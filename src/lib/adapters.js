// adapters.js — translate kgsm-api DTOs into the shapes the SPA components read.
//
// The backend emits an HONEST, narrower model than the prototype fixtures: no
// per-server players/ip/uptime, no per-process host tables — kgsm-api omits
// anything it can't measure (the "never fabricate" invariant). So the cardinal
// rule here: a value the backend doesn't provide maps to null / "unknown" /
// empty — NEVER to 0 or an invented default. The components render "—" for
// those; see WIRING.md §5.
//
// camelCase (api) → the fixture field names the components already use.

const round = (n, d = 0) => {
  if (n == null || !isFinite(n)) return null;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
};

// ---- Servers ------------------------------------------------------------
// api status is the watchdog/Docker run-state tri-state; the UI vocabulary is
// online/offline/unknown (+ installing/updating/crashed/error, which are
// synthesized later from the job + alert streams — slice 5/6).
const SERVER_STATUS = { running: "online", stopped: "offline", unknown: "unknown" };

export function adaptServer(be) {
  if (!be) return be;
  const m = be.metrics || null;
  return {
    // identity / metadata (honest passthrough)
    id: be.id,
    name: be.name ?? be.id,
    hostId: be.hostId,
    blueprint: be.blueprint,
    runtime: be.runtime,
    version: be.version ?? null,
    // display game name: no curated title upstream yet → fall back to blueprint
    // id (enriched from /library by id in a later slice).
    game: be.blueprint,
    status: SERVER_STATUS[be.status] || "unknown",
    // honest-unknown — no backend source today (presence tracking is WIP):
    players: null,                 // unknown now, wired later
    uptime: null,                  // not exposed by kgsm
    ip: null,                      // not exposed by kgsm
    last_backup: null,
    log: [],                       // console history is a true backend gap (no topic yet)
    // update_available intentionally omitted (kgsm reports installed version,
    // not an update check) → no "update waiting" badge.
    // per-instance metrics (null when the monitor is absent/down):
    cpu: m ? round(m.cpuPctCore, 0) : null,           // % of one core (can exceed 100)
    ram: m ? { used: round(m.memBytes / 1e9, 2), max: null } : null,  // GiB; no per-instance max
    // keep the raw backend objects for surfaces that want honest detail:
    metrics: m,
    network: be.network || null,
    steamAppId: be.steamAppId,
    clientSteamAppId: be.clientSteamAppId,
    isSteamAccountRequired: be.isSteamAccountRequired,
  };
}
export const adaptServers = (arr) => (Array.isArray(arr) ? arr.map(adaptServer) : []);

// ---- Hosts --------------------------------------------------------------
// The backend gives coarse, honest host metrics (aggregate cpuPct, mem, disks)
// or null when the metrics capability is down. The diagnostics deep-dive reads
// a richer shape (per_core / load / sensors / processes) the backend doesn't
// have — we fill those with a valid-but-empty skeleton (mirrors the FE's own
// makeHostSkeleton convention) so nothing crashes, and the capability status
// (truthfully reported by the backend) drives the "no signal" treatment. No
// fabricated numbers: absent telemetry → zero-length / 0 framed by a down LED.
function telemetrySkeleton() {
  return {
    cpu: { model: "—", cores: 0, threads: 0, freq_ghz: 0, usage_pct: 0, per_core: [], load_avg: [0, 0, 0], temp_c: 0 },
    ram: { total_gb: 0, used_gb: 0, cached_gb: 0, buffers_gb: 0, free_gb: 0, swap_total_gb: 0, swap_used_gb: 0 },
    disks: [], network: { interfaces: [], open_ports: [] }, sensors: [], processes: [],
  };
}

export function adaptHost(be) {
  if (!be) return be;
  const skel = telemetrySkeleton();
  const metricsOk = !!(be.capabilities && be.capabilities.metrics && be.capabilities.metrics.status === "operational");
  // Map the coarse honest metrics into the meter fields when present.
  const cpu = be.cpuPct != null ? { ...skel.cpu, usage_pct: round(be.cpuPct, 0) } : skel.cpu;
  const ram = be.mem
    ? { ...skel.ram, total_gb: round(be.mem.total, 1), used_gb: round(be.mem.used, 1), free_gb: round(Math.max(0, be.mem.total - be.mem.used), 1) }
    : skel.ram;
  const disks = Array.isArray(be.disks) && be.disks.length
    ? be.disks.map((d) => ({ mount: d.mount, device: "—", total_gb: round(d.total, 1), used_gb: round(d.used, 1), fs: "—", smart: "ok" }))
    : skel.disks;
  const network = be.network
    ? {
        interfaces: [],
        open_ports: Array.isArray(be.network.openPorts)
          ? be.network.openPorts.map((p) => ({ port: p.port, proto: p.proto, server: p.server ?? null, app: p.app ?? null }))
          : [],
      }
    : skel.network;
  return {
    id: be.id,
    name: be.label ?? be.id,
    hostname: be.id,                  // backend has no separate hostname
    region: "—",
    online: be.status === "online",
    // capabilities pass straight through — the api shape already matches the
    // FE capability model {provisioned,status,since,message,info}.
    capabilities: be.capabilities || {},
    cpu, ram, disks, network,
    sensors: skel.sensors, processes: skel.processes,
    events: [], logs: [],
    _metricsOk: metricsOk,
  };
}
export const adaptHosts = (arr) => (Array.isArray(arr) ? arr.map(adaptHost) : []);

// ---- Library (installable catalog) -------------------------------------
export function adaptLibraryEntry(be) {
  if (!be) return be;
  return {
    id: be.id,
    name: be.name ?? be.id,
    // no curated category upstream → group by runtime type (honest, coarse).
    category: be.type || "game",
    type: be.type,
    // players: specs.maxPlayers is null today → leave unknown (no display).
    players: be.specs && be.specs.maxPlayers != null ? String(be.specs.maxPlayers) : null,
    steamAppId: be.steamAppId ?? null,
    ports: be.ports || [],
    specs: be.specs || null,
    cover: be.cover ?? null,         // reserved upstream (null) → gradient fallback
    rawg_slug: be.rawgSlug ?? null,
  };
}
export const adaptLibrary = (arr) => (Array.isArray(arr) ? arr.map(adaptLibraryEntry) : []);

// ---- Audit --------------------------------------------------------------
// api returns { data:[...], nextCursor }; the store expects a bare array.
export function adaptAudit(page) {
  const rows = page && Array.isArray(page.data) ? page.data : Array.isArray(page) ? page : [];
  return rows.map((e) => ({ ...e }));   // shapes align (actor carries extra `kind` harmlessly)
}

// ---- Alerts -------------------------------------------------------------
// api returns { data:[Alert] }; the FE alerts store consumes an array.
export function adaptAlerts(page) {
  const rows = page && Array.isArray(page.data) ? page.data : Array.isArray(page) ? page : [];
  return rows.map((a) => ({ ...a }));
}

// ---- Me (caller identity + tier) ---------------------------------------
// /me drives the per-host tier (the persona / route gate). Honest passthrough;
// tier falls back to "none" (secure-by-default), never a fabricated role.
export function adaptMe(be) {
  if (!be) return be;
  return { user: be.user || null, tier: be.tier || "none", scopes: be.scopes || [] };
}
