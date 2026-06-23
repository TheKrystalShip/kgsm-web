import { api } from "./apiClient.js";
import { CONNECTIONS, LIVE, MOCK, reconcileConnectionId } from "./config.js";
import { KRYSTAL_DATA } from "./data.js";
import * as merge from "./merge.js";
import { createStore, useStore } from "./store.js";

// stores.js — domain stores (the server-authoritative cache the UI reads from).
//
// Each store holds one domain's data, hydrated from the API and — in
// production — kept live over the WebSocket. Components read them with useStore
// and never touch KRYSTAL_DATA directly. As real endpoints ship, only
// the hydrate source below changes; no component is touched. See
// architecture.html (§4, §7).

// ---- Game servers -------------------------------------------------------
// Cold-load vs background-refresh: in slow-network mode (?slow=1 / dev toggle)
// the surface stores start EMPTY so the very first load shows skeletons; in
// normal mode they hydrate synchronously from the fixture (instant, no flash).
// `everLoaded` is the guard that makes skeletons COLD-ONLY: once a store has
// held data, a later refetch keeps showing it (stale-while-revalidate) and
// never flashes skeletons again — the refresh spinner / connection banner
// cover the background fetch instead.
const _slow = (() => { try { return !!(api && api.__slow && api.__slow()); } catch (e) { return false; } })();
// "Cold" boot = start surface stores EMPTY and hydrate asynchronously from the
// backend. True in slow-network demo mode (?slow=1) AND whenever a live backend
// is wired (VITE_API_BASE) — in live mode there are no fixtures to show, so we
// always fetch real data on boot. Default (mock, fast) keeps the synchronous
// fixture seed for an instant, flash-free first paint.
const _cold = _slow || LIVE;
// Fixtures seed ONLY in the MOCK demo. A cold (LIVE/slow) boot starts empty and
// fetches; an OFFLINE boot (no connection, no MOCK) starts empty and fetches
// nothing — the app shows the connect screen before any data surface renders.
const _seed = (arr) => ((!_cold && MOCK) ? arr : []);

const serversStore = createStore({
  // Mock hydration: synchronous from the fixture so there's no first-paint
  // flash (cold-load skeletons only appear in slow mode — see _seed).
  list: _seed((KRYSTAL_DATA.servers || []).map(s => ({ ...s }))),
  status: _cold ? "loading" : "ready",   // ready | loading | error
  error: null,
  everLoaded: !_cold,                     // true once real data has landed
});

// Domain actions. These mirror the server: the fake state machine in App still
// drives transitions for now (it stands in for KGSM), writing through here so
// the store stays the single reactive source. Migrating those transitions to
// api.post("/servers/{id}/commands") + the `jobs` channel is the next step.
serversStore.patch = (id, partial) =>
  serversStore.setState(s => ({ ...s, list: s.list.map(x => (x.id === id ? { ...x, ...partial } : x)) }));
serversStore.add = (server) =>
  serversStore.setState(s => ({ ...s, list: [...s.list, server] }));
serversStore.find = (id) =>
  serversStore.getState().list.find(x => x.id === id) || null;
// Manual re-fetch of the authoritative server list. Game servers stay live on
// their own via the `servers` WebSocket channel below, but a server registered
// directly in the backend won't surface until the next push — so the Servers
// page offers this as a manual "pull latest now". We re-fetch /servers and
// merge by id: fixed metadata comes from the fetch, while the fields the socket
// owns (status/uptime/in-flight job) are preserved for servers we already
// track, and brand-new servers are added. Returns the promise for progress UI.
serversStore.refresh = () => {
    serversStore.setState(s => ({ ...s, status: "loading", error: null }));
    // Fan out across every connected host and merge by id (each server is owned
    // by one host, tagged hostId by the backend). MOCK / lone seed → a single get,
    // so N=1 is identical to before. A partial failure (one host down) shows the
    // rest; only an all-hosts failure is an error.
    return api.fanOut("/servers").then(results => {
      const okr = results.filter(r => r.ok);
      if (results.length && !okr.length) { const err = results[0].err; serversStore.setState(s => ({ ...s, status: "error", error: err })); throw err; }
      const list = merge.mergeServers(okr.map(r => r.data));
      serversStore.setState(s => {
        const cur = new Map(s.list.map(x => [x.id, x]));
        const next = list.map(srv => {
          const c = cur.get(srv.id);
          return c ? { ...srv, status: c.status, uptime: c.uptime, job: c.job } : srv;
        });
        return { ...s, list: next, status: "ready", error: null, everLoaded: true };
      });
      resolveGameNames();   // a refetch re-pulls `game` as the blueprint id → re-resolve
      return list;
    });
  };

