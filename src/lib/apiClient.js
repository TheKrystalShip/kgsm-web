import { KRYSTAL_DATA } from "./data.js";
import { createStore } from "./store.js";
import { LIVE, MOCK, API_V1, WS_URL, apiV1Of, apiOriginOf, wsUrlOf, CONNECTIONS } from "./config.js";
import * as adapt from "./adapters.js";
import { createLiveStream } from "./liveStream.js";

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
import("./stores.js").then((m) => {
  storesNs = m;
  // The first live WS open can land before the host list hydrates → re-key the
  // realtime indicator under the real host id once hosts arrive (LIVE only;
  // single-host — multi-host fan-out is a later slice). Reuses this one dynamic
  // import (no second one) since `live`/`setLiveRealtime` are defined by the time
  // this microtask runs.
  if (LIVE && liveStreams.length && m.hostsStore) {
    // Re-key each stream's realtime entry under its connection's (now possibly
    // reconciled) host id once hosts hydrate — matters for a lone seed (id-less
    // at boot); registered hosts already key by their real id.
    try { m.hostsStore.subscribe(() => liveStreams.forEach((s, i) => setLiveRealtime(CONNECTIONS[i] && CONNECTIONS[i].id, s.mode()))); } catch (e) {}
  }
});

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
  // Seed the SIMULATED per-host channels from the fixture (mock mode only). In
  // LIVE the real WebSocket (createLiveStream, below) owns realtimeStore for the
  // single live host — the fixture host ids don't match the backend, so seeding
  // them here would project a phantom fleet. (Multi-host live fan-out = later slice.)
  if (MOCK) hostKnown().forEach(chan);

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
    // alertsStore lives in alertsApi.js (late-bound above), not the stores ns.
    if (alertsStore && alertsStore.refresh) alertsStore.refresh().catch(() => {});
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
  // OFFLINE: no connection configured and not the fixtures demo. The app shows the
  // connect screen before any data surface, so this is a defensive backstop — a
  // stray call returns an honest "not connected", never silently mock data.
  function offlineError() {
    const e = new Error("No kgsm-api host is connected.");
    e.code = "EOFFLINE";
    e.userMessage = "Connect a host to get started.";
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
  // A host's bearer, when we hold a live one. Null under KGSM_API_AUTH_DISABLED
  // (no token is minted) → the call goes out unauthenticated, which that mode
  // accepts. Pass the explicit host id for a host-scoped call (api.host(id));
  // an unscoped call falls back to the selected host. Reuses the same late-bound
  // sessionStore/storesNs refs as the host-auth gate below (no init cycle).
  function liveBearer(hostId) {
    try {
      const id = hostId || (storesNs && storesNs.selectedHostStore && storesNs.selectedHostStore.getState().id);
      if (sessionStore && sessionStore.tokenOf && id && id !== "all") return sessionStore.tokenOf(id);
    } catch (e) {}
    return null;
  }
  // hostId routes the call to that host's base URL + bearer (multi-host). With a
  // single connection apiV1Of() ignores the id (sole-connection fallback) so N=1
  // is byte-identical to the old single global-API_V1 path.
  async function liveFetch(method, path, body, hostId, bearerOverride, baseOverride) {
    const headers = body != null
      ? { "Content-Type": "application/json", Accept: "application/json" }
      : { Accept: "application/json" };
    // bearerOverride lets a caller send a specific bearer (the refresh-token
    // rotation needs the REFRESH token, not the access token the seam injects).
    // `undefined` = use the host's live access bearer; a string/null = send/omit as given.
    const tok = bearerOverride !== undefined ? bearerOverride : liveBearer(hostId);
    if (tok) headers.Authorization = "Bearer " + tok;
    // baseOverride routes off the default /api/v1 base (the auth endpoints are
    // root-routed on the backend, not under /api/v1).
    const base = baseOverride !== undefined ? baseOverride : (apiV1Of(hostId) || API_V1);
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
    } catch (e) { markFailure(); throw netError(); }
    markSuccess();                   // the host answered → reachable
    if (res.status === 204) return null;
    let json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    if (!res.ok) throw apiError(res.status, json);
    return json;
  }
  // Map a logical FE path onto its response adapter (GET only; writes pass
  // through). Match on the path WITHOUT its query string so paginated/filtered
  // reads (e.g. /alerts?status=resolved, /audit?cursor=…) still hit their adapter.
  function adaptResponse(path, json) {
    const base = path.split("?")[0];
    if (base === "/servers") return adapt.adaptServers(json);
    if (base === "/hosts") return adapt.adaptHosts(json);
    if (base === "/library") return adapt.adaptLibrary(json);
    if (base === "/audit") return adapt.adaptAudit(json);
    if (base === "/alerts") return adapt.adaptAlerts(json);
    if (base === "/me") return adapt.adaptMe(json);
    if (/^\/servers\/[^/]+$/.test(base)) return adapt.adaptServer(json);
    if (/^\/hosts\/[^/]+$/.test(base)) return adapt.adaptHost(json);
    if (/^\/integrations\/[^/]+$/.test(base)) return adapt.adaptIntegration(json);
    return json;
  }
  const liveGet = (path, hostId) => liveFetch("GET", path, null, hostId).then((j) => adaptResponse(path, j));
  const livePost = (path, body, hostId) => liveFetch("POST", path, body, hostId);
  const livePatch = (path, body, hostId) => liveFetch("PATCH", path, body, hostId);

  // Rotate a host's access token from its long-lived refresh token (§6·a): POST
  // /auth/session/refresh with the REFRESH token as the bearer (NOT the access
  // token the seam would inject) → { token, tier } (a fresh access token + the
  // role from the refresh claims). No Discord round-trip. Past the refresh token's
  // absolute cap the backend 401s → the caller (sessionStore.refresh) treats it as
  // genuinely expired. ⚠ The endpoint is ROOT-routed (/auth/session/refresh), NOT
  // under /api/v1 — so pass the bare origin as the base override. MOCK mints a
  // token to mirror the old inline /auth/session/refresh stub.
  function refreshSession(hostId, refreshToken) {
    if (LIVE) return liveFetch("POST", "/auth/session/refresh", null, hostId, refreshToken || null, apiOriginOf(hostId));
    if (MOCK) return Promise.resolve({ token: mintToken(hostId) });
    return Promise.reject(offlineError());
  }

  // ---- live assistant turn (SSE) ------------------------------------------
  // The assistant turn is neither a request/response call nor a WS topic: it's a
  // POST that returns a long-lived text/event-stream relaying the assistant's
  // §5·a frames (text.delta / tool.start / tool.result / command.proposed /
  // error / done — see kgsm-llm/docs/m7-sse-5a-spec.md). The backend (kgsm-api
  // AssistantController) relays the per-host assistant leaf verbatim and decides
  // the capability degrade (absent→404 / down→503 / relay-misconfig→502) BEFORE
  // the stream commits — so those land as a thrown apiError here, while a turn
  // that DID commit surfaces its own failures as an in-band `error` frame.
  //
  // Parse one SSE event block → its in-band JSON payload. Each frame carries both
  // an `event:` line and a `data:` line with an in-band `type` discriminator; we
  // key on the canonical in-band `type`, so the `event:` line is ignored. Per the
  // SSE spec, multiple `data:` lines concatenate with "\n" (the writer emits one).
  function parseSseEvent(block) {
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) return null;
    try { return JSON.parse(data.join("\n")); } catch (e) { return null; }
  }
  // POST /assistant/turn and pump §5·a frames to onEvent until the stream ends.
  // `bearer` is the assistant host's token (null under auth-disabled → unauth,
  // which that mode accepts). A pre-stream non-2xx throws apiError (the honest
  // 404/503/502); an abort rethrows so the caller can render "stopped"; any other
  // mid-stream transport drop just ends the pump (the accumulated text stays — we
  // never invent a `done` that didn't arrive).
  async function liveTurn(bearer, body, opts, hostId) {
    const { onEvent, signal } = opts || {};
    const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
    if (bearer) headers.Authorization = "Bearer " + bearer;
    const base = apiV1Of(hostId) || API_V1;
    let res;
    try {
      res = await fetch(base + "/assistant/turn", { method: "POST", headers, body: JSON.stringify(body), signal });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      markFailure(); throw netError();
    }
    markSuccess();                          // the host answered → reachable
    if (!res.ok) {
      let json = null; try { json = await res.json(); } catch (e) { json = null; }
      throw apiError(res.status, json);     // pre-stream degrade (404/503/502/400)
    }
    if (!res.body) return;                  // nothing to stream (shouldn't happen on 200)
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      let chunk;
      try { chunk = await reader.read(); }
      catch (e) { if (e && e.name === "AbortError") throw e; break; }   // drop → keep what streamed
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const evt = parseSseEvent(block);
        if (evt && onEvent) onEvent(evt);
      }
    }
    // Flush a trailing complete block with no terminating blank line (defensive).
    const tail = buf.trim();
    if (tail) { const evt = parseSseEvent(tail); if (evt && onEvent) onEvent(evt); }
  }

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
  async function get(path, hostId) {
    if (LIVE) return liveGet(path, hostId);
    if (MOCK) return guard(() => resolveGet(path));
    return Promise.reject(offlineError());
  }

  // PATCH/POST are acknowledgements — the store applies the result. A real
  // backend returns the authoritative resource here.
  async function patch(path, body, hostId) {
    if (LIVE) return livePatch(path, body, hostId);
    if (!MOCK) return Promise.reject(offlineError());
    return guard(() => {
      const alert = path.match(/^\/alerts\/([^/]+)$/);
      if (alert) return { id: alert[1], ...body };
      return { ok: true, path, body };
    });
  }
  async function post(path, body, hostId) {
    if (LIVE) return livePost(path, body, hostId);
    if (!MOCK) return Promise.reject(offlineError());
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
  let liveStreams = [];   // one real WebSocket per connection (LIVE only); assigned below
  // Transport-agnostic dispatch seam: deliver one { topic, type, data } frame to
  // every listener subscribed to its topic. BOTH the mock backend (emit, with
  // per-host gating) and the live WebSocket (onMessage, below) feed through here,
  // so the store subscribers are identical in either mode.
  function dispatchMessage(full) {
    for (const l of listeners) if (l.topics.has(full.topic)) { try { l.fn(full); } catch (e) {} }
  }
  function emit(topic, message) {
    // No browser network — nothing can push. Otherwise gate per host: a dropped
    // host's channel can't deliver ITS servers' events, so live updates freeze
    // for that host while the others keep streaming (the polling fallback
    // re-hydrates the frozen one). Mirrors N independent WebSockets.
    if (!online) return;
    const hid = messageHost(message);
    if (hid && chans[hid] && !chans[hid].socket) return;
    dispatchMessage({ topic, ...message });
  }
  const topicStillWanted = (topic) => {
    for (const l of listeners) if (l.topics.has(topic)) return true;
    return false;
  };
  const stream = {
    subscribe(topics, onMessage) {
      const entry = { topics: new Set(topics), fn: onMessage };
      listeners.add(entry);
      if (LIVE) liveStreams.forEach((s) => s.subscribe(topics));   // every host pushes these
      return () => {
        listeners.delete(entry);
        // Tell the real sockets to stop pushing any topic no remaining listener still
        // wants — this is what re-idles the server's subscriber-gated pumps when a
        // DYNAMIC subscription is torn down (the diagnostics deep-dive's
        // hosts/{id}/metrics). The app-lifetime subscriptions (servers/jobs/audit) never
        // dispose, so this branch only ever runs for those dynamic topics.
        if (LIVE) {
          const drop = [...entry.topics].filter((t) => !topicStillWanted(t));
          if (drop.length) liveStreams.forEach((s) => s.unsubscribe(drop));
        }
      };
    },
  };

  // ---- live realtime adaptation (the WS parallel of adaptResponse) --------
  // Reshape a live server→client frame into the FE shapes the stores hold. The
  // mock feed is already FE-shaped (fixtures), so ONLY the live path runs this.
  // Unknown topics/types pass through untouched — a new server message must never
  // crash an old client (forward-compatible).
  function adaptStreamMessage(msg) {
    if (!msg) return msg;
    const { topic, type, data } = msg;
    if (topic === "servers" && type === "server.patch") return { topic, type, data: adapt.adaptServer(data) };
    if (topic === "jobs" && type === "job.patch") return { topic, type, data: adapt.adaptJob(data) };
    if (topic === "alerts" && type === "alert.raise") return { topic, type, data: adapt.adaptAlert(data) };
    // host.metrics rides hosts/{id}/metrics — reshape the HostMetricsDto into the FE telemetry partial
    // (the WS parallel of adaptResponse for GET /hosts/{id}). The store merges it clobber-safe by id.
    if (type === "host.metrics" && /^hosts\/[^/]+\/metrics$/.test(topic || "")) return { topic, type, data: adapt.adaptHostMetrics(data) };
    // server.removed {id}, alert.resolve {id,resolution}, alert.retract {id} and
    // audit.append (a record — adaptAudit is per-row identity) need no reshaping.
    return msg;
  }

  // ---- live realtime transport (one WebSocket PER connection) -------------
  // Picked only when LIVE. Drives realtimeStore (NOT connectionStore — liveFetch
  // already owns REST reachability via markSuccess/markFailure). On every (re)open
  // it re-hydrates the REST stores to catch deltas missed while the socket was
  // down (§3·j). Multi-host: one socket per registered connection, each feeding the
  // SAME dispatchMessage seam, so frames from every host land in the shared stores
  // (keyed by id). realtimeStore is keyed per host and MERGED (never clobbered) so
  // one host's link state doesn't overwrite another's.
  function liveHostId() {
    try { return ((storesNs && storesNs.hostsStore && storesNs.hostsStore.getState().list[0]) || {}).id || null; }
    catch (e) { return null; }
  }
  function setLiveRealtime(connId, mode) {
    const id = connId || liveHostId() || "live";
    realtimeStore.setState((s) => ({ online, hosts: { ...s.hosts, [id]: { mode, attempts: 0, nextRetryInMs: 0, lastSyncAt: Date.now(), polling: mode === "reconnecting" } } }));
  }
  if (LIVE && CONNECTIONS.length) {
    liveStreams = CONNECTIONS.map((conn) => createLiveStream({
      url: wsUrlOf(conn.id),                 // sole-fallback for a lone seed; exact for registered hosts
      bearer: () => liveBearer(conn.id),     // that host's token (null under auth-disabled)
      onOpen: () => rehydrateAll(),
      onMessage: (raw) => dispatchMessage(adaptStreamMessage(raw)),
      onMode: (mode) => setLiveRealtime(conn.id, mode),
    }));
    // (re-keying a seed connection's realtime under its reconciled host id once
    // hosts hydrate is wired into the storesNs import at the top — no 2nd import.)
  }

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
      // Every call carries THIS host's id → liveFetch routes to its base URL +
      // bearer (multi-host). Sole-connection fallback keeps N=1 identical.
      get: (p) => withRetry(() => get(p, id)),
      post: (p, b) => withRetry(() => post(p, b, id)),
      patch: (p, b) => withRetry(() => patch(p, b, id)),
      // Assistant turn (live-only SSE). Pre-call gate only (ensure) — a turn isn't
      // idempotent, so withRetry's replay-on-401 would be wrong; an expired token
      // mid-stream just ends the turn and the per-host expired state surfaces on
      // the next call. The bearer + base URL are THIS host's (null token under auth-disabled).
      turn: (b, o) => LIVE
        ? ensure().then(() => liveTurn(sessionStore && sessionStore.tokenOf ? sessionStore.tokenOf(id) : null, b, o, id))
        : Promise.reject(new Error("assistant turn is live-only")),
    };
  }

  // Fan a GET across EVERY connection (multi-host roll-up). Returns
  // [{ conn, ok, data, err }] — per-connection failures captured, so one host
  // being down doesn't fail the whole read. With no connection (MOCK / a lone
  // seed routed plainly) it's a single get, so N=1 and MOCK are byte-identical to
  // before; the caller merges the results (see lib/merge.js). A registered host
  // uses its scoped client (per-host bearer); the lone seed uses plain get.
  function fanOut(path) {
    if (!CONNECTIONS.length) {
      return get(path).then((data) => [{ conn: null, ok: true, data }], (err) => [{ conn: null, ok: false, err, data: null }]);
    }
    return Promise.all(CONNECTIONS.map((conn) => {
      const client = conn.id ? hostScoped(conn.id) : { get };
      return client.get(path).then((data) => ({ conn, ok: true, data }), (err) => ({ conn, ok: false, err, data: null }));
    }));
  }

  const api = {
    get, post, patch, stream, mockMonitorResolve, fanOut, refreshSession,
    host: hostScoped,
    reconnectHost, reconnectAll,
    __setHealth: setHealth, __health: () => health,
    __setSlow: setSlow, __slow: () => slow,
    __setHostSocket: setHostSocket, __hostSocket: hostSocket,
    __hostAuth: hostAuthStatus,
    // Test/dev affordance: inject a RAW server→client frame through the full live
    // path (adapt → dispatch), exactly as the WebSocket would. Lets the smoke
    // verify the server.patch/server.removed/job.patch remaps deterministically
    // (kgsm `events emit` only exercises audit.append end-to-end).
    __dispatch: (raw) => dispatchMessage(adaptStreamMessage(raw)),
  };

export { api, connectionStore, realtimeStore };
