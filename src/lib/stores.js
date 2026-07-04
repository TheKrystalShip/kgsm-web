import { adaptPhantom, adaptServerMetrics, adaptService, adaptLeafConfigApply } from "./adapters.js";
import { api, realtimeStore } from "./apiClient.js";
import { CONNECTIONS, reconcileConnectionId } from "./config.js";
import * as merge from "./merge.js";
import { createStore, useStore } from "./store.js";

// stores.js — domain stores (the server-authoritative cache the UI reads from).
//
// Each store holds one domain's data, hydrated from the API and kept live over
// the WebSocket. Components read them with useStore and never reach the API seam
// directly. See architecture.html (§4, §7).

// ---- Game servers -------------------------------------------------------
// Every surface store starts EMPTY and hydrates asynchronously from the backend
// (the boot block at the bottom kicks the first fetch). `everLoaded` is the guard
// that makes skeletons COLD-ONLY: once a store has held data, a later refetch
// keeps showing it (stale-while-revalidate) and never flashes skeletons again —
// the refresh spinner / connection banner cover the background fetch instead.
const serversStore = createStore({
  list: [],
  status: "loading",   // ready | loading | error
  error: null,
  everLoaded: false,   // true once real data has landed
});

// Local store mutators. The authoritative transitions come from the backend over
// the `servers`/`jobs` channels (commandServer → api.post); these helpers apply
// those pushes so the store stays the single reactive source the UI reads.
serversStore.patch = (id, partial) =>
  serversStore.setState(s => ({ ...s, list: s.list.map(x => (x.id === id ? { ...x, ...partial } : x)) }));
serversStore.add = (server) =>
  serversStore.setState(s => ({ ...s, list: [...s.list, server] }));
serversStore.find = (id) =>
  serversStore.getState().list.find(x => x.id === id) || null;
serversStore.remove = (id) =>
  serversStore.setState(s => ({ ...s, list: s.list.filter(x => x.id !== id) }));
// Inject a phantom install-in-progress row. No-ops if the id already exists
// (real server beat the phantom, or the initiating user triggered twice).
serversStore.addPhantom = (id, { blueprint, cover, hero, displayName, hostId } = {}) => {
  if (serversStore.find(id)) return;
  serversStore.add(adaptPhantom({ id, blueprint, cover, hero, displayName, hostId }));
};
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
    // by one host, tagged hostId by the backend). A lone connection → a single
    // get, so N=1 is the simple case. A partial failure (one host down) shows the
    // rest; only an all-hosts failure is an error.
    return api.fanOut("/servers").then(results => {
      const okr = results.filter(r => r.ok);
      if (results.length && !okr.length) { const err = results[0].err; serversStore.setState(s => ({ ...s, status: "error", error: err })); throw err; }
      const list = merge.mergeServers(okr.map(r => r.data));
      serversStore.setState(s => {
        const cur = new Map(s.list.map(x => [x.id, x]));
        const next = list.map(srv => {
          const c = cur.get(srv.id);
          // Preserve the fields the LIST shape doesn't carry but we hold for a row:
          // socket-owned status/uptime/job, AND the detail-only `network` block
          // (required ports, fetched by serversStore.fetchDetail for the connect
          // address). The fresh list element has no `network`, so without this a
          // rehydrate (every WS reopen) would wipe it → the hero connect address
          // flips back to "—". Detail-fetched-once, survives every list refresh.
          // Don't copy status from a phantom — the real backend data should win.
          if (!c || c._phantom) return srv;
          return { ...srv, status: c.status, uptime: c.uptime, job: c.job, network: c.network };
        });
        // Re-attach any phantom installs not yet in the backend list so they survive
        // manual refreshes. They'll be replaced in-place when server.patch arrives.
        const phantoms = s.list.filter(x => x._phantom && !next.some(r => r.id === x.id));
        return { ...s, list: [...next, ...phantoms], status: "ready", error: null, everLoaded: true };
      });
      resolveGameNames();   // a refetch re-pulls `game` as the blueprint id → re-resolve
      return list;
    });
  };

// Fetch one server's DETAIL superset (GET /servers/{id}) and merge its
// detail-only `network` block (required ports ⋈ firewall) onto the cached row.
// The list/stream deliberately OMIT network (it's a per-poll firewall probe the
// backend keeps off the list), so the detail page pulls it on demand — that's
// where the connect address (host:port) gets its port. Only `network` is patched,
// so socket-owned fields (status/uptime/in-flight job) are never clobbered by this
// slower fetch. Routed through the host-scoped client so the per-host auth gate
// runs. Never rejects — a failure leaves the row as-is (the address stays "—").
serversStore.fetchDetail = (id, hostId) => {
  if (!id) return Promise.resolve(null);
  const client = (hostId && api.host) ? api.host(hostId) : api;
  return client.get("/servers/" + id).then(be => {
    // Merge the detail-only fields onto the cached row WITHOUT clobbering the socket-owned
    // status/uptime/job: the `network` block (required ⋈ firewall) plus the blueprint's RAWG
    // cover/hero art (the list/stream omit both → only the detail GET carries them). hero is the
    // landscape banner the ServerHero renders behind the title.
    if (be && serversStore.find(id))
      serversStore.patch(id, { network: be.network || null, cover: be.cover ?? null, hero: be.hero ?? null });
    return be;
  }, () => null);
};

