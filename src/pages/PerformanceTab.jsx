import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { TimeSeriesChart, detectAnomalies, ChartHoverProvider } from "../components/TimeSeriesChart.jsx";
import { adaptServerMetrics, subscribeServerMetrics, fetchServerMetricsHistory, fetchServerEvents } from "../lib/stores.js";

// PerformanceTab — per-server resource metrics with live + historical ranges.
//
// LIVE: the kgsm-monitor samples each running instance's cgroup/proc tree at
// ~1 Hz; kgsm-api re-publishes the per-server frame on the WS topic
// `servers/{id}/metrics` (`metrics.tick`), subscriber-gated on both ends.
// The live tab is a transient rolling window: it seeds from the REST `metrics`
// block, then appends each tick into a transient buffer (resets on unmount).
//
// HISTORICAL (M9): the kgsm-api metrics history store persists samples at 15s
// cadence into a dedicated metrics.db. Short ranges (≤24h) serve raw ~15s
// samples; long ranges (7d/30d) serve 5-min rollup buckets with min/max/n.
// Gaps are absent points (the backend never carry-forwards). The range
// selector fetches from GET /servers/{id}/metrics/history?range=X.

const BUFFER_CAP = 150;
const STALE_MS   = 10000;
const NO_SOURCE_MS = 9000;

const RANGES = [
  { key: "live", label: "Live" },
  { key: "1h",   label: "1h" },
  { key: "24h",  label: "24h" },
  { key: "7d",   label: "7d" },
  { key: "30d",  label: "30d" },
];

const RANGE_MS = { "1h": 3600e3, "24h": 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3 };

// Lifecycle audit actions worth pinning to the metrics timeline (#3). Tone matches
// the audit log's vocabulary; the label is terse for a chart flag.
const EVENT_META = {
  "server.start":   { label: "Started",   tone: "success" },
  "server.stop":    { label: "Stopped",   tone: "danger"  },
  "server.restart": { label: "Restarted", tone: "update"  },
  "server.crash":   { label: "Crashed",   tone: "danger"  },
  "server.update":  { label: "Updated",   tone: "info"    },
  "server.install": { label: "Installed", tone: "success" },
};
function rowsToEvents(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(r => r && EVENT_META[r.action])
    .map(r => ({ t: Date.parse(r.ts), ...EVENT_META[r.action] }))
    .filter(e => isFinite(e.t));
}

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

// Summary stats over the visible window (#2). Nulls are skipped, never coerced
// to 0 — an all-null window has no honest avg/peak, so the strip is omitted.
function seriesStats(vals) {
  let mn = Infinity, mx = -Infinity, sum = 0, n = 0;
  for (const v of vals) {
    if (v == null || !isFinite(v)) continue;
    if (v < mn) mn = v; if (v > mx) mx = v; sum += v; n++;
  }
  return n ? { min: mn, max: mx, avg: sum / n } : null;
}

function StatStrip({ items }) {
  if (!items || !items.length) return null;
  return (
    <div className="chart-stats">
      {items.map((it, i) => (
        <span key={i} className="chart-stat"><b>{it.label}</b>{it.value}</span>
      ))}
    </div>
  );
}

function PerformanceTab({ server, onAsk }) {
  // A stopped server has no live feed and nothing to measure — default to the most
  // recent history so its run-time data + lifecycle events stay visible. Live is
  // still selectable; it just renders an honest "not running" state, never a
  // fabricated flat-0 line (the monitor reports nothing for a stopped instance).
  const stopped = server.status === "offline";
  const [range, setRange] = React.useState(stopped ? "1h" : "live");

  return (
    <>
      <div className="players-toolbar">
        <RangeSelector range={range} setRange={setRange} />
      </div>
      {range === "live"
        ? <LiveMetrics server={server} stopped={stopped} />
        : <HistoricalMetrics server={server} range={range} />
      }
    </>
  );
}