// Keep the store live from the server's `servers` channel. In the mock this is
// where lifecycle-command transitions (status/uptime) land; in production it's
// the same WebSocket push. This replaces the old in-component state machine.
api.stream.subscribe(["servers"], (m) => {
  if (m.type === "server.patch" && m.data && m.data.id) {
    // server.patch carries a FULL element to merge by id → UPSERT: patch an
    // existing server, or add one the roster didn't have yet (a server registered
    // directly on the backend surfaces here without waiting for a manual refresh).
    if (serversStore.find(m.data.id)) {
      const { id, ...patch } = m.data;
      serversStore.patch(id, patch);
    } else {
      serversStore.add(m.data);
    }
    // A live patch carries `game` as the raw blueprint id again → re-join the
    // catalog name so the display name doesn't regress (no-op until curation).
    resolveGameNames();
  } else if (m.type === "server.removed" && m.data && m.data.id) {
    // Roster tombstone: the instance is gone → drop it (architecture.html §3·b).
    serversStore.setState(s => ({ ...s, list: s.list.filter(x => x.id !== m.data.id) }));
  }
});

// ---- Jobs (command outcomes, keyed by id) -------------------------------
// The `jobs` channel drives two things: the per-server in-flight indicator
// (serversStore.job, below) AND — keyed by job id here — the OUTCOME a confirmed
// assistant command verifies against (slice 9b). We retain the latest adapted job
// per id (state queued|running|"done"; adaptJob collapses succeeded|failed→"done"
// but keeps `error`, so done+no-error = succeeded, done+error = failed). Fed ONLY
// from WS frames (never the POST's `queued` response, a different vocab), so
// awaitJob reads authoritative state. A homelab issues a handful of commands —
// the map stays small; no eviction needed.
const jobsStore = createStore({ byId: {} });
jobsStore.upsert = (job) => {
  if (!job || !job.id) return;
  jobsStore.setState(s => ({ ...s, byId: { ...s.byId, [job.id]: { ...s.byId[job.id], ...job } } }));
};
jobsStore.get = (id) => (id ? jobsStore.getState().byId[id] || null : null);

// Track the in-flight command per server from the `jobs` channel, so action
// buttons can show progress (spinner) and lock siblings until it completes.
api.stream.subscribe(["jobs"], (m) => {
  // mock pushes `job`; live pushes `job.patch` (adaptJob collapses the API's
  // succeeded|failed terminal states to "done", so this one branch serves both).
  if ((m.type === "job" || m.type === "job.patch") && m.data) {
    jobsStore.upsert(m.data);              // retain by id for command-verify correlation
    const { serverId, verb, state } = m.data;
    serversStore.patch(serverId, { job: state === "done" ? null : { verb, state } });
  }
});

// ---- Hosts (diagnostics) ------------------------------------------------
// Read-heavy and live (cpu/ram/net/temp). Production:
//   api.get("/hosts").then(list => hostsStore.setState({ list }));
//   api.stream.subscribe(["hosts/primary/metrics"], m => hostsStore.patch(m.data.id, m.data));
const hostsStore = createStore({
  list: _seed((KRYSTAL_DATA.hosts || []).map(h => ({ ...h }))),
  status: _cold ? "loading" : "ready",
  error: null,
  everLoaded: !_cold,
});
hostsStore.patch = (id, partial) =>
  hostsStore.setState(s => ({ ...s, list: s.list.map(x => (x.id === id ? { ...x, ...partial } : x)) }));
hostsStore.find = (id) => hostsStore.getState().list.find(x => x.id === id) || null;
// Resource CRUD — hosts are a first-class resource managed from the Hosts page.
//   add: append a freshly-connected host (production: POST /hosts).
//   update: rename / edit fields (production: PATCH /hosts/{id}).
//   remove: only when it owns no servers — otherwise the caller must move or
//           delete those servers first, so we never orphan history.
hostsStore.add = (host) =>
  hostsStore.setState(s => ({ ...s, list: [...s.list, host] }));
hostsStore.update = (id, partial) => hostsStore.patch(id, partial);
hostsStore.remove = (id) =>
  hostsStore.setState(s => ({ ...s, list: s.list.filter(x => x.id !== id) }));
