import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { alertsTone, anchoredAlerts } from "../components/ContextualAlerts.jsx";
import { HostConnection } from "../components/ErrorBoundary.jsx";
import { HostMeters, hostHealth, hostMetricsFreshness } from "../components/HostCardBody.jsx";
import { Icon } from "../components/Icon.jsx";
import { KPI } from "../components/KPI.jsx";
import { ConsoleView } from "../components/ConsoleView.jsx";
import { NeedsAttention, useAlerts } from "../components/NeedsAttention.jsx";
import { Pagination, useDebouncedValue } from "../components/Pagination.jsx";
import { FleetSkeleton } from "../components/Skeletons.jsx";
import { SubTabs } from "../components/SubTabs.jsx";
import { Toolbar, ToolbarCount, ToolbarSearch, ToolbarSpacer } from "../components/Toolbar.jsx";
import { api } from "../lib/apiClient.js";
import { can, canOn } from "../lib/persona.js";
import { sessionStore } from "../lib/sessionStore.js";
import { useStore } from "../lib/store.js";
import { hostsStore, logsStore, selectedHostStore, serversStore, servicesStore, subscribeHostLogs, subscribeHostMetrics, useSelectedHostId } from "../lib/stores.js";
import { RecentActivity } from "./DashboardPage.jsx";
import { HostAuthBadge, HostDeniedNotice } from "./HostAccess.jsx";

// DiagnosticsPage — host-machine (not game-server) command center.
//
// Multi-host from the start: a host picker appears only when more than
// one host is configured. The page has four sub-tabs:
//   1. Overview   — traffic-light board + leaf-service health summary + events
//   2. Resources  — per-core CPU grid, RAM breakdown, disk I/O, network
//   3. Services   — KGSM leaf control center (systemd liveness ⋈ deep health)
//   4. Logs       — aggregated leaf-service journals
//
// Backed by hostsStore (hydrated from GET /hosts + live metric ticks).

// ---------- Helpers ----------

