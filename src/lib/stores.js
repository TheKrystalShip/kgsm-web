import { api } from "./apiClient.js";
import { LIVE } from "./config.js";
import { KRYSTAL_DATA } from "./data.js";
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
const _seed = (arr) => (_cold ? [] : arr);

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
    return api.get("/servers").then(list => {
      serversStore.setState(s => {
        const live = new Map(s.list.map(x => [x.id, x]));
        const merged = list.map(srv => {
          const cur = live.get(srv.id);
          return cur ? { ...srv, status: cur.status, uptime: cur.uptime, job: cur.job } : srv;
        });
        return { ...s, list: merged, status: "ready", error: null, everLoaded: true };
      });
      resolveGameNames();   // a refetch re-pulls `game` as the blueprint id → re-resolve
      return list;
    }, err => {
      serversStore.setState(s => ({ ...s, status: "error", error: err }));
      throw err;
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

// Track the in-flight command per server from the `jobs` channel, so action
// buttons can show progress (spinner) and lock siblings until it completes.
api.stream.subscribe(["jobs"], (m) => {
  // mock pushes `job`; live pushes `job.patch` (adaptJob collapses the API's
  // succeeded|failed terminal states to "done", so this one branch serves both).
  if ((m.type === "job" || m.type === "job.patch") && m.data) {
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
  return api.get("/hosts").then(list => {
    hostsStore.setState(s => {
      const fetched = new Map(list.map(h => [h.id, h]));
      const known = new Set(s.list.map(h => h.id));
      // Update existing hosts from the fetch; keep client-added hosts the
      // fixture doesn't know; append hosts the fetch introduces.
      const merged = s.list.map(h => fetched.has(h.id) ? { ...h, ...fetched.get(h.id) } : h);
      list.forEach(h => { if (!known.has(h.id)) merged.push(h); });
      return { ...s, list: merged, status: "ready", error: null, everLoaded: true };
    });
    return list;
  }, err => {
    hostsStore.setState(s => ({ ...s, status: "error", error: err }));
    throw err;
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
      if (t.cpu) next.cpu = t.cpu;
      if (t.ram) next.ram = t.ram;
      if (t.disks) next.disks = t.disks;
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
});
auditStore.prepend = (entry) =>
  auditStore.setState(s => ({ ...s, list: [_withHost(entry), ...s.list] }));
// Re-fetch the log (status → loading → ready/error). The audit page reads
// `status` to show its timeline skeleton.
auditStore.refresh = () => {
  auditStore.setState(s => ({ ...s, status: "loading", error: null }));
  return api.get("/audit").then(list => {
    auditStore.setState(s => ({ ...s, list: list.map(_withHost), status: "ready", error: null, everLoaded: true }));
    return list;
  }, err => {
    auditStore.setState(s => ({ ...s, status: "error", error: err }));
    throw err;
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
  return api.get("/library").then(list => {
    libraryStore.setState(s => ({ ...s, list, status: "ready", error: null, everLoaded: true }));
    return list;
  }, err => {
    libraryStore.setState(s => ({ ...s, status: "error", error: err }));
    throw err;
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

// ---- Game display-name resolution (servers ✕ library) -------------------
// The backend gives a server only its blueprint id (e.g. "factorio"); the human
// title lives in /library. Resolve `game` by joining on the blueprint id so the
// UI shows the catalog name everywhere it reads `server.game`. Today the curated
// titles equal the ids upstream (name == id), so this is a no-op that SELF-HEALS
// the moment metadata curation lands — never a fabricated label. Mock servers
// carry no `blueprint`, so it's a clean no-op there too. Runs after every server
// refresh (the merge re-pulls the id) and whenever the catalog changes.
function resolveGameNames() {
  const lib = libraryStore.getState().list || [];
  if (!lib.length) return;
  const byId = new Map(lib.map(g => [g.id, g.name]));
  const cur = serversStore.getState().list;
  let changed = false;
  const next = cur.map(srv => {
    const name = srv.blueprint ? byId.get(srv.blueprint) : null;
    if (name && srv.game !== name) { changed = true; return { ...srv, game: name }; }
    return srv;
  });
  // setState always emits — only write on a real change, else a library tick
  // would needlessly re-render every server subscriber. NOT subscribed to
  // serversStore itself (that would loop through this very setState).
  if (changed) serversStore.setState(s => ({ ...s, list: next }));
}
libraryStore.subscribe(resolveGameNames);

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

export { auditEventHost, auditInScope, auditStore, favoritesStore, hostsStore, libraryStore, scopeServers, selectedHostStore, serverHostId, serversStore, subscribeHostMetrics, useIsFavorite, useSelectedHostId };
