import { createStore } from "./store.js";
import { API_V1, apiV1Of, apiOriginOf, wsUrlOf, CONNECTIONS } from "./config.js";
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
// deferred call-time paths (request handlers + the realtime wiring). A static
// import would re-form the apiClient<->stores init cycle.
let storesNs = null;
import("./stores.js").then((m) => {
  storesNs = m;
  // The first WS open can land before the host list hydrates → re-key the realtime
  // indicator under the real host id once hosts arrive (single-host; multi-host
  // fan-out is a later slice). Reuses this one dynamic import.
  if (liveStreams.length && m.hostsStore) {
    try { m.hostsStore.subscribe(() => liveStreams.forEach((s, i) => setLiveRealtime(CONNECTIONS[i] && CONNECTIONS[i].id, s.mode()))); } catch (e) {}
  }
});

// apiClient.js — the single seam between the client and the backend.
//
// Everything that talks to the server goes through `api`: REST over fetch
// (translated by adapters.js) and realtime over one WebSocket per connected host
// (liveStream.js). The call sites (the domain stores) only ever see `api`. See
// architecture.html (§3, §3·b).

  // ---- connection health (drives the resilience layer) -------------------
  // connectionStore is REST reachability, the reactive signal the shell reads:
  // 'connecting' (booting), 'live' (reachable), 'down' (unreachable). `everLoaded`
  // separates a COLD start (never succeeded → full takeover) from a WARM drop
  // (succeeded before → non-blocking banner). Updated as a side effect of traffic.
  const connectionStore = createStore({
    status: "connecting",
    everLoaded: false,
    failures: 0,
    retrying: false,
  });

  // ---- realtime channel health (PER-HOST WebSocket + the browser online state) --
  // Distinct from REST reachability above. realtimeStore answers "is the live
  // PUSH channel up?" — and that channel is PER HOST: the panel is a sink
  // aggregating N hosts, each running its own agent over its own WebSocket. One
  // host's link can drop while the others keep streaming, so there is no single
  // global "live" state — only `online` (does the BROWSER have a network at all?)
  // plus a per-host socket mode. When a host's link drops we don't blank its data:
  // on reconnect the socket re-subscribes + re-hydrates the REST stores. This is
  // the "Realtime fallback" promised in architecture.html (§3·j).
  //
  //   per host →  'live'         socket connected, that host is pushing
  //               'reconnecting' its link dropped but we're online — backing off
  //   global   →  'offline'      the browser itself reports no network
  const nav = (typeof navigator !== "undefined") ? navigator : { onLine: true };
  let online = nav.onLine !== false;
  const realtimeStore = createStore({ online, hosts: {} });

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
  // Defensive: a stray call before any host is connected. The app shows the
  // connect screen before any data surface, so this is a backstop — an honest
  // "not connected", never silently invented data.
  function offlineError() {
    const e = new Error("No kgsm-api host is connected.");
    e.code = "EOFFLINE";
    e.userMessage = "Connect a host to get started.";
    return e;
  }

  // ---- REST transport ----------------------------------------------------
  // Hit a real kgsm-api over fetch and translate its honest DTOs into the shapes
  // the components read (see adapters.js). The connection signal tracks
  // REACHABILITY: any HTTP response (even 4xx/5xx) means the host answered →
  // markSuccess; only a transport throw is "down".
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
  // accepts. Pass the explicit host id for a host-scoped call (api.host(id)); an
  // unscoped call falls back to the selected host.
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
  const livePut = (path, body, hostId) => liveFetch("PUT", path, body, hostId);

  // Rotate a host's access token from its long-lived refresh token (§6·a): POST
  // /auth/session/refresh with the REFRESH token as the bearer (NOT the access
  // token the seam would inject) → { token, tier }. No Discord round-trip. Past
  // the refresh token's absolute cap the backend 401s → the caller treats it as
  // genuinely expired. ⚠ The endpoint is ROOT-routed (/auth/session/refresh), NOT
  // under /api/v1 — so pass the bare origin as the base override.
  function refreshSession(hostId, refreshToken) {
    return liveFetch("POST", "/auth/session/refresh", null, hostId, refreshToken || null, apiOriginOf(hostId));
  }

  // ---- assistant turn (SSE) ------------------------------------------------
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

  // ---- latency probe (the dashboard Ping KPI) -----------------------------
  // Measure the CLIENT-side round trip to a host's /api/v1/ping — a deliberately
  // tiny, AUTH-FREE target (kgsm-api PingController). The server can't observe the
  // round trip, so WE clock it: t0 → response received. Sent as a BARE GET with no
  // Authorization header (an auth header would trip a CORS preflight and inflate the
  // first reading) and cache:"no-store" (so a cached 200 can't fake a ~0ms result).
  // Returns the RTT in ms, or null on any failure → the KPI honestly reads "no
  // reading" (never a fabricated latency, never 0). Deliberately ISOLATED from
  // markSuccess/markFailure: ping is a side channel, not the cold-start signal.
  async function pingHost(hostId) {
    const base = apiV1Of(hostId);
    if (!base) return null;
    const clock = (typeof performance !== "undefined" && performance.now) ? () => performance.now() : () => Date.now();
    const t0 = clock();
    let res;
    try { res = await fetch(base + "/ping", { method: "GET", cache: "no-store" }); }
    catch (e) { return null; }                 // unreachable → no honest reading
    const rtt = clock() - t0;                   // response received → that's the round trip
    if (!res.ok) return null;
    try { await res.text(); } catch (e) {}      // drain the tiny body (frees the connection)
    return Math.round(rtt);
  }

  async function get(path, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return liveGet(path, hostId);
  }
  async function patch(path, body, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return livePatch(path, body, hostId);
  }
  async function post(path, body, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return livePost(path, body, hostId);
  }
  async function put(path, body, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return livePut(path, body, hostId);
  }

  // ---- realtime transport (one WebSocket PER connection) ------------------
  // subscribe(topics) tells each host's socket what to push; each inbound
  // { topic, type, data } frame is dispatched to every listener subscribed to its
  // topic. The store subscribers don't care which host a frame came from — frames
  // from every host land in the shared stores (keyed by id).
  const listeners = new Set();
  let liveStreams = [];   // one WebSocket per connection; assigned below
  function dispatchMessage(full) {
    for (const l of listeners) if (l.topics.has(full.topic)) { try { l.fn(full); } catch (e) {} }
  }
  const topicStillWanted = (topic) => {
    for (const l of listeners) if (l.topics.has(topic)) return true;
    return false;
  };
  const stream = {
    subscribe(topics, onMessage) {
      const entry = { topics: new Set(topics), fn: onMessage };
      listeners.add(entry);
      liveStreams.forEach((s) => s.subscribe(topics));   // every host pushes these
      return () => {
        listeners.delete(entry);
        // Tell the sockets to stop pushing any topic no remaining listener still
        // wants — this re-idles the server's subscriber-gated pumps when a DYNAMIC
        // subscription is torn down (the diagnostics deep-dive's hosts/{id}/metrics).
        // The app-lifetime subscriptions (servers/jobs/audit) never dispose, so this
        // branch only ever runs for those dynamic topics.
        const drop = [...entry.topics].filter((t) => !topicStillWanted(t));
        if (drop.length) liveStreams.forEach((s) => s.unsubscribe(drop));
      };
    },
  };

  // Reshape a server→client frame into the FE shapes the stores hold. Unknown
  // topics/types pass through untouched — a new server message must never crash an
  // old client (forward-compatible).
  function adaptStreamMessage(msg) {
    if (!msg) return msg;
    const { topic, type, data } = msg;
    if (topic === "servers" && type === "server.patch") return { topic, type, data: adapt.adaptServer(data) };
    if (topic === "jobs" && type === "job.patch") return { topic, type, data: adapt.adaptJob(data) };
    if (topic === "alerts" && type === "alert.raise") return { topic, type, data: adapt.adaptAlert(data) };
    // host.metrics rides hosts/{id}/metrics — reshape the HostMetricsDto into the FE telemetry partial
    // (the WS parallel of adaptResponse for GET /hosts/{id}). The store merges it clobber-safe by id.
    if (type === "host.metrics" && /^hosts\/[^/]+\/metrics$/.test(topic || "")) return { topic, type, data: adapt.adaptHostMetrics(data) };
    // metrics.tick rides servers/{id}/metrics — the per-server ServerMetricsDto, reshaped to a chart
    // point for the Performance deep-dive's live window. The server id is in the TOPIC (the payload
    // carries no id), so subscribeServerMetrics keys off its closure, not data.id.
    if (type === "metrics.tick" && /^servers\/[^/]+\/metrics$/.test(topic || "")) return { topic, type, data: adapt.adaptServerMetrics(data) };
    // server.removed {id}, alert.resolve {id,resolution}, alert.retract {id} and
    // audit.append (a record — adaptAudit is per-row identity) need no reshaping.
    return msg;
  }

  // On every (re)open, re-hydrate the REST stores to catch deltas missed while a
  // socket was down (§3·j).
  function rehydrateAll() {
    ["serversStore", "hostsStore", "auditStore", "libraryStore"].forEach(name => {
      const st = storesNs && storesNs[name];
      if (st && st.refresh) st.refresh().catch(() => {});
    });
    // alertsStore lives in alertsApi.js (late-bound above), not the stores ns.
    if (alertsStore && alertsStore.refresh) alertsStore.refresh().catch(() => {});
  }

  function liveHostId() {
    try { return ((storesNs && storesNs.hostsStore && storesNs.hostsStore.getState().list[0]) || {}).id || null; }
    catch (e) { return null; }
  }
  function setLiveRealtime(connId, mode) {
    const id = connId || liveHostId() || "live";
    realtimeStore.setState((s) => ({ online, hosts: { ...s.hosts, [id]: { mode, attempts: 0, nextRetryInMs: 0, lastSyncAt: Date.now(), polling: mode === "reconnecting" } } }));
  }
  // One socket per connection, each feeding the SAME dispatchMessage seam, so
  // frames from every host land in the shared stores. realtimeStore is keyed per
  // host and MERGED (never clobbered) so one host's link state doesn't overwrite
  // another's.
  if (CONNECTIONS.length) {
    liveStreams = CONNECTIONS.map((conn) => createLiveStream({
      url: wsUrlOf(conn.id),                 // sole-fallback for a lone seed; exact for registered hosts
      bearer: () => liveBearer(conn.id),     // that host's token (null under auth-disabled)
      onOpen: () => rehydrateAll(),
      onMessage: (raw) => dispatchMessage(adaptStreamMessage(raw)),
      onMode: (mode) => setLiveRealtime(conn.id, mode),
    }));
  }

  // User-driven "Reconnect now" (the connectivity banner / per-host indicator):
  // drop the backoff and re-open that host's socket immediately.
  function reconnectHost(id) {
    const idx = CONNECTIONS.findIndex((c) => c.id === id);
    const s = idx >= 0 ? liveStreams[idx] : null;
    if (s && s.reconnect) s.reconnect();
  }
  function reconnectAll() { liveStreams.forEach((s) => s && s.reconnect && s.reconnect()); }

  // Browser network transitions are global (no network = every host link is down).
  // Offline → mark it; online → flip back and kick every socket to reconnect.
  function handleOffline() { online = false; realtimeStore.setState((s) => ({ ...s, online: false })); }
  function handleOnline() { online = true; realtimeStore.setState((s) => ({ ...s, online: true })); reconnectAll(); }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
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
      put: (p, b) => withRetry(() => put(p, b, id)),
      // Assistant turn (SSE). Pre-call gate only (ensure) — a turn isn't
      // idempotent, so withRetry's replay-on-401 would be wrong; an expired token
      // mid-stream just ends the turn and the per-host expired state surfaces on
      // the next call. The bearer + base URL are THIS host's (null token under auth-disabled).
      turn: (b, o) => ensure().then(() => liveTurn(sessionStore && sessionStore.tokenOf ? sessionStore.tokenOf(id) : null, b, o, id)),
    };
  }

  // Fan a GET across EVERY connection (multi-host roll-up). Returns
  // [{ conn, ok, data, err }] — per-connection failures captured, so one host
  // being down doesn't fail the whole read. With no registered id (a lone seed
  // routed plainly) it's a single get; the caller merges the results (lib/merge.js).
  // A registered host uses its scoped client (per-host bearer); the lone seed uses plain get.
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
    get, post, patch, put, stream, fanOut, refreshSession, pingHost,
    host: hostScoped,
    reconnectHost, reconnectAll,
    __hostAuth: hostAuthStatus,
    // Test/dev affordance: inject a RAW server→client frame through the full live
    // path (adapt → dispatch), exactly as the WebSocket would. Lets the smoke
    // verify the server.patch/server.removed/job.patch remaps deterministically.
    __dispatch: (raw) => dispatchMessage(adaptStreamMessage(raw)),
  };

export { api, connectionStore, realtimeStore };