// Re-fetch the host list (status → loading → ready/error). Used by the slow
// re-hydrate and any future manual refresh; the fleet grid reads `status`.
hostsStore.refresh = () => {
  hostsStore.setState(s => ({ ...s, status: "loading", error: null }));
  // Each connection answers for its own host (an array of one). Reconcile the
  // connection's real id from the host it reports — so per-host routing + WS keys
  // are exact even for a lone seed connected id-less — then merge all hosts.
  return api.fanOut("/hosts").then(results => {
    const okr = results.filter(r => r.ok);
    if (results.length && !okr.length) { const err = results[0].err; hostsStore.setState(s => ({ ...s, status: "error", error: err })); throw err; }
    okr.forEach(r => { const h = (r.data || [])[0]; if (r.conn && h && h.id) reconcileConnectionId(r.conn.url, h.id); });
    const list = merge.mergeHosts(okr.map(r => r.data));
    hostsStore.setState(s => {
      // LIVE: the connected hosts are authoritative → replace. MOCK: keep
      // client-added hosts the fixture fetch doesn't know (the demo add-host flow).
      if (LIVE) return { ...s, list, status: "ready", error: null, everLoaded: true };
      const fetched = new Map(list.map(h => [h.id, h]));
      const known = new Set(s.list.map(h => h.id));
      const merged = s.list.map(h => fetched.has(h.id) ? { ...h, ...fetched.get(h.id) } : h);
      list.forEach(h => { if (!known.has(h.id)) merged.push(h); });
      return { ...s, list: merged, status: "ready", error: null, everLoaded: true };
    });
    return list;
  });
};

// ---- Host metrics live tick (diagnostics deep-dive only) ----------------
// The host telemetry tick (`hosts/{id}/metrics` → `host.metrics`, adapted by
// adaptHostMetrics) carries ONLY the measured-capacity portion of the host —
// cpu / ram / disks / iface throughput / boot-time. It deliberately omits the
// capability block (status flips ride hosts/{id}/capabilities) and the firewall
// open-ports grid (that's the on-demand detail probe). So we MERGE it in
// clobber-safe: swap the telemetry fields, DEEP-merge network (replace interfaces,
// keep open_ports), and never touch `capabilities` except to stamp freshness.
//
// last_sample_at is stamped with RECEIPT time (skew-immune — a monitor/FE clock
// skew can't make a just-arrived tick look stale), giving the diagnostics "frozen"
// treatment an honest signal: if ticks stop (socket drop or monitor death while the
// capability hasn't been re-polled), it ages past the staleness floor → frozen.
hostsStore.mergeMetrics = (id, t) => {
  if (!t) return;
  const at = new Date().toISOString();
  hostsStore.setState(s => ({
    ...s,
    list: s.list.map(h => {
      if (h.id !== id) return h;
      const cap = h.capabilities || {};
      const next = { ...h };
      // MERGE cpu (don't replace): the tick carries only the dynamic fields
      // (usage/per-core/cores/load); the static identity (model/threads/freq) set
      // by the REST hydrate must survive — a wholesale swap would wipe it.
      if (t.cpu) next.cpu = { ...(h.cpu || {}), ...t.cpu };
      if (t.ram) next.ram = t.ram;
      if (t.disks) next.disks = t.disks;
      if (t.sensors) next.sensors = t.sensors;   // hwmon temps are dynamic → update from the tick
      if (t.boot_time != null) next.boot_time = t.boot_time;
      if (t.hostname) next.hostname = t.hostname;
      // Deep-merge: the tick carries interfaces but NOT open_ports (firewall block) → keep open_ports.
      next.network = { ...(h.network || {}), interfaces: t.interfaces || (h.network && h.network.interfaces) || [] };
      // Stamp freshness without disturbing the rest of the capability block (status/since/info/provisioned).
      next.capabilities = { ...cap, metrics: { ...(cap.metrics || {}), last_sample_at: at } };
      return next;
    }),
  }));
};
// Drop the WS freshness stamp, reverting this host to capability-based freshness.
// Run by the deep-dive disposer so a stamped sample never leaks to the per-server
// surfaces that share hostMetricsFreshness once you stop inspecting the host.
hostsStore.clearMetricsStamp = (id) => {
  hostsStore.setState(s => ({
    ...s,
    list: s.list.map(h => {
      const m = h.id === id && h.capabilities && h.capabilities.metrics;
      if (!m || m.last_sample_at == null) return h;
      const { last_sample_at, ...rest } = m;
      return { ...h, capabilities: { ...h.capabilities, metrics: rest } };
    }),
  }));
};
// Subscribe to a host's live metric ticks, scoped to its diagnostics deep-dive.
// Subscriber-gated on BOTH ends: the kgsm-api MetricsPump scrapes the monitor only
// while a client is subscribed, and we subscribe ONLY while the deep-dive is open
// → an idle panel costs nothing. The disposer unsubscribes the socket topic (so the
// server pump idles again) AND clears the freshness stamp. LIVE-only — the mock has
// no host-metrics emitter, so this is a no-op there (returns an inert disposer).
function subscribeHostMetrics(hostId) {
  if (!LIVE || !hostId) return () => {};
  const topic = "hosts/" + hostId + "/metrics";
  const dispose = api.stream.subscribe([topic], (m) => {
    if (m && m.type === "host.metrics" && m.data) hostsStore.mergeMetrics(hostId, m.data);
  });
  return () => { dispose(); hostsStore.clearMetricsStamp(hostId); };
}

