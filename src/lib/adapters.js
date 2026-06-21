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
    cpu: { model: "—", cores: 0, threads: null, freq_ghz: null, usage_pct: null, per_core: [], load_avg: null, temp_c: null },
    ram: { total_gb: 0, used_gb: 0, cached_gb: null, buffers_gb: null, free_gb: 0, swap_total_gb: null, swap_used_gb: null },
    disks: [], network: { interfaces: [], open_ports: [] }, sensors: [], processes: [],
  };
}

// Interface throughput: the monitor measures bytes/sec; the UI labels it "kbps". Convert to
// kilobits/sec (the conventional network unit) — a real measured rate, unit-shifted for display,
// not a fabricated value. null in → null out (honest-unknown, never a 0 rate).
const toKbps = (bps) => (bps == null ? null : Math.round((bps * 8) / 1000));

// mapHostTelemetry(be) — the measured-capacity portion of a host: exactly the fields present in
// BOTH the full Host DTO (GET /hosts) AND the host.metrics WS tick (HostMetricsDto). The API maps
// both through one shared MetricsMapping (so a tick is byte-identical to the REST host it patches);
// mapping them in one place here is the FE mirror of that invariant — a live tick reshapes to the
// SAME telemetry a hydrate produced, so the WS merge can never drift from the REST element.
//
// Honest-unknown throughout: usage / per-core / load / mem-breakdown / fs / iface throughput are
// MEASURED; model / threads / freq / temperature / cached / buffers / device / SMART / ip / mac /
// error counters are NOT sampled → "—"/null, never a fabricated 0. A field the snapshot omits comes
// back null here; the caller decides whether to fall back to a skeleton (adaptHost) or skip it (merge).
function mapHostTelemetry(be) {
  const hasSample = Array.isArray(be.perCore) && be.perCore.length > 0;
  const cpu = (be.cpuPct != null || hasSample)
    ? {
        model: "—", threads: null, freq_ghz: null, temp_c: null,
        cores: hasSample ? be.perCore.length : 0,
        usage_pct: be.cpuPct != null ? round(be.cpuPct, 0) : null,
        per_core: hasSample ? be.perCore.map((p) => round(p, 0)) : [],
        load_avg: be.load ? [round(be.load.one, 2), round(be.load.five, 2), round(be.load.fifteen, 2)] : null,
      }
    : null;
  const ram = be.mem
    ? {
        total_gb: round(be.mem.total, 1),
        used_gb: round(be.mem.used, 1),
        free_gb: be.mem.available != null ? round(be.mem.available, 1) : round(Math.max(0, be.mem.total - be.mem.used), 1),
        cached_gb: null, buffers_gb: null,
        swap_total_gb: be.mem.swapTotal != null ? round(be.mem.swapTotal, 1) : null,
        swap_used_gb: be.mem.swapUsed != null ? round(be.mem.swapUsed, 1) : null,
      }
    : null;
  const disks = Array.isArray(be.disks) && be.disks.length
    ? be.disks.map((d) => ({ mount: d.mount, total_gb: round(d.total, 1), used_gb: round(d.used, 1), fs: d.fs || "—", device: "—", smart: null }))
    : null;
  const interfaces = Array.isArray(be.interfaces)
    ? be.interfaces.map((i) => ({
        name: i.name, ip: null, mac: null, errors: null,
        rx_kbps: toKbps(i.rxBps), tx_kbps: toKbps(i.txBps), rx_pps: i.rxPps ?? null, tx_pps: i.txPps ?? null,
      }))
    : null;
  // boot_time derived from the measured uptime (now − uptimeSec); the FE's uptime helpers want a
  // timestamp. null when uptime isn't sourced → the helpers render "—".
  const boot_time = be.uptimeSec != null ? new Date(Date.now() - be.uptimeSec * 1000).toISOString() : null;
  const hostname = be.hostname || null;
  return { cpu, ram, disks, interfaces, boot_time, hostname };
}

