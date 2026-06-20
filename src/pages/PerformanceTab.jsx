import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { serverMetricsFreshness } from "../components/HostCardBody.jsx";
import { Icon } from "../components/Icon.jsx";
import { TimeSeriesChart, detectAnomalies } from "../components/TimeSeriesChart.jsx";
import { KRYSTAL_DATA } from "../lib/data.js";

// PerformanceTab — time-series metrics for one server, plus z-score
// anomaly detection surfaced as inline chart markers, and an optional
// comparison series ("vs last week" etc.) rendered as a dashed line under the
// main one. Below the charts sits the server's live Alerts feed (the shared
// NeedsAttention card, scoped to this server) so the operator sees what the
// platform has actually flagged for this game server, not just statistical
// spikes.
//
// Detection rule: any point > mean + 2σ over the visible window for ≥ 2
// consecutive points. Cheap, robust to scale, no per-metric tuning. See
// detectAnomalies() in TimeSeriesChart.jsx.

// Generate a comparison series for the same length, deterministically.
// In production this is just `?compare=last-week` on the metrics endpoint —
// the backend returns the matching shape from the prior period. Here we
// reproduce that vibe with a different seed + a mild scale tilt so the
// comparison line visibly differs without being obviously synthetic.
function genCompare(seed, length, scale = 0.9) {
  let s = seed;
  const r = () => { s = (s * 9301 + 49297) % 233280 / 233280; return s; };
  const out = [];
  let v = 40 * scale;
  for (let i = 0; i < length; i++) {
    v += (r() - 0.5) * 8;
    v = Math.max(8, Math.min(85, v));
    out.push(v);
  }
  return out;
}