// ---- Server write actions (the two mutation paths into the engine) ------
// Both go through the HOST-SCOPED client (api.host) so the per-host session
// gate runs (bearer injected + 401 → re-auth) and the M5 provenance origin is
// stamped onto the kgsm command. Neither writes the store directly: the
// authoritative result arrives over the WS — a lifecycle command's status +
// job progress on the `servers`/`jobs` channels, an install's new server on
// `servers` (server.patch) once kgsm finishes the off-request work. Callers
// handle a rejected 401 (open the re-auth modal). The mock seam answers both
// (runServerCommand for the command verb; the LIVE install path is App's mock
// fabrication, so installServer is only ever called when LIVE).

// Issue a lifecycle command (start|stop|restart|open_ports). `origin` tags the
// driving surface on the kgsm event + the audit row it sources (M5) — "ui" for a
// panel button, "assistant" for a confirmed assistant proposal (slice 9b). The
// server's resulting status + the in-flight job ride the WS, not this return.
function commandServer(server, verb, origin = "ui") {
  const client = (server && server.hostId && api.host) ? api.host(server.hostId) : api;
  return client.post("/servers/" + server.id + "/commands", { verb, origin });
}

// Resolve when a job reaches a terminal state, read from the WS-fed jobsStore.
// Race-free: the always-on `jobs` subscriber upserts every frame, so we check the
// CURRENT state first (the terminal frame may have already landed) THEN subscribe
// for a future transition — with no await between, so there's no window to miss a
// frame.
//
// The give-up is gated on SOCKET LIVENESS, NOT wall-clock and NOT time-at-state. A
// real start runs queued→running→…(minutes, NO frames in between)…→done, so a long
// silent gap is the NORMAL slow-start case — surrendering on elapsed time would flip a
// command that actually succeeds to a permanent, stale "couldn't confirm". So while
// the host socket is UP we wait indefinitely (the late `done` still lands); we resolve
// honest "unknown" ONLY when the socket is sustained-DOWN (the one state where the
// outcome frame genuinely can't arrive — there's no GET /jobs to recover it). Honest-
// unknown, never a fabricated success. Returns { status, job? }. Timing + the liveness
// probe are injectable for tests via __setJobTiming.
let _jobPollMs = 3000;          // how often to sample socket liveness
let _jobDeadMs = 30000;         // sustained-down for this long → honest "unknown"
let _jobLiveProbe = null;       // test override (hostId)=>bool; null = real host socket
function __setJobTiming(opts) {
  if (!opts) { _jobPollMs = 3000; _jobDeadMs = 30000; _jobLiveProbe = null; return; }
  if (opts.pollMs != null) _jobPollMs = opts.pollMs;
  if (opts.deadMs != null) _jobDeadMs = opts.deadMs;
  if ("liveProbe" in opts) _jobLiveProbe = opts.liveProbe;
}
function awaitJob(jobId, hostId) {
  return new Promise((resolve) => {
    if (!jobId) { resolve({ status: "unknown" }); return; }
    let settled = false, poll = null, dispose = null, downTicks = 0;
    const maxDownTicks = Math.max(1, Math.ceil(_jobDeadMs / _jobPollMs));
    const finish = (val) => {
      if (settled) return;
      settled = true;
      if (poll) { clearInterval(poll); poll = null; }
      if (dispose) dispose();
      resolve(val);
    };
    const evaluate = () => {
      const j = jobsStore.get(jobId);
      if (j && j.state === "done") finish({ status: j.error ? "failed" : "succeeded", job: j });
    };
    // "up" (a live socket the outcome frame can ride) resets the streak; "down"/
    // "reconnecting" both count toward the give-up grace — a long-enough outage
    // could have dropped the (un-replayable) terminal frame.
    const socketUp = () => {
      try {
        if (_jobLiveProbe) return !!_jobLiveProbe(hostId);
        if (!hostId || !api.__hostSocket) return true;
        return api.__hostSocket(hostId) === "up";
      } catch (e) { return true; }
    };
    const tick = () => {
      if (settled) return;
      if (socketUp()) { downTicks = 0; return; }
      if (++downTicks >= maxDownTicks) finish({ status: "unknown" });
    };
    dispose = jobsStore.subscribe(evaluate);
    poll = setInterval(tick, _jobPollMs);
    evaluate();                             // resolve now if the terminal frame already arrived
  });
}

