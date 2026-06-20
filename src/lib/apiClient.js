import { KRYSTAL_DATA } from "./data.js";
import { createStore } from "./store.js";
import { LIVE, API_V1 } from "./config.js";
import * as adapt from "./adapters.js";

// alertsStore + sessionStore are used only inside request methods (deferred,
// `?`-guarded). Static imports would put this base module in init cycles
// (apiClient<->alertsApi, apiClient->sessionStore->stores->apiClient), so
// resolve them lazily after the module graph settles.
let alertsStore = null;
import("./alertsApi.js").then((m) => { alertsStore = m.alertsStore; });
let sessionStore = null;
import("./sessionStore.js").then((m) => { sessionStore = m.sessionStore; });
// Lazy: apiClient is the base layer; it touches the domain stores only in
// deferred call-time paths (request handlers + the degraded-mode poll loop). A
// static import would re-form the apiClient<->stores init cycle.
let storesNs = null;
import("./stores.js").then((m) => { storesNs = m; });

// apiClient.js — the single seam between the client and the backend.
//
// Everything that talks to the server goes through api. This mock
// resolves from KRYSTAL_DATA with simulated latency so the prototype
// behaves like a real (slightly laggy) network. To go live, replace the bodies
// of get/post/patch with fetch() against /api/v1, and `stream.subscribe` with a
// real WebSocket that routes topic messages into the domain stores. The call
// sites (stores) never change. See architecture.html (§3, §3·b).

  const LATENCY = 300;
  // `slow` stretches every simulated round-trip so loading skeletons are
  // actually visible (a real backend's latency, on demand). Boot with ?slow=1
  // or toggle from the ?dev panel. Default off → instant fixture hydration.
  let slow = (() => {
    try { return new URLSearchParams(window.location.search).get("slow") === "1" || localStorage.getItem("krystal:slow") === "1"; }
    catch (e) { return false; }
  })();
  const lat = () => (slow ? 1400 : LATENCY);
  const later = (value, ms) => new Promise(res => setTimeout(() => res(value), ms == null ? lat() : ms));
  const DATA = () => KRYSTAL_DATA || {};

  // ---- connection health (drives the resilience layer) -------------------
  // `health` is the simulated backend reachability. Flip it with
  // api.__setHealth('down'|'ok') or boot with ?api=down to demo the
  // cold-start + degraded states. connectionStore is the reactive signal the
  // shell reads: 'connecting' (booting), 'live' (reachable), 'down'
  // (unreachable). `everLoaded` separates a COLD start (never succeeded → full
  // takeover) from a WARM drop (succeeded before → non-blocking banner).
  const qpDown = (() => {
    try { return new URLSearchParams(window.location.search).get("api") === "down"; }
    catch (e) { return false; }
  })();
  let health = qpDown ? "down" : "ok";

  const connectionStore = createStore({
    status: qpDown ? "down" : "connecting",
    everLoaded: false,
    failures: 0,
    retrying: false,
  });

  // ---- realtime channel health (PER-HOST WebSocket + the browser online state) --
  // Distinct from REST reachability above. connectionStore answers "can we
  // FETCH?" (the cold takeover + warm banner). realtimeStore answers "is the
  // live PUSH channel up?" — and that channel is PER HOST: the panel is a sink
  // aggregating N hosts, each running its own agent over its own WebSocket. One
  // host's link can drop while the others keep streaming, so there is no single
  // global "live" state — only `online` (does the BROWSER have a network at
  // all?) plus a per-host socket. When a host's link drops we don't blank its
  // data: we fall back to interval polling of its REST endpoints (stale-while-
  // revalidate, no skeleton flash), surface it on that host's own UI + a banner
  // naming it, and on reconnect re-subscribe + re-hydrate. This is the
  // "Realtime fallback" promised in architecture.html (§3·j).
  //
  //   per host →  'live'         socket connected, that host is pushing
  //               'reconnecting' its link dropped but we're online — polling it
  //   global   →  'offline'      the browser itself reports no network (every
  //                              host link is down at once)
  const nav = (typeof navigator !== "undefined") ? navigator : { onLine: true };
  let online = nav.onLine !== false;
  const POLL_EVERY = 4000;                       // REST poll cadence while degraded
  const RECONNECT_BASE = 2500, RECONNECT_CAP = 12000;

  // Per-host channel runtime. Keyed by host id; created lazily so hosts added
  // at runtime (the Fleet "Add host" flow) get a channel too.
  const hostKnown = () => (KRYSTAL_DATA && KRYSTAL_DATA.hosts || []).map(h => h.id);
  const chans = {};   // id -> { socket, held, attempts, nextRetryInMs, lastSyncAt, reconnectTimer, countdownTimer }
  function chan(id) {
    if (!chans[id]) chans[id] = {
      socket: online && health === "ok", held: false, attempts: 0,
      nextRetryInMs: 0, lastSyncAt: Date.now(), reconnectTimer: null, countdownTimer: null,
    };
    return chans[id];
  }
  hostKnown().forEach(chan);   // seed from the fixture

  let pollTimer = null;        // ONE shared poll loop while any host is degraded
  const backoff = (n) => Math.min(RECONNECT_BASE * Math.pow(2, n), RECONNECT_CAP);

  const realtimeStore = createStore({ online, hosts: {} });

  // Project the internal channel map into the (serialisable) store the UI reads.
  const hostMode = (c) => (!online ? "offline" : (c.socket ? "live" : "reconnecting"));
  function syncStore() {
    const hosts = {};
    Object.keys(chans).forEach(id => {
      const c = chans[id];
      hosts[id] = { mode: hostMode(c), attempts: c.attempts, nextRetryInMs: c.nextRetryInMs, lastSyncAt: c.lastSyncAt, polling: !!pollTimer && hostMode(c) === "reconnecting" };
    });
    realtimeStore.setState({ online, hosts });
  }
  const anyDegraded = () => online && Object.keys(chans).some(id => !chans[id].socket);

  // Shared interval polling fallback. While ANY host's push channel is down (and
  // we're online), re-fetch the live surfaces. The store refreshes are stale-
  // while-revalidate, so current data stays on screen (no skeleton flash) — it
  // just refreshes underneath. In production each degraded host would poll only
  // its own endpoints; the mock's stores are shared, so one loop covers it.
  function pollOnce() {
    const jobs = [];
    ["serversStore", "hostsStore", "auditStore"].forEach(name => {
      const st = storesNs && storesNs[name];
      if (st && st.refresh && st.getState().everLoaded) jobs.push(st.refresh().catch(() => {}));
    });
    Promise.all(jobs).then(() => {
      const t = Date.now();
      Object.keys(chans).forEach(id => { if (!chans[id].socket) chans[id].lastSyncAt = t; });
      syncStore();
    });
  }
  function refreshPolling() {
    if (anyDegraded() && !pollTimer) { pollOnce(); pollTimer = setInterval(pollOnce, POLL_EVERY); }
    else if (!anyDegraded() && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function clearHostTimers(c) {
    if (c.reconnectTimer) { clearTimeout(c.reconnectTimer); c.reconnectTimer = null; }
    if (c.countdownTimer) { clearInterval(c.countdownTimer); c.countdownTimer = null; }
  }
  // Schedule one host's next reconnect attempt with exponential backoff, ticking
  // a 1s countdown so its indicator can show "retrying in Ns".
  function scheduleReconnect(id) {
    const c = chan(id);
    clearHostTimers(c);
    let remaining = backoff(c.attempts);
    c.nextRetryInMs = remaining;
    syncStore();
    c.countdownTimer = setInterval(() => {
      remaining = Math.max(0, remaining - 1000);
      c.nextRetryInMs = remaining;
      syncStore();
    }, 1000);
    c.reconnectTimer = setTimeout(() => attemptReconnect(id), remaining);
  }
  // Try to bring ONE host's push channel back. Succeeds only when we're online,
  // the dev hasn't pinned it down, and the backend is reachable — else we stay
  // 'reconnecting' and back off again. On success that host re-subscribes (its
  // emit() resumes) and the surfaces re-hydrate once.
  function attemptReconnect(id) {
    const c = chan(id);
    clearHostTimers(c);
    c.attempts += 1;
    if (!online) { c.nextRetryInMs = 0; syncStore(); return; }
    if (c.held || health === "down") { syncStore(); scheduleReconnect(id); return; }
    c.socket = true;
    c.attempts = 0;
    c.nextRetryInMs = 0;
    c.lastSyncAt = Date.now();
    refreshPolling();
    syncStore();
    rehydrateAll();
  }
  function rehydrateAll() {
    ["serversStore", "hostsStore", "auditStore", "libraryStore"].forEach(name => {
      const st = storesNs && storesNs[name];
      if (st && st.refresh) st.refresh().catch(() => {});
    });
  }
  // One host's link dropped (dev toggle, backend down, or a transient blip).
  // Don't blank its data: start the shared polling fallback + its reconnect loop.
  function dropHost(id) {
    const c = chan(id);
    if (!c.socket && c.reconnectTimer) return;   // already degraded
    c.socket = false;
    c.attempts = 0;
    refreshPolling();
    if (online) scheduleReconnect(id);
    else clearHostTimers(c);
    syncStore();
  }
  const forEachHost = (fn) => Object.keys(chans).forEach(fn);

  // Browser network transitions — these ARE global (no network = every host
  // link is down). Offline → polling is pointless; pause it all and show
  // 'offline'. Online → try to reconnect every host.
  function handleOffline() {
    online = false;
    forEachHost(id => { chans[id].socket = false; clearHostTimers(chans[id]); });
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    syncStore();
  }
  function handleOnline() {
    online = true;
    syncStore();
    forEachHost(id => attemptReconnect(id));
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
  }

  // Which host does a pushed message belong to? server.patch carries the
  // serverId as `id`; console/jobs carry `serverId`; some carry `hostId`
  // directly. Used to gate emit() so a dropped host freezes only ITS servers.
  function messageHost(message) {
    const d = message && message.data;
    if (!d) return null;
    if (d.hostId) return d.hostId;
    const sid = d.serverId || d.id;
    if (!sid) return null;
    // Prefer the live store (covers servers installed at runtime), fall back to
    // the fixture.
    const s = (storesNs && storesNs.serversStore && storesNs.serversStore.find(sid))
      || (KRYSTAL_DATA.servers || []).find(x => x.id === sid);
    return s ? s.hostId : null;
  }

  // Public: a user-driven "Reconnect now" from a host's indicator (or all).
  function reconnectHost(id) { const c = chan(id); clearHostTimers(c); c.attempts = 0; attemptReconnect(id); }
  function reconnectAll() { forEachHost(reconnectHost); }
  // Dev/demo: pin one host's channel up or down from the ?dev panel.
  function setHostSocket(id, state) {
    const c = chan(id);
    if (state === "down") { c.held = true; dropHost(id); }
    else { c.held = false; if (!c.socket) reconnectHost(id); }
    return c.held ? "down" : (c.socket ? "up" : "reconnecting");
  }
  const hostSocket = (id) => { const c = chan(id); return c.held ? "down" : (c.socket ? "up" : "reconnecting"); };

  function markSuccess() {
    const s = connectionStore.getState();
    if (s.status !== "live" || !s.everLoaded || s.failures || s.retrying) {
      connectionStore.setState({ status: "live", everLoaded: true, failures: 0, retrying: false });
    }
  }
  function markFailure() {
    connectionStore.setState(s => ({ ...s, status: "down", failures: s.failures + 1, retrying: false }));
  }
  function netError() {
    const e = new Error("Can't reach the Krystal backend (network).");
    e.code = "ECONNREFUSED";
    e.userMessage = "Can't reach Krystal.";
    return e;
  }
  // Every REST call routes through here: simulate the round-trip, then either
  // fail (health down) or succeed — updating the connection signal as a side
  // effect so the banner / cold screen react to real traffic.
  async function guard(produce) {
    await later(null);
    if (health === "down") { markFailure(); throw netError(); }
    const out = produce();
    markSuccess();
    return out;
  }

  function mintToken(id) { return "tok_" + (id || "h") + "_" + Math.random().toString(36).slice(2, 10); }

  // ---- live transport (real backend) -------------------------------------
  // When VITE_API_BASE is set we hit a real kgsm-api over fetch and translate
  // its honest DTOs into the shapes the components read (see adapters.js). The
  // connection signal tracks REACHABILITY: any HTTP response (even 4xx/5xx)
  // means the host answered → markSuccess; only a transport throw is "down".
  function apiError(status, body) {
    const env = body && body.error ? body.error : {};
    const e = new Error(env.message || ("HTTP " + status));
    e.code = status;                 // numeric — the host-auth gate keys on 401/403
    e.envCode = env.code || null;
    e.status = status;
    e.userMessage = env.message || "The server returned an error.";
    return e;
  }
  // The selected host's bearer, when we hold a live one. Null under
  // KGSM_API_AUTH_DISABLED (no token is minted) → the call goes out
  // unauthenticated, which that mode accepts. Reuses the same late-bound
  // sessionStore/storesNs refs as the host-auth gate below (no init cycle).
  function liveBearer() {
    try {
      const id = storesNs && storesNs.selectedHostStore && storesNs.selectedHostStore.getState().id;
      if (sessionStore && sessionStore.tokenOf && id && id !== "all") return sessionStore.tokenOf(id);
    } catch (e) {}
    return null;
  }
  async function liveFetch(method, path, body) {
    const headers = body != null
      ? { "Content-Type": "application/json", Accept: "application/json" }
      : { Accept: "application/json" };
    const tok = liveBearer();
    if (tok) headers.Authorization = "Bearer " + tok;
    let res;
    try {
      res = await fetch(API_V1 + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
    } catch (e) { markFailure(); throw netError(); }
    markSuccess();                   // the host answered → reachable
    if (res.status === 204) return null;
    let json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    if (!res.ok) throw apiError(res.status, json);
    return json;
  }
  // Map a logical FE path onto its response adapter (GET only; writes pass through).
  function adaptResponse(path, json) {
    if (path === "/servers") return adapt.adaptServers(json);
    if (path === "/hosts") return adapt.adaptHosts(json);
    if (path === "/library") return adapt.adaptLibrary(json);
    if (path === "/audit") return adapt.adaptAudit(json);
    if (path === "/alerts") return adapt.adaptAlerts(json);
    if (path === "/me") return adapt.adaptMe(json);
    if (/^\/servers\/[^/?]+$/.test(path)) return adapt.adaptServer(json);
    if (/^\/hosts\/[^/?]+$/.test(path)) return adapt.adaptHost(json);
    return json;
  }
  const liveGet = (path) => liveFetch("GET", path).then((j) => adaptResponse(path, j));
  const livePost = (path, body) => liveFetch("POST", path, body);
  const livePatch = (path, body) => liveFetch("PATCH", path, body);

  function resolveGet(path) {
    if (path === "/servers") return (DATA().servers || []).map(s => ({ ...s }));
    if (path === "/alerts")  return alertsStore ? alertsStore.getState().list.map(a => ({ ...a })) : [];
    if (path === "/hosts")   return (DATA().hosts || []).map(h => ({ ...h }));
    if (path === "/audit")   return (DATA().auditLog || []).slice();
    if (path === "/library") return (DATA().catalog || []).slice();
    const srv = path.match(/^\/servers\/([^/]+)$/);
    if (srv) return (DATA().servers || []).find(s => s.id === srv[1]) || null;
    // ---- per-host identity bootstrap (Model A, §6·a) --------------------
    // The popup lands here. The host verifies the Discord identity once
    // (/users/@me, then discards the token) and answers with its own bot-
    // resolved verdict + a host-scoped session token. A host flagged
    // authDenied returns a 403-style verdict the SPA renders as terminal.
    if (path.indexOf("/auth/") === 0 && path.indexOf("/callback") !== -1) {
      const qs = path.indexOf("?") === -1 ? "" : path.slice(path.indexOf("?") + 1);
      const id = new URLSearchParams(qs).get("host");
      const host = (storesNs && storesNs.hostsStore && storesNs.hostsStore.find(id))
        || (DATA().hosts || []).find(h => h.id === id) || null;
      if (host && host.authDenied) return { verdict: "denied", tier: "none", user_id: "discord:872" };
      return { verdict: "ok", tier: (host && host.tier) || "operator", token: mintToken(id), user_id: "discord:872" };
    }
    throw new Error("mock api: unhandled GET " + path);
  }
  async function get(path) {
    if (LIVE) return liveGet(path);
    return guard(() => resolveGet(path));
  }

  // PATCH/POST are acknowledgements — the store applies the result. A real
  // backend returns the authoritative resource here.
  async function patch(path, body) {
    if (LIVE) return livePatch(path, body);
    return guard(() => {
      const alert = path.match(/^\/alerts\/([^/]+)$/);
      if (alert) return { id: alert[1], ...body };
      return { ok: true, path, body };
    });
  }
  async function post(path, body) {
    if (LIVE) return livePost(path, body);
    // Health-gate first so a down backend rejects commands too.
    await later(null);
    if (health === "down") { markFailure(); throw netError(); }
    markSuccess();
    // Rotate a host-scoped session token without a Discord round-trip (§6·a).
    if (path === "/auth/session/refresh") return { ok: true, token: mintToken((body || {}).host || "h") };
    const cmd = path.match(/^\/servers\/([^/]+)\/commands$/);
    if (cmd) return runServerCommand(cmd[1], (body || {}).verb);
    return { ok: true, path, body };
  }

  // Dev/demo control: flip simulated backend reachability at runtime.
  function setHealth(state) {
    health = (state === "down") ? "down" : "ok";
    if (health === "down") {
      markFailure();
      // A dead backend means every host's push channel is dead too — drop them
      // all so the per-host indicators + polling fallback reflect reality.
      forEachHost(dropHost);
    } else {
      const s = connectionStore.getState();
      if (s.everLoaded) markSuccess();
      else connectionStore.setState(cs => ({ ...cs, status: "connecting" }));
      // Backend's back: bring every host's channel up (unless dev pinned it down).
      forEachHost(id => { if (!chans[id].socket && !chans[id].held) reconnectHost(id); });
    }
    return health;
  }

  // ---- mock WebSocket -----------------------------------------------------
  // Real impl: one socket; subscribe(topics) tells the server what to push,
  // and each inbound { topic, type, data } is dispatched to the owning store.
  // Here, listeners register topics and the mock backend calls emit().
  const listeners = new Set();
  function emit(topic, message) {
    // No browser network — nothing can push. Otherwise gate per host: a dropped
    // host's channel can't deliver ITS servers' events, so live updates freeze
    // for that host while the others keep streaming (the polling fallback
    // re-hydrates the frozen one). Mirrors N independent WebSockets.
    if (!online) return;
    const hid = messageHost(message);
    if (hid && chans[hid] && !chans[hid].socket) return;
    for (const l of listeners) if (l.topics.has(topic)) { try { l.fn({ topic, ...message }); } catch (e) {} }
  }
  const stream = {
    subscribe(topics, onMessage) {
      const entry = { topics: new Set(topics), fn: onMessage };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },
  };

  // ---- mock server runtime ------------------------------------------------
  // Stands in for KGSM: processes a lifecycle command by pushing status +
  // console + job events over the stream, exactly as the real monitor would.
  // This is the fake state machine that used to live in App, now server-side.
  function runServerCommand(id, verb) {
    const jobId = "job_" + Math.random().toString(36).slice(2, 7);
    const clock = () => new Date().toTimeString().slice(0, 8);
    const patchServer = (data) => emit("servers", { type: "server.patch", data: { id, ...data } });
    const consoleLine = (line) => emit("console", { type: "console.line", data: { serverId: id, line } });
    const job = (state) => emit("jobs", { type: "job", data: { id: jobId, serverId: id, verb, state } });

    job("running");
    if (verb === "start") {
      consoleLine({ ts: clock(), tag: "info", text: "Starting server\u2026" });
      setTimeout(() => { patchServer({ status: "online", uptime: "0h 0m 04s" }); consoleLine({ ts: clock(), tag: "ok", text: "Server online" }); job("done"); }, 800);
    } else if (verb === "stop") {
      consoleLine({ ts: clock(), tag: "info", text: "Shutdown requested" });
      setTimeout(() => { patchServer({ status: "offline", uptime: "\u2014" }); consoleLine({ ts: clock(), tag: "ok", text: "Server stopped" }); job("done"); }, 800);
    } else if (verb === "restart") {
      consoleLine({ ts: clock(), tag: "warn", text: "Restarting \u2014 players will be disconnected" });
      patchServer({ status: "updating", uptime: "\u2014" });
      setTimeout(() => { patchServer({ status: "online", uptime: "0h 0m 02s" }); consoleLine({ ts: clock(), tag: "ok", text: "Server back online" }); job("done"); }, 1400);
    } else if (verb === "update") {
      consoleLine({ ts: clock(), tag: "info", text: "Checking for updates\u2026" });
      patchServer({ status: "updating" });
      setTimeout(() => { patchServer({ status: "online", uptime: "0h 0m 01s" }); consoleLine({ ts: clock(), tag: "ok", text: "Already on latest version" }); job("done"); }, 1600);
    } else {
      job("done");
    }
    return Promise.resolve({ job: { id: jobId, verb, serverId: id, state: "running" } });
  }

  // ---- mock alerts monitor ------------------------------------------------
  // Stands in for the host-monitor / watchdog deciding, on its own, that an
  // alert's condition is now handled, and pushing the authoritative change over
  // the `alerts` channel — exactly as the real backend would. Drives the demo
  // "simulate monitor resolution" trigger on the Alerts page. Picks the named
  // alert, or the next active one that declares it can auto-resolve.
  function mockMonitorResolve(id) {
    const list = alertsStore ? alertsStore.getState().list : [];
    const target = id
      ? list.find(a => a.id === id && a.status === "firing")
      : list.find(a => a.status === "firing" && a.autoResolves && !a.escalated);
    if (!target) return null;
    const r = target.autoResolves || { source: target.source, reason: "Condition cleared." };
    // A beat of latency so it reads as the server deciding, not a local toggle.
    setTimeout(() => emit("alerts", { type: "alert.resolve", data: {
      id: target.id, status: "completed", resolution: { source: r.source, reason: r.reason },
    } }), 480);
    return target.id;
  }

  function setSlow(b) {
    slow = !!b;
    try { localStorage.setItem("krystal:slow", slow ? "1" : "0"); } catch (e) {}
    return slow;
  }

  // ---- per-host auth gate (Model A) ---------------------------------------
  // api.host(id) is the host-scoped client: it injects that host's bearer and
  // enforces the 401/403/login_required state machine before any call. denied
  // → 403 (terminal); none/expired → lazily (re)bootstrap, then re-check.
  function hostAuthStatus(id) {
    try { return sessionStore ? sessionStore.statusOf(id) : "live"; } catch (e) { return "live"; }
  }
  function authError(code, id) {
    const e = new Error(code === 403 ? "Forbidden on host " + id : "Unauthorized on host " + id);
    e.code = code; e.authState = code === 403 ? "denied" : "expired"; e.hostId = id;
    e.userMessage = code === 403 ? "You don’t have permission on this host." : "Your session expired.";
    return e;
  }
  function hostScoped(id) {
    // Pre-call gate: only SILENT recovery (sessionStore.ensure never pops an
    // interactive Discord consent — that needs a user gesture, i.e. the re-auth
    // modal). If silent recovery can't heal it, the call fails with 401 and the
    // UI surfaces the per-host expired state + Re-authorize.
    const ensure = () => {
      const st = hostAuthStatus(id);
      if (st === "denied") return Promise.reject(authError(403, id));
      if (st === "live") return Promise.resolve();
      if (!sessionStore) return Promise.resolve();
      return sessionStore.ensure(id).then(r => {
        if (r === "denied") throw authError(403, id);
        if (r !== "live") throw authError(401, id);
      });
    };
    // Reactive interceptor: a call that passed the gate can STILL come back 401
    // if the token died mid-flight (early expiry, clock skew, host restart).
    // Mark the host expired, attempt ONE silent heal, and replay the request
    // once. Only if that still fails does the 401 propagate to the UI. A
    // pre-call gate rejection is NOT retried (it's already a silent attempt).
    const withRetry = (call) => ensure().then(() => call().catch(err => {
      if (!err || err.code !== 401 || !sessionStore) throw err;
      sessionStore.expire(id);
      return sessionStore.ensure(id).then(r => {
        if (r !== "live") throw authError(401, id);
        return call();
      });
    }));
    return {
      get: (p) => withRetry(() => get(p)),
      post: (p, b) => withRetry(() => post(p, b)),
      patch: (p, b) => withRetry(() => patch(p, b)),
    };
  }

  const api = {
    get, post, patch, stream, mockMonitorResolve,
    host: hostScoped,
    reconnectHost, reconnectAll,
    __setHealth: setHealth, __health: () => health,
    __setSlow: setSlow, __slow: () => slow,
    __setHostSocket: setHostSocket, __hostSocket: hostSocket,
    __hostAuth: hostAuthStatus,
  };

export { api, connectionStore, realtimeStore };