function RangeSelector({ range, setRange }) {
  return (
    <div style={{ display: "flex", gap: 2, background: "var(--surface-2)", borderRadius: 6, padding: 2 }}>
      {RANGES.map(r => (
        <button key={r.key}
          onClick={() => setRange(r.key)}
          style={{
            padding: "4px 10px", fontSize: 12, fontWeight: 600, borderRadius: 5, border: "none",
            cursor: "pointer", transition: "all 0.15s",
            background: range === r.key ? "var(--surface-3)" : "transparent",
            color: range === r.key ? "var(--fg-1)" : "var(--fg-3)",
          }}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

// ---- Live rolling window (unchanged from before M9) ----

function LiveMetrics({ server, stopped }) {
  const [buffer, setBuffer] = React.useState([]);
  const [lastTickAt, setLastTickAt] = React.useState(null);
  const [mountedAt, setMountedAt] = React.useState(() => Date.now());
  const [, setClock] = React.useState(0);

  React.useEffect(() => {
    const seed = adaptServerMetrics(server.metrics);
    // Stamp each point with its receipt time — the live feed carries no
    // per-sample timestamp, so the hover tooltip's wall-clock comes from here
    // (honest: time-of-receipt at ~1 Hz, not a fabricated sample time).
    setBuffer(seed ? [{ ...seed, t: Date.now() }] : []);
    setLastTickAt(seed ? Date.now() : null);
    setMountedAt(Date.now());
    return subscribeServerMetrics(server.id, (point) => {
      const now = Date.now();
      setLastTickAt(now);
      setBuffer(prev => {
        const arr = prev.concat([{ ...point, t: now }]);
        return arr.length > BUFFER_CAP ? arr.slice(arr.length - BUFFER_CAP) : arr;
      });
    });
  }, [server.id]);

  React.useEffect(() => {
    const id = setInterval(() => setClock(c => c + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const hasData = buffer.length > 0;
  const latest = hasData ? buffer[buffer.length - 1] : null;
  const ageMs = lastTickAt != null ? Date.now() - lastTickAt : null;
  const stale = hasData && ageMs != null && ageMs > STALE_MS;
  const elapsed = Date.now() - mountedAt;

  if (stopped && !hasData) {
    return <EmptyPerf icon="power-off" title="Server isn’t running"
      sub="No live feed while stopped — the monitor measures nothing for a stopped instance. Pick a history range above to see recorded metrics and the server’s start/stop events." />;
  }

  if (!hasData) {
    return elapsed < NO_SOURCE_MS
      ? <EmptyPerf icon="line-chart" title="Connecting to live metrics…" spin
          sub="Subscribing to this server's metrics feed." />
      : <EmptyPerf icon="line-chart" title="No live per-server metrics"
          sub="The monitor isn't reporting this server on its host — its metrics capability may be down, or per-server sampling isn't available here." />;
  }

  const times = buffer.map(p => p.t);

  const cpu = buffer.map(p => p.cpu ?? 0);
  const memVals = buffer.map(p => p.memBytes).filter(v => v != null);
  const memPeak = memVals.length ? Math.max(...memVals) : 0;
  const memUseGiB = memPeak >= GiB;
  const memDiv = memUseGiB ? GiB : MiB;
  const memUnit = memUseGiB ? "GiB" : "MiB";
  const mem = buffer.map(p => p.memBytes != null ? p.memBytes / memDiv : 0);

  const ioAvail = buffer.some(p => p.ioReadBps != null || p.ioWriteBps != null);
  const ioPeak = Math.max(1, ...buffer.map(p => Math.max(p.ioReadBps || 0, p.ioWriteBps || 0)));
  const ioUseMiB = ioPeak >= MiB;
  const ioDiv = ioUseMiB ? MiB : KiB;
  const ioUnit = ioUseMiB ? "MiB/s" : "KiB/s";
  const ioRead = buffer.map(p => (p.ioReadBps || 0) / ioDiv);
  const ioWrite = buffer.map(p => (p.ioWriteBps || 0) / ioDiv);

  // Network rx/tx — sourced for native instances (eBPF meter on kgsm.slice),
  // null when unmetered (container / un-metered host). null across the whole
  // window → honest "not available", NOT a flat-zero chart (mirrors Disk I/O).
  const netAvail = buffer.some(p => p.rxBps != null || p.txBps != null);
  const netPeak = Math.max(1, ...buffer.map(p => Math.max(p.rxBps || 0, p.txBps || 0)));
  const netUseMiB = netPeak >= MiB;
  const netDiv = netUseMiB ? MiB : KiB;
  const netUnit = netUseMiB ? "MiB/s" : "KiB/s";
  const netRx = buffer.map(p => (p.rxBps || 0) / netDiv);
  const netTx = buffer.map(p => (p.txBps || 0) / netDiv);

  const cpuAnoms = detectAnomalies(cpu);
  const memAnoms = detectAnomalies(mem);
  const ioAnoms  = ioAvail ? detectAnomalies(ioWrite) : [];
  const netAnoms = netAvail ? detectAnomalies(netTx) : [];

  // Per-window summary stats (#2) — computed over the raw values, formatted per metric.
  const cpuStats = seriesStats(cpu);
  const memStats = seriesStats(memVals);
  const ioReadStats  = ioAvail ? seriesStats(buffer.map(p => p.ioReadBps)) : null;
  const ioWriteStats = ioAvail ? seriesStats(buffer.map(p => p.ioWriteBps)) : null;
  const netRxStats = netAvail ? seriesStats(buffer.map(p => p.rxBps)) : null;
  const netTxStats = netAvail ? seriesStats(buffer.map(p => p.txBps)) : null;

  const win = buffer.length;
  const streaming = !stale;

  return (
    <>
      <div className="players-toolbar" style={{ marginTop: 4 }}>
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

      <ChartHoverProvider>
      <div className="chart-grid" style={stale ? { opacity: 0.6 } : undefined}>
        <BriefCard className="chart-brief" icon="cpu"
          title={<>CPU {cpuAnoms.length > 0 && <AnomalyBadge count={cpuAnoms.length} />}</>}
          action={<span className="chart-card__val">{(latest.cpu ?? 0).toFixed(0)}<small>% core</small></span>}>
          <div className="chart-brief__body">
            <StatStrip items={cpuStats && [
              { label: "avg", value: cpuStats.avg.toFixed(0) + "%" },
              { label: "peak", value: cpuStats.max.toFixed(0) + "%" },
              { label: "min", value: cpuStats.min.toFixed(0) + "%" },
            ]} />
            <TimeSeriesChart range="live" times={times}
              series={[{ key: "cpu", label: "CPU", color: "var(--krystal-teal)", fill: true, values: cpu, fmt: v => v.toFixed(0) + "% core" }]}
              anomalies={cpuAnoms} yMin={0} height={120} />
          </div>
        </BriefCard>

        <BriefCard className="chart-brief" icon="hard-drive"
          title={<>Memory {memAnoms.length > 0 && <AnomalyBadge count={memAnoms.length} />}</>}
          action={<span className="chart-card__val">{fmtBytes(latest.memBytes)}</span>}>
          <div className="chart-brief__body">
            <StatStrip items={memStats && [
              { label: "avg", value: fmtBytes(memStats.avg) },
              { label: "peak", value: fmtBytes(memStats.max) },
              { label: "min", value: fmtBytes(memStats.min) },
            ]} />
            <TimeSeriesChart range="live" times={times}
              series={[{ key: "mem", label: "Memory", color: "#FBBF24", fill: true, values: mem, fmt: v => fmtBytes(v * memDiv) }]}
              anomalies={memAnoms} yMin={0} height={120} />
            <div className="chart-card__legend"><span>{memUnit} used · no per-server cap to chart against</span></div>
          </div>
        </BriefCard>

        <BriefCard className="chart-brief" icon="network"
          title={<>Disk I/O {ioAnoms.length > 0 && <AnomalyBadge count={ioAnoms.length} />}</>}
          action={ioAvail
            ? <span className="chart-card__val"><small style={{ marginRight: 6 }}>r</small>{fmtBps(latest.ioReadBps)}<small> / </small><small style={{ marginRight: 6 }}>w</small>{fmtBps(latest.ioWriteBps)}</span>
            : <span className="chart-card__val" style={{ color: "var(--fg-3)" }}>—</span>}>
          <div className="chart-brief__body">
            {ioAvail ? (
              <>
                <StatStrip items={[
                  ...(ioReadStats ? [{ label: "r peak", value: fmtBps(ioReadStats.max) }] : []),
                  ...(ioWriteStats ? [{ label: "w peak", value: fmtBps(ioWriteStats.max) }] : []),
                ]} />
                <TimeSeriesChart range="live" times={times}
                  series={[
                    { key: "r", label: "Read", color: "var(--info)", fill: false, values: ioRead, fmt: v => fmtBps(v * ioDiv) },
                    { key: "w", label: "Write", color: "var(--krystal-teal)", fill: false, values: ioWrite, fmt: v => fmtBps(v * ioDiv) },
                  ]}
                  anomalies={ioAnoms} yMin={0} height={120} />
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

        <BriefCard className="chart-brief" icon="arrow-down-up"
          title={<>Network {netAnoms.length > 0 && <AnomalyBadge count={netAnoms.length} />}</>}
          action={netAvail
            ? <span className="chart-card__val"><small style={{ marginRight: 6 }}>rx</small>{fmtBps(latest.rxBps)}<small> / </small><small style={{ marginRight: 6 }}>tx</small>{fmtBps(latest.txBps)}</span>
            : <span className="chart-card__val" style={{ color: "var(--fg-3)" }}>—</span>}>
          <div className="chart-brief__body">
            {netAvail ? (
              <>
                <StatStrip items={[
                  ...(netRxStats ? [{ label: "rx peak", value: fmtBps(netRxStats.max) }] : []),
                  ...(netTxStats ? [{ label: "tx peak", value: fmtBps(netTxStats.max) }] : []),
                ]} />
                <TimeSeriesChart range="live" times={times}
                  series={[
                    { key: "rx", label: "Receive", color: "var(--info)", fill: false, values: netRx, fmt: v => fmtBps(v * netDiv) },
                    { key: "tx", label: "Transmit", color: "var(--krystal-teal)", fill: false, values: netTx, fmt: v => fmtBps(v * netDiv) },
                  ]}
                  anomalies={netAnoms} yMin={0} height={120} />
                <div className="chart-card__legend">
                  <span><span className="swatch" style={{ background: "var(--info)" }}></span>Receive</span>
                  <span><span className="swatch" style={{ background: "var(--krystal-teal)" }}></span>Transmit</span>
                  <span style={{ marginLeft: "auto" }}>{netUnit}</span>
                </div>
              </>
            ) : (
              <div className="perf-nochart">
                <Icon name="info" size={16} strokeWidth={1.8} />
                <span>Network isn't measured for this server — no per-instance meter on its host (e.g. a container or an un-metered host).</span>
              </div>
            )}
          </div>
        </BriefCard>
      </div>
      </ChartHoverProvider>
    </>
  );
}

// ---- Historical metrics (M9 — fetch from the durable store) ----

function HistoricalMetrics({ server, range }) {
  const [data, setData] = React.useState(null);
  const [events, setEvents] = React.useState([]);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setEvents([]);
    const now = Date.now();
    setNowMs(now);
    const sinceIso = new Date(now - (RANGE_MS[range] || RANGE_MS["1h"])).toISOString();
    fetchServerMetricsHistory(server.id, range, server.hostId)
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e); setLoading(false); } });
    // Lifecycle markers are best-effort — a failure here must never break the charts.
    fetchServerEvents(server.id, server.hostId, sinceIso)
      .then(rows => { if (!cancelled) setEvents(rowsToEvents(rows)); })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, [server.id, server.hostId, range]);

  // One shared time domain [now-range, now] for all charts → the synced crosshair
  // and the event flags line up by wall-clock across CPU/Memory/Disk.
  const domain = [nowMs - (RANGE_MS[range] || RANGE_MS["1h"]), nowMs];

  if (loading) {
    return <EmptyPerf icon="line-chart" title="Loading history…" spin
      sub={`Fetching ${range} of metrics history.`} />;
  }
  if (error) {
    return <EmptyPerf icon="alert-triangle" title="Couldn't load history"
      sub={error.userMessage || error.message || "An error occurred."} />;
  }
  if (!data || !data.series || Object.keys(data.series).length === 0) {
    return <EmptyPerf icon="line-chart" title="No history available"
      sub="The metrics history store has no data for this server in this range. Data accumulates over time as the server runs." />;
  }

  const tier = data.tier;
  const isRollup = tier === "rollup";
  const step = data.step;

  const cpuSeries = data.series.cpuPctCore || [];
  const memSeries = data.series.memBytes || [];
  const ioReadSeries = data.series.ioReadBps || [];
  const ioWriteSeries = data.series.ioWriteBps || [];

  const cpuVals = cpuSeries.map(p => p.value);
  const cpuMin = isRollup ? cpuSeries.map(p => p.min ?? p.value) : null;
  const cpuMax = isRollup ? cpuSeries.map(p => p.max ?? p.value) : null;

  const memVals = memSeries.map(p => p.value);
  const memPeak = memVals.length ? Math.max(...memVals) : 0;
  const memUseGiB = memPeak >= GiB;
  const memDiv = memUseGiB ? GiB : MiB;
  const memUnit = memUseGiB ? "GiB" : "MiB";
  const mem = memVals.map(v => v / memDiv);
  const memMinBand = isRollup ? memSeries.map(p => (p.min ?? p.value) / memDiv) : null;
  const memMaxBand = isRollup ? memSeries.map(p => (p.max ?? p.value) / memDiv) : null;

  const ioAvail = ioReadSeries.length > 0 || ioWriteSeries.length > 0;
  const ioPeak = ioAvail
    ? Math.max(1, ...ioReadSeries.map(p => p.value || 0), ...ioWriteSeries.map(p => p.value || 0))
    : 1;
  const ioUseMiB = ioPeak >= MiB;
  const ioDiv = ioUseMiB ? MiB : KiB;
  const ioUnit = ioUseMiB ? "MiB/s" : "KiB/s";
  const ioRead = ioReadSeries.map(p => (p.value || 0) / ioDiv);
  const ioWrite = ioWriteSeries.map(p => (p.value || 0) / ioDiv);

  const cpuAnoms = detectAnomalies(cpuVals);
  const memAnoms = detectAnomalies(mem);

  // Real per-bucket timestamps (kept from the backend `ts`) for the hover tooltip,
  // and per-window stats (#2) over the raw values.
  const cpuTimes = cpuSeries.map(p => p.ts);
  const memTimes = memSeries.map(p => p.ts);
  const ioTimes  = (ioReadSeries.length ? ioReadSeries : ioWriteSeries).map(p => p.ts);
  const cpuStats = seriesStats(cpuVals);
  const memStats = seriesStats(memVals);
  const ioReadStats  = ioReadSeries.length ? seriesStats(ioReadSeries.map(p => p.value)) : null;
  const ioWriteStats = ioWriteSeries.length ? seriesStats(ioWriteSeries.map(p => p.value)) : null;

  return (
    <>
      <div className="players-toolbar" style={{ marginTop: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "var(--fg-3)" }}>
          <Icon name="clock" size={14} strokeWidth={1.8} />
          {tier === "rollup" ? `${step / 60}min avg` : `~${step}s samples`} · {range}
        </span>
        <span style={{ flex: 1 }}></span>
        <span style={{ color: "var(--fg-3)", fontSize: 12.5, fontFamily: "var(--font-mono)" }}>
          {cpuSeries.length} point{cpuSeries.length === 1 ? "" : "s"}
        </span>
      </div>

      <ChartHoverProvider>
      <div className="chart-grid">
        {cpuVals.length > 0 && (
          <BriefCard className="chart-brief" icon="cpu"
            title={<>CPU {cpuAnoms.length > 0 && <AnomalyBadge count={cpuAnoms.length} />}</>}
            action={<span className="chart-card__val">{cpuVals[cpuVals.length - 1].toFixed(0)}<small>% core</small></span>}>
            <div className="chart-brief__body">
              <StatStrip items={cpuStats && [
                { label: "avg", value: cpuStats.avg.toFixed(0) + "%" },
                { label: "peak", value: cpuStats.max.toFixed(0) + "%" },
                { label: "min", value: cpuStats.min.toFixed(0) + "%" },
              ]} />
              <TimeSeriesChart range={range} times={cpuTimes} domain={domain} events={events} stepSec={step}
                series={[{ key: "cpu", label: "CPU", color: "var(--krystal-teal)", fill: true, values: cpuVals, fmt: v => v.toFixed(0) + "% core" }]}
                anomalies={cpuAnoms} yMin={0} height={120}
                band={cpuMin && cpuMax ? { min: cpuMin, max: cpuMax, color: "var(--krystal-teal)" } : undefined} />
              {isRollup && <div className="chart-card__legend"><span style={{ color: "var(--fg-4)", fontSize: 11 }}>shaded band = min/max per bucket</span></div>}
            </div>
          </BriefCard>
        )}

        {mem.length > 0 && (
          <BriefCard className="chart-brief" icon="hard-drive"
            title={<>Memory {memAnoms.length > 0 && <AnomalyBadge count={memAnoms.length} />}</>}
            action={<span className="chart-card__val">{fmtBytes(memVals[memVals.length - 1])}</span>}>
            <div className="chart-brief__body">
              <StatStrip items={memStats && [
                { label: "avg", value: fmtBytes(memStats.avg) },
                { label: "peak", value: fmtBytes(memStats.max) },
                { label: "min", value: fmtBytes(memStats.min) },
              ]} />
              <TimeSeriesChart range={range} times={memTimes} domain={domain} events={events} stepSec={step}
                series={[{ key: "mem", label: "Memory", color: "#FBBF24", fill: true, values: mem, fmt: v => fmtBytes(v * memDiv) }]}
                anomalies={memAnoms} yMin={0} height={120}
                band={memMinBand && memMaxBand ? { min: memMinBand, max: memMaxBand, color: "#FBBF24" } : undefined} />
              <div className="chart-card__legend"><span>{memUnit} used</span>
                {isRollup && <span style={{ color: "var(--fg-4)", fontSize: 11, marginLeft: 8 }}>band = min/max</span>}
              </div>
            </div>
          </BriefCard>
        )}

        {ioAvail && (
          <BriefCard className="chart-brief" icon="network" title="Disk I/O"
            action={<span className="chart-card__val">
              <small style={{ marginRight: 6 }}>r</small>{fmtBps(ioReadSeries.length ? ioReadSeries[ioReadSeries.length - 1].value : null)}
              <small> / </small>
              <small style={{ marginRight: 6 }}>w</small>{fmtBps(ioWriteSeries.length ? ioWriteSeries[ioWriteSeries.length - 1].value : null)}
            </span>}>
            <div className="chart-brief__body">
              <StatStrip items={[
                ...(ioReadStats ? [{ label: "r peak", value: fmtBps(ioReadStats.max) }] : []),
                ...(ioWriteStats ? [{ label: "w peak", value: fmtBps(ioWriteStats.max) }] : []),
              ]} />
              <TimeSeriesChart range={range} times={ioTimes} domain={domain} events={events} stepSec={step}
                series={[
                  { key: "r", label: "Read", color: "var(--info)", fill: false, values: ioRead, fmt: v => fmtBps(v * ioDiv) },
                  { key: "w", label: "Write", color: "var(--krystal-teal)", fill: false, values: ioWrite, fmt: v => fmtBps(v * ioDiv) },
                ]}
                yMin={0} height={120} />
              <div className="chart-card__legend">
                <span><span className="swatch" style={{ background: "var(--info)" }}></span>Read</span>
                <span><span className="swatch" style={{ background: "var(--krystal-teal)" }}></span>Write</span>
                <span style={{ marginLeft: "auto" }}>{ioUnit}</span>
              </div>
            </div>
          </BriefCard>
        )}
      </div>
      </ChartHoverProvider>
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