// Confirm + execute an assistant-proposed command (slice 9b / fork (a)): the SAME
// M3 path the UI buttons use, stamped origin:"assistant" (M5 provenance). NO double-
// write, NO fabricated audit row — the backend writes the audit from the kgsm event
// echo (the old mock handler that did both is gated off in LIVE). Returns the outcome
// the chat composes command.verified from: { status: succeeded|failed|unknown|sent,
// job?, jobId }. The status reached + the audit row arrive on the WS, exactly as for
// a UI command. `token` on the proposal is inert for this path (it routes to M3, not
// the assistant's /confirm) → never sent.
function confirmCommand(server, verb) {
  return commandServer(server, verb, "assistant").then(resp => {
    const job = resp && resp.job;
    if (!job || !job.id) return { status: "sent", jobId: null };
    return awaitJob(job.id, server && server.hostId).then(r => ({ ...r, jobId: job.id }));
  });
}

// Install a new server from a blueprint (POST /servers → 202 { job }; the
// backend assigns the instance id via kgsm generate-id). `blueprint` is the
// library id the user picked, `name` the instance name; the rest of the install
// form is accepted-but-inert upstream (§3·h additive-only), so we send only the
// honored fields — never a fabricated server row. The new server surfaces on
// `servers` (server.patch) when the install job settles.
function installServer(cfg) {
  const hostId = (cfg && cfg.hostId) || (hostsStore.getState().list[0] || {}).id || null;
  const client = (hostId && api.host) ? api.host(hostId) : api;
  return client.post("/servers", { blueprint: cfg.game.id, name: cfg.name, origin: "ui" });
}

// ---- Selected host (GLOBAL scope) --------------------------------------
// The whole panel is a sink that aggregates many hosts. This store holds the
// active scope the user picks from the sidebar switcher: either a specific
// host id, or the sentinel "all" (aggregate / fleet view). Every data surface
// reads it — servers, audit, diagnostics, the assistant. Persisted so a reload
// keeps you where you were.
const SELECTED_HOST_KEY = "krystal:selectedHost";
function readSelectedHost() {
  try {
    const list = (hostsStore && hostsStore.getState().list) || [];
    const v = localStorage.getItem(SELECTED_HOST_KEY);
    // Single-host deployments: pre-select the lone host instead of the "all
    // hosts" aggregate — there's nothing to aggregate. Multi-host defaults to
    // "all". An explicit, persisted choice always wins either way.
    if (!v) return list.length === 1 ? list[0].id : "all";
    // Guard against a stale id for a host that was since removed.
    if (v !== "all" && !hostsStore.find(v)) return "all";
    return v;
  } catch (e) { return "all"; }
}
const selectedHostStore = createStore({ id: readSelectedHost() });
selectedHostStore.set = (id) => {
  try { localStorage.setItem(SELECTED_HOST_KEY, id); } catch (e) {}
  selectedHostStore.setState({ id });
};
// Keep the single-host default live: until the user makes an explicit (persisted)
// choice, pin scope to the lone host — and fall back to the aggregate the moment
// a second host connects. Never persisted, so it stays a default, not a choice.
hostsStore.subscribe(() => {
  try {
    if (localStorage.getItem(SELECTED_HOST_KEY)) return; // explicit choice wins
    const list = hostsStore.getState().list || [];
    const want = list.length === 1 ? list[0].id : "all";
    if (selectedHostStore.getState().id !== want) selectedHostStore.setState({ id: want });
  } catch (e) {}
});
// Convenience hook: returns the live selected host id ("all" or a host id).
const useSelectedHostId = () => useStore(selectedHostStore, s => s.id);

// Scope helpers — single source of truth for "what belongs to the active host".
//   scopeServers: filter a server list by the selected host ("all" → passthrough).
//   serverHostId: which host a server lives on.
//   auditInScope: an audit event is in scope when its server is on the host,
//                 OR it's a global/account event (no serverId) — those show in
//                 every scope so the log never looks mysteriously empty.
const scopeServers = (servers, hostId) =>
  (!hostId || hostId === "all") ? servers : servers.filter(s => s.hostId === hostId);
const serverHostId = (serverId) => {
  const s = serversStore.find(serverId);
  return s ? s.hostId : null;
};
// ---- Audit host attribution --------------------------------------------
//   auditEventHost: which host an audit event belongs to. Explicit ev.hostId
//     wins (host-level events: connect/disconnect/disk/panel); else derived
//     from the server it concerns; else null = panel-wide (auth, tokens,
//     account settings, Discord) — those belong to no host.
//   auditInScope: under a specific host, show that host's events plus the
//     panel-wide ones (so "who signed in" never vanishes behind a host filter).
const auditEventHost = (ev) => ev.hostId || (ev.serverId ? serverHostId(ev.serverId) : null);
const auditInScope = (ev, hostId) => {
  if (!hostId || hostId === "all") return true;
  const h = auditEventHost(ev);
  if (!h) return true;
  return h === hostId;
};

