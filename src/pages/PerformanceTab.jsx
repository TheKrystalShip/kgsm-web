import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { TimeSeriesChart, detectAnomalies } from "../components/TimeSeriesChart.jsx";
import { adaptServerMetrics, subscribeServerMetrics } from "../lib/stores.js";

// PerformanceTab — LIVE per-server resource metrics for one game server.
//
// Source: the kgsm-monitor samples each running instance's cgroup/proc tree at
// ~1 Hz; kgsm-api re-publishes the per-server frame on the WS topic
// `servers/{id}/metrics` (`metrics.tick`), subscriber-gated on both ends. There
// is NO metrics-history store anywhere in the stack (the monitor serves only the
// latest frame), so this tab is a LIVE rolling window: it seeds from the REST
// `metrics` block already on the server, then appends each tick into a transient
// buffer. The window resets on unmount — it honestly means "since you opened
// this tab", never a backfilled history.
//
// HONESTY: the monitor measures cpu / memory / disk-IO / pids / on-disk footprint
// per server and nothing else. Per-server NETWORK, PLAYER COUNT and game TICK-RATE
// have no source and are deliberately ABSENT — never charted as zeros. CPU is % of
// one core (htop convention) and can exceed 100, so its axis is uncapped. Memory is
// absolute bytes (no per-server limit exists → no honest %), so it's charted in
// GiB/MiB, not a 0–100 bar.
//
// Anomaly markers: any point > mean + 2σ over the visible window for ≥ 2
// consecutive points (detectAnomalies() in TimeSeriesChart.jsx). Cheap, robust to
// scale, no per-metric tuning.

const BUFFER_CAP = 150;     // ~2.5 min of 1 Hz samples held in the live window
const STALE_MS   = 10000;   // no tick for ~10 missed samples → feed paused
const NO_SOURCE_MS = 9000;  // no data this long after opening → the monitor isn't reporting it

const KiB = 1024, MiB = 1024 * 1024, GiB = 1024 * 1024 * 1024;

function fmtBytes(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n >= GiB) return (n / GiB).toFixed(2) + " GiB";
  if (n >= MiB) return (n / MiB).toFixed(1) + " MiB";
  if (n >= KiB) return (n / KiB).toFixed(0) + " KiB";
  return Math.round(n) + " B";
}
function fmtBps(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n >= MiB) return (n / MiB).toFixed(1) + " MiB/s";
  if (n >= KiB) return (n / KiB).toFixed(0) + " KiB/s";
  return Math.round(n) + " B/s";
}

