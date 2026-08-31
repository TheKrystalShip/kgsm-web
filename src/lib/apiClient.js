import { createStore } from "./store.js";
import { apiV1Of, apiOriginOf, apiV1ForConn, streamUrlForConn, subscribeConnections, subscribeConnectionsRemoved, CONNECTIONS } from "./config.js";
import { DEVICE_HEADER, deviceId } from "./device.js";
import * as adapt from "./adapters.js";
import { createSseStream } from "./liveStream.js";

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
    try { m.hostsStore.subscribe(() => primaryStreams.forEach(p => { if (p.stream) setLiveRealtime(p.conn.id, p.stream.mode()); })); } catch {}
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
  //
  // Reachability is tracked PER CONNECTION (the `hosts` map) and the global summary
  // is AGGREGATED from it: 'live' when ANY connection answers, 'down' ONLY when every
  // known connection is unreachable. This mirrors realtimeStore's per-host model —
  // one down host (a federated peer that's offline, a background fan-out probe that
  // fails) must never flip the whole shell to "Can't reach Krystal" while the host
  // you're actually on is fine. Its own surfaces carry the per-host degraded state.
  const connectionStore = createStore({
    status: "connecting",
    everLoaded: false,
    failures: 0,
    retrying: false,
    hosts: {},   // per-connection reachability: { [hostId]: "live" | "down" }
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

  // ---- fan-out reach (what an aggregated read actually got) ---------------
  // A read spanning N nodes comes back partial when a node is unreachable,
  // refuses the session, or errors: the rows that node owns are simply absent.
  // On a list with no node dimension on screen that is indistinguishable from
  // "those servers are gone" — a fabricated state. So every fan-out records its
  // per-node outcome here and the aggregated surfaces disclose it. Absence of
  // data is never the signal; this is the measurement.
  //   ok           the node answered
  //   unreachable  transport failure — no answer at all
  //   unauthorized the node refused the session (401/403)
  //   error        the node answered, with a failure
  // Keyed by the connection's URL, not its id: a connection's backend id is null
  // until GET /hosts reconciles it, so id-keying would strand the reads taken
  // before that under a second key and inflate the node count. The URL is the
  // one identity that holds from the first request. `id` rides along for label
  // resolution and can fill in later.
  const reachStore = createStore({ byHost: {} });
  function reachReason(err) {
    if (!err) return "unreachable";
    // `preflight` means the call never left: the session couldn't be established.
    // That covers a node that is simply down (its /me probe can't complete) as
    // well as one whose session is dead, so it must NOT be reported as the node
    // refusing us — we never got to ask it.
    if (err.preflight) return "unauthenticated";
    if (err.code === 401 || err.code === 403) return "unauthorized";
    if (typeof err.code === "number") return "error";
    return "unreachable";   // ECONNREFUSED / EOFFLINE / a thrown transport error
  }
  function recordReach(conn, ok, err) {
    const key = (conn && conn.url) || "_default";
    const reason = ok ? null : reachReason(err);
    const id = (conn && conn.id) || null;
    const prev = reachStore.getState().byHost[key];
    if (prev && prev.ok === ok && prev.reason === reason && prev.id === id) return;   // steady state → no churn
    reachStore.setState(s => ({
      byHost: { ...s.byHost, [key]: { ok, reason, id, name: (conn && conn.name) || null, at: Date.now() } },
    }));
  }

  // The connection a call routed to; a falsy / aggregate ("all") id folds onto the
  // sole-connection default key so N=1 (and unscoped calls) attribute consistently.
  function connKey(hostId) { return (hostId && hostId !== "all") ? hostId : "_default"; }
  function downCount(hosts) { let n = 0; for (const k in hosts) if (hosts[k] === "down") n++; return n; }
  // 'live' if any connection is reachable, 'down' only when every one is, else the
  // cold pre-first-response 'connecting'.
  function aggregateStatus(hosts) {
    let anyLive = false, anyDown = false;
    for (const k in hosts) { if (hosts[k] === "live") anyLive = true; else if (hosts[k] === "down") anyDown = true; }
    return anyLive ? "live" : (anyDown ? "down" : "connecting");
  }
  function markSuccess(hostId) {
    const key = connKey(hostId);
    const s = connectionStore.getState();
    // Hot path: this host already live on an already-live warm shell → nothing to change.
    if (s.hosts[key] === "live" && s.status === "live" && s.everLoaded && !s.retrying) return;
    const hosts = { ...s.hosts, [key]: "live" };
    connectionStore.setState({ status: "live", everLoaded: true, failures: downCount(hosts), retrying: false, hosts });
  }
  function markFailure(hostId) {
    const key = connKey(hostId);
    const s = connectionStore.getState();
    const hosts = { ...s.hosts, [key]: "down" };
    // Global 'down' ONLY when no connection is reachable; one down host among healthy
    // ones keeps the shell live (that host's own surfaces show its degraded state).
    connectionStore.setState({ status: aggregateStatus(hosts), everLoaded: s.everLoaded, failures: downCount(hosts), retrying: false, hosts });
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
    // The envelope's optional `details` object, carried through verbatim. Some errors say more than a
    // sentence can — `blueprint_invalid` puts the ENGINE's own validator messages in `details.errors`,
    // and the blueprint editor renders them one per line. Dropping it here would leave the caller with
    // "the engine rejected this blueprint" and nothing about what to fix.
    e.details = env.details || null;
    return e;
  }
  // A host's bearer, when we hold a live one. Sessions are keyed by BACKEND HOST
  // ID, so the id must be the one the call is for — there is no ambient node to
  // borrow a token from, and sending one node's token to another is how a request
  // becomes both wrong and authenticated. No id (the cold-boot connection, before
  // GET /hosts names it) or the aggregate scope ⇒ no bearer. Null is also the
  // honest answer under KGSM_API_AUTH_DISABLED, where no token is minted at all
  // and the call goes out unauthenticated.
  function liveBearer() {
    try {
      if (sessionStore && sessionStore.tokenOf) return sessionStore.tokenOf();
    } catch { /* the session layer is still loading */ }
    return null;
  }
  // ---- the egress AUTH FUNNEL (the single chokepoint every request resolves its bearer through) ----
  // The model is REACTIVE — the API is the authority. This hands back the host's CURRENT access token
  // as-is; it does NOT check expiry. If the token has lapsed the API answers 401 and hostScoped.withRetry
  // rotates (via the refresh token) + replays — one round-trip, no client-side prediction. We only
  // (silently) authorize a session that isn't live yet, and THROW authError (tagged `preflight`, so the
  // host gate doesn't pointlessly re-retry) when it can't be made live. Returns null when the host needs
  // no bearer (auth-disabled). The auth layer's OWN call — the /me probe via meWith — passes an
  // explicit bearer and so SKIPS this, which keeps the funnel from re-entering itself. Renewal never
  // reaches here at all: it is the anchor's, and no call in this file asks a node for a credential.
  async function authorizedBearer(hostId) {
    // The FIRST WS/REST call can fire during apiClient's synchronous module eval — BEFORE the lazy
    // import("./sessionStore.js") above resolves — so without this await `sessionStore` is still null and
    // we'd fall through to a tokenless bearer → a guaranteed 401 on every fresh load, healed only by the
    // reconnect backoff. Awaiting the module-ready promise lets seed() restore the persisted session
    // first, so the first call already carries the token. Bounded: the module is in-bundle.
    if (!sessionStore) { try { await sessionReady; } catch { /* fall through tokenless */ } }
    if (!sessionStore || !sessionStore.authorize) return liveBearer();
    // ONE session, presented to every member. The host id does not choose a token — it only says
    // which member is being called, which matters for what a refusal means, never for what is sent.
    let st = sessionStore.statusOf();
    if (st !== "live") st = await sessionStore.authorize();   // renew only when NOT already live
    if (st === "denied") { const e = authError(403, hostId); e.preflight = true; throw e; }
    if (st !== "live")   { const e = authError(401, hostId); e.preflight = true; throw e; }
    return sessionStore.tokenOf();   // may be a lapsed JWT — a refusal heals it reactively
  }
  // A call that couldn't be routed to a node. In prod apiV1Of/apiOriginOf answer
  // "" for a node we don't hold, and a relative fetch would quietly hit whatever
  // origin served the bundle — so stop here and say which node was asked for.
  function unroutedError(hostId) {
    const e = new Error(`No connection for node ${hostId ? `"${hostId}"` : "(unnamed)"}.`);
    e.code = "EUNROUTED";
    e.userMessage = "That node isn’t connected.";
    return e;
  }
  // hostId routes the call to that host's base URL + bearer. It is the NODE the
  // call is for: routing is exact (config.connOf), so an id we don't hold fails
  // here rather than landing on another node.
  // `init` carries the two things a call to something that ISN'T a node needs: `track:false`, because
  // an anchor's reachability is not a member's and must not move the connection signal, and
  // `credentials`, because the identity-link ticket is a cookie a cross-origin fetch stores only when
  // asked to.
  async function liveFetch(method, path, body, hostId, bearerOverride, baseOverride, init) {
    const opts = init || {};
    const headers = body != null
      ? { "Content-Type": "application/json", Accept: "application/json" }
      : { Accept: "application/json" };
    // bearerOverride lets a caller send a specific bearer (the refresh-token
    // rotation needs the REFRESH token, not the access token the seam injects).
    // `undefined` = use the host's live access bearer; a string/null = send/omit as given.
    const tok = bearerOverride !== undefined ? bearerOverride : await authorizedBearer(hostId);
    if (tok) headers.Authorization = "Bearer " + tok;
    // Which BROWSER is asking, for the per-device half of the preference store. Sent on every call
    // rather than only the preference ones: it is one short header, and a seam that decides per path
    // which headers to attach is a seam that gets it wrong when a path moves.
    headers[DEVICE_HEADER] = deviceId();
    // baseOverride routes off the default /api/v1 base (the auth endpoints are
    // root-routed on the backend, not under /api/v1; the fan-out addresses an
    // as-yet-unidentified connection by its own URL).
    const base = baseOverride !== undefined ? baseOverride : apiV1Of(hostId);
    if (!base) throw unroutedError(hostId);
    // Serialize OUTSIDE the try below. Only a TRANSPORT throw is "the host is unreachable" —
    // a body that can't be serialized is a caller bug, and letting it land in that catch would
    // report a healthy backend as down (banner included) while hiding the real TypeError.
    const payload = body != null ? JSON.stringify(body) : undefined;
    let res;
    try {
      res = await fetch(base + path, opts.credentials
        ? { method, headers, body: payload, credentials: opts.credentials }
        : { method, headers, body: payload });
    } catch { if (opts.track !== false) markFailure(hostId); throw netError(); }
    if (opts.track !== false) markSuccess(hostId);   // the host answered → reachable
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
    // Before /servers/{id} → adaptServer, which would otherwise read this report as an instance and
    // return a server-shaped object with every field null. Relayed verbatim: the backend already
    // answers in the honest model this boundary exists to enforce — an unmeasurable availability is
    // null there — so there is nothing for an adapter to protect against.
    if (base === "/servers/availability") return json;
    if (/^\/servers\/[^/]+$/.test(base)) return adapt.adaptServer(json);
    if (/^\/hosts\/[^/]+$/.test(base)) return adapt.adaptHost(json);
    if (/^\/integrations\/[^/]+$/.test(base)) return adapt.adaptIntegration(json);
    return json;
  }
  const liveGet = (path, hostId) => liveFetch("GET", path, null, hostId).then((j) => adaptResponse(path, j));

  // A GET whose response is a FILE, not JSON — the console log download. It cannot be an <a href>:
  // every gated read carries a bearer, and a top-level navigation sends no Authorization header, so
  // the browser would fetch an anonymous 401 and save it. Streamed into a Blob here and handed to the
  // caller to save. Same routing and the same reachability bookkeeping as any other call.
  async function liveBlob(path, hostId) {
    const base = apiV1Of(hostId);
    if (!base) throw unroutedError(hostId);
    const tok = await authorizedBearer(hostId);
    const headers = {};
    if (tok) headers.Authorization = "Bearer " + tok;
    let res;
    try {
      res = await fetch(base + path, { method: "GET", headers });
    } catch { markFailure(hostId); throw netError(); }
    markSuccess(hostId);
    if (!res.ok) {
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      throw apiError(res.status, json);
    }
    return res.blob();
  }
  const livePost = (path, body, hostId) => liveFetch("POST", path, body, hostId);
  const livePatch = (path, body, hostId) => liveFetch("PATCH", path, body, hostId);
  const livePut = (path, body, hostId) => liveFetch("PUT", path, body, hostId);
  const livedel = (path, hostId) => liveFetch("DELETE", path, null, hostId);

  // Rotate a host's access token from its long-lived refresh token (§6·a): POST
  // /auth/session/refresh with the REFRESH token as the bearer (NOT the access
  // token the seam would inject) → { token, tier }. No Discord round-trip. Past
  // the refresh token's absolute cap the backend 401s → the caller treats it as
  // genuinely expired. The endpoint is ROOT-routed (/auth/session/refresh), NOT
  // under /api/v1 — so pass the bare origin as the base override.


  // Privileged, UN-FUNNELED identity probe for the session layer's bootstrap (sessionStore): pass the
  // bearer we hold explicitly (the access token, or null) so liveFetch SKIPS authorizedBearer. Routing
  // /me through the funnel would re-enter authorize() and recurse — so this is that path's escape
  // hatch. Not for general call sites.
  function meWith(bearer, hostId) {
    return liveFetch("GET", "/me", null, hostId, bearer ?? null).then((j) => adaptResponse("/me", j));
  }

  // ---- latency probe ------------------------------------------------------
  // Round trip to one node, read by the dashboard's capacity strip, the cluster constellation
  // and diagnostics.
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

  // A root-routed counterpart to post, for the node's own sign-out: the auth endpoints live at the
  // bare origin, NOT under /api/v1. Unlike meWith the caller DOES want the funnel — the cluster
  // bearer, resolved the same way every other call resolves it. Leaving bearerOverride undefined
  // routes liveFetch through authorizedBearer exactly like get/post do; only baseOverride changes.
  async function rootPost(path, body, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return liveFetch("POST", path, body, hostId, undefined, apiOriginOf(hostId));
  }

  // ---- where account management goes --------------------------------------
  // One question, asked once: are this cluster's accounts held by an anchor, or by the node in front
  // of us? A cluster with an anchor administers them AT the anchor — a write that lands in a member's
  // read-only replica is overwritten by the next thing the anchor publishes, so it appears to work
  // and then quietly has not — and every member refuses those calls for exactly that reason. A
  // cluster without one holds its own, and every call goes where it always did.
  //
  // Only the account surfaces resolve through here. Servers, metrics, audit, console and members are
  // the node's and stay addressed to it. So do sessions and sign-out: revoking takes authority away
  // rather than granting it, and the rows belong to whoever holds them.
  //
  // The door is resolved per call rather than captured once, because the answer arrives from a member
  // asynchronously and a surface that captured it at mount would keep whatever was true then.
  async function accountDoor(hostId) {
    let url = "";
    try {
      if (!sessionStore) await sessionReady;
      if (sessionStore && sessionStore.resolveAnchor) url = await sessionStore.resolveAnchor();
    } catch { url = ""; }
    return url
      ? { anchor: true, origin: url, users: "/auth/cluster/users" }
      : { anchor: false, origin: apiOriginOf(hostId), users: "/auth/users" };
  }

  // `ticket` asks the browser to keep the anchor's one-time link cookie. Set on the link start and
  // nowhere else: a credentialed cross-origin request needs the anchor to allow credentials, so
  // sending it on every call would put every account read behind that same header.
  function doorFetch(method, path, body, hostId, door, ticket) {
    const init = door.anchor
      ? (ticket ? { track: false, credentials: "include" } : { track: false })
      : undefined;
    return liveFetch(method, path, body, door.anchor ? null : hostId, undefined, door.origin, init);
  }

  // ---- realtime transport (SSE streams, one primary + dynamic per host) ------
  // The primary stream carries a fixed global topic set and drives realtimeStore
  // mode + rehydrateAll on open. Resource-scoped topics (containing '/') get
  // their own ref-counted dynamic streams.
  // `me` is delivered by the SERVER only to the connections this account holds, so a frame that
  // arrives on it is about the reader and needs no client-side filtering.
  const GLOBAL_TOPICS = ["servers", "jobs", "audit", "alerts", "console", "players", "batches", "me"];
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
  //
  // `hostId` is the node whose socket delivered the frame, stamped on every
  // message: an event carries its origin so a listener never has to guess which
  // node produced it. Null only when the frame didn't come from a node's stream
  // (the dev __dispatch hook).
  function adaptStreamMessage(msg, hostId = null) {
    if (!msg) return msg;
    const { topic, type, data } = msg;
    const at = (d) => ({ topic, type, data: d, hostId });
    if (topic === "servers" && type === "server.patch") return at(adapt.adaptServer(data));
    if (topic === "me" && type === "me.patch") return at(adapt.adaptMePatch(data));
    if (topic === "jobs" && type === "job.patch") return at(adapt.adaptJob(data));
    if (topic === "alerts" && type === "alert.raise") return at(adapt.adaptAlert(data));
    if (type === "host.metrics" && /^hosts\/[^/]+\/metrics$/.test(topic || "")) return at(adapt.adaptHostMetrics(data));
    if (type === "capabilities.patch" && /^hosts\/[^/]+\/capabilities$/.test(topic || "")) return at(adapt.adaptCapabilities(data));
    if (type === "metrics.tick" && /^servers\/[^/]+\/metrics$/.test(topic || "")) return at(adapt.adaptServerMetrics(data));
    if (type === "metrics.roster" && topic === "servers/metrics") return at(adapt.adaptServerMetricsRoster(data));
    if (type === "log.line" && /^hosts\/[^/]+\/logs$/.test(topic || "")) return at(adapt.adaptLogLine(data));
    if (type === "service.patch" && /^hosts\/[^/]+\/services$/.test(topic || "")) return at(adapt.adaptService(data));
    return { ...msg, hostId };
  }

  // On every (re)open of the primary stream, re-hydrate the REST stores to catch
  // deltas missed while the stream was down (§3·j).
  function rehydrateAll() {
    ["serversStore", "hostsStore", "auditStore", "libraryStore", "batchesStore"].forEach(name => {
      const st = storesNs && storesNs[name];
      if (st && st.refresh) st.refresh().catch(() => {});
    });
    if (alertsStore && alertsStore.refresh) alertsStore.refresh().catch(() => {});
    // Services and host journals are keyed by host, and several nodes' worth can be held at once.
    // Re-hydrate EVERY key somebody is currently holding — refreshing only one would leave the rest
    // showing whatever they had before the stream dropped, with no sign that they had stopped
    // following. A key nobody holds is absent from the map and costs nothing.
    ["servicesStore", "logsStore"].forEach(name => {
      const st = storesNs && storesNs[name];
      const held = st && st.getState && st.getState().byHost;
      if (held) Object.keys(held).forEach(hostId => st.refresh(hostId).catch(() => {}));
    });
  }

  // Realtime state is keyed by the CONNECTION whose socket produced the mode —
  // never by "whichever node loaded first", which would report one node's link
  // under another's name. A connection with no backend id yet (cold boot) keys
  // under COLD_BOOT_KEY: its own state, attributed to nothing, until the hostsStore
  // subscription above re-emits it under the reconciled id.
  const COLD_BOOT_KEY = "_cold-boot";
  function setLiveRealtime(connId, mode) {
    const id = connId || COLD_BOOT_KEY;
    realtimeStore.setState((s) => ({ online, hosts: { ...s.hosts, [id]: { mode, attempts: 0, nextRetryInMs: 0, lastSyncAt: Date.now(), polling: mode === "reconnecting" } } }));
  }

  // Per-host primary + dynamic stream registries.
  let primaryStreams = [];      // one { conn, stream } per connection, in connection order
  const dynamicStreams = new Map(); // topic → { stream, refCount, hosts }

  // Open the primary SSE stream for a connection (global topics, drives mode + rehydrate).
  function openPrimary(conn) {
    const url = streamUrlForConn(conn, GLOBAL_TOPICS);
    if (!url) return null;
    return createSseStream({
      url,
      bearer: () => authorizedBearer(conn.id),
      onOpen: () => rehydrateAll(),
      onMessage: (raw) => dispatchMessage(adaptStreamMessage(raw, conn.id)),
      onMode: (m) => setLiveRealtime(conn.id, m),
      onUnauthorized: () => { if (sessionStore) sessionStore.expire(); },
    });
  }

  // Open a dynamic SSE stream for a resource-scoped topic on all connected hosts.
  // Before the streams are started the topic is recorded with no sockets, so a
  // subscription taken early is honoured by startStreams rather than silently lost.
  function openDynamic(topic) {
    const hosts = [];
    if (!streamsStarted) { dynamicStreams.set(topic, { hosts, refCount: 1 }); return; }
    for (const conn of CONNECTIONS) {
      const url = streamUrlForConn(conn, [topic]);
      if (!url) continue;
      const s = createSseStream({
        url,
        bearer: () => authorizedBearer(conn.id),
        onOpen: () => {},  // dynamic streams self-hydrate via REST
        onMessage: (raw) => dispatchMessage(adaptStreamMessage(raw, conn.id)),
        onMode: () => {},  // dynamic streams don't touch realtimeStore
        onUnauthorized: () => { if (sessionStore) sessionStore.expire(); },
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

  // Whether the streams are running. They are NOT opened at import: a browser sitting
  // on the sign-in screen holds no session, so every dial would 401 into a backoff loop
  // that never succeeds and never stops — traffic on behalf of nobody, against a host
  // that has not been chosen yet. The shell starts them once there is an identity, and
  // stops them when there is not.
  let streamsStarted = false;

  function startStreams() {
    if (streamsStarted) return;
    streamsStarted = true;
    // One primary stream per connection, each feeding the SAME dispatchMessage seam.
    primaryStreams = CONNECTIONS.map((conn) => ({ conn, stream: openPrimary(conn) }));
    // Any topic subscribed before the start dialled no sockets; give it them now,
    // keeping the ref count the subscribers already established.
    for (const [topic, entry] of [...dynamicStreams]) {
      if (entry.hosts.length) continue;
      const refCount = entry.refCount;
      dynamicStreams.delete(topic);
      openDynamic(topic);
      const opened = dynamicStreams.get(topic);
      if (opened) opened.refCount = refCount;
    }
  }

  function stopStreams() {
    if (!streamsStarted) return;
    streamsStarted = false;
    for (const p of primaryStreams) { try { if (p.stream) p.stream.close(); } catch {} }
    primaryStreams = [];
    for (const topic of [...dynamicStreams.keys()]) closeDynamic(topic);
  }

  // Cluster discovery grows the connection set in place. Give each new node the
  // same treatment the boot set got — its primary stream, carried with the connection
  // that owns it so a departure can find and close exactly that one, plus
  // every dynamic topic a view is currently subscribed to, so a late-joining node
  // is not silently missing from an open subscription. Then re-hydrate: the
  // stores fan out over CONNECTIONS, so their current contents predate this node.
  //
  // The listener registers at import and no-ops until the streams are running, so a
  // node discovered before sign-in is simply picked up by startStreams' own sweep
  // over CONNECTIONS rather than needing a second path.
  subscribeConnections((added) => {
    if (!streamsStarted) return;
    for (const conn of added) {
      primaryStreams.push({ conn, stream: openPrimary(conn) });
      for (const [topic, entry] of dynamicStreams) {
        const url = streamUrlForConn(conn, [topic]);
        if (!url) continue;
        entry.hosts.push({
          connId: conn.id,
          stream: createSseStream({
            url,
            bearer: () => authorizedBearer(conn.id),
            onOpen: () => {},
            onMessage: (raw) => dispatchMessage(adaptStreamMessage(raw, conn.id)),
            onMode: () => {},
            onUnauthorized: () => { if (sessionStore) sessionStore.expire(); },
          }),
        });
      }
    }
    rehydrateAll();
  });

  // A node that has left the cluster stops being a node here. Every per-connection
  // resource it holds is released — its streams closed, its realtime state and its
  // reach record dropped, its session forgotten — because a departed node that keeps
  // a "reconnecting" entry keeps its name in the connectivity banner and keeps
  // counting against the reach footnote forever, which reads as an outage rather than
  // as the departure it is. A member that is merely unreachable is untouched by this:
  // it keeps its connection, and saying so is the banner's job.
  //
  subscribeConnectionsRemoved((removed) => {
    for (const conn of removed) {
      const idx = primaryStreams.findIndex((p) => p.conn === conn || (conn.id && p.conn.id === conn.id));
      if (idx >= 0) {
        try { if (primaryStreams[idx].stream) primaryStreams[idx].stream.close(); } catch {}
        primaryStreams.splice(idx, 1);
      }
      for (const [, entry] of dynamicStreams) {
        for (let i = entry.hosts.length - 1; i >= 0; i--) {
          if (entry.hosts[i].connId !== conn.id) continue;
          try { entry.hosts[i].stream.close(); } catch {}
          entry.hosts.splice(i, 1);
        }
      }
      if (conn.id) {
        realtimeStore.setState((s) => {
          if (!(conn.id in s.hosts)) return s;
          const hosts = { ...s.hosts };
          delete hosts[conn.id];
          return { ...s, hosts };
        });
        if (sessionStore && sessionStore.forgetNode) sessionStore.forgetNode(conn.id);
      }
      reachStore.setState((s) => {
        if (!(conn.url in s.byHost)) return s;
        const byHost = { ...s.byHost };
        delete byHost[conn.url];
        return { byHost };
      });
    }
    if (removed.length) rehydrateAll();
  });

  // User-driven "Reconnect now" (the connectivity banner / per-host indicator):
  // drop the backoff and re-open that host's streams immediately.
  function reconnectHost(id) {
    const owned = primaryStreams.find((p) => p.conn.id === id);
    const s = owned && owned.stream;
    if (s && s.reconnect) s.reconnect();
    // Also reconnect dynamic streams for this host.
    for (const [, entry] of dynamicStreams) {
      for (const h of entry.hosts) {
        if (h.connId === id && h.stream && h.stream.reconnect) h.stream.reconnect();
      }
    }
  }
  function reconnectAll() {
    primaryStreams.forEach((p) => { if (p.stream && p.stream.reconnect) p.stream.reconnect(); });
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
    primaryStreams.forEach((p) => { const s = p.stream; if (s && s.mode && s.mode() !== "live" && s.reconnect) s.reconnect(); });
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
  function sessionStatus() {
    try { return sessionStore ? sessionStore.statusOf() : "live"; } catch { return "live"; }
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
    const withRetry = (call) => call().then(
      (ok) => { if (sessionStore && sessionStore.markNode) sessionStore.markNode(id, "ok"); return ok; },
      async err => {
        if (!err || !sessionStore) throw err;
        // 403 is NEVER ambiguous. The member validated the token perfectly well and then resolved
        // the person to a tier too low — which, for an account its replica does not carry, is
        // `none`. So a 403 is always a statement about that member's view of this person and never
        // about the session, and a member that has just joined answers it as a matter of course
        // while its replica catches up.
        if (err.code === 403) { if (sessionStore.markNode) sessionStore.markNode(id, "refusing", "unknown_here"); throw err; }
        if (err.code !== 401) throw err;
        // A funnel PRE-FLIGHT 401 (the renewal already failed → the session is dead) is not replayed;
        // re-running it fails identically and it belongs to the sign-in screen.
        if (err.preflight) throw err;
        sessionStore.expire();
        return call().then(
          (ok) => { if (sessionStore.markNode) sessionStore.markNode(id, "ok"); return ok; },
          (err2) => {
            // 401 is the ambiguous one, and this is where the ambiguity is resolved. A member
            // answers it when the token itself did not validate — signature, audience, issuer,
            // expiry, or a session it has been told is revoked — so it can mean a session that has
            // genuinely ended OR a member that has not yet heard which key and issuer to check
            // against. The renewal above separates them: a FRESH session still refused here is not
            // the session's problem, and recording it against the member is what stops one member's
            // lag from reading as everybody being signed out.
            if (err2 && err2.code === 401 && sessionStore.isLive && sessionStore.isLive()) {
              if (sessionStore.markNode) sessionStore.markNode(id, "refusing", "unverified_here");
            }
            throw err2;
          },
        );
      },
    );
    return {
      // Every call carries THIS host's id → liveFetch routes to its base URL + the funnel-resolved
      // bearer (multi-host). Sole-connection fallback keeps N=1 identical.
      get: (p) => withRetry(() => get(p, id)),
      post: (p, b) => withRetry(() => post(p, b, id)),
      patch: (p, b) => withRetry(() => patch(p, b, id)),
      put: (p, b) => withRetry(() => put(p, b, id)),
      del: (p) => withRetry(() => del(p, id)),
      blob: (p) => withRetry(() => liveBlob(p, id)),
    };
  }

  // api.sessions(id) — the root-routed session-management surface (list/revoke
  // active sessions), through accountDoor: a session's rows sit with whatever minted it, and in a
  // cluster with an anchor the members mint none — they verify a signature and keep nothing, so
  // asking a member would return an honest empty list that reads as "no other devices".
  // Root-routed either way (these live at the bare origin, not under /api/v1); funneled (not the
  // meWith bypass) because every call site here wants the live cluster bearer plus the same
  // 401→expire→replay heal hostScoped gives REST calls. Mirrors hostScoped's withRetry verbatim
  // rather than sharing it, since hostScoped's closure is itself scoped to the get/post/patch/put/del
  // set.
  //
  // Sign-out is the exception and stays on the node (see logout below).
  function sessionsScoped(id) {
    if (!id) throw new Error("api.sessions() requires a concrete host id (got " + id + ")");
    const withRetry = (call) => call().catch(err => {
      if (!err || err.code !== 401 || err.preflight || !sessionStore) throw err;
      sessionStore.expire();
      return call();
    });
    const at = (method, path, body) =>
      accountDoor(id).then((d) => doorFetch(method, path, body, id, d));
    return {
      // Self, or (admin) another user's sessions via ?userId=.
      list: (userId) => withRetry(() => at("GET", "/auth/sessions" + (userId ? "?userId=" + encodeURIComponent(userId) : ""))).then(adapt.adaptSessions),
      // Self-revoke: {sid} one, {all:true} every session, {} the caller's own.
      revoke: (body) => withRetry(() => at("POST", "/auth/session/revoke", body || {})),
      // Admin: end ONE of another user's sessions — a different decision from signing them out
      // everywhere, and the narrow one is the one an admin reaches for when they have a single
      // suspicious session. Scoped under the account at an anchor, which makes the question "is this
      // session that person's" rather than "does this session exist": an admin with the wrong account
      // open is told so instead of being shown a stranger's row.
      revokeSid: (userId, sid) => withRetry(() => accountDoor(id).then((d) => doorFetch(
        "POST",
        d.anchor
          ? d.users + "/" + encodeURIComponent(userId) + "/sessions/" + encodeURIComponent(sid) + "/revoke"
          : "/auth/sessions/" + encodeURIComponent(sid) + "/revoke",
        {}, id, d))),
      // Admin: log a user out everywhere. Scoped under the accounts path, which is the one place
      // the two doors spell differently.
      revokeUser: (userId) => withRetry(() => accountDoor(id).then((d) => doorFetch(
        "POST", d.users + "/" + encodeURIComponent(userId) + "/sessions/revoke-all", {}, id, d))),
    };
  }

  // api.users(id) — the KGSM accounts this cluster's identity holder keeps, through accountDoor:
  // the anchor's when one holds them, otherwise the node's own. Root-routed either way (these live
  // at the bare origin, not under /api/v1). Admin-gated server-side throughout, with one exception:
  // changePassword is the caller changing their own.
  //
  // Deliberately NOT behind a reactive store. Every other domain here is polled or
  // streamed because something else changes it; accounts change only when an admin
  // changes them, on this screen, and a cached list is then a list that can be stale
  // about who may do what. Each screen reads, and re-reads after it writes.
  function usersScoped(id) {
    const withRetry = (call) => call().catch((e) => {
      if (!(e && e.status === 401)) throw e;
      sessionStore.expire();
      return call();
    });
    const at = (method, suffix, body) =>
      accountDoor(id).then((d) => doorFetch(method, d.users + suffix, body, id, d));
    const one = (userId) => "/" + encodeURIComponent(userId);
    return {
      list: () => withRetry(() => at("GET", "")).then((r) => (r && r.data) || []),
      create: (body) => withRetry(() => at("POST", "", body || {})),
      update: (userId, body) => withRetry(() => at("PATCH", one(userId), body || {})),
      remove: (userId) => withRetry(() => at("DELETE", one(userId))),
      setPassword: (userId, password) => withRetry(() => at("POST", one(userId) + "/password", { password })),
      // Self-service. The current password is required even though the caller holds a
      // live session — the backend refuses without it, and for the reason it should. The two doors
      // spell the same two fields differently, which is the whole of the difference.
      changePassword: (currentPassword, newPassword) =>
        withRetry(() => accountDoor(id).then((d) => doorFetch("POST", "/auth/password",
          d.anchor ? { current: currentPassword, password: newPassword }
                   : { currentPassword, newPassword }, id, d))),
    };
  }

  // api.identities(id) — the caller's OWN sign-in methods, through accountDoor like the accounts
  // above. Self-service throughout: an account carries the tier, and only its holder changes what
  // proves it.
  //
  // The link flow rides a one-time HttpOnly ticket cookie the callback comes back with. On a node
  // that is same-origin and needs nothing said about it, because the deployed panel is served by the
  // API it talks to. At an anchor it is cross-origin, so the start asks the browser to keep the
  // cookie and the anchor has to allow credentials for that origin; where it does not, the start
  // succeeds and the callback then honestly reports `invalid_state`.
  //
  // The two doors name a credential differently — `credentialId` at the anchor, `id` on a node —
  // so the list normalises to one shape and the screen above reads a single field.
  function identitiesScoped(id) {
    if (!id) throw new Error("api.identities() requires a concrete host id (got " + id + ")");
    const withRetry = (call) => call().catch((e) => {
      if (!(e && e.status === 401)) throw e;
      sessionStore.expire();
      return call();
    });
    const at = (method, path, body, ticket) =>
      accountDoor(id).then((d) => doorFetch(method, path, body, id, d, ticket));
    const named = (row) => (row && row.id === undefined && row.credentialId !== undefined
      ? { ...row, id: row.credentialId } : row);
    return {
      list: () => withRetry(() => at("GET", "/auth/identities")).then((d) => (d && Array.isArray(d.identities)
        ? { ...d, identities: d.identities.map(named) } : d)),
      // Prove the KGSM password again, opening the window both writes below need.
      reauth: (password) => withRetry(() => at("POST", "/auth/reauth", { password })),
      // Returns the URL to send the browser to. Navigating is the caller's — a bearer does not
      // survive a top-level navigation, so the start has to be an XHR and the bounce a location set.
      // The provider comes from the door's own list, never from a name written here.
      startLink: (provider) =>
        withRetry(() => at("POST", "/auth/identities/" + encodeURIComponent(provider) + "/start", {}, true)),
      unlink: (credentialId) =>
        withRetry(() => at("DELETE", "/auth/identities/" + encodeURIComponent(credentialId))),
    };
  }

  // api.members(id) — the cluster membership surface (/api/v1/members…): admin CRUD over
  // this host's peer roster + the viewer-safe converged roster. v1-routed (get/
  // post/patch/del, not rootGet/rootPost) because these live under /api/v1, not
  // at the bare origin. Mirrors sessionsScoped's withRetry verbatim (see its
  // comment) rather than sharing it — each scoped surface owns its own closure.
  function membersScoped(id) {
    if (!id) throw new Error("api.members() requires a concrete host id (got " + id + ")");
    const withRetry = (call) => call().catch(err => {
      if (!err || err.code !== 401 || err.preflight || !sessionStore) throw err;
      sessionStore.expire();
      return call();
    });
    return {
      // Admin: this host's full membership roster.
      list: () => withRetry(() => get("/members", id)).then(j => (j && j.members) || []),
      // Viewer-safe: the converged member list (no management fields).
      roster: () => withRetry(() => get("/members/roster", id)).then(j => (j && j.members) || []),
      // Admin: add a member by seed URL (+ optional nickname); returns the raw added row.
      add: (url, nickname) => withRetry(() => post("/members", { url, nickname: nickname || null }, id)),
      // Admin: drop a member from this host's roster.
      remove: (memberId) => withRetry(() => del("/members/" + encodeURIComponent(memberId), id)),
      // Admin: enable/disable a member (the trust gate), without removing it.
      setEnabled: (memberId, enabled) => withRetry(() => patch("/members/" + encodeURIComponent(memberId), { enabled: !!enabled }, id)),
      // Admin: on-demand latency probe for one member.
      latency: (memberId) => withRetry(() => get("/members/" + encodeURIComponent(memberId) + "/latency", id)),
      // Viewer: which member holds each of the cluster's capabilities. Viewer-visible because it is
      // what makes a member with no servers legible — it is not a broken node, it is the one holding
      // the accounts.
      capabilities: () => withRetry(() => get("/members/capabilities", id)).then(j => (j && j.capabilities) || []),
      // Admin: move a capability to another member. The deliberate failover — nothing promotes
      // itself, so this is the only way one moves. An empty member id records "deliberately nobody".
      assign: (capability, memberId) => withRetry(() =>
        put("/members/capabilities/" + encodeURIComponent(capability), { memberId: memberId || "" }, id)),
    };
  }

  // Fan a GET across EVERY connection (multi-host roll-up). Returns
  // [{ conn, ok, data, err }] — per-connection failures captured, so one host
  // being down doesn't fail the whole read; the caller merges (lib/merge.js).
  //
  // A connection with a backend id goes through its scoped client (per-host
  // bearer + the 401 heal). One without an id yet is addressed by ITS OWN URL —
  // the node is named, it just isn't identified — and carries no bearer, because
  // sessions are keyed by host id and there is no token that belongs to it.
  function fanOut(path) {
    if (!CONNECTIONS.length) return Promise.resolve([{ conn: null, ok: false, err: offlineError(), data: null }]);
    const byUrl = (conn) => (p) =>
      liveFetch("GET", p, null, null, null, apiV1ForConn(conn)).then((j) => adaptResponse(p, j));
    return Promise.all(CONNECTIONS.map((conn) => {
      const client = conn.id ? hostScoped(conn.id) : { get: byUrl(conn) };
      return client.get(path).then(
        (data) => { recordReach(conn, true, null); return { conn, ok: true, data }; },
        (err) => { recordReach(conn, false, err); return { conn, ok: false, err, data: null }; },
      );
    }));
  }

  // Server-side sign-out for a host: revoke the CALLING session in the registry
  // (root-routed POST /auth/logout, funneled with the live bearer). The one auth call that never
  // resolves a door — it is the node's own, and the cluster-wide sign-out is sessionStore's, which
  // tells the anchor directly. Best-effort
  // — the caller drops its local tokens regardless; a 401 (already gone) or a
  // network error must never block the client-side logout.
  function logout(id) {
    if (!id) return Promise.resolve();
    return rootPost("/auth/logout", {}, id).catch(() => {});
  }

  const api = {
    get, post, patch, put, del, stream, fanOut, meWith, pingHost, logout,
    host: hostScoped,
    sessions: sessionsScoped,
    users: usersScoped,
    identities: identitiesScoped,
    members: membersScoped,
    reconnectHost, reconnectAll,
    startStreams, stopStreams,
    __sessionStatus: sessionStatus,
    // Test/dev affordance: inject a RAW server→client frame through the full live
    // path (adapt → dispatch), exactly as the WebSocket would. Lets the smoke
    // verify the server.patch/server.removed/job.patch remaps deterministically.
    // `hostId` is the node the frame is delivered AS — a real socket always stamps one, so a check
    // that reads the origin off a message has to be able to state it here too.
    __dispatch: (raw, hostId = null) => dispatchMessage(adaptStreamMessage(raw, hostId)),
    // The topic set every primary stream asks for. A topic missing from it is a feature that
    // silently never arrives — nothing errors, the frames simply are not sent — so it is readable.
    __topics: () => GLOBAL_TOPICS.slice(),
  };

export { api, connectionStore, reachStore, realtimeStore };