// ---- Audit log ----------------------------------------------------------
// Append-only event stream. Production: hydrate from api.get("/audit") (cursor
// paginated) and prepend new events arriving on the `audit` WS channel.
//
// Every record carries `hostId` (part of the schema). Host-level and account
// events set it explicitly; server events get it derived from their server at
// hydration, so the source of truth (serverId) isn't duplicated by hand.
const _serverHostMap = {};
(KRYSTAL_DATA.servers || []).forEach(s => { _serverHostMap[s.id] = s.hostId || null; });
const _withHost = (e) => ({ ...e, hostId: e.hostId || (e.serverId ? (_serverHostMap[e.serverId] || null) : null) });
const auditStore = createStore({
  list: _seed((KRYSTAL_DATA.auditLog || []).map(_withHost)),
  status: _cold ? "loading" : "ready",
  error: null,
  everLoaded: !_cold,
  // Keyset paging (LIVE only). `nextCursor` is the rowid to pass as ?cursor= for
  // the next (older) page, or null = the whole log is loaded ("complete"). The
  // page reads `nextCursor != null` as "older events exist, not yet loaded" and
  // discloses that — so its client-side search never silently returns "no match"
  // while matches sit older than the loaded window.
  nextCursor: null,
  loadingMore: false,
  // The server-side filter set applied to the current walk ({severity,serverId,
  // actor,since,category}). The page pushes the structured filters down so the
  // cursor walks the FILTERED log (old matching events stay reachable); loadMore
  // reuses these. Free-text search stays client-side (no backend `q=`).
  filterParams: {},
});
auditStore.prepend = (entry) =>
  auditStore.setState(s => ({ ...s, list: [_withHost(entry), ...s.list] }));

// One keyset page off the live endpoint (limit clamps to <=200 server-side).
// Returns { rows, nextCursor } in BOTH modes: LIVE hits adaptAudit (the envelope);
// MOCK's resolveGet returns the bare fixture array (no query parsing) → nextCursor
// null. We only ever attach a query string in LIVE (the mock resolver matches the
// path exactly and would 404 on "/audit?…").
const AUDIT_BATCH = 200;   // the server's max page — fetch it whole
const AUDIT_CAP = 1000;    // initial-walk ceiling: auto-completes a typical per-host
                           //   log (→ search is honest over the whole loaded set); a
                           //   larger log stops here and discloses + offers "load older".
let _auditGen = 0;         // bumped by refresh() → invalidates an in-flight loadMore
const _fetchAuditPage = (cursor, params) => {
  if (!LIVE) return api.get("/audit").then(page => ({
    rows: (Array.isArray(page) ? page : (page && page.rows) || []).map(_withHost),
    nextCursor: null,
  }));
  const qs = new URLSearchParams({ limit: String(AUDIT_BATCH) });
  if (cursor) qs.set("cursor", cursor);
  for (const k in (params || {})) { const v = params[k]; if (v != null && v !== "") qs.set(k, v); }
  return api.get("/audit?" + qs.toString()).then(page => ({
    rows: ((page && page.rows) || []).map(_withHost),
    nextCursor: (page && page.nextCursor) || null,
  }));
};