export function adaptHost(be) {
  if (!be) return be;
  const skel = telemetrySkeleton();
  const metricsOk = !!(be.capabilities && be.capabilities.metrics && be.capabilities.metrics.status === "operational");
  const tel = mapHostTelemetry(be);

  // Absent telemetry → the valid-but-empty skeleton (so nothing crashes reading the shape); the
  // capability status (truthfully reported by the backend) drives the "no signal" treatment. We do
  // NOT stamp last_sample_at on a REST hydrate (deliberate): an unrefreshed sample would age every
  // host to "frozen" 30s after boot on surfaces that have no WS feed — the freshness stamp is owned
  // by the host.metrics tick path only (see adaptHostMetrics + hostsStore.mergeMetrics).
  const cpu = tel.cpu || skel.cpu;
  const ram = tel.ram || skel.ram;
  const disks = tel.disks || skel.disks;
  const interfaces = tel.interfaces || [];
  const network = {
    interfaces,
    open_ports: be.network && Array.isArray(be.network.openPorts)
      ? be.network.openPorts.map((p) => ({ port: p.port, proto: p.proto, server: p.server ?? null, app: p.app ?? null }))
      : [],
  };

  return {
    id: be.id,
    name: be.label ?? be.id,
    hostname: tel.hostname || be.id,   // real monitor hostname when sampled, else the host id
    region: "—",
    os: "—", kernel: "—", panel_version: "—",  // not sourced by the API today → honest-unknown
    boot_time: tel.boot_time,
    online: be.status === "online",
    // capabilities pass straight through — the api shape already matches the
    // FE capability model {provisioned,status,since,message,info}.
    capabilities: be.capabilities || {},
    cpu, ram, disks, network,
    sensors: [], processes: [],   // no host sensor / process-list source → honest-empty (not fabricated rows)
    events: [], logs: [],
    _metricsOk: metricsOk,
  };
}
export const adaptHosts = (arr) => (Array.isArray(arr) ? arr.map(adaptHost) : []);

// adaptHostMetrics(be) — reshape a host.metrics WS tick (the HostMetricsDto, which is the measured
// SUBSET of the Host DTO) into the FE telemetry partial. Same fields, same units as adaptHost (they
// share mapHostTelemetry), so a live tick produces telemetry byte-identical to the REST host it
// patches. Returns ONLY the telemetry fields — the store merges them clobber-safe over the existing
// host, preserving the capability block and the firewall open-ports grid the tick deliberately omits
// (hostsStore.mergeMetrics). The per-tick freshness stamp is applied at merge time, not here.
export function adaptHostMetrics(be) {
  if (!be) return be;
  return mapHostTelemetry(be);
}

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
// api returns { data:[Alert] }; the FE alerts store consumes an array. The
// honest backend shape carries no `icon` — an icon is PRESENTATION, not a
// measured fact (like SERVER_STATUS maps a run-state to a label), so we derive
// one from the alert's real `source`/`severity`. Only the watchdog crash
// producer is live today (M6·a), so source→icon is the honest common path; the
// severity map is the forward-compat fallback for producers that land later.
const ALERT_ICON_BY_SOURCE = {
  watchdog: "alert-triangle",
  "host-monitor": "server",
  metrics: "gauge",
  assistant: "sparkles",
};
const ALERT_ICON_BY_SEVERITY = { danger: "alert-triangle", warn: "circle-alert", info: "info" };
function alertIcon(a) {
  return ALERT_ICON_BY_SOURCE[a.source] || ALERT_ICON_BY_SEVERITY[a.severity] || "circle-alert";
}
// One alert: honest passthrough of every field the API sources (id/severity/
// source/title/detail/serverId/hostId/anchor/status/raisedAt/escalated/attempts/
// resolvedAt/resolution) plus a derived display icon. `prompt`/`autoResolves` are
// demo-only (no upstream source) → left absent, never fabricated. Shared by the
// REST page (below) and the live `alert.raise` stream message (adaptStreamMessage).
export function adaptAlert(a) {
  if (!a) return a;
  return { ...a, icon: a.icon || alertIcon(a) };
}
export function adaptAlerts(page) {
  const rows = page && Array.isArray(page.data) ? page.data : Array.isArray(page) ? page : [];
  return rows.map(adaptAlert);
}

// ---- Jobs (command progress over the `jobs` stream) --------------------
// API Job state is queued|running|succeeded|failed; the FE job tracker reads a
// coarse running-vs-done (spinner until terminal, then clears). Collapse the two
// terminal states to the FE's "done" so the existing store logic
// (`state === "done" ? clear : { verb, state }`) works for mock AND live.
const JOB_TERMINAL = { succeeded: true, failed: true };
export function adaptJob(be) {
  if (!be) return be;
  return {
    id: be.id,
    serverId: be.serverId,
    verb: be.verb,
    state: JOB_TERMINAL[be.state] ? "done" : be.state,
    error: be.error ?? null,
  };
}

// ---- Me (caller identity + tier) ---------------------------------------
// /me drives the per-host tier (the persona / route gate). Honest passthrough;
// tier falls back to "none" (secure-by-default), never a fabricated role.
export function adaptMe(be) {
  if (!be) return be;
  return { user: be.user || null, tier: be.tier || "none", scopes: be.scopes || [] };
}