function PerformanceTab({ server, onAsk }) {
  // Live rolling window. All hooks run unconditionally (the render branches come
  // after) so the hook order is stable across a server's offline/online states.
  const [buffer, setBuffer] = React.useState([]);
  const [lastTickAt, setLastTickAt] = React.useState(null);
  const [mountedAt, setMountedAt] = React.useState(() => Date.now());
  const [, setClock] = React.useState(0);   // ticks the staleness check when no frames arrive

  // Seed from the REST metrics block, then follow the WS tick. Re-runs only when
  // the server id changes (the prop object churns on every store update, but the
  // id is stable → the subscription survives). The subscribe is gated to this
  // mounted tab, so the API's per-server pump idles whenever it's closed.
  React.useEffect(() => {
    const seed = adaptServerMetrics(server.metrics);
    setBuffer(seed ? [seed] : []);
    setLastTickAt(seed ? Date.now() : null);
    setMountedAt(Date.now());
    return subscribeServerMetrics(server.id, (point) => {
      setLastTickAt(Date.now());
      setBuffer(prev => {
        const arr = prev.concat([point]);
        return arr.length > BUFFER_CAP ? arr.slice(arr.length - BUFFER_CAP) : arr;
      });
    });
  }, [server.id]);

  // Re-evaluate freshness even when frames stop arriving (so the feed flips to
  // "paused" on its own). While streaming, the 1 Hz ticks already re-render.
  React.useEffect(() => {
    const id = setInterval(() => setClock(c => c + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const hasData = buffer.length > 0;
  const latest = hasData ? buffer[buffer.length - 1] : null;
  const ageMs = lastTickAt != null ? Date.now() - lastTickAt : null;
  const stale = hasData && ageMs != null && ageMs > STALE_MS;
  const elapsed = Date.now() - mountedAt;

  // --- Empty / waiting states (no fabricated data) -------------------------
  // The monitor only reports RUNNING servers, so a stopped server has no metrics.
  if (server.status === "offline") {
    return <EmptyPerf icon="power-off" title="Server is offline"
      sub="Per-server metrics are collected only while the server is running — start it to begin the live feed." />;
  }
  if (!hasData) {
    return elapsed < NO_SOURCE_MS
      ? <EmptyPerf icon="line-chart" title="Connecting to live metrics…" spin
          sub="Subscribing to this server's metrics feed." />
      : <EmptyPerf icon="line-chart" title="No live per-server metrics"
          sub="The monitor isn't reporting this server on its host — its metrics capability may be down, or per-server sampling isn't available here." />;
  }

  // --- Series (honest units) ----------------------------------------------
  const cpu = buffer.map(p => p.cpu ?? 0);

  const memVals = buffer.map(p => p.memBytes).filter(v => v != null);
  const memPeak = memVals.length ? Math.max(...memVals) : 0;
  const memUseGiB = memPeak >= GiB;
  const memDiv = memUseGiB ? GiB : MiB;
  const memUnit = memUseGiB ? "GiB" : "MiB";
  const mem = buffer.map(p => p.memBytes != null ? p.memBytes / memDiv : 0);

  // Disk I/O — only when the cgroup io controller is actually accounted (else the
  // monitor sends null, which we must NOT chart as a flat zero line).
  const ioAvail = buffer.some(p => p.ioReadBps != null || p.ioWriteBps != null);
  const ioPeak = Math.max(1, ...buffer.map(p => Math.max(p.ioReadBps || 0, p.ioWriteBps || 0)));
  const ioUseMiB = ioPeak >= MiB;
  const ioDiv = ioUseMiB ? MiB : KiB;
  const ioUnit = ioUseMiB ? "MiB/s" : "KiB/s";
  const ioRead = buffer.map(p => (p.ioReadBps || 0) / ioDiv);
  const ioWrite = buffer.map(p => (p.ioWriteBps || 0) / ioDiv);

  const cpuAnoms = detectAnomalies(cpu);
  const memAnoms = detectAnomalies(mem);
  const ioAnoms  = ioAvail ? detectAnomalies(ioWrite) : [];

  const win = buffer.length;
  const streaming = !stale;

  return (
    <>
      <div className="players-toolbar">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: streaming ? "var(--krystal-teal)" : "var(--fg-3)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: streaming ? "var(--krystal-teal)" : "var(--fg-4)", boxShadow: streaming ? "0 0 0 3px color-mix(in srgb, var(--krystal-teal) 22%, transparent)" : "none" }}></span>
          {streaming ? "live · 1 Hz" : "feed paused"}
        </span>
        <span style={{ flex: 1 }}></span>
        <span style={{ color: "var(--fg-3)", fontSize: 12.5, fontFamily: "var(--font-mono)" }}>
          live window · {win} sample{win === 1 ? "" : "s"}
        </span>
      </div>

      {stale && (
        <div className="perf-stale-banner">
          <Icon name="power-off" size={14} strokeWidth={1.9} />
          <span>Live feed paused — last reading {Math.round((ageMs || 0) / 1000)}s ago. Showing the last known window.</span>
        </div>
      )}

      <div className="chart-grid" style={stale ? { opacity: 0.6 } : undefined}>
        <BriefCard
          className="chart-brief"
          icon="cpu"
          title={<>CPU {cpuAnoms.length > 0 && <AnomalyBadge count={cpuAnoms.length} />}</>}
          action={<span className="chart-card__val">{(latest.cpu ?? 0).toFixed(0)}<small>% core</small></span>}>
          <div className="chart-brief__body">
            <TimeSeriesChart
              range="live"
              series={[{ key: "cpu", color: "var(--krystal-teal)", fill: true, values: cpu }]}
              anomalies={cpuAnoms}
              yMin={0} height={120} />
          </div>
        </BriefCard>

        <BriefCard
          className="chart-brief"
          icon="hard-drive"
          title={<>Memory {memAnoms.length > 0 && <AnomalyBadge count={memAnoms.length} />}</>}
          action={<span className="chart-card__val">{fmtBytes(latest.memBytes)}</span>}>
          <div className="chart-brief__body">
            <TimeSeriesChart
              range="live"
              series={[{ key: "mem", color: "#FBBF24", fill: true, values: mem }]}
              anomalies={memAnoms}
              yMin={0} height={120} />
            <div className="chart-card__legend"><span>{memUnit} used · no per-server cap to chart against</span></div>
          </div>
        </BriefCard>

        <BriefCard
          className="chart-brief"
          icon="network"
          title={<>Disk I/O {ioAnoms.length > 0 && <AnomalyBadge count={ioAnoms.length} />}</>}
          action={ioAvail
            ? <span className="chart-card__val"><small style={{ marginRight: 6 }}>r</small>{fmtBps(latest.ioReadBps)}<small> / </small><small style={{ marginRight: 6 }}>w</small>{fmtBps(latest.ioWriteBps)}</span>
            : <span className="chart-card__val" style={{ color: "var(--fg-3)" }}>—</span>}>
          <div className="chart-brief__body">
            {ioAvail ? (
              <>
                <TimeSeriesChart
                  range="live"
                  series={[
                    { key: "r", color: "var(--info)", fill: false, values: ioRead },
                    { key: "w", color: "var(--krystal-teal)", fill: false, values: ioWrite },
                  ]}
                  anomalies={ioAnoms}
                  yMin={0} height={120} />
                <div className="chart-card__legend">
                  <span><span className="swatch" style={{ background: "var(--info)" }}></span>Read</span>
                  <span><span className="swatch" style={{ background: "var(--krystal-teal)" }}></span>Write</span>
                  <span style={{ marginLeft: "auto" }}>{ioUnit}</span>
                </div>
              </>
            ) : (
              <div className="perf-nochart">
                <Icon name="info" size={16} strokeWidth={1.8} />
                <span>Disk I/O isn't accounted for this server on its host (cgroup io controller off).</span>
              </div>
            )}
          </div>
        </BriefCard>

        <BriefCard
          className="chart-brief"
          icon="database"
          title="Processes &amp; footprint">
          <div className="chart-brief__body">
            <div className="perf-stats">
              <div className="perf-stat">
                <span className="perf-stat__label">Processes</span>
                <span className="perf-stat__val">{latest.pids != null ? latest.pids : "—"}</span>
              </div>
              <div className="perf-stat">
                <span className="perf-stat__label">On-disk footprint</span>
                <span className="perf-stat__val">{fmtBytes(latest.diskBytes)}</span>
              </div>
            </div>
            <div className="chart-card__legend"><span>footprint sampled on a slow cadence (install + saves + backups + logs)</span></div>
          </div>
        </BriefCard>
      </div>
    </>
  );
}

function EmptyPerf({ icon, title, sub, spin }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 0", color: "var(--fg-3)" }}>
      <span style={spin ? { display: "inline-block", animation: "act-spin 1.4s linear infinite" } : undefined}>
        <Icon name={icon} size={26} strokeWidth={1.6} />
      </span>
      <div style={{ marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>{title}</div>
      <div style={{ marginTop: 4, fontSize: 12.5, maxWidth: 460, margin: "4px auto 0" }}>{sub}</div>
    </div>
  );
}

function AnomalyBadge({ count }) {
  return (
    <span className="chart-card__anomaly-badge" title={count + " anomaly window" + (count > 1 ? "s" : "")}>
      <Icon name="alert-triangle" size={10} strokeWidth={2.4} />
      {count}
    </span>
  );
}

export { PerformanceTab };