// Re-fetch the log (status → loading → ready/error). The audit page reads
// `status` to show its timeline skeleton. `params` = the server-side filter set
// (severity/serverId/actor/since/category); blank → the whole log. In LIVE this
// WALKS the keyset cursor (filtered) up to AUDIT_CAP so events older than the
// first page are reachable; a fresh refresh bumps the generation so a slow
// in-flight loadMore can't append onto the new list.
auditStore.refresh = (params) => {
  const gen = ++_auditGen;
  const filterParams = params || {};
  auditStore.setState(s => ({ ...s, status: "loading", error: null, filterParams }));
  // Multi-host: N independent logs don't share a keyset cursor space, so v1 pulls a
  // recent window from each host and merge-sorts newest-first (mergeAuditRows). A
  // unified cross-host "load older" (k-way cursor) is a documented follow-up — for
  // now nextCursor is null (no global load-older); per-host drill-in covers depth.
  if (LIVE && CONNECTIONS.length > 1) {
    const qs = new URLSearchParams({ limit: String(AUDIT_BATCH) });
    for (const k in filterParams) { const v = filterParams[k]; if (v != null && v !== "") qs.set(k, v); }
    return api.fanOut("/audit?" + qs.toString()).then(results => {
      if (gen !== _auditGen) return [];
      const okr = results.filter(r => r.ok);
      if (results.length && !okr.length) { const err = results[0].err; auditStore.setState(s => ({ ...s, status: "error", error: err })); throw err; }
      const rows = merge.mergeAuditRows(okr.flatMap(r => ((r.data && r.data.rows) || []).map(_withHost)));
      auditStore.setState(s => ({ ...s, list: rows, nextCursor: null, filterParams, status: "ready", error: null, everLoaded: true, loadingMore: false }));
      return rows;
    });
  }
  return _fetchAuditPage(null, filterParams).then(async (page) => {
    let rows = page.rows;
    let next = page.nextCursor;
    while (LIVE && next && rows.length < AUDIT_CAP) {
      const more = await _fetchAuditPage(next, filterParams);
      rows = rows.concat(more.rows);
      next = more.nextCursor;
    }
    if (gen !== _auditGen) return rows;   // a newer refresh superseded us — drop
    auditStore.setState(s => ({ ...s, list: rows, nextCursor: next, filterParams, status: "ready", error: null, everLoaded: true, loadingMore: false }));
    return rows;
  }, err => {
    if (gen === _auditGen) auditStore.setState(s => ({ ...s, status: "error", error: err }));
    throw err;
  });
};
// Fetch the next (older) keyset page and APPEND it — the "Load older events"
// action when the FILTERED log exceeds the initial walk. Reuses the active
// filterParams so the cursor stays on the same filtered set. No-op unless LIVE
// with an outstanding cursor and not already loading. De-dups by id (defensive)
// and drops its result if a refresh replaced the list underneath it (generation
// guard). A failed load is non-fatal: keep what's loaded, leave the affordance.
auditStore.loadMore = () => {
  const st = auditStore.getState();
  if (!LIVE || !st.nextCursor || st.loadingMore) return Promise.resolve();
  const gen = _auditGen;
  const cursor = st.nextCursor;
  const filterParams = st.filterParams || {};
  auditStore.setState(s => ({ ...s, loadingMore: true }));
  return _fetchAuditPage(cursor, filterParams).then(page => {
    if (gen !== _auditGen) return;
    auditStore.setState(s => {
      const seen = new Set(s.list.map(e => e.id));
      const fresh = page.rows.filter(e => !seen.has(e.id));
      return { ...s, list: s.list.concat(fresh), nextCursor: page.nextCursor, loadingMore: false };
    });
  }, () => {
    if (gen === _auditGen) auditStore.setState(s => ({ ...s, loadingMore: false }));
  });
};
// Keep the log live: a new record arrives on the `audit` channel as
// `audit.append` (immutable, never edited) → prepend it. REST is the hydrate/
// backfill; the socket carries fresh appends (architecture.html §3·d/§3·j).
api.stream.subscribe(["audit"], (m) => {
  if (m.type === "audit.append" && m.data) auditStore.prepend(m.data);
});

// ---- Game library (installable catalog) ---------------------------------
// Mostly static; hydrate from api.get("/library"). Listed for completeness so
// every page reads a store, never the fixture.
const libraryStore = createStore({
  list: _seed((KRYSTAL_DATA.catalog || []).slice()),
  status: _cold ? "loading" : "ready",   // ready | loading | error
  error: null,
  everLoaded: !_cold,
});
// Force a re-fetch of the catalog and re-populate the in-memory store. Games
// are added server-side (a new server registers its game in the backend), so
// without this the library only updates on a full page reload. The library
// view calls this from its Refresh button; production swaps nothing — api.get
// already hits /library. Returns the promise so callers can show progress.
libraryStore.refresh = () => {
  libraryStore.setState(s => ({ ...s, status: "loading", error: null }));
  // Fan out the catalog across hosts; the SAME game on multiple hosts de-dups to
  // one entry whose `hosts` UNIONs the offering (mergeLibrary). MOCK / lone seed
  // (no source hostId) keeps the fixture's own offering untouched.
  return api.fanOut("/library").then(results => {
    const okr = results.filter(r => r.ok);
    if (results.length && !okr.length) { const err = results[0].err; libraryStore.setState(s => ({ ...s, status: "error", error: err })); throw err; }
    const list = merge.mergeLibrary(okr.map(r => ({ hostId: r.conn && r.conn.id, list: r.data })));
    libraryStore.setState(s => ({ ...s, list, status: "ready", error: null, everLoaded: true }));
    return list;
  });
};
// A game's host offering can change at runtime — e.g. a host syncs its catalog
// to match the fleet, so a once-exclusive game becomes available everywhere (or
// vice-versa). Patch the offering in place; every subscriber (library cards,
// game detail, the open install modal) re-renders through useStore. Pass a host
// id array to restrict, or null/omit to clear the restriction (offered by all).
libraryStore.setOffering = (id, hosts) =>
  libraryStore.setState(s => ({
    ...s,
    list: s.list.map(g => {
      if (g.id !== id) return g;
      if (hosts == null) { const { hosts: _drop, ...rest } = g; return rest; }
      return { ...g, hosts };
    }),
  }));