function PerformanceTab({ server, onAsk }) {
  const [range, setRange] = React.useState("24h");
  const [compareTo, setCompareTo] = React.useState("off");
  const [live, setLive] = React.useState(false);
  const baseMetrics = KRYSTAL_DATA.metricsByServer[server.id];

  // Live mode: tail-window simulation. Every ~1.5s a new point is appended
  // and the oldest is dropped. New points are nudged from the prior value
  // so the line stays continuous. In production this is a WebSocket / SSE
  // stream from `${API_BASE}/servers/{id}/metrics/stream`.
  const [tail, setTail] = React.useState(null);
  React.useEffect(() => {
    if (!live || !baseMetrics) { setTail(null); return; }
    setTail(baseMetrics);
    const tick = () => {
      setTail(prev => {
        if (!prev) return prev;
        const last = prev[prev.length - 1];
        const jitter = (key, max = 100, step = 6) =>
          Math.max(0, Math.min(max, last[key] + (Math.random() - 0.5) * step));
        const next = {
          cpu:          jitter("cpu", 100, 12),
          ram_pct:      jitter("ram_pct", 100, 3),
          players:      Math.max(0, Math.min(server.players.max, last.players + (Math.random() < 0.15 ? (Math.random() < 0.5 ? -1 : 1) : 0))),
          tick_ms:      jitter("tick_ms", 50, 1.4),
          disk_pct:     jitter("disk_pct", 100, 0.4),
          net_in_kbps:  Math.round(jitter("net_in_kbps", 9999, 40)),
          net_out_kbps: Math.round(jitter("net_out_kbps", 9999, 80)),
        };
        return [...prev.slice(1), next];
      });
    };
    const id = setInterval(tick, 1500);
    return () => clearInterval(id);
  }, [live, server.id, baseMetrics]);
  const metrics = tail || baseMetrics;

  // Host metrics feed down → the charts can't be live, regardless of any cached
  // series. Show the last-known feed state, matching the host diagnostics.
  const mFresh = serverMetricsFreshness ? serverMetricsFreshness(server) : null;
  if (mFresh && mFresh.frozen) {
    return (
      <div className="perf-feed-down">
        <span className="perf-feed-down__icon"><Icon name="power-off" size={26} strokeWidth={1.9} /></span>
        <div className="perf-feed-down__title">Live metrics unavailable</div>
        <div className="perf-feed-down__sub">
          {mFresh.message || "This server’s host stopped reporting metrics."}{" "}
          Last reading {mFresh.label || "a while ago"} — the charts resume when the feed returns.
        </div>
        <span className="perf-feed-down__tag">
          <span className="status-led status-led--down"></span> no signal{mFresh.label ? " · " + mFresh.label : ""}
        </span>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-lg)", padding: 60, textAlign: "center", color: "var(--fg-3)" }}>
        <Icon name="line-chart" size={28} />
        <div style={{ marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>No metrics yet</div>
        <div style={{ marginTop: 4, fontSize: 13 }}>
          {server.status === "offline" ? "Start the server and we'll begin collecting metrics." : "Metrics are collected every minute. Check back shortly."}
        </div>
      </div>
    );
  }

  const last = metrics[metrics.length - 1];
  const cpu      = metrics.map(m => m.cpu);
  const ram      = metrics.map(m => m.ram_pct);
  const disk     = metrics.map(m => m.disk_pct);
  const netIn    = metrics.map(m => m.net_in_kbps);
  const netOut   = metrics.map(m => m.net_out_kbps);
  const N = metrics.length;

  // Compare series — generated only when a comparison is active.
  const compareLabel = { off: null, "1h": "last hour", "24h": "yesterday", "7d": "last week", "30d": "last month" }[compareTo];
  const compareSeed = { "1h": 0.21, "24h": 0.42, "7d": 0.71, "30d": 0.91 }[compareTo] || 0.5;
  const makeCompare = (active) => active ? { label: compareLabel, values: genCompare(compareSeed + (active.length / 137), N, 0.85) } : null;
  const compareSeries = compareLabel ? {
    cpu:    makeCompare("cpu"),
    ram:    makeCompare("ram"),
    disk:   makeCompare("disk"),
    netIn:  makeCompare("netin"),
    netOut: makeCompare("netout"),
  } : { cpu: null, ram: null, disk: null, netIn: null, netOut: null };

  // Metrics worth flagging anomalies on (high = bad). Players going up is
  // good; we deliberately omit it.
  const ANOMALY_DEFS = [
    { key: "cpu",  label: "CPU",         icon: "cpu",        unit: "%",    decimals: 0, values: cpu },
    { key: "ram",  label: "Memory",      icon: "hard-drive", unit: "%",    decimals: 0, values: ram },
    { key: "net",  label: "Network out", icon: "network",    unit: " kbps",decimals: 0, values: netOut },
  ];
  // Anomalies per metric (high = bad). Players going up is good → omitted.
  // Plain computation (not useMemo) so no hook runs after the early `!metrics`
  // return above — keeps the hook order stable across servers with/without data.
  const allAnomalies = ANOMALY_DEFS.flatMap(def => detectAnomalies(def.values).map(a => ({ ...a, metric: def })));
  const cpuAnoms  = allAnomalies.filter(a => a.metric.key === "cpu");
  const ramAnoms  = allAnomalies.filter(a => a.metric.key === "ram");
  const netAnoms  = allAnomalies.filter(a => a.metric.key === "net");

  const ranges = ["1h", "24h", "7d", "30d"];

  return (
    <>
      <div className="players-toolbar">
        <div className="range-tabs">
          {ranges.map(r => (
            <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>

        <span style={{ flex: 1 }}></span>
        <span style={{ color: "var(--fg-3)", fontSize: 12.5, fontFamily: "var(--font-mono)" }}>
          {live ? "streaming" : "sampled every " + (range === "1h" ? "75s" : range === "24h" ? "30m" : range === "7d" ? "3.5h" : "15h")}
        </span>
      </div>

      <div className="chart-grid">
        <BriefCard
          className="chart-brief"
          icon="cpu"
          title={<>CPU {cpuAnoms.length > 0 && <AnomalyBadge count={cpuAnoms.length} />}</>}
          action={<span className="chart-card__val">{last.cpu.toFixed(0)}<small>%</small></span>}>
          <div className="chart-brief__body">
            <TimeSeriesChart
              range={range}
              series={[{ key: "cpu", color: "var(--krystal-teal)", fill: true, values: cpu }]}
              anomalies={cpuAnoms}
              compare={compareSeries.cpu}
              yMin={0} yMax={100} height={120} />
            <CompareLegend compareLabel={compareLabel} />
          </div>
        </BriefCard>

        <BriefCard
          className="chart-brief"
          icon="hard-drive"
          title={<>RAM {ramAnoms.length > 0 && <AnomalyBadge count={ramAnoms.length} />}</>}
          action={<span className="chart-card__val">{last.ram_pct.toFixed(0)}<small>%</small></span>}>
          <div className="chart-brief__body">
            <TimeSeriesChart
              range={range}
              series={[{ key: "ram", color: "#FBBF24", fill: true, values: ram }]}
              anomalies={ramAnoms}
              compare={compareSeries.ram}
              yMin={0} yMax={100} height={120} />
            <CompareLegend compareLabel={compareLabel} />
          </div>
        </BriefCard>

        <BriefCard
          className="chart-brief"
          icon="database"
          title="Disk usage"
          action={<span className="chart-card__val">{last.disk_pct.toFixed(0)}<small>%</small></span>}>
          <div className="chart-brief__body">
            <TimeSeriesChart
              range={range}
              series={[{ key: "disk", color: "#FB923C", fill: true, values: disk }]}
              compare={compareSeries.disk}
              yMin={0} yMax={100} height={120} />
            <CompareLegend compareLabel={compareLabel} />
          </div>
        </BriefCard>

        <BriefCard
          className="chart-brief"
          icon="network"
          title={<>Network {netAnoms.length > 0 && <AnomalyBadge count={netAnoms.length} />}</>}
          action={
            <span className="chart-card__val">
              <small style={{ marginRight: 6 }}>in</small>{last.net_in_kbps}<small> / </small>
              <small style={{ marginRight: 6 }}>out</small>{last.net_out_kbps}<small>kbps</small>
            </span>
          }>
          <div className="chart-brief__body">
            <TimeSeriesChart
              range={range}
              series={[
                { key: "in",  color: "var(--info)",        fill: false, values: netIn },
                { key: "out", color: "var(--krystal-teal)", fill: false, values: netOut },
              ]}
              anomalies={netAnoms}
              compare={compareSeries.netOut}
              yMin={0} height={120} />
            <div className="chart-card__legend">
              <span><span className="swatch" style={{ background: "var(--info)" }}></span>Inbound</span>
              <span><span className="swatch" style={{ background: "var(--krystal-teal)" }}></span>Outbound</span>
              {compareLabel && (
                <span style={{ marginLeft: "auto" }}>
                  <span className="swatch swatch--dashed"></span>{compareLabel}
                </span>
              )}
            </div>
          </div>
        </BriefCard>
      </div>
    </>
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

function CompareLegend({ compareLabel }) {
  if (!compareLabel) return null;
  return (
    <div className="chart-card__legend">
      <span><span className="swatch swatch--dashed"></span>vs {compareLabel}</span>
    </div>
  );
}

export { PerformanceTab };