// Keep the store live from the server's `servers` channel — lifecycle-command
// transitions (status/uptime) and roster changes arrive here as WebSocket pushes.
api.stream.subscribe(["servers"], (m) => {
  if (m.type === "server.patch" && m.data && m.data.id) {
    // server.patch carries a FULL element to merge by id → UPSERT: patch an
    // existing server, or add one the roster didn't have yet (a server registered
    // directly on the backend surfaces here without waiting for a manual refresh).
    if (serversStore.find(m.data.id)) {
      const { id, ...patch } = m.data;
      const existing = serversStore.find(id);
      // While an uninstall is in flight the backend's verify step may publish a
      // server.patch before server.removed (roster not yet flushed). Applying it
      // would clear _phantom and briefly show a normal card before removal. Skip
      // the patch entirely — server.removed is the only thing that should change
      // the card state from here.
      if (existing?._phantom && existing?.job?.verb === "uninstall") return;
      // Explicitly clear _phantom and job so a phantom install card transitions
      // to a real server card when server.patch arrives — adaptServer never
      // emits these keys, so a plain spread-merge would leave _phantom:true
      // in place and the card would stay stuck as a phantom install tile.
      serversStore.patch(id, { ...patch, _phantom: false, job: null });
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
// Install jobs also drive phantom card creation and phase updates for ALL
// connected users (not just the one who initiated — the API broadcasts to everyone).
api.stream.subscribe(["jobs"], (m) => {
  // The `jobs` channel pushes `job.patch` (adaptJob collapses the API's
  // succeeded|failed terminal states to "done"). `job` is accepted too for the
  // raw test-injection path.
  if ((m.type === "job" || m.type === "job.patch") && m.data) {
    jobsStore.upsert(m.data);              // retain by id for command-verify correlation
    const { serverId, verb, state, phase, blueprint } = m.data;

    if (verb === "install") {
      // Create phantom for any user who doesn't have the server yet (multi-user
      // broadcast path, or the job appeared before the local 202 resolved).
      if (state !== "done" && !serversStore.find(serverId)) {
        const lib = libraryStore.getState().list || [];
        const gameEntry = blueprint ? lib.find(g => g.id === blueprint) : null;
        serversStore.addPhantom(serverId, {
          blueprint,
          cover:       gameEntry?.cover ?? null,
          hero:        gameEntry?.hero  ?? null,
          displayName: gameEntry?.name  ?? blueprint,
          hostId:      hostsStore.getState().list[0]?.id ?? null,
        });
      }
      if (state === "done") {
        if (m.data.error) {
          // Failed install: keep phantom visible with a failed state so the user
          // knows what happened; they can dismiss it.
          serversStore.patch(serverId, { status: "install-failed", job: null });
        }
        // Success: leave the phantom in place — server.patch SSE will arrive
        // shortly and the upsert path in the `servers` subscriber replaces it.
      } else {
        serversStore.patch(serverId, { job: { verb, state, phase: phase ?? null } });
      }
    } else if (verb === "uninstall") {
      if (state === "done") {
        if (m.data.error) {
          // Failed uninstall: revert to a normal card — the server still exists.
          serversStore.patch(serverId, { _phantom: false, job: null });
        }
        // Success: server.removed SSE arrives shortly and drops the row.
      } else {
        // In progress: flip the existing card to the phantom "Uninstalling" tile.
        serversStore.patch(serverId, { _phantom: true, job: { verb, state } });
      }
    } else {
      serversStore.patch(serverId, { job: state === "done" ? null : { verb, state } });
    }
  }
});

// ---- Hosts (diagnostics) ------------------------------------------------
// Read-heavy and live (cpu/ram/net/temp). Production:
//   api.get("/hosts").then(list => hostsStore.setState({ list }));
//   api.stream.subscribe(["hosts/primary/metrics"], m => hostsStore.patch(m.data.id, m.data));
const hostsStore = createStore({
  list: [],
  status: "loading",
  error: null,
  everLoaded: false,
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
    // The connected hosts are authoritative → replace.
    hostsStore.setState(s => ({ ...s, list, status: "ready", error: null, everLoaded: true }));
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
// server pump idles again) AND clears the freshness stamp.
function subscribeHostMetrics(hostId) {
  if (!hostId) return () => {};
  const topic = "hosts/" + hostId + "/metrics";
  const dispose = api.stream.subscribe([topic], (m) => {
    if (m && m.type === "host.metrics" && m.data) hostsStore.mergeMetrics(hostId, m.data);
  });
  return () => { dispose(); hostsStore.clearMetricsStamp(hostId); };
}

// ---- Host capabilities live patch (app-wide, always-on) -----------------
// A capabilities.patch (hosts/{id}/capabilities) carries the FULL HostCapabilities block. Unlike a
// host metrics/logs tick (which is deep-dive-scoped), the capability SET gates UI across the WHOLE app —
// the assistant FAB/dock (assistant), the Resources/Performance surfaces (metrics), the watchdog-gated
// server actions (watchdog) — so this subscription is always-on for every connected host, not gated to a
// panel. Folded PER-KEY (not a wholesale replace) so a patch updates a capability's provisioned/status/
// since/message/info WITHOUT wiping fields another path owns — notably the metrics tick's last_sample_at
// freshness stamp. A capability the patch newly carries appears; one it drops to provisioned:false reads
// as absent through the capability model → capability-gated UI grows/shrinks live, no reload.
hostsStore.mergeCapabilities = (id, caps) => {
  if (!caps || typeof caps !== "object") return;
  hostsStore.setState(s => ({
    ...s,
    list: s.list.map(h => {
      if (h.id !== id) return h;
      const cur = h.capabilities || {};
      const next = { ...cur };
      for (const k of Object.keys(caps)) next[k] = { ...(cur[k] || {}), ...caps[k] };
      return { ...h, capabilities: next };
    }),
  }));
};
// Keep one capabilities subscription per CONNECTED host, in sync with the host list. The patch carries the
// host in its TOPIC, so each subscription keys off its closure id (the host.metrics precedent). A host added
// at runtime gets subscribed; a removed one disposed. The subscription set is flushed on every (re)open by
// liveStream, so subscribing before the socket is up is fine. Driven off hostsStore so it self-heals as the
// fleet changes; runs once at boot for the hosts already hydrated.
const _capSubs = new Map();   // hostId → dispose
function _subscribeHostCapabilities(hostId) {
  const topic = "hosts/" + hostId + "/capabilities";
  return api.stream.subscribe([topic], (m) => {
    if (m && m.type === "capabilities.patch" && m.data) hostsStore.mergeCapabilities(hostId, m.data);
  });
}
function syncCapabilitySubscriptions() {
  const ids = new Set((hostsStore.getState().list || []).map(h => h && h.id).filter(Boolean));
  for (const id of ids) if (!_capSubs.has(id)) _capSubs.set(id, _subscribeHostCapabilities(id));
  for (const [id, dispose] of _capSubs) if (!ids.has(id)) { try { dispose(); } catch (e) {} _capSubs.delete(id); }
}
hostsStore.subscribe(syncCapabilitySubscriptions);

// ---- Per-server metrics live tick (Performance deep-dive only) -----------
// The per-server tick (`servers/{id}/metrics` → `metrics.tick`, already adapted
// to a chart point by adaptStreamMessage) feeds the Performance tab's live
// rolling window. Unlike the host path there is NO store merge — the window is
// transient local state in the tab (it honestly means "since you opened this"),
// so the helper just forwards each adapted point to the caller's onTick.
//
// Subscriber-gated on BOTH ends, exactly like subscribeHostMetrics: the kgsm-api
// MetricsPump only scrapes the monitor while a client subscribes a metrics topic,
// and we subscribe ONLY while the tab is mounted → an unopened tab costs nothing.
// The id is in the topic, not the payload, so we key off the closure serverId.
function subscribeServerMetrics(serverId, onTick) {
  if (!serverId || typeof onTick !== "function") return () => {};
  const topic = "servers/" + serverId + "/metrics";
  return api.stream.subscribe([topic], (m) => {
    if (m && m.type === "metrics.tick" && m.data) onTick(m.data);
  });
}

// ---- Per-server metrics HISTORY (M9 — the durable tiered store) ---------
// Fetches historical metrics for a server from the new history endpoint.
// Returns the raw response: { entityId, kind, range, step, tier, series }.
// The series object is keyed by metric name, each value an array of points
// with { ts, value } (raw tier) or { ts, value, min, max, n } (rollup tier).
// Gaps are absent points (the backend never carry-forwards). Empty series
// when history is disabled or the monitor has never reported for this server.
async function fetchServerMetricsHistory(serverId, range, hostId) {
  if (!serverId) return null;
  const r = range || "1h";
  return api.host(hostId).get("/servers/" + serverId + "/metrics/history?range=" + r);
}

// Lifecycle events for ONE server within [since, now] — the Performance tab's
// timeline annotations (#3). Reuses the audit endpoint (server-scoped + a `since`
// lower bound) through the host-scoped client so the per-host bearer/401-retry
// runs. Returns the raw rows (newest-first); the caller maps them to markers.
// Best-effort by contract: callers treat a rejection as "no events", never an error.
async function fetchServerEvents(serverId, hostId, sinceIso) {
  if (!serverId) return [];
  const qs = new URLSearchParams({ serverId, limit: "200" });
  if (sinceIso) qs.set("since", sinceIso);
  const client = (hostId && api.host) ? api.host(hostId) : api;
  const page = await client.get("/audit?" + qs.toString());
  return (page && page.rows) || (page && Array.isArray(page.data) ? page.data : null) || (Array.isArray(page) ? page : []) || [];
}

// ---- File browser (per-server working-dir tree + editor cache) -----------
// Keyed by host+server. Caches the lazily-loaded directory listings (flat, by
// path — "" is the root), which folders are EXPANDED, and the last-opened
// file's content+etag. So re-entering the Files tab paints the tree AND the
// editor instantly from cache, then revalidates the tree in the background
// (stale-while-revalidate, exactly like the `everLoaded` surfaces above).
//
// There is NO filesystem WS channel (the stream carries servers/jobs/audit/
// metrics/alerts/network — not files), so "live" here means refetch-on-revisit
// (filesStore.enter), never a push.
//
// Honesty + write-safety: a cached listing is last-known-real (same SWR the
// servers list uses), not fabricated. A cached file's content is only ever
// shown after a deliberate open did a fresh GET; tab re-entry restores that
// last-known content for instant paint, and clicking a file always re-GETs it
// fresh. The etag-guarded PUT (412 → reload prompt) is the safety net that
// stops a stale cached file clobbering newer bytes on disk.
const filesKey = (hostId, serverId) => (hostId || "_") + "/" + serverId;
const _emptyFilesEntry = () => ({ dirs: {}, expanded: {}, open: null, everLoaded: false });
// The store seam: a server carries its host, and like every write path here we
// route through the host-scoped client so the per-host bearer/401-retry runs.
const _filesClient = (hostId) => ((hostId && api.host) ? api.host(hostId) : api);
const filesStore = createStore({ byServer: {} });
filesStore.entry = (hostId, serverId) =>
  filesStore.getState().byServer[filesKey(hostId, serverId)] || null;
const _patchFiles = (key, fn) =>
  filesStore.setState(s => ({ ...s, byServer: { ...s.byServer, [key]: fn(s.byServer[key] || _emptyFilesEntry()) } }));

// Fetch one directory listing (path "" = root) into the store. A COLD load
// marks the dir `loading` with null entries (the row shows "Loading…"); a
// background REVALIDATE keeps the cached entries in place (status flips to
// loading but `entries` survives) so it never flashes a skeleton over good
// data. On success it REPLACES entries/truncated; expansion lives in a separate
// map keyed by path, so a folder that vanished simply stops rendering and a new
// one appears collapsed — no reconciliation pass needed. A failed revalidate
// keeps the last-known entries (SWR) and only surfaces the error when there's
// nothing cached to show. Never rejects (callers fire-and-forget).
filesStore.loadDir = (hostId, serverId, path) => {
  const key = filesKey(hostId, serverId);
  const cur = ((filesStore.getState().byServer[key] || {}).dirs || {})[path] || null;
  const keptEntries = cur && cur.entries ? cur.entries : null;
  const keptTrunc = !!(cur && cur.truncated);
  _patchFiles(key, e => ({ ...e, dirs: { ...e.dirs, [path]: { entries: keptEntries, truncated: keptTrunc, status: "loading", error: null } } }));
  const url = "/servers/" + serverId + "/files" + (path ? "?path=" + encodeURIComponent(path) : "");
  return _filesClient(hostId).get(url).then(
    (res) => {
      _patchFiles(key, e => ({
        ...e,
        everLoaded: path === "" ? true : e.everLoaded,
        dirs: { ...e.dirs, [path]: { entries: (res && res.entries) || [], truncated: !!(res && res.truncated), status: "ready", error: null } },
      }));
    },
    (err) => {
      _patchFiles(key, e => ({
        ...e,
        dirs: { ...e.dirs, [path]: { entries: keptEntries || [], truncated: keptTrunc, status: "error", error: err } },
      }));
    }
  );
};

// Toggle a folder open/closed. Opening lazily fetches its children the first
// time (or after an error); a cached folder opens instantly and is reconciled
// on the next filesStore.enter revalidate.
filesStore.toggleDir = (hostId, serverId, path) => {
  const key = filesKey(hostId, serverId);
  const entry = filesStore.getState().byServer[key] || _emptyFilesEntry();
  const willOpen = !entry.expanded[path];
  _patchFiles(key, e => ({ ...e, expanded: { ...e.expanded, [path]: willOpen } }));
  const d = entry.dirs[path];
  if (willOpen && (!d || (d.status !== "ready" && d.status !== "loading"))) filesStore.loadDir(hostId, serverId, path);
};

// Enter the Files tab for a server: paint the cache instantly, then revalidate
// the root and every currently-expanded folder in the background.
filesStore.enter = (hostId, serverId) => {
  const entry = filesStore.entry(hostId, serverId);
  filesStore.loadDir(hostId, serverId, "");
  if (entry) Object.keys(entry.expanded).forEach((p) => {
    if (p !== "" && entry.expanded[p]) filesStore.loadDir(hostId, serverId, p);
  });
};

// Open a file's content fresh (a deliberate user action always re-GETs) and
// cache it as `open` so a later tab re-entry restores the editor instantly.
// Resolves the cached descriptor; rejects with the API error (the component
// maps binary/too-large by envCode).
filesStore.openFile = (hostId, serverId, path) => {
  const key = filesKey(hostId, serverId);
  return _filesClient(hostId).get("/servers/" + serverId + "/files/content?path=" + encodeURIComponent(path)).then((res) => {
    const open = { path: res.path, content: res.content, etag: res.etag, sizeBytes: res.sizeBytes };
    _patchFiles(key, e => ({ ...e, open }));
    return open;
  });
};

// Save the editor draft (etag-guarded PUT). On success updates the cache so
// content === the saved draft and the etag advances (dirty → false). Rejects
// with the API error so the component can detect 412 (changed on disk).
filesStore.saveFile = (hostId, serverId, path, content, etag) => {
  const key = filesKey(hostId, serverId);
  return _filesClient(hostId).put("/servers/" + serverId + "/files/content?path=" + encodeURIComponent(path), { content, etag, origin: "ui" }).then((res) => {
    const open = { path, content, etag: res.etag, sizeBytes: res.sizeBytes };
    _patchFiles(key, e => ({ ...e, open }));
    return open;
  });
};

// ---- Server write actions (the two mutation paths into the engine) ------
// Both go through the HOST-SCOPED client (api.host) so the per-host session
// gate runs (bearer injected + 401 → re-auth) and the M5 provenance origin is
// stamped onto the kgsm command. Neither writes the store directly: the
// authoritative result arrives over the WS — a lifecycle command's status +
// job progress on the `servers`/`jobs` channels, an install's new server on
// `servers` (server.patch) once kgsm finishes the off-request work. Callers
// handle a rejected 401 (open the re-auth modal).

// Issue a lifecycle command (start|stop|restart|open_ports). `origin` tags the
// driving surface on the kgsm event + the audit row it sources (M5) — "ui" for a
// panel button, "assistant" for a confirmed assistant proposal (slice 9b). The
// server's resulting status + the in-flight job ride the WS, not this return.
function commandServer(server, verb, origin = "ui") {
  const client = (server && server.hostId && api.host) ? api.host(server.hostId) : api;
  return client.post("/servers/" + server.id + "/commands", { verb, origin });
}

// Send an arbitrary console command to a running NATIVE server (POST /servers/{id}/
// console). Fire-and-forget: resolves on a 202 (delivered to the console input) and
// the server's response, if any, streams back on the servers/{id}/console WS topic —
// not this return. `origin` tags the driving surface on the kgsm instance_input_sent
// event + the console.input audit row sourced from it. Callers handle a rejected 401
// (re-auth) + surface other failures (409 = not running / container).
function sendConsoleInput(server, text, origin = "ui") {
  const client = (server && server.hostId && api.host) ? api.host(server.hostId) : api;
  return client.post("/servers/" + server.id + "/console", { input: text, origin });
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
        if (!hostId) return true;
        const rt = realtimeStore.getState();
        if (!rt.online) return false;
        const h = rt.hosts[hostId];
        return h ? h.mode === "live" : true;   // no entry yet → assume up (don't give up early)
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

// Confirm + execute an assistant-proposed command (fork (a)): the SAME M3 path
// the UI buttons use, stamped origin:"assistant" (M5 provenance). NO double-write,
// NO fabricated audit row — the backend writes the audit from the kgsm event echo.
// Returns the outcome the chat composes command.verified from:
// { status: succeeded|failed|unknown|sent,
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
// library id the user picked, `name` the instance name, and `port` the optional
// Game Port override (now honored upstream — kgsm `install --port`). The rest of
// the install form is still accepted-but-inert (§3·h additive-only), so we send
// only the honored fields — never a fabricated server row. The new server
// surfaces on `servers` (server.patch) when the install job settles.
function installServer(cfg) {
  const hostId = (cfg && cfg.hostId) || (hostsStore.getState().list[0] || {}).id || null;
  const client = (hostId && api.host) ? api.host(hostId) : api;
  const body = { blueprint: cfg.game.id, name: cfg.name, origin: "ui" };
  // Only send a real, in-range port; the backend rejects out-of-range, and an empty
  // field must not become a fabricated 0. Omit it → kgsm keeps the blueprint default.
  const port = Number(cfg.port);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) body.port = port;
  return client.post("/servers", body);
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
// Host-level and account events carry `hostId` explicitly; server events carry
// only a serverId and their host is derived at lookup time from serversStore
// (auditEventHost), so the source of truth isn't duplicated by hand and it
// tolerates servers hydrating after the log.
const _withHost = (e) => ({ ...e });
const auditStore = createStore({
  list: [],
  status: "loading",
  error: null,
  everLoaded: false,
  // Keyset paging. `nextCursor` is the rowid to pass as ?cursor= for
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

// One keyset page off the endpoint (limit clamps to <=200 server-side). Returns
// { rows, nextCursor } — adaptAudit unwraps the { data, nextCursor } envelope.
const AUDIT_BATCH = 200;   // the server's max page — fetch it whole
const AUDIT_CAP = 1000;    // initial-walk ceiling: auto-completes a typical per-host
                           //   log (→ search is honest over the whole loaded set); a
                           //   larger log stops here and discloses + offers "load older".
let _auditGen = 0;         // bumped by refresh() → invalidates an in-flight loadMore
// Which host this single-host walk reads. The sole/selected connection's id, so
// the call routes through that host's AUTH-GATED client (api.host(id)) — the bare
// api.get bypasses the per-host bearer + ensure()/401-retry, which under an
// auth-enabled backend means an unauthenticated 401 and an empty log on cold boot
// (the live WS still authenticates, so streamed appends appear but the backfill
// never does). At boot selectedHost is "all" (hosts not hydrated yet) → fall back
// to the lone connection. Null only for an id-less seed, where there's no bearer
// to attach anyway → plain api.get (matches the multi-host fanOut: id ? scoped : bare).
const _auditHostId = () => {
  const sel = selectedHostStore.getState().id;
  if (sel && sel !== "all") return sel;
  const c = CONNECTIONS[0];
  return c && c.id ? c.id : null;
};
const _fetchAuditPage = (cursor, params) => {
  const qs = new URLSearchParams({ limit: String(AUDIT_BATCH) });
  if (cursor) qs.set("cursor", cursor);
  for (const k in (params || {})) { const v = params[k]; if (v != null && v !== "") qs.set(k, v); }
  const id = _auditHostId();
  const client = id ? api.host(id) : api;   // auth-gated when we know the host id
  return client.get("/audit?" + qs.toString()).then(page => ({
    rows: ((page && page.rows) || []).map(_withHost),
    nextCursor: (page && page.nextCursor) || null,
  }));
};

// Re-fetch the log (status → loading → ready/error). The audit page reads
// `status` to show its timeline skeleton. `params` = the server-side filter set
// (severity/serverId/actor/since/category); blank → the whole log. This WALKS the
// keyset cursor (filtered) up to AUDIT_CAP so events older than the first page are
// reachable; a fresh refresh bumps the generation so a slow in-flight loadMore
// can't append onto the new list.
auditStore.refresh = (params) => {
  const gen = ++_auditGen;
  const filterParams = params || {};
  auditStore.setState(s => ({ ...s, status: "loading", error: null, filterParams }));
  // Multi-host: N independent logs don't share a keyset cursor space, so v1 pulls a
  // recent window from each host and merge-sorts newest-first (mergeAuditRows). A
  // unified cross-host "load older" (k-way cursor) is a documented follow-up — for
  // now nextCursor is null (no global load-older); per-host drill-in covers depth.
  if (CONNECTIONS.length > 1) {
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
    while (next && rows.length < AUDIT_CAP) {
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
// filterParams so the cursor stays on the same filtered set. No-op without an
// outstanding cursor or while already loading. De-dups by id (defensive) and
// drops its result if a refresh replaced the list underneath it (generation
// guard). A failed load is non-fatal: keep what's loaded, leave the affordance.
auditStore.loadMore = () => {
  const st = auditStore.getState();
  if (!st.nextCursor || st.loadingMore) return Promise.resolve();
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

// ---- Host logs (the aggregated leaf-service journal) -------------------
// The Host page's Logs tab: a recent window of the host's MERGED leaf logs
// (assistant/monitor/watchdog/firewall/api/bot), hydrated from GET /hosts/{id}/logs
// (OPERATOR-gated, cursor-paginated) and kept live by the hosts/{id}/logs WS topic.
// ONE focused host at a time (the host deep-dive), keyed by hostId so a host switch
// re-hydrates and never blends two hosts' streams. The LogConsole splits the merged
// list by `source` for its per-source dropdown; a quiet leaf simply shows fewer lines.
const LOGS_WINDOW = 300;   // recent merged lines pulled on open (spans the active leaves)
const LOGS_MAX = 2000;     // cap the live-growing window (bounds memory + DOM, newest kept)
const logsStore = createStore({
  list: [],
  status: "loading",   // ready | loading | error
  error: null,
  everLoaded: false,
  hostId: null,        // which host the current window belongs to (guards stale streams)
});
// A live line off hosts/{id}/logs: prepend newest-first, drop a dup by id (defensive
// vs a reconnect re-hydrate overlapping the stream), ignore a frame for a host we're
// not currently showing, and cap the window so a long live session can't grow unbounded.
logsStore.prepend = (hostId, line) =>
  logsStore.setState(s => {
    if (!line || !line.id) return s;
    if (s.hostId && hostId && s.hostId !== hostId) return s;
    if (s.list.length && s.list[0].id === line.id) return s;        // immediate dup (cheap)
    if (s.list.some(e => e.id === line.id)) return s;               // reconnect overlap
    const list = [line, ...s.list];
    return { ...s, list: list.length > LOGS_MAX ? list.slice(0, LOGS_MAX) : list };
  });
// Hydrate the recent window for one host. Routes through that host's AUTH-gated client
// so the bearer rides (the tab gates to operator before calling; this stays correct if
// reached by a viewer — a 403 → status:"error"). A host switch bumps the generation so
// a slow in-flight fetch can't land its rows on the newly-selected host.
let _logsGen = 0;
logsStore.refresh = (hostId) => {
  if (!hostId) return Promise.resolve([]);
  const gen = ++_logsGen;
  logsStore.setState(s => ({ ...s, status: "loading", error: null, hostId }));
  return api.host(hostId).get("/hosts/" + hostId + "/logs?limit=" + LOGS_WINDOW).then(page => {
    if (gen !== _logsGen) return [];
    const rows = (page && page.rows) || [];
    logsStore.setState(s => ({ ...s, list: rows, status: "ready", error: null, everLoaded: true, hostId }));
    return rows;
  }, err => {
    if (gen === _logsGen) logsStore.setState(s => ({ ...s, status: "error", error: err, hostId }));
    throw err;
  });
};
// Live tail: subscribe ONLY while the Logs tab is mounted (subscriber-gated on both
// ends — the kgsm-api JournalFollowBridge runs ONE journalctl -f only while the topic
// has subscribers, so an unopened tab costs nothing). The line id is unique; prepend
// keyed on the closure hostId (the payload is a LogLine, the host is in the topic).
// Mirror of subscribeHostMetrics. A viewer's subscribe is refused server-side → no frames.
function subscribeHostLogs(hostId) {
  if (!hostId) return () => {};
  const topic = "hosts/" + hostId + "/logs";
  return api.stream.subscribe([topic], (m) => {
    if (m && m.type === "log.line" && m.data) logsStore.prepend(hostId, m.data);
  });
}

// ---- Host log sources (the configured source dropdown) --------------------
// GET /hosts/{id}/logs/sources → the ordered set of configured log sources derived from the canonical
// LeafCatalog. The frontend uses this to populate the source dropdown regardless of whether a source has
// recent journal entries — quiet services remain selectable (they show "No recent log lines" when chosen).
// Host-scoped + gen-guarded like the other stores.
const logSourcesStore = createStore({
  sources: [],
  status: "loading",   // ready | loading | error
  error: null,
  hostId: null,
});
let _logSourcesGen = 0;
logSourcesStore.refresh = (hostId) => {
  if (!hostId) return Promise.resolve([]);
  const gen = ++_logSourcesGen;
  logSourcesStore.setState(s => ({ ...s, status: "loading", error: null, hostId }));
  return api.host(hostId).get("/hosts/" + hostId + "/logs/sources").then(sources => {
    if (gen !== _logSourcesGen) return [];
    const list = Array.isArray(sources) ? sources : [];
    logSourcesStore.setState(s => ({ ...s, sources: list, status: "ready", error: null, hostId }));
    return list;
  }, err => {
    if (gen === _logSourcesGen) logSourcesStore.setState(s => ({ ...s, status: "error", error: err, hostId }));
    throw err;
  });
};

// ---- Host services (the leaf control center) ----------------------------
// GET /hosts/{id}/services → one row per KGSM leaf (watchdog/monitor/assistant/firewall/api/bot) joining
// its systemd liveness with the api's deep-health probe. A plain snapshot (no live stream in this slice):
// the Services tab hydrates on mount and on a host switch; systemd state changes are infrequent, so a
// manual/periodic re-fetch is enough (mirror of logsStore.refresh, minus the tail). Host-scoped + gen-guarded
// so a slow in-flight fetch can't land its rows on the newly-selected host.
const servicesStore = createStore({
  list: [],
  status: "loading",   // ready | loading | error
  error: null,
  everLoaded: false,
  hostId: null,        // which host the current list belongs to (guards a stale fetch after a switch)
});
let _servicesGen = 0;
servicesStore.refresh = (hostId) => {
  if (!hostId) return Promise.resolve([]);
  const gen = ++_servicesGen;
  servicesStore.setState(s => ({ ...s, status: "loading", error: null, hostId }));
  return api.host(hostId).get("/hosts/" + hostId + "/services").then(rows => {
    if (gen !== _servicesGen) return [];
    const list = Array.isArray(rows) ? rows : [];
    servicesStore.setState(s => ({ ...s, list, status: "ready", error: null, everLoaded: true, hostId }));
    return list;
  }, err => {
    if (gen === _servicesGen) servicesStore.setState(s => ({ ...s, status: "error", error: err, hostId }));
    throw err;
  });
};
// Fold ONE leaf row into the host-scoped board (a provisioning connect/disconnect result, or an optimistic
// pre-flight flip) — so the board updates without a full refetch. Guarded on the current hostId: if a host
// switch superseded this mid-flight, drop it and let the next refresh reconcile. Upserts by id (the row
// should already exist, but adding is harmless).
servicesStore.applyRow = (hostId, row) => {
  if (!row || !row.id) return;
  servicesStore.setState(s => {
    if (s.hostId !== hostId) return s;   // a switch superseded this update
    const seen = s.list.some(x => x.id === row.id);
    const list = seen ? s.list.map(x => (x.id === row.id ? { ...x, ...row } : x)) : [...s.list, row];
    return { ...s, list };
  });
};

// ---- Leaf provisioning + config (admin-only; the Services control center) ----
// Connect or disconnect a leaf at RUNTIME (admin-only): POST .../{leaf}/connect|disconnect → the updated
// LeafService row. Routed through the host-scoped client (per-host bearer/401-retry). The POST returns a
// raw row → adaptService it, then fold it into the board. The matching capabilities.patch ALSO arrives over
// WS (for the capability-gated leaves), flipping the capability-gated UI live; this just keeps the board's
// own provisioned chip in lock-step without waiting for a refetch. Returns the adapted row.
function setLeafProvisioned(hostId, leaf, connected) {
  const client = (hostId && api.host) ? api.host(hostId) : api;
  const action = connected ? "connect" : "disconnect";
  return client.post("/hosts/" + hostId + "/services/" + leaf + "/" + action).then(raw => {
    const row = adaptService(raw);
    if (row && row.id) servicesStore.applyRow(hostId, row);
    return row;
  });
}
// Read one leaf's typed config manifest (GET .../{leaf}/config → adaptLeafConfig via adaptResponse). Routed
// host-scoped so the per-host bearer rides. Returns the adapted LeafConfig (or null).
function fetchLeafConfig(hostId, leaf) {
  if (!hostId || !leaf) return Promise.resolve(null);
  const client = api.host ? api.host(hostId) : api;
  return client.get("/hosts/" + hostId + "/services/" + leaf + "/config");
}
// Apply a config change (PUT .../{leaf}/config { values, reset }) → LeafConfigApplyResult. PUT returns a raw
// body (no auto-adapt) → adaptLeafConfigApply it. The caller renders the outcome HONESTLY (a rolled_back is
// not a success — the value didn't stick) and re-reads the form from result.config.
function applyLeafConfig(hostId, leaf, body) {
  if (!hostId || !leaf) return Promise.resolve(null);
  const client = api.host ? api.host(hostId) : api;
  return client.put("/hosts/" + hostId + "/services/" + leaf + "/config", body || {}).then(adaptLeafConfigApply);
}

// ---- Game library (installable catalog) ---------------------------------
// Mostly static; hydrate from api.get("/library"). Every page reads this store.
const libraryStore = createStore({
  list: [],
  status: "loading",   // ready | loading | error
  error: null,
  everLoaded: false,
});
// Force a re-fetch of the catalog and re-populate the in-memory store. Games
// are added server-side (a new server registers its game in the backend), so
// without this the library only updates on a full page reload. The library
// view calls this from its Refresh button; production swaps nothing — api.get
// already hits /library. Returns the promise so callers can show progress.
libraryStore.refresh = () => {
  libraryStore.setState(s => ({ ...s, status: "loading", error: null }));
  // Fan out the catalog across hosts; the SAME game on multiple hosts de-dups to
  // one entry whose `hosts` UNIONs the offering (mergeLibrary). A lone connection
  // (no source hostId) leaves the entry's offering untouched.
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
// Run once at init in case servers hydrate before the library does — without this
// the join would only run on the next refresh/stream tick.
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

// ---- Link latency (the dashboard Ping KPI) ------------------------------
// Per-host round-trip latency to each connected kgsm-api, measured CLIENT-side
// (api.pingHost → WebSocket ping/pong, clocked there). Keyed by BACKEND host id so the
// dashboard reads the scoped host's value (and the worst across hosts under "all").
// A reading is { ms, at }; ms is null when the last probe failed → the KPI shows
// "no reading" (honest unknown — never a stale or fabricated number).
const pingStore = createStore({ byHost: {} });
pingStore.record = (hostId, ms) =>
  pingStore.setState(s => ({ byHost: { ...s.byHost, [hostId]: { ms, at: Date.now() } } }));

const PING_INTERVAL_MS = 1000;
let _pingTimer = null;
function pingTick() {
  // Skip while the tab is hidden — a background panel needs no live ping, and the
  // reading would be stale by the time it's looked at anyway.
  if (typeof document !== "undefined" && document.hidden) return;
  const list = hostsStore.getState().list || [];
  for (const h of list) {
    if (!h || !h.id) continue;
    api.pingHost(h.id).then(ms => pingStore.record(h.id, ms), () => pingStore.record(h.id, null));
  }
}
function startPingLoop() {
  if (_pingTimer || !CONNECTIONS.length) return;
  // Fire one probe the moment the host list first hydrates (don't wait a full
  // interval for the first reading), then poll on a fixed cadence.
  if ((hostsStore.getState().list || []).length) pingTick();
  else { const un = hostsStore.subscribe(() => { if ((hostsStore.getState().list || []).length) { un(); pingTick(); } }); }
  _pingTimer = setInterval(pingTick, PING_INTERVAL_MS);
}

// ---- Boot hydrate -------------------------------------------------------
// Every surface store starts empty; kick a real async hydrate on boot so the
// first paint shows skeletons until the backend answers. Each store records its
// own error state, so a failed fetch surfaces inline rather than throwing here.
try {
  const swallow = () => {};
  serversStore.refresh().catch(swallow);
  libraryStore.refresh().catch(swallow);
  hostsStore.refresh().catch(swallow);
  auditStore.refresh().catch(swallow);
  startPingLoop();
  syncCapabilitySubscriptions();   // subscribe capabilities for any host already hydrated (the rest ride the hostsStore subscriber)
} catch (e) {}

// ---- Settings (Phase 0: auto_update toggle + delete) --------------------
const _settingsClient = (hostId) => ((hostId && api.host) ? api.host(hostId) : api);

function fetchSettings(hostId, serverId) {
  return _settingsClient(hostId).get("/servers/" + serverId + "/settings");
}

function patchSettings(hostId, serverId, patch) {
  return _settingsClient(hostId).patch("/servers/" + serverId + "/settings", patch);
}

function deleteServer(hostId, serverId, origin) {
  const qs = origin ? "?origin=" + encodeURIComponent(origin) : "";
  return _settingsClient(hostId).del("/servers/" + serverId + qs);
}

export { __setJobTiming, adaptServerMetrics, applyLeafConfig, auditEventHost, auditInScope, auditStore, awaitJob, commandServer, confirmCommand, deleteServer, favoritesStore, fetchLeafConfig, fetchServerEvents, fetchServerMetricsHistory, fetchSettings, filesKey, filesStore, hostsStore, installServer, jobsStore, libraryStore, logSourcesStore, logsStore, patchSettings, pingStore, scopeServers, selectedHostStore, sendConsoleInput, serverHostId, servicesStore, serversStore, setLeafProvisioned, subscribeHostLogs, subscribeHostMetrics, subscribeServerMetrics, useIsFavorite, useSelectedHostId };
