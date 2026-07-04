import { createStore } from "./store.js";
import { API_V1, apiV1Of, apiOriginOf, streamUrlOf, CONNECTIONS } from "./config.js";
import * as adapt from "./adapters.js";
import { createSseStream } from "./liveStream.js";
import { readSseStream } from "./sse.js";

// alertsStore + sessionStore are used only inside request methods (deferred,
// `?`-guarded). Static imports would put this base module in init cycles
// (apiClient<->alertsApi, apiClient->sessionStore->stores->apiClient), so
// resolve them lazily after the module graph settles.
let alertsStore = null;
import("./alertsApi.js").then((m) => { alertsStore = m.alertsStore; });
let sessionStore = null;
// Keep the import promise: the egress funnel (authorizedBearer) AWAITS it so the
// FIRST WS dial — which runs synchronously during this module's eval, before this
// lazy import can resolve — doesn't fall through to a tokenless connect and 401.
const sessionReady = import("./sessionStore.js").then((m) => { sessionStore = m.sessionStore; });
// Lazy: apiClient is the base layer; it touches the domain stores only in
// deferred call-time paths (request handlers + the realtime wiring). A static
// import would re-form the apiClient<->stores init cycle.
let storesNs = null;
import("./stores.js").then((m) => {
  storesNs = m;
  // The first WS open can land before the host list hydrates → re-key the realtime
  // indicator under the real host id once hosts arrive (single-host; multi-host
  // fan-out is a later slice). Reuses this one dynamic import.
  if (primaryStreams.length && m.hostsStore) {
    try { m.hostsStore.subscribe(() => primaryStreams.forEach((s, i) => setLiveRealtime(CONNECTIONS[i] && CONNECTIONS[i].id, s.mode()))); } catch {}
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
    } catch {}
    return null;
  }
  // ---- the egress AUTH FUNNEL (the single chokepoint every request resolves its bearer through) ----
  // The model is REACTIVE — the API is the authority. This hands back the host's CURRENT access token
  // as-is; it does NOT check expiry. If the token has lapsed the API answers 401 and hostScoped.withRetry
  // rotates (via the refresh token) + replays — one round-trip, no client-side prediction. We only
  // (silently) authorize a session that isn't live yet, and THROW authError (tagged `preflight`, so the
  // host gate doesn't pointlessly re-retry) when it can't be made live. Returns null when the host needs
  // no bearer (auth-disabled). The auth layer's OWN calls (refreshSession, the bootstrap /me probe via
  // meWith) pass an explicit bearer and so SKIP this — that keeps the funnel from re-entering itself.
  async function authorizedBearer(hostId) {
    const id = hostId || (storesNs && storesNs.selectedHostStore && storesNs.selectedHostStore.getState().id);
    // The FIRST WS/REST call can fire during apiClient's synchronous module eval — BEFORE the lazy
    // import("./sessionStore.js") above resolves — so without this await `sessionStore` is still null and
    // we'd fall through to a tokenless bearer → a guaranteed 401 on every fresh load, healed only by the
    // reconnect backoff. Awaiting the module-ready promise lets seed() restore the persisted session
    // first, so the first call already carries the token. Bounded: the module is in-bundle.
    if (!sessionStore) { try { await sessionReady; } catch {} }
    // No session layer (auth-disabled / still unavailable), no host scope, or the aggregate scope → fall
    // back to the sync best-effort bearer (null when none).
    if (!sessionStore || !sessionStore.authorize || !id || id === "all") return liveBearer(hostId);
    let st = sessionStore.statusOf(id);
    if (st !== "live") st = await sessionStore.authorize(id);   // rotate/bootstrap only when NOT already live
    if (st === "denied") { const e = authError(403, id); e.preflight = true; throw e; }
    if (st !== "live")   { const e = authError(401, id); e.preflight = true; throw e; }
    return sessionStore.tokenOf(id);   // may be a lapsed JWT — REST heals it reactively on the 401
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
    const tok = bearerOverride !== undefined ? bearerOverride : await authorizedBearer(hostId);
    if (tok) headers.Authorization = "Bearer " + tok;
    // baseOverride routes off the default /api/v1 base (the auth endpoints are
    // root-routed on the backend, not under /api/v1).
    const base = baseOverride !== undefined ? baseOverride : (apiV1Of(hostId) || API_V1);
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
    } catch { markFailure(); throw netError(); }
    markSuccess();                   // the host answered → reachable
    if (res.status === 204) return null;
    let json = null;
    try { json = await res.json(); } catch { json = null; }
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
    if (/^\/hosts\/[^/]+\/logs$/.test(base)) return adapt.adaptLogPage(json); // before /hosts/{id} → adaptHost
    if (/^\/hosts\/[^/]+\/services\/[^/]+\/config$/.test(base)) return adapt.adaptLeafConfig(json); // before /services → adaptServices
    if (/^\/hosts\/[^/]+\/services$/.test(base)) return adapt.adaptServices(json); // before /hosts/{id} → adaptHost
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
  const livedel = (path, hostId) => liveFetch("DELETE", path, null, hostId);

  // Rotate a host's access token from its long-lived refresh token (§6·a): POST
  // /auth/session/refresh with the REFRESH token as the bearer (NOT the access
  // token the seam would inject) → { token, tier }. No Discord round-trip. Past
  // the refresh token's absolute cap the backend 401s → the caller treats it as
  // genuinely expired. ⚠ The endpoint is ROOT-routed (/auth/session/refresh), NOT
  // under /api/v1 — so pass the bare origin as the base override.
  function refreshSession(hostId, refreshToken) {
    return liveFetch("POST", "/auth/session/refresh", null, hostId, refreshToken || null, apiOriginOf(hostId));
  }

  // Privileged, UN-FUNNELED identity probe for the session layer's bootstrap (sessionStore): pass the
  // bearer we hold explicitly (the access token, or null) so liveFetch SKIPS authorizedBearer. Routing
  // /me through the funnel would re-enter authorize()→bootstrap and recurse — so this is the
  // bootstrap's escape hatch, exactly as refreshSession is the refresh path's. Not for general call sites.
  function meWith(bearer, hostId) {
    return liveFetch("GET", "/me", null, hostId, bearer ?? null).then((j) => adaptResponse("/me", j));
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
  // Framing + the read loop are shared with the realtime stream via sse.js
  // (readSseStream); each frame carries both an `event:` line and a `data:`
  // line with an in-band `type` discriminator, and we key on the canonical
  // in-band `type`, so the `event:` line is ignored (parseSseEvent only reads
  // `data:`).
  //
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
      let json = null; try { json = await res.json(); } catch { json = null; }
      throw apiError(res.status, json);     // pre-stream degrade (404/503/502/400)
    }
    await readSseStream(res, (evt) => { if (onEvent) onEvent(evt); }, signal);
  }

  // ---- latency probe (the dashboard Ping KPI) -----------------------------
  // Measure the CLIENT-side round trip via a REST GET to /health on the host.
  // Returns the RTT in ms, or null on any failure → the KPI honestly reads "no
  // reading" (never a fabricated latency, never 0). Deliberately ISOLATED from
  // markSuccess/markFailure: ping is a side channel, not the cold-start signal.
  async function pingHost(hostId) {
    const base = apiOriginOf(hostId);
    if (!base) return null;
    try {
      const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      const res = await fetch(base + "/health");
      if (!res.ok) return null;
      const rtt = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0;
      return Math.round(rtt);
    } catch { return null; }
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
  async function del(path, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return livedel(path, hostId);
  }

  // ---- realtime transport (SSE streams, one primary + dynamic per host) ------
  // The primary stream carries a fixed global topic set and drives realtimeStore
  // mode + rehydrateAll on open. Resource-scoped topics (containing '/') get
  // their own ref-counted dynamic streams.
  const GLOBAL_TOPICS = ["servers", "jobs", "audit", "alerts", "console", "players"];
  const isResourceScoped = (t) => t.includes("/");

  const listeners = new Set();
  function dispatchMessage(full) {
    for (const l of listeners) if (l.topics.has(full.topic)) { try { l.fn(full); } catch {} }
  }
  const topicStillWanted = (topic) => {
    for (const l of listeners) if (l.topics.has(topic)) return true;
    return false;
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
    if (type === "host.metrics" && /^hosts\/[^/]+\/metrics$/.test(topic || "")) return { topic, type, data: adapt.adaptHostMetrics(data) };
    if (type === "capabilities.patch" && /^hosts\/[^/]+\/capabilities$/.test(topic || "")) return { topic, type, data: adapt.adaptCapabilities(data) };
    if (type === "metrics.tick" && /^servers\/[^/]+\/metrics$/.test(topic || "")) return { topic, type, data: adapt.adaptServerMetrics(data) };
    if (type === "log.line" && /^hosts\/[^/]+\/logs$/.test(topic || "")) return { topic, type, data: adapt.adaptLogLine(data) };
    return msg;
  }

  // On every (re)open of the primary stream, re-hydrate the REST stores to catch
  // deltas missed while the stream was down (§3·j).
  function rehydrateAll() {
    ["serversStore", "hostsStore", "auditStore", "libraryStore"].forEach(name => {
      const st = storesNs && storesNs[name];
      if (st && st.refresh) st.refresh().catch(() => {});
    });
    if (alertsStore && alertsStore.refresh) alertsStore.refresh().catch(() => {});
  }

  function liveHostId() {
    try { return ((storesNs && storesNs.hostsStore && storesNs.hostsStore.getState().list[0]) || {}).id || null; }
    catch { return null; }
  }
  function setLiveRealtime(connId, mode) {
    const id = connId || liveHostId() || "live";
    realtimeStore.setState((s) => ({ online, hosts: { ...s.hosts, [id]: { mode, attempts: 0, nextRetryInMs: 0, lastSyncAt: Date.now(), polling: mode === "reconnecting" } } }));
  }

  // Per-host primary + dynamic stream registries.
  let primaryStreams = [];      // one per connection
  const dynamicStreams = new Map(); // topic → { stream, refCount, hosts }

  // Open the primary SSE stream for a connection (global topics, drives mode + rehydrate).
  function openPrimary(conn) {
    const url = streamUrlOf(conn.id, GLOBAL_TOPICS);
    if (!url) return null;
    return createSseStream({
      url,
      bearer: () => authorizedBearer(conn.id),
      onOpen: () => rehydrateAll(),
      onMessage: (raw) => dispatchMessage(adaptStreamMessage(raw)),
      onMode: (m) => setLiveRealtime(conn.id, m),
      onUnauthorized: () => { if (sessionStore) sessionStore.expire(conn.id); },
    });
  }

  // Open a dynamic SSE stream for a resource-scoped topic on all connected hosts.
  function openDynamic(topic) {
    const hosts = [];
    for (const conn of CONNECTIONS) {
      const url = streamUrlOf(conn.id, [topic]);
      if (!url) continue;
      const s = createSseStream({
        url,
        bearer: () => authorizedBearer(conn.id),
        onOpen: () => {},  // dynamic streams self-hydrate via REST
        onMessage: (raw) => dispatchMessage(adaptStreamMessage(raw)),
        onMode: () => {},  // dynamic streams don't touch realtimeStore
        onUnauthorized: () => { if (sessionStore) sessionStore.expire(conn.id); },
      });
      hosts.push({ connId: conn.id, stream: s });
    }
    dynamicStreams.set(topic, { hosts, refCount: 1 });
  }

  // Close a dynamic stream for a topic.
  function closeDynamic(topic) {
    const entry = dynamicStreams.get(topic);
    if (!entry) return;
    for (const h of entry.hosts) { try { h.stream.close(); } catch {} }
    dynamicStreams.delete(topic);
  }

  const stream = {
    subscribe(topics, onMessage) {
      const entry = { topics: new Set(topics), fn: onMessage };
      listeners.add(entry);
      // Open dynamic streams for resource-scoped topics not yet covered.
      for (const t of topics) {
        if (!isResourceScoped(t)) continue;
        const existing = dynamicStreams.get(t);
        if (existing) { existing.refCount++; }
        else { openDynamic(t); }
      }
      return () => {
        listeners.delete(entry);
        // Dispose dynamic streams no longer wanted by any listener.
        for (const t of entry.topics) {
          if (!isResourceScoped(t)) continue;
          if (topicStillWanted(t)) continue;
          const existing = dynamicStreams.get(t);
          if (!existing) continue;
          existing.refCount--;
          if (existing.refCount <= 0) closeDynamic(t);
        }
      };
    },
  };

  // One primary stream per connection, each feeding the SAME dispatchMessage seam.
  if (CONNECTIONS.length) {
    primaryStreams = CONNECTIONS.map((conn) => openPrimary(conn));
  }

  // User-driven "Reconnect now" (the connectivity banner / per-host indicator):
  // drop the backoff and re-open that host's streams immediately.
  function reconnectHost(id) {
    const idx = CONNECTIONS.findIndex((c) => c.id === id);
    const s = idx >= 0 ? primaryStreams[idx] : null;
    if (s && s.reconnect) s.reconnect();
    // Also reconnect dynamic streams for this host.
    for (const [, entry] of dynamicStreams) {
      for (const h of entry.hosts) {
        if (h.connId === id && h.stream && h.stream.reconnect) h.stream.reconnect();
      }
    }
  }
  function reconnectAll() {
    primaryStreams.forEach((s) => s && s.reconnect && s.reconnect());
    for (const [, entry] of dynamicStreams) {
      for (const h of entry.hosts) { if (h.stream && h.stream.reconnect) h.stream.reconnect(); }
    }
  }

  // Browser network transitions are global (no network = every host link is down).
  // Offline → mark it; online → flip back and kick every socket to reconnect.
  function handleOffline() { online = false; realtimeStore.setState((s) => ({ ...s, online: false })); }
  function handleOnline() { online = true; realtimeStore.setState((s) => ({ ...s, online: true })); reconnectAll(); }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
  }

  // A backgrounded tab suspends the socket's reconnect backoff, so a long stint with the panel hidden
  // (e.g. while in-game) can leave a non-live socket sitting idle. On the tab becoming visible again,
  // nudge any non-live socket to reconnect NOW — its pre-dial gate (wsBearer) rotates a lapsed token
  // before redialing. REST needs nothing here: it heals reactively on its next 401.
  function handleVisible() {
    if (typeof document !== "undefined" && document.hidden) return;
    primaryStreams.forEach((s) => { if (s && s.mode && s.mode() !== "live" && s.reconnect) s.reconnect(); });
    for (const [, entry] of dynamicStreams) {
      for (const h of entry.hosts) { if (h.stream && h.stream.mode && h.stream.mode() !== "live" && h.stream.reconnect) h.stream.reconnect(); }
    }
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", handleVisible);
  }

  // ---- per-host auth gate (Model A) ---------------------------------------
  // api.host(id) is the host-scoped client: it injects that host's bearer and
  // enforces the 401/403/login_required state machine before any call. denied
  // → 403 (terminal); none/expired → lazily (re)bootstrap, then re-check.
  function hostAuthStatus(id) {
    try { return sessionStore ? sessionStore.statusOf(id) : "live"; } catch { return "live"; }
  }
  function authError(code, id) {
    const e = new Error(code === 403 ? "Forbidden on host " + id : "Unauthorized on host " + id);
    e.code = code; e.authState = code === 403 ? "denied" : "expired"; e.hostId = id;
    e.userMessage = code === 403 ? "You don’t have permission on this host." : "Your session expired.";
    return e;
  }
  function hostScoped(id) {
    if (!id) throw new Error("api.host() requires a concrete host id (got " + id + ")");
    // THE reactive heal — this is the whole REST freshness story (the API is the authority). The funnel
    // hands out the current token WITHOUT checking expiry; when it lapses the API answers 401, and HERE we
    // mark the host expired and replay once. The replay re-enters authorizedBearer → authorize → rotate
    // (via the refresh token), so a lapsed token self-heals in one extra round-trip — no client-side
    // expiry prediction anywhere. A funnel PRE-FLIGHT 401 (rotate already failed → session dead) is tagged
    // `preflight` and not retried — re-running it would just fail again; it propagates to the UI's re-auth.
    // Replay-on-401 is safe because every gated verb below is idempotent in effect at the kgsm layer for a
    // retry that only fires when the FIRST attempt was rejected unauthenticated; the SSE turn (not
    // idempotent) deliberately skips the replay.
    const withRetry = (call) => call().catch(err => {
      if (!err || err.code !== 401 || err.preflight || !sessionStore) throw err;
      sessionStore.expire(id);
      return call();
    });
    return {
      // Every call carries THIS host's id → liveFetch routes to its base URL + the funnel-resolved
      // bearer (multi-host). Sole-connection fallback keeps N=1 identical.
      get: (p) => withRetry(() => get(p, id)),
      post: (p, b) => withRetry(() => post(p, b, id)),
      patch: (p, b) => withRetry(() => patch(p, b, id)),
      put: (p, b) => withRetry(() => put(p, b, id)),
      del: (p) => withRetry(() => del(p, id)),
      // Assistant turn (SSE). The funnel resolves + freshens the bearer; NO withRetry replay — a turn
      // isn't idempotent, so an expired token mid-stream just ends the turn and the per-host expired
      // state surfaces on the next call. authorizedBearer throws on a dead session → the turn rejects
      // with authError (the chat surfaces re-auth). Null token under auth-disabled.
      turn: (b, o) => authorizedBearer(id).then(tok => liveTurn(tok, b, o, id)),
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
    get, post, patch, put, del, stream, fanOut, refreshSession, meWith, pingHost,
    host: hostScoped,
    reconnectHost, reconnectAll,
    __hostAuth: hostAuthStatus,
    // Test/dev affordance: inject a RAW server→client frame through the full live
    // path (adapt → dispatch), exactly as the WebSocket would. Lets the smoke
    // verify the server.patch/server.removed/job.patch remaps deterministically.
    __dispatch: (raw) => dispatchMessage(adaptStreamMessage(raw)),
  };

export { api, connectionStore, realtimeStore };