// ---- Game metadata resolution (servers ✕ library) -----------------------
// The backend gives a server only its blueprint id (e.g. "factorio"); the human
// title AND the RAWG-sourced cover/hero art live on the /library entry, never on
// the server DTO. Join on the blueprint id to attach `game` (display name) plus
// `cover`/`hero` so the server tiles/hero/sidebar light up with the same art the
// catalog shows. Today the curated titles equal the ids upstream (name == id),
// so the NAME side is a no-op that SELF-HEALS the moment curation lands — never a
// fabricated label; the cover side lights up as soon as the library entry has one
// (cover/hero null → the components keep their `art` gradient fallback). Runs
// after every server refresh (the merge re-pulls the id), whenever the catalog
// changes, and once at init (the seed subscription wouldn't fire for it).
function resolveGameNames() {
  const lib = libraryStore.getState().list || [];
  if (!lib.length) return;
  const byId = new Map(lib.map(g => [g.id, g]));
  const cur = serversStore.getState().list;
  let changed = false;
  const next = cur.map(srv => {
    const g = srv.blueprint ? byId.get(srv.blueprint) : null;
    if (!g) return srv;
    // Normalize to ?? null so a metadata-less game doesn't flip `changed` every
    // run (which would re-render every subscriber on each library tick).
    const name = g.name;
    const cover = g.cover ?? null;
    const hero = g.hero ?? null;
    if ((name && srv.game !== name) || (srv.cover ?? null) !== cover || (srv.hero ?? null) !== hero) {
      changed = true;
      return { ...srv, ...(name ? { game: name } : null), cover, hero };
    }
    return srv;
  });
  // setState always emits — only write on a real change, else a library tick
  // would needlessly re-render every server subscriber. NOT subscribed to
  // serversStore itself (that would loop through this very setState).
  if (changed) serversStore.setState(s => ({ ...s, list: next }));
}
libraryStore.subscribe(resolveGameNames);
// Run once at init: the seed above is synchronous (MOCK) so the subscribe never
// fires for it; without this the join only ran on a later refresh/stream tick.
resolveGameNames();

// ---- Favorites (client-local, persisted) --------------------------------
// A user's pinned servers. This is a CLIENT preference, not server truth — it
// lives only in localStorage and never round-trips to a host (unlike a server's
// status or notice). Stored as an ordered id array so JSON round-trips cleanly;
// membership tests go through `has`. The Servers page reads this to render a
// pinned "Favorites" section ABOVE the host/blueprint groups — favorited
// servers are MIRRORED there, never moved out of their host group, so the host
// view stays a complete picture of each machine's blast radius.
const FAVORITES_KEY = "krystal:favorites";
function readFavorites() {
  try {
    const arr = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(arr) ? arr.filter(x => typeof x === "string") : [];
  } catch (e) { return []; }
}
const favoritesStore = createStore({ ids: readFavorites() });
function writeFavorites(ids) { try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids)); } catch (e) {} }
favoritesStore.has = (id) => favoritesStore.getState().ids.includes(id);
favoritesStore.toggle = (id) => favoritesStore.setState(s => {
  const next = s.ids.includes(id) ? s.ids.filter(x => x !== id) : [...s.ids, id];
  writeFavorites(next);
  return { ids: next };
});
favoritesStore.set = (id, on) => favoritesStore.setState(s => {
  if (on === s.ids.includes(id)) return s;
  const next = on ? [...s.ids, id] : s.ids.filter(x => x !== id);
  writeFavorites(next);
  return { ids: next };
});
// Convenience hook — returns a stable boolean, so it won't churn renders.
const useIsFavorite = (id) => useStore(favoritesStore, s => s.ids.includes(id));

// ---- Cold boot (live backend, or slow-network demo) ----------------------
// When a live backend is wired (VITE_API_BASE) OR the demo boots in slow mode
// (?slow=1 / persisted dev flag), kick a real async hydrate of every surface
// store: live mode fetches real data (no fixtures to show); slow mode shows
// skeletons for ~1.4s exactly as a latent backend would. Default (mock, fast)
// keeps the synchronous fixture data above — instant, no flash. The dev "Slow
// network" toggle calls these same refreshes at runtime to re-enter loading.
try {
  if (_cold) {
    const swallow = () => {};   // each store records its own error state
    serversStore.refresh().catch(swallow);
    libraryStore.refresh().catch(swallow);
    hostsStore.refresh().catch(swallow);
    auditStore.refresh().catch(swallow);
  }
} catch (e) {}

export { __setJobTiming, auditEventHost, auditInScope, auditStore, awaitJob, commandServer, confirmCommand, favoritesStore, hostsStore, installServer, jobsStore, libraryStore, scopeServers, selectedHostStore, serverHostId, serversStore, subscribeHostMetrics, useIsFavorite, useSelectedHostId };