function uptimeFrom(bootTime) {
  const boot = new Date(bootTime);
  const ms = Date.now() - boot.getTime();
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function fmtTimeFull(ts) {
  const d = new Date(ts.replace(" ", "T"));
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Choose a traffic-light tone (success/warn/danger) for a numeric value
// against amber/red thresholds.
function statusTone(value, amber, red) {
  if (value >= red) return "danger";
  if (value >= amber) return "warn";
  return "success";
}

// ---------- Overview tiles ----------
// The overview KPIs reuse the shared KPI card (KPI) so the dashboard,
// the host diagnostics overview, and the server-detail stats never drift. Unlike the dashboard, which stays calm when
// healthy, the diagnostics tiles keep a full traffic-light top hairline on
// every tone (green / amber / red) — see `.diag-tiles .kpi` in kit.css. Diag
// tones (success/warn/danger) map onto Kpi tones (ok/warn/danger).
const DIAG_KPI_TONE = { success: "ok", warn: "warn", danger: "danger" };

// ---------- Host capacity strip (reusable) ----------
// Compact CPU / Memory / Disk headroom meters. Defined here so Diagnostics
// owns the source of truth; the Dashboard imports the very same component
// (via window) for at-a-glance discovery with a jump-to-Diagnostics button.

// Derive the three capacity meters from a host record. Kept separate so the
// math lives in one place regardless of who renders it.
function hostCapacityMeters(host) {
  // No honest telemetry to chart (metrics capability down, or a freshly added
  // host that hasn't reported) → no meters, never fabricated zeros. Callers
  // treat an empty list as "metrics unavailable".
  if (!host || !host.cpu || !host.ram || !host.ram.total_gb) return [];
  const ramPct = Math.round((host.ram.used_gb / host.ram.total_gb) * 100);
  const fullest = host.disks.reduce((acc, d) => {
    const pct = (d.used_gb / d.total_gb) * 100;
    return pct > acc.pct ? { disk: d, pct } : acc;
  }, { disk: null, pct: 0 });
  const diskPct = Math.round(fullest.pct);
  const swapRatio = host.ram.swap_total_gb ? host.ram.swap_used_gb / host.ram.swap_total_gb : 0;
  return [
    {
      key: "cpu", icon: "cpu", label: "CPU", pct: host.cpu.usage_pct,
      value: host.cpu.usage_pct + "%",
      detail: "load " + host.cpu.load_avg[0].toFixed(1) + " \u00b7 " + host.cpu.cores + " cores",
      tone: statusTone(host.cpu.usage_pct, 60, 80),
    },
    {
      key: "ram", icon: "memory-stick", label: "Memory", pct: ramPct,
      value: ramPct + "%",
      detail: host.ram.used_gb.toFixed(1) + " / " + host.ram.total_gb + " GB",
      tone: statusTone(ramPct, 70, 85),
      flag: swapRatio > 0.3 ? "swap rising" : null,
    },
    {
      key: "disk", icon: "database", label: "Disk", pct: diskPct,
      value: diskPct + "%",
      detail: fullest.disk ? fullest.disk.mount + " \u00b7 " + fullest.disk.used_gb + " / " + fullest.disk.total_gb + " GB" : "\u2014",
      tone: statusTone(diskPct, 80, 90),
      flag: fullest.disk && fullest.disk.smart && fullest.disk.smart !== "ok" ? "SMART " + fullest.disk.smart : null,
    },
  ];
}

function CapacityMeter({ meter }) {
  return (
    <div className={"cap-meter cap-meter--" + meter.tone}>
      <div className="cap-meter__top">
        <span className="cap-meter__icon"><Icon name={meter.icon} size={14} strokeWidth={2.2} /></span>
        <span className="cap-meter__label">{meter.label}</span>
        <span className="cap-meter__value">{meter.value}</span>
      </div>
      <div className="cap-meter__track">
        <i className="cap-meter__fill" style={{ width: Math.max(2, Math.min(100, meter.pct)) + "%" }}></i>
      </div>
      <div className="cap-meter__detail">
        <span className="cap-meter__detail-text">{meter.detail}</span>
        {meter.flag && (
          <span className="cap-meter__flag"><Icon name="triangle-alert" size={10} strokeWidth={2.4} />{meter.flag}</span>
        )}
      </div>
    </div>
  );
}

function HostCapacityStrip({ host, title, hostLabel, onOpenDiagnostics, hideAlert }) {
  if (!host) return null;
  const meters = hostCapacityMeters(host);
  const rank = { success: 0, warn: 1, danger: 2 };
  const worst = meters.reduce((w, m) => (rank[m.tone] > rank[w.tone] ? m : w), meters[0]);
  const alert = !hideAlert && worst && worst.tone !== "success";
  return (
    <section className="cap-strip">
      <div className="cap-strip__head">
        <h2 className="cap-strip__title">
          <Icon name="server" size={14} />
          {title || "Host capacity"}
          {hostLabel && <span className="cap-strip__host">{hostLabel}</span>}
        </h2>
        {alert && (
          <span className={"cap-strip__alert cap-strip__alert--" + worst.tone}>
            <Icon name="triangle-alert" size={12} strokeWidth={2.4} />
            {worst.label} {worst.flag || ("at " + worst.value)}
          </span>
        )}
        <span style={{ flex: 1 }}></span>
        {onOpenDiagnostics && (
          <button className="dash-section__more" onClick={onOpenDiagnostics}>
            Diagnostics <Icon name="arrow-right" size={12} strokeWidth={2.2} />
          </button>
        )}
      </div>
      <div className="cap-strip__meters">
        {meters.length
          ? meters.map(m => <CapacityMeter key={m.key} meter={m} />)
          : <div className="cap-strip__empty"><Icon name="activity" size={13} /> Live metrics unavailable on this host</div>}
      </div>
    </section>
  );
}

// ---------- Metrics freshness UI ----------
// When a host's live metrics stop arriving (agent's exporter down, or samples
// gone stale), we keep showing the LAST reading rather than blanking the page,
// but treat each KPI like a powered-down instrument readout: dimmed and dark
// while the feed is out, lighting back up when it returns. A per-card status
// LED (red + age when down, green when live) keeps the state on the data.

// Per-card status LED — a control-panel signal light: solid green when this
// host's live metrics are flowing, solid red when the feed has dropped. Sits
// at the right edge of a card header (the title's flex:1 pushes it there). When
// down, a compact age ("2m") sits just left of the LED: "2m ●".
function StatusLed({ live, label }) {
  return (
    <span className="led-group" title={live ? "Live" : "No signal"}>
      {label && <span className="led-group__age">{label}</span>}
      <span
        className={"status-led status-led--" + (live ? "live" : "down")}
        aria-label={live ? "Live" : "No signal"}
      ></span>
    </span>
  );
}

// ---------- Overview ----------

function DiagOverview({ host, fresh, onAsk, onViewAlerts, onViewAudit, onViewServices }) {
  const frozen = !!(fresh && fresh.frozen);
  // Power-on transition: when the feed returns (frozen → live), run the
  // instrument warm-up flicker on the gauges. Detect the edge across renders.
  const wasFrozen = React.useRef(frozen);
  const [poweringOn, setPoweringOn] = React.useState(false);
  React.useEffect(() => {
    if (wasFrozen.current && !frozen) {
      setPoweringOn(true);
      const t = setTimeout(() => setPoweringOn(false), 1700);
      wasFrozen.current = frozen;
      return () => clearTimeout(t);
    }
    wasFrozen.current = frozen;
  }, [frozen]);
  // When the feed is out, the live gauges go dark — the value color drops to a
  // faint "off" tone (via inline tone, not !important, so it transitions
  // cleanly) and the per-card LED turns red with a compact age beside it.
  const gTone = (t) => frozen ? "off" : DIAG_KPI_TONE[t];
  const gLed = frozen ? "down" : "live";
  const ageShort = fresh && fresh.label ? fresh.label.replace(/\s*ago$/, "") : null;
  const gLedLabel = frozen ? ageShort : null;
  const cpuTone = statusTone(host.cpu.usage_pct, 60, 80);
  const ramPct = Math.round((host.ram.used_gb / host.ram.total_gb) * 100);
  const ramTone = statusTone(ramPct, 70, 85);
  const fullestDisk = host.disks.reduce((acc, d) => {
    const pct = (d.used_gb / d.total_gb) * 100;
    return pct > acc.pct ? { disk: d, pct } : acc;
  }, { disk: null, pct: 0 });
  const diskTone = statusTone(fullestDisk.pct, 80, 90);
  // Temperature has no sensor source on this host → the KPI is hidden, never shown as a fabricated 0°C.
  const hasSensors = Array.isArray(host.sensors) && host.sensors.length > 0;
  const hotTemp = hasSensors ? host.sensors.reduce((max, s) => s.value_c > max ? s.value_c : max, 0) : null;
  const tempTone = hotTemp != null ? statusTone(hotTemp, 75, 85) : "success";
  // Network throughput is measured; per-interface error counters are NOT sourced, so there is no
  // honest errors figure to tone on — show interface count, neutral tone (never a fabricated 0-errors "success").
  const netTotal = host.network.interfaces.reduce((sum, i) => sum + (i.rx_kbps || 0) + (i.tx_kbps || 0), 0);
  const ifaceCount = host.network.interfaces.length;

  // The host's KGSM leaf services — a compact status summary here, the full board on the Services sub-tab
  // ("View all"). Hydrated on mount + on a host switch; systemd state changes rarely, so fetch-on-open is
  // enough (no live stream in this slice). The store is host-scoped + gen-guarded against a stale switch.
  const svcList = useStore(servicesStore, s => s.list);
  const svcStatus = useStore(servicesStore, s => s.status);
  const svcForHost = useStore(servicesStore, s => s.hostId);
  React.useEffect(() => {
    if (host && host.id) servicesStore.refresh(host.id).catch(() => {});
  }, [host && host.id]);
  const svcReady = svcForHost === host.id;

  return (
    <>
      {/* Same component the dashboard's "Alerts" card uses, pinned to the host
         being inspected here (not the global scope). One alerts surface, one
         set of visuals — it just answers "what needs attention on THIS host?" */}
      {NeedsAttention && (
        <NeedsAttention
          hostId={host.id}
          onPick={onAsk}
          onViewAll={onViewAlerts}
          max={3} />
      )}

      {KPI && (
        <div className={"diag-tiles" + (frozen ? " is-frozen" : "") + (poweringOn ? " is-powering-on" : "")}>
          <KPI icon="cpu"          label="CPU"         tone={gTone(cpuTone)} className="kpi--metric" led={gLed} ledLabel={gLedLabel}
            value={host.cpu.usage_pct + "%"}
            sub={"load " + host.cpu.load_avg.join(" / ") + " · " + host.cpu.cores + " cores"} />
          <KPI icon="hard-drive"   label="Memory"      tone={gTone(ramTone)} className="kpi--metric" led={gLed} ledLabel={gLedLabel}
            value={ramPct + "%"}
            sub={host.ram.used_gb.toFixed(1) + " / " + host.ram.total_gb + " GB · swap " + host.ram.swap_used_gb + " GB"} />
          <KPI icon="database"     label="Disk"        tone={gTone(diskTone)} className="kpi--metric" led={gLed} ledLabel={gLedLabel}
            value={Math.round(fullestDisk.pct) + "%"}
            sub={fullestDisk.disk ? fullestDisk.disk.mount + " · " + fullestDisk.disk.used_gb + " / " + fullestDisk.disk.total_gb + " GB" : "—"} />
          <KPI icon="network"      label="Network"     tone={frozen ? "off" : "muted"} className="kpi--metric" led={gLed} ledLabel={gLedLabel}
            value={Math.round(netTotal) + "kbps"}
            sub={ifaceCount + (ifaceCount === 1 ? " interface" : " interfaces")} />
          {hasSensors && (
            <KPI icon="thermometer"  label="Temperature" tone={gTone(tempTone)} className="kpi--metric" led={gLed} ledLabel={gLedLabel}
              value={hotTemp + "°C"}
              sub={"highest of " + host.sensors.length + " sensors"} />
          )}
          <KPI icon="clock"        label="Uptime"      tone="ok" led="live"
            value={uptimeFrom(host.boot_time)}
            sub={host.kernel} />
        </div>
      )}

      <div className="diag-grid">
        {/* The host's KGSM leaf services — a compact status summary that drills into the Services
           sub-tab. Same card chrome as Recent activity (header + count + "View all"). */}
        <ServicesSummaryCard services={svcList} status={svcStatus} ready={svcReady} onViewAll={onViewServices} />

        {/* Same Recent activity card the dashboard renders, scoped to this host
           (its server events plus panel-wide ones) via window.auditInScope. */}
        {RecentActivity
          ? <RecentActivity hostId={host.id} onViewAll={onViewAudit} max={5} />
          : null}
      </div>
    </>
  );
}

// ---------- Resources ----------

function DiagResources({ host, fresh, servers = [], onOpenServerSettings }) {
  const frozen = !!(fresh && fresh.frozen);
  // No honest telemetry to show (metrics capability down, or never reported) →
  // render the honest "unavailable" state, NOT zero readouts (0 cores / load 0.0
  // / 0% RAM would read as real, fabricated measurements).
  const noTelemetry = !host.cpu || !Array.isArray(host.cpu.per_core) || host.cpu.per_core.length === 0 || !host.ram || !host.ram.total_gb;
  if (noTelemetry) {
    return (
      <div className="diag-empty">
        <Icon name="activity" size={18} strokeWidth={1.8} />
        <p>Live metrics are unavailable on this host{fresh && fresh.message ? " — " + fresh.message : "."}</p>
        <p className="diag-empty__sub">CPU, memory, disk and network telemetry need the host's metrics agent to be running.</p>
      </div>
    );
  }
  const ageShort = fresh && fresh.label ? fresh.label.replace(/\s*ago$/, "") : null;
  const ramPct = Math.round((host.ram.used_gb / host.ram.total_gb) * 100);
  // cached / buffers aren't broken out by the monitor → omit those bar segments + legend rows
  // entirely (a 0-width segment / "0.0 GB" legend would read as a real measurement of zero).
  const hasBreakdown = host.ram.cached_gb != null && host.ram.buffers_gb != null;
  const cachedPct = hasBreakdown ? (host.ram.cached_gb / host.ram.total_gb) * 100 : 0;
  const bufPct = hasBreakdown ? (host.ram.buffers_gb / host.ram.total_gb) * 100 : 0;
  // Open-ports table helpers. exposure is best-effort: explicit on the port if
  // present, else a simple heuristic (remote shell = LAN, everything else
  // internet-facing). Owner resolves the server id to its display name.
  const serverName = (id) => (servers.find(s => s.id === id) || {}).name || id;
  const portExposure = (p) => p.exposure || (p.app === "sshd" ? "lan" : "public");
  const PORT_COLS = "92px minmax(110px, 1fr) minmax(150px, 1.4fr) 104px 18px";
  return (
    <>
      <div className="diag-2col">
        <div className={"chat-brief" + (frozen ? " is-frozen" : "")}>
          <div className="chat-brief__head">
            <span className="chat-brief__title">
              <Icon name="cpu" size={13} /> CPU
              <span className="chat-brief__count chat-brief__count--neutral">{host.cpu.cores} cores</span>
            </span>
            <span className="diag-meta-line">{host.cpu.model}</span>
            <StatusLed live={!frozen} label={frozen ? ageShort : null} />
          </div>
          <div className="chat-brief__pad">
            <div className="core-grid" style={{ "--core-count": host.cpu.per_core.length }}>
              {host.cpu.per_core.map((pct, i) => (
                <div key={i} className="core-cell" title={"core " + i + ": " + pct + "%"}>
                  <div className="core-cell__bar"><i style={{ height: pct + "%", background: pct > 80 ? "var(--danger)" : pct > 60 ? "var(--warning)" : "var(--krystal-teal)" }}></i></div>
                  <span className="core-cell__lbl">{i}</span>
                </div>
              ))}
            </div>
            <div className="diag-meta-line" style={{ marginTop: 14 }}>
              load 1m / 5m / 15m: <b>{host.cpu.load_avg[0].toFixed(1)}</b> · <b>{host.cpu.load_avg[1].toFixed(1)}</b> · <b>{host.cpu.load_avg[2].toFixed(1)}</b>
            </div>
          </div>
        </div>

        <div className={"chat-brief" + (frozen ? " is-frozen" : "")}>
          <div className="chat-brief__head">
            <span className="chat-brief__title">
              <Icon name="memory-stick" size={13} /> Memory
              <span className="chat-brief__count chat-brief__count--neutral">{host.ram.total_gb} GB</span>
            </span>
            <StatusLed live={!frozen} label={frozen ? ageShort : null} />
          </div>
          <div className="chat-brief__pad">
            <div className="ram-bar">
              <div className="ram-bar__seg" style={{ width: (ramPct - cachedPct - bufPct) + "%", background: "var(--krystal-teal)" }}></div>
              <div className="ram-bar__seg" style={{ width: cachedPct + "%",                       background: "var(--info)" }}></div>
              <div className="ram-bar__seg" style={{ width: bufPct + "%",                          background: "var(--update)" }}></div>
            </div>
            <div className="ram-legend">
              <span><span className="swatch" style={{ background: "var(--krystal-teal)" }}></span>used <b>{host.ram.used_gb.toFixed(1)} GB</b></span>
              {hasBreakdown && <span><span className="swatch" style={{ background: "var(--info)" }}></span>cached <b>{host.ram.cached_gb.toFixed(1)} GB</b></span>}
              {hasBreakdown && <span><span className="swatch" style={{ background: "var(--update)" }}></span>buffers <b>{host.ram.buffers_gb.toFixed(1)} GB</b></span>}
              <span><span className="swatch" style={{ background: "var(--surface-3)" }}></span>free <b>{host.ram.free_gb.toFixed(1)} GB</b></span>
            </div>
            <div className="diag-meta-line" style={{ marginTop: 14 }}>
              swap: <b>{host.ram.swap_used_gb} / {host.ram.swap_total_gb} GB</b>
              {host.ram.swap_used_gb / host.ram.swap_total_gb > 0.3 && (
                <span style={{ color: "var(--warning-fg)", marginLeft: 10 }}>↑ rising — investigate</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="chat-brief">
        <div className="chat-brief__head">
          <span className="chat-brief__title">
            <Icon name="database" size={13} /> Disks
            <span className="chat-brief__count chat-brief__count--neutral">{host.disks.length}</span>
          </span>
          {frozen && <span className="asof-tag"><Icon name="clock" size={11} /> as of {fresh.label}</span>}
        </div>
        <div className="disk-list">
          {host.disks.map(d => {
            const pct = Math.round((d.used_gb / d.total_gb) * 100);
            const tone = statusTone(pct, 80, 90);
            const smart = d.smart === "warn" ? "warn" : d.smart === "fail" ? "danger" : "success";
            return (
              <div className="disk-row" key={d.mount}>
                <div className="disk-row__head">
                  <code className="disk-row__mount">{d.mount}</code>
                  <span className="disk-row__device">{d.device}</span>
                  <span className="disk-row__fs">{d.fs}</span>
                  <span style={{ flex: 1 }}></span>
                  {/* SMART health has no source (no smartctl reader) → hide the pill, never claim "ok". */}
                  {d.smart && <span className={"disk-row__smart disk-row__smart--" + smart}>SMART: {d.smart}</span>}
                </div>
                <div className="disk-row__bar"><i className={"disk-row__fill disk-row__fill--" + tone} style={{ width: pct + "%" }}></i></div>
                <div className="disk-row__usage">
                  <span><b>{d.used_gb}</b> / {d.total_gb} GB used</span>
                  <span style={{ marginLeft: "auto" }}>{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={"chat-brief" + (frozen ? " is-frozen" : "")}>
        <div className="chat-brief__head">
          <span className="chat-brief__title">
            <Icon name="network" size={13} /> Network
            <span className="chat-brief__count chat-brief__count--neutral">{host.network.interfaces.length} iface</span>
          </span>
          <StatusLed live={!frozen} label={frozen ? ageShort : null} />
        </div>
        <div className="iface-list">
          {host.network.interfaces.map(i => (
            <div className="iface-row" key={i.name}>
              <code className="iface-row__name">{i.name}</code>
              {/* ip / mac aren't sampled by the monitor → honest "—", never a fabricated address. */}
              <span className="iface-row__ip">{i.ip || "—"}</span>
              <span className="iface-row__mac">{i.mac || "—"}</span>
              <span className="iface-row__metric">
                <span style={{ color: "var(--fg-3)" }}>↓</span> <b>{i.rx_kbps}</b> kbps
              </span>
              <span className="iface-row__metric">
                <span style={{ color: "var(--fg-3)" }}>↑</span> <b>{i.tx_kbps}</b> kbps
              </span>
              {/* error counters aren't sourced → omit (showing "0 errors" would be a fabricated clean bill). */}
              {i.errors != null && (
                <span className={"iface-row__errors" + (i.errors > 0 ? " iface-row__errors--bad" : "")}>
                  {i.errors} errors
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="ports-block">
          <div className="ports-block__head">Open ports <span className="ports-block__count">{host.network.open_ports.length}</span></div>
          <div className="card-table">
            <div className="card-table__head" style={{ gridTemplateColumns: PORT_COLS }}>
              <span className="card-table__th">Port</span>
              <span className="card-table__th">Service</span>
              <span className="card-table__th">Owner</span>
              <span className="card-table__th">Exposure</span>
              <span></span>
            </div>
            {host.network.open_ports.map((p, idx) => {
              const exp = portExposure(p);
              return (
                <div className="card-table__row" key={idx} style={{ gridTemplateColumns: PORT_COLS }}>
                  <span className="card-table__cell port-num"><b>{p.port}</b><span className="port-proto">/{p.proto}</span></span>
                  <span className="card-table__cell port-svc">{p.app}</span>
                  <span className="card-table__cell">
                    {p.server ? (
                      <button className="port-owner port-owner--link" onClick={() => onOpenServerSettings && onOpenServerSettings(p.server)} title={"Configure " + serverName(p.server)}>
                        <Icon name="gamepad-2" size={13} />
                        <span className="port-owner__name">{serverName(p.server)}</span>
                        <Icon name="arrow-up-right" size={12} />
                      </button>
                    ) : (
                      <span className="port-owner port-owner--host"><Icon name="server" size={13} /> Host service</span>
                    )}
                  </span>
                  <span className="card-table__cell">
                    <span className={"port-exp port-exp--" + exp}>
                      <Icon name={exp === "public" ? "globe" : "lock"} size={11} /> {exp === "public" ? "Public" : "LAN"}
                    </span>
                  </span>
                  <span className="card-table__cell port-chevron">
                    {p.server && <Icon name="chevron-right" size={15} />}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------- Services (the KGSM leaf control center) ----------
//
// Replaces the original htop-style process table (the host has no honest per-process source — the monitor
// reports resource totals, not a process list). This tab is the host's leaf-service control center: one
// card per KGSM leaf (watchdog / monitor / assistant / firewall / api / bot), joining its live SYSTEMD
// liveness with the api's DEEP-HEALTH probe where it has one. Honest throughout — an unmeasured field is
// "—" (never a fabricated 0), a not-installed leaf says so, and a leaf the api can't probe shows liveness
// only. Read-only for now; start / stop / restart controls are a planned follow-up (need a host polkit grant).

// Fold a leaf's systemd state + (optional) health into one tone + label. systemd is the spine; health
// refines a RUNNING leaf — active + health:down is the "up but unwell" case the at-a-glance dot can't show.
const SVC_STATE = {
  active:          { tone: "up",   label: "Running" },
  activating:      { tone: "warn", label: "Starting" },
  deactivating:    { tone: "warn", label: "Stopping" },
  reloading:       { tone: "warn", label: "Reloading" },
  maintenance:     { tone: "warn", label: "Maintenance" },
  failed:          { tone: "down", label: "Failed" },
  inactive:        { tone: "off",  label: "Stopped" },
  "not-installed": { tone: "off",  label: "Not installed" },
  masked:          { tone: "off",  label: "Masked" },
  unknown:         { tone: "off",  label: "Unknown" },
};
function leafStatus(svc) {
  // A socket-activated leaf (the firewall) resting inactive is idle-by-design, not stopped — render neutral.
  if (svc.state === "inactive" && svc.onDemand) return { tone: "idle", label: "Idle", note: "on-demand" };
  if (svc.state === "active" && svc.health && svc.health.status === "down")
    return { tone: "warn", label: "Running", note: "health check failing" };
  if (svc.state === "active" && svc.health && svc.health.status === "unknown")
    return { tone: "up", label: "Running", note: "health unknown" };
  return SVC_STATE[svc.state] || SVC_STATE.unknown;
}

// Bytes → a compact human size. Null (unmeasured / idle) → null so the caller can omit it, never show "0".
function fmtBytes(n) {
  if (n == null) return null;
  if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  if (n >= 1024 * 1024) return Math.round(n / (1024 * 1024)) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}

function LeafCard({ svc }) {
  const s = leafStatus(svc);
  const mem = fmtBytes(svc.memoryBytes);
  const up = svc.since ? uptimeShort(svc.since) : null;
  const running = svc.state === "active";
  return (
    <div className={"svc-card svc-card--" + s.tone}>
      <div className="svc-card__head">
        <span className={"svc-dot svc-dot--" + s.tone}></span>
        <span className="svc-card__name">{svc.displayName}</span>
        <span className="svc-card__status">
          {s.label}{s.note ? <span className="svc-card__note"> · {s.note}</span> : null}
        </span>
      </div>
      <div className="svc-card__role">{svc.role}</div>
      <div className="svc-card__facts">
        <span className="svc-fact svc-fact--unit" title="systemd unit"><Icon name="box" size={12} /><code>{svc.unit}</code></span>
        {running && up && <span className="svc-fact" title="uptime"><Icon name="clock" size={12} />up {up}</span>}
        {running && mem && <span className="svc-fact" title="memory (systemd cgroup accounting)"><Icon name="memory-stick" size={12} />{mem}</span>}
        {running && svc.mainPid && <span className="svc-fact" title="main pid"><Icon name="hash" size={12} />{svc.mainPid}</span>}
        {svc.enabled != null && (
          <span className={"svc-fact svc-fact--boot" + (svc.enabled ? " is-on" : "")} title="starts on boot">
            <Icon name={svc.enabled ? "power" : "power-off"} size={12} />{svc.enabled ? "on boot" : "manual"}
          </span>
        )}
      </div>
    </div>
  );
}

function DiagServices({ host }) {
  const hostId = host && host.id;
  const list = useStore(servicesStore, s => s.list);
  const status = useStore(servicesStore, s => s.status);
  const forHost = useStore(servicesStore, s => s.hostId);

  // Hydrate on mount + on a host switch (a plain snapshot — no live stream in this slice).
  React.useEffect(() => {
    if (!hostId) return;
    servicesStore.refresh(hostId).catch(() => {});
  }, [hostId]);

  // Only trust the list once it belongs to THIS host (a switch re-hydrates; guard the gap).
  const ready = forHost === hostId;
  const rows = ready && Array.isArray(list) ? list : [];

  if (rows.length > 0) {
    const installed = rows.filter(r => r.state !== "not-installed");
    const running = rows.filter(r => r.state === "active").length;
    return (
      <>
        <div className="players-toolbar">
          <div className="svc-summary">
            <span className="svc-summary__stat"><b>{running}</b> running</span>
            <span className="svc-summary__sep">·</span>
            <span className="svc-summary__stat">{installed.length} of {rows.length} installed</span>
          </div>
          <span style={{ flex: 1 }}></span>
          <span style={{ color: "var(--fg-3)", fontSize: 12.5 }}>The KGSM services that make up this host.</span>
        </div>
        <div className="svc-grid">
          {rows.map(svc => <LeafCard key={svc.id} svc={svc} />)}
        </div>
      </>
    );
  }

  // Nothing yet: loading (first fetch / host switch), an error, or a host that reports no leaves — render
  // the honest state for each rather than a fabricated empty board.
  const phase = (status === "loading" || !ready) ? "loading" : status === "error" ? "error" : "quiet";
  return (
    <div className="proc-unavailable">
      <span className="proc-unavailable__icon"><Icon name="server-cog" size={26} strokeWidth={1.9} /></span>
      <div className="proc-unavailable__title">
        {phase === "loading" ? "Reading host services…" : phase === "error" ? "Host services unavailable" : "No services reported"}
      </div>
      <div className="proc-unavailable__sub">
        {phase === "loading"
          ? "Reading the state of this host’s KGSM leaf services (watchdog · monitor · assistant · firewall · api · bot)."
          : phase === "error"
            ? "Couldn’t read the host’s service state — the backend didn’t respond."
            : "This host reports no KGSM leaf services."}
      </div>
      <span className="proc-unavailable__tag">
        <Icon name="activity" size={12} /> {phase === "loading" ? "loading" : phase === "error" ? "unavailable" : "none"}
      </span>
    </div>
  );
}

// Compact leaf-status summary for the Overview tab — the same data as the Services board, condensed to a
// row-list with a "View all" drill-down. Renders through the shared BriefCard shell (so its header matches
// the Recent activity + Alerts cards exactly), and each row uses the dashboard fleet-row visual language
// (status dot + bold name on the left, status on the right, chevron) so it reads as one family with the
// Fleet strip. Reads the shared servicesStore (the Overview hydrates it on mount).
function ServicesSummaryCard({ services, status, ready, onViewAll }) {
  const rows = ready && Array.isArray(services) ? services : [];
  const running = rows.filter(r => r.state === "active").length;
  const unwell = rows.some(r => { const t = leafStatus(r).tone; return t === "down" || t === "warn"; });
  return (
    <BriefCard
      icon="server-cog"
      title="Services"
      count={rows.length ? running + "/" + rows.length : null}
      countTone={unwell ? undefined : "neutral"}
      onViewAll={rows.length ? onViewAll : undefined}
    >
      {rows.length > 0 ? (
        <div className="svc-rows">
          {rows.map(svc => {
            const s = leafStatus(svc);
            return (
              <button key={svc.id} className="svc-row" onClick={onViewAll} title={svc.role}>
                <span className="svc-row__id">
                  <span className={"svc-dot svc-dot--" + s.tone}></span>
                  <span className="svc-row__name">{svc.displayName}</span>
                </span>
                <span className="svc-row__status">
                  <span className={"svc-row__state svc-row__state--" + s.tone}>{s.label}</span>
                  {s.note ? <span className="svc-row__note">{s.note}</span> : null}
                </span>
                <span className="svc-row__end"><Icon name="chevron-right" size={16} className="svc-row__go" /></span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <Icon name="server-cog" size={20} />
          <span className="chat-brief__empty-title">{status === "error" ? "Services unavailable" : "Reading host services…"}</span>
          <span className="chat-brief__empty-sub">{status === "error" ? "Couldn’t read the host’s leaf-service state." : "This host’s KGSM leaf services will appear here."}</span>
        </div>
      )}
    </BriefCard>
  );
}

// ---------- Logs ----------

// Host log sources we know how to label/colour. The list is OPEN-ENDED: the
// aggregator ingests from the backend API, the assistant, the watchdog, the
// kernel, auth… and whatever else reports in later. Any source id that appears
// in the data but isn't here still renders (it just falls back to a neutral
// tag), so adding an N-th source needs no UI change.
const LOG_SOURCE_META = {
  api:       { label: "Backend API", hint: "REST · WS · SSE" },
  assistant: { label: "Assistant" },
  watchdog:  { label: "Watchdog", hint: "supervisor" },
  monitor:   { label: "Monitor", hint: "metrics daemon" },
  firewall:  { label: "Firewall", hint: "host ports" },
  bot:       { label: "Discord bot" },
  kernel:    { label: "Kernel" },
  auth:      { label: "Auth" },
};

function DiagLogs({ host }) {
  // The host's aggregated leaf logs (assistant/monitor/watchdog/firewall/api/bot), merged from the
  // systemd journal by kgsm-api (GET /hosts/{id}/logs) and kept live by the hosts/{id}/logs WS topic.
  // We show ONE source at a time — the LogConsole's dropdown switches between them; sources are derived
  // from the data so a quiet/extra producer just (dis)appears. The host deep-dive is admin-gated
  // (NAV_FLEET) and the endpoint is operator-gated, so reaching here already clears the read gate.
  // Read-only: no onSend (system logs aren't a command channel).
  const hostId = host && host.id;
  const list = useStore(logsStore, s => s.list);
  const status = useStore(logsStore, s => s.status);
  const forHost = useStore(logsStore, s => s.hostId);

  // Hydrate the recent window + open the live tail WHILE this tab is mounted (subscriber-gated end to
  // end: the kgsm-api journalctl -f runs only while we're subscribed). Re-hydrate on a host switch.
  React.useEffect(() => {
    if (!hostId) return undefined;
    logsStore.refresh(hostId).catch(() => {});
    return subscribeHostLogs(hostId);
  }, [hostId]);

  if (!ConsoleView) return null;

  // Only trust the list once it belongs to THIS host (a switch re-hydrates; guard the gap).
  const ready = forHost === hostId;
  const entries = ready && Array.isArray(list) ? list : [];
  const order = ["api", "assistant", "watchdog", "monitor", "firewall", "bot", "kernel", "auth"];
  const present = [...new Set(entries.map(e => e.source))];
  const ids = [...order.filter(id => present.includes(id)), ...present.filter(id => !order.includes(id))];
  // The console card tails oldest-first (newest at the bottom); the store is newest-first, so reverse.
  // Each line already carries { at, level, text } — the ConsoleView gutter renders the journald time.
  const sources = ids.map(id => {
    const m = LOG_SOURCE_META[id] || {};
    return { id, label: m.label || id, lines: entries.filter(e => e.source === id).slice().reverse() };
  });

  if (sources.length > 0)
    return <ConsoleView title="Host logs" icon="scroll-text" sources={sources} pill={{ label: "Live", live: true }} resetKey={hostId} />;

  // Nothing to show yet: loading (first fetch / host switch), an error, or a genuinely quiet host —
  // render the honest state for each rather than a "Live" console sitting empty (never fabricate lines).
  const phase = (status === "loading" || !ready) ? "loading" : status === "error" ? "error" : "quiet";
  return (
    <div className="proc-unavailable">
      <span className="proc-unavailable__icon"><Icon name="scroll-text" size={26} strokeWidth={1.9} /></span>
      <div className="proc-unavailable__title">
        {phase === "loading" ? "Loading host logs…" : phase === "error" ? "Host logs unavailable" : "No recent log lines"}
      </div>
      <div className="proc-unavailable__sub">
        {phase === "loading"
          ? "Reading the host’s leaf-service journal (assistant · monitor · watchdog · firewall · api · bot)."
          : phase === "error"
            ? "Couldn’t read the host log stream — the backend journal source didn’t respond."
            : "The host’s leaf services haven’t logged anything in the recent window."}
      </div>
      <span className="proc-unavailable__tag">
        <Icon name="activity" size={12} /> {phase === "loading" ? "loading" : phase === "error" ? "no log source" : "quiet"}
      </span>
    </div>
  );
}

// =====================================================================
// FLEET PAGE — Diagnostics + Hosts management, merged.
//
// One page, two states driven by a LOCAL focus (carried in the route, NOT the
// global scope store):
//   • no focus  → the fleet grid: a monitoring card per host, plus add/edit/
//                 connect/remove via each card's ⋯ menu.
//   • a host    → that host's diagnostics deep-dive (the four sub-tabs).
//
// Inspecting a host is pure navigation — it never changes the globally active
// host. Re-scoping the app is an explicit "Set as active scope" action.
// =====================================================================

function slugify(s) {
  return (s || "host").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24) || "host";
}

// A freshly-connected host has no telemetry yet — give it a valid-but-empty
// shape so the deep-dive and grid cards never crash reading it.
function makeHostSkeleton(fields) {
  const base = slugify(fields.name || fields.hostname);
  let id = base, n = 2;
  while (hostsStore.find(id)) id = base + "-" + n++;
  return {
    id,
    name: fields.name || "New host",
    hostname: fields.hostname || "host.example",
    region: fields.region || "—",
    online: false,
    boot_time: new Date().toISOString().slice(0, 19),
    kernel: "—", os: fields.os || "—", panel_version: "0.14.2",
    cpu: { model: "—", cores: 0, threads: 0, freq_ghz: 0, usage_pct: 0, per_core: [], load_avg: [0, 0, 0], temp_c: 0 },
    ram: { total_gb: 0, used_gb: 0, cached_gb: 0, buffers_gb: 0, free_gb: 0, swap_total_gb: 0, swap_used_gb: 0 },
    disks: [], network: { interfaces: [], open_ports: [] }, sensors: [], processes: [],
    events: [{ ts: new Date().toISOString().slice(0, 19), severity: "info", icon: "plug", text: "Host registered — awaiting first agent check-in" }],
    logs: [],
    _pending: true,
  };
}

function uptimeShort(bootTime) {
  const ms = Date.now() - new Date(bootTime).getTime();
  if (ms < 0 || !isFinite(ms)) return "—";
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return d + "d " + h + "h";
  if (h > 0) return h + "h " + m + "m";
  return m + "m";
}

// ---------- Editor modal (add / edit) ----------

// The host editor. Two modes, but only the EDIT half writes to the API — `PATCH /hosts/{id}` can set
// exactly the host's IDENTITY OVERRIDES: the display `label` and the free-form `region`. Everything else on
// a host (hostname, OS, kernel, capacity) is runtime-derived/read-only — the API never sets it — so those
// inputs are gone (a placeholder of strip-able "—" is treated as empty when prefilling). The ADD mode keeps
// an address field because connecting to a NEW host needs its URL (that's choosing which kgsm-api, not
// setting an API field); it stays the client-side registry path.
function HostEditorModal({ host, onSave, onClose }) {
  const editing = !!host;
  // A display placeholder ("—") prefills as empty so the operator edits real text, not a dash.
  const clean = (v) => (v && v !== "—" ? v : "");
  const [name, setName] = React.useState(clean(host?.name));
  const [hostname, setHostname] = React.useState(clean(host?.hostname));
  const [region, setRegion] = React.useState(clean(host?.region));
  // Edit: a label is required (region is optional — clearing it falls back to the host's config default).
  // Add: an address is required to reach the new host.
  const canSave = editing ? !!name.trim() : (!!name.trim() && !!hostname.trim());
  const submit = () => {
    if (!canSave) return;
    if (editing) onSave({ label: name.trim(), region: region.trim() });           // → PATCH /hosts/{id}
    else onSave({ name: name.trim(), hostname: hostname.trim(), region: region.trim() }); // → registry add
  };
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal host-editor" onClick={e => e.stopPropagation()}>
        <div className="host-editor__head">
          <div className="host-editor__head-icon"><Icon name={editing ? "pencil" : "server-cog"} size={18} /></div>
          <div>
            <h2 className="host-editor__title">{editing ? "Edit host" : "Add a host"}</h2>
            <p className="host-editor__sub">{editing ? "Set how this machine appears across the panel — its label and region." : "Register a machine running the Krystal agent. It connects on first check-in."}</p>
          </div>
          <button className="host-editor__close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div className="host-editor__body">
          <label className="host-field">
            <span className="host-field__label">Display name</span>
            <input className="host-field__input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Frankfurt box" autoFocus />
          </label>
          {/* Address is connection info — only meaningful when ADDING a host. The API can't change where a
              host lives, so it isn't shown (nor settable) when editing an existing one. */}
          {!editing && (
            <label className="host-field">
              <span className="host-field__label">Hostname / address</span>
              <input className="host-field__input host-field__input--mono" value={hostname} onChange={e => setHostname(e.target.value)} placeholder="krystal-3.tks.example" spellCheck="false" />
            </label>
          )}
          <label className="host-field">
            <span className="host-field__label">Region <span className="host-field__opt">optional</span></span>
            <input className="host-field__input host-field__input--mono" value={region} onChange={e => setRegion(e.target.value)} placeholder="e.g. eu-west" spellCheck="false" />
          </label>
        </div>
        <div className="host-editor__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="host-btn host-btn--primary" onClick={submit} disabled={!canSave}>
            <Icon name={editing ? "check" : "plus"} size={14} strokeWidth={2.4} />
            {editing ? "Save changes" : "Add host"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Remove confirm ----------

function RemoveHostDialog({ host, serverCount, onConfirm, onClose }) {
  const blocked = serverCount > 0;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal host-remove" onClick={e => e.stopPropagation()}>
        <div className={"host-remove__icon" + (blocked ? " host-remove__icon--warn" : " host-remove__icon--danger")}>
          <Icon name={blocked ? "shield-alert" : "trash-2"} size={20} />
        </div>
        <h2 className="host-remove__title">{blocked ? "Can't remove this host yet" : "Remove " + host.name + "?"}</h2>
        {blocked ? (
          <p className="host-remove__text">
            <b>{host.name}</b> still hosts <b>{serverCount} server{serverCount === 1 ? "" : "s"}</b>. Move or delete them first — removing the host would orphan their history and audit trail.
          </p>
        ) : (
          <p className="host-remove__text">
            This unregisters <b>{host.name}</b> ({host.hostname}) from the panel. Diagnostics and metrics for it stop being collected. This can't be undone.
          </p>
        )}
        <div className="host-remove__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose}>{blocked ? "Close" : "Cancel"}</button>
          {!blocked && (
            <button className="host-btn host-btn--danger" onClick={onConfirm}>
              <Icon name="trash-2" size={14} /> Remove host
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Per-host ⋯ management menu (used on cards and in the deep-dive) ----------

function HostMenu({ host, isActive, onSetActive, onEdit, onToggle, onRemove }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const act = (fn) => (e) => { e.stopPropagation(); setOpen(false); fn(); };
  // Per-host management is SCOPED (architecture.html §3·f·1): reaching the fleet
  // grid takes admin on *some* host (aggregate), but editing / connecting /
  // removing THIS host takes admin on THIS host. Set-as-scope is navigation, so
  // it stays open to anyone who can see the grid.
  const canManage = canOn ? canOn("host.manage", host.id) : true;
  return (
    <div className="host-menu" ref={ref} onClick={e => e.stopPropagation()}>
      <button className={"icon-btn" + (open ? " icon-btn--on" : "")} onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }} title="Manage host" aria-label="Manage host">
        <Icon name="ellipsis" size={15} />
      </button>
      {open && (
        <div className="host-menu__pop">
          <button className="host-menu__item" onClick={act(() => onSetActive(host.id))} disabled={isActive}>
            <Icon name="eye" size={14} />{isActive ? "Active scope" : "Set as active scope"}
          </button>
          {canManage && (
            <>
              <button className="host-menu__item" onClick={act(() => onEdit(host))}><Icon name="pencil" size={14} />Edit host</button>
              <button className="host-menu__item" onClick={act(() => onToggle(host))}>
                <Icon name={host.online ? "power-off" : "power"} size={14} />{host.online ? "Disconnect" : "Connect"}
              </button>
              <div className="host-menu__sep"></div>
              <button className="host-menu__item host-menu__item--danger" onClick={act(() => onRemove(host))}><Icon name="trash-2" size={14} />Remove host</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Unified fleet card (monitoring body + management menu) ----------

function FleetHostCard({ host, serverCount, alerts, isActive, onInspect, menuProps }) {
  // Health (tone + meters) comes from the shared hostHealth() so this card and
  // the Dashboard fleet strip can't drift apart.
  const { denied, metricsDown, hasTelemetry, meters, tone } = hostHealth(host);
  const alertTone = alerts.length ? alertsTone(alerts) : null;

  return (
    <div className={"fleet-card fleet-card--" + tone} onClick={() => onInspect(host.id)} role="button" tabIndex={0}>
      <div className="fleet-card__head">
        <span className={"fleet-card__dot fleet-card__dot--" + tone}></span>
        <span className="fleet-card__name">{host.name}</span>
        <span className="fleet-card__region">{host.region}</span>
        {isActive && <span className="fleet-card__active"><Icon name="circle-check" size={11} strokeWidth={2.4} />active</span>}
        <span style={{ flex: 1 }}></span>
        {alerts.length > 0 && (
          <span className={"fleet-card__alerts fleet-card__alerts--" + alertTone}><Icon name="triangle-alert" size={11} strokeWidth={2.4} />{alerts.length}</span>
        )}
        {denied && HostAuthBadge && <HostAuthBadge hostId={host.id} size="sm" />}
        {host.online && !denied && <HostConnection hostId={host.id} />}
        <HostMenu host={host} isActive={isActive} {...menuProps} />
      </div>
      <div className="fleet-card__hostname"><code>{host.hostname}</code></div>

      {denied ? (
        <div className="fleet-card__offline fleet-card__offline--denied"><Icon name="lock" size={13} /> No access — your Discord role isn’t granted on this host</div>
      ) : metricsDown ? (
        <div className="fleet-card__offline"><Icon name="activity" size={13} /> Live metrics unavailable on this host</div>
      ) : hasTelemetry ? (
        <div className="fleet-card__meters">
          <HostMeters meters={meters} />
        </div>
      ) : (
        <div className="fleet-card__offline"><Icon name={host._pending ? "loader" : "moon"} size={13} /> {host._pending ? "Awaiting first agent check-in" : "Disconnected — no live telemetry"}</div>
      )}

      <div className="fleet-card__foot">
        <span><Icon name="box" size={12} />{serverCount + " server" + (serverCount === 1 ? "" : "s")}</span>
        <span><Icon name="cpu" size={12} />{(host.cpu.cores || "—") + " cores"}</span>
        <span><Icon name="clock" size={12} />{host.online ? "up " + uptimeShort(host.boot_time) : "—"}</span>
        <span className="fleet-card__open">Inspect <Icon name="arrow-right" size={12} strokeWidth={2.2} /></span>
      </div>
    </div>
  );
}

// ---------- Page shell ----------

function FleetPage({ focusHostId, onFocusHost, onAsk, onOpenServer, onOpenServerSettings, onViewAlerts, onViewAudit }) {
  // Subscribe to the alert feed so in-context cards appear/clear live.
  if (useAlerts) useAlerts();
  const hosts = useStore(hostsStore, s => s.list);
  const dataLoading = useStore(hostsStore, s => s.status === "loading" && !s.everLoaded);
  const servers = useStore(serversStore, s => s.list);
  // Global active scope (set by the sidebar switcher / "Set as active scope").
  // Separate from focusHostId, which is just what we're *looking at* here.
  const activeId = useSelectedHostId();
  const [tab, setTab] = React.useState("overview");
  // 1s clock while a host is focused: keeps the "last sample Xm ago" labels
  // ticking and lets the metrics power-down/up transition register promptly.
  const [, setClock] = React.useState(0);
  React.useEffect(() => {
    if (!focusHostId) return;
    const t = setInterval(() => setClock(c => c + 1), 1000);
    return () => clearInterval(t);
  }, [focusHostId]);
  // While a host's deep-dive is open, subscribe to its live metric ticks
  // (hosts/{id}/metrics → host.metrics) so cpu/ram/disk/network update in place.
  // The disposer (returned by subscribeHostMetrics) unsubscribes the socket topic +
  // clears the freshness stamp on unfocus / host switch, so the server's
  // subscriber-gated pump idles again.
  React.useEffect(() => subscribeHostMetrics(focusHostId), [focusHostId]);
  const [editing, setEditing] = React.useState(null);
  const [removing, setRemoving] = React.useState(null);
  // Fleet-grid search + pagination (hooks must live above the early returns).
  const [hostQuery, setHostQuery] = React.useState("");
  const [hostPage, setHostPage] = React.useState(0);
  const dq = useDebouncedValue(hostQuery, 250);
  const searchPending = hostQuery.trim() !== dq.trim();
  const hostQ = dq.trim().toLowerCase();
  React.useEffect(() => { setHostPage(0); }, [hostQ]);

  React.useEffect(() => { setTab("overview"); }, [focusHostId]);

  const countFor = (hostId) => servers.filter(s => s.hostId === hostId).length;

  // Management actions (shared by grid cards + deep-dive header menu).
  // Edit writes the identity overrides through the API (PATCH /hosts/{id} { label, region }) — admin-gated
  // server-side. We update the store optimistically, then reconcile the label/region from the server's
  // response (the authoritative effective values, incl. a clear falling back to the config default). Add
  // stays the client-side registry/skeleton path (a new host is reached by URL, not created via the API).
  const saveHost = (fields) => {
    if (editing && editing.id) {
      const id = editing.id;
      hostsStore.update(id, { name: fields.label, region: fields.region || "—" });   // optimistic
      setEditing(null);
      const client = api.host ? api.host(id) : api;
      Promise.resolve(client.patch("/hosts/" + id, { label: fields.label, region: fields.region }))
        .then((updated) => {
          if (updated && updated.id) hostsStore.update(id, { name: updated.name, region: updated.region });
        })
        .catch(() => { /* keep optimistic; the next /hosts refetch reconciles authoritative truth */ });
    } else {
      hostsStore.add(makeHostSkeleton(fields));
      setEditing(null);
    }
  };
  const toggleHost = (host) => hostsStore.update(host.id, { online: !host.online, _pending: false });
  const confirmRemove = () => {
    if (!removing) return;
    const id = removing.id;
    hostsStore.remove(id);
    if (activeId === id) selectedHostStore.set("all");
    if (focusHostId === id) onFocusHost(null);
    setRemoving(null);
  };
  const menuProps = {
    onSetActive: (id) => selectedHostStore.set(id),
    onEdit: (host) => setEditing(host),
    onToggle: toggleHost,
    onRemove: (host) => setRemoving(host),
  };
  const modals = (
    <>
      {editing && <HostEditorModal host={editing.id ? editing : null} onSave={saveHost} onClose={() => setEditing(null)} />}
      {removing && <RemoveHostDialog host={removing} serverCount={countFor(removing.id)} onConfirm={confirmRemove} onClose={() => setRemoving(null)} />}
    </>
  );

  // No hosts at all.
  if (!hosts.length) {
    return (
      <>
        <div className="dash-head">
          <div className="dash-head__row">
            <h1>Fleet</h1>
            <button className="fb-editor__btn servers-toolbar__new" onClick={() => setEditing({})}>
              <Icon name="plus" size={13} strokeWidth={2.4} />&nbsp;Add host
            </button>
          </div>
          <div className="dash-head__sub">No hosts connected yet.</div>
        </div>
        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-lg)", padding: 60, textAlign: "center", color: "var(--fg-3)" }}>
          <Icon name="server-off" size={28} />
          <div style={{ marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>No hosts configured</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>Add a host to start aggregating servers and diagnostics.</div>
        </div>
        {modals}
      </>
    );
  }

  // ---------- Grid (no host focused) ----------
  if (!focusHostId || !hosts.find(h => h.id === focusHostId)) {
    const anchored = anchoredAlerts || (() => []);
    const fleetAlerts = anchored(an => an.surface === "diagnostics");
    // Search across name / hostname / region, then page the result (25/page).
    const PAGE_SIZE = 25;
    const matched = hosts.filter(h =>
      !hostQ || (h.name + " " + h.hostname + " " + (h.region || "")).toLowerCase().includes(hostQ));
    const onlineHosts = hosts.filter(h => h.online).length;
    const offlineCount = hosts.length - onlineHosts;
    const pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
    const safePage = Math.min(hostPage, pageCount - 1);
    const pageHosts = matched.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
    const onLastPage = safePage === pageCount - 1;
    return (
      <>
        <div className="dash-head">
          <div className="dash-head__row">
            <h1>Fleet</h1>
            <button className="fb-editor__btn servers-toolbar__new" onClick={() => setEditing({})}>
              <Icon name="plus" size={13} strokeWidth={2.4} />&nbsp;Add host
            </button>
          </div>
          <div className="dash-head__sub">Every host this panel aggregates — health, diagnostics and management in one place.</div>
        </div>

        {dataLoading ? <FleetSkeleton /> : (<>
        {/* Top-of-page glance — the shared KPI cards, same as the Dashboard
            summary, so Fleet reads as one of the family instead of a one-off
            bordered stat strip. "Host alerts" tones warm only when non-zero. */}
        <div className="dash-summary">
          <KPI
            icon="server" label="Hosts"
            value={hosts.length}
            sub={hosts.length === 1 ? "machine aggregated" : "machines aggregated"}
            tone="muted" />
          <KPI
            icon="circle-check" label="Online"
            value={onlineHosts}
            sub={offlineCount ? offlineCount + (offlineCount === 1 ? " offline" : " offline") : "all reachable"}
            tone={onlineHosts ? "ok" : "muted"} />
          <KPI
            icon="box" label="Servers"
            value={servers.length}
            sub="across the fleet"
            tone="muted" />
          <KPI
            icon="triangle-alert" label="Host alerts"
            value={fleetAlerts.length}
            sub={fleetAlerts.length ? "need attention" : "all clear"}
            tone={fleetAlerts.length ? "warn" : "muted"}
            onView={fleetAlerts.length ? onViewAlerts : null} />
        </div>

        {/* Quiet, shared Toolbar — same search/count row as Servers, Library
            and Audit, in place of the old bespoke pill filter-bar. */}
        <Toolbar>
          <ToolbarSearch
            value={hostQuery}
            onChange={setHostQuery}
            pending={searchPending}
            placeholder="Search hosts…" />
          <ToolbarSpacer />
          <ToolbarCount shown={matched.length} total={hosts.length} unit="hosts" />
        </Toolbar>

        <div className="fleet-grid">
          {pageHosts.map(h => (
            <FleetHostCard
              key={h.id}
              host={h}
              serverCount={countFor(h.id)}
              alerts={anchored(an => an.surface === "diagnostics" && an.hostId === h.id)}
              isActive={activeId === h.id}
              onInspect={onFocusHost}
              menuProps={menuProps}
            />
          ))}
          {!hostQ && onLastPage && (
            <button className="host-card host-card--add" onClick={() => setEditing({})}>
              <span className="host-card__add-icon"><Icon name="plus" size={22} /></span>
              <span className="host-card__add-title">Add a host</span>
              <span className="host-card__add-sub">Register another machine to aggregate here</span>
            </button>
          )}
        </div>
        {matched.length === 0 && (
          <div style={{ padding: "48px 0", textAlign: "center", color: "var(--fg-3)" }}>No hosts match “{hostQuery.trim()}”.</div>
        )}
        <Pagination
          page={safePage}
          pageCount={pageCount}
          total={matched.length}
          pageSize={PAGE_SIZE}
          onPage={setHostPage}
          unit="hosts"
        />
        </>)}
        {modals}
      </>
    );
  }

  // ---------- Deep dive (a host is focused) ----------
  const host = hosts.find(h => h.id === focusHostId);
  const isActive = activeId === host.id;

  // 403 — identity verified, role not granted on this host. Terminal surface,
  // never re-authed (§6·a). Distinct from "unreachable" / "awaiting telemetry".
  if (sessionStore && sessionStore.isDenied(host.id)) {
    return (
      <>
        <div className="diag-head-row">
          <button className="diag-back-btn" onClick={() => onFocusHost(null)} title="All hosts" aria-label="Back to all hosts">
            <Icon name="arrow-left" size={18} />
          </button>
          <div className="diag-head">
            <div className="diag-head__title">
              <h1>{host.name}</h1>
              <div className="dash-head__sub">{host.hostname} · {host.region}</div>
            </div>
          </div>
        </div>
        <HostDeniedNotice host={host} embedded
          onBack={() => onFocusHost(null)}
          onManage={() => selectedHostStore.set("all")} />
        {modals}
      </>
    );
  }

  const headerChrome = (
    <div className="diag-head-row">
      <button className="diag-back-btn" onClick={() => onFocusHost(null)} title="All hosts" aria-label="Back to all hosts">
        <Icon name="arrow-left" size={18} />
      </button>
      <div className="diag-head">
        <div className="diag-head__title">
          <h1>{host.name}{isActive && <span className="host-picker__active-tag">active</span>}</h1>
          <div className="dash-head__sub">{host.hostname} · {host.region} — host machine health, distinct from per-game-server metrics.</div>
        </div>
        {host.online && <HostConnection hostId={host.id} full />}
      </div>
    </div>
  );

  if (!host.online || host.ram.total_gb === 0) {
    return (
      <>
        {headerChrome}
        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-lg)", padding: 56, textAlign: "center", color: "var(--fg-3)" }}>
          <Icon name="plug-zap" size={26} />
          <div style={{ marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>{host.name} is {host._pending ? "connecting" : host.online ? "awaiting telemetry" : "disconnected"}</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>{(host._pending || host.online) ? "Waiting for the agent's first check-in — diagnostics appear once it reports in." : "Reconnect this host from its ⋯ menu to resume telemetry."}</div>
        </div>
        {modals}
      </>
    );
  }

  const hostAlerts = anchoredAlerts
    ? anchoredAlerts(an => an.surface === "diagnostics" && an.hostId === host.id)
    : [];
  // Live-metrics freshness — drives the "frozen" treatment across every sub-tab.
  const fresh = hostMetricsFreshness ? hostMetricsFreshness(host) : null;
  const resourceAlerts = hostAlerts.filter(a => a.anchor.tab === "resources");
  const serviceAlerts  = hostAlerts.filter(a => a.anchor.tab === "services");
  const badge = (items) => items.length ? { badge: items.length, badgeTone: alertsTone(items) } : {};
  const tabs = [
    { id: "overview",  label: "Overview",  icon: "layout-grid" },
    { id: "resources", label: "Resources", icon: "activity", ...badge(resourceAlerts) },
    { id: "services",  label: "Services",  icon: "server-cog", ...badge(serviceAlerts) },
    { id: "logs",      label: "Logs",      icon: "scroll-text" },
  ];

  return (
    <>
      {headerChrome}
      <SubTabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === "overview"  && <DiagOverview host={host} fresh={fresh} onAsk={onAsk} onViewAlerts={onViewAlerts} onViewAudit={onViewAudit} onViewServices={() => setTab("services")} />}
      {tab === "resources" && <DiagResources host={host} fresh={fresh} servers={servers} onOpenServerSettings={onOpenServerSettings} />}
      {tab === "services"  && <DiagServices host={host} />}
      {tab === "logs"      && <DiagLogs host={host} />}
      {modals}
    </>
  );
}

export { CapacityMeter, FleetPage, HostCapacityStrip, hostCapacityMeters };
