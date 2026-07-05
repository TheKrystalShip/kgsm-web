import React from "react";
import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Modal } from "../../components/Modal.jsx";
import { TimeSeriesChart, ChartHoverProvider } from "../../components/TimeSeriesChart.jsx";
import { RANGES } from "./perfHelpers.js";

// Presentational building blocks for the Performance tab, extracted from
// PerformanceTab.jsx (#8). All are stateless-ish view pieces the two data views
// (Live / Historical) render; MetricChartCard owns per-card transient view state
// (expand / log-scale / series-mute) only.

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

function AnomalyBadge({ count }) {
  return (
    <span className="chart-card__anomaly-badge" title={count + " anomaly window" + (count > 1 ? "s" : "")}>
      <Icon name="alert-triangle" size={10} strokeWidth={2.4} />
      {count}
    </span>
  );
}

// MetricChartCard — one Performance chart card with the #5 polish folded in:
//   • single-chart full-screen pop-out (portal to <body>, Esc/scrim close — the
//     same pattern as the console card), so a chart can be read big;
//   • a log-scale toggle (opt-in via allowLog) for the order-of-magnitude metrics
//     (Disk I/O / Network), so an idle baseline survives next to a spike;
//   • clickable legend series-toggles on the dual-series cards (mute Read to focus
//     on Write); hiding rescales to what's left, never hides every series.
// All three are per-card transient view state; the card body is rendered by one
// `body(big)` used both inline and in the full-screen portal so the state is shared.
function MetricChartCard({
  icon, title, anomalyCount = 0, value, stats, series, unit, legendNote, empty,
  allowLog = false, range, times, domain, events, stepSec, anomalies, band, yMin = 0,
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [logScale, setLogScale] = React.useState(false);
  const [hidden, setHidden] = React.useState(() => new Set());
  const [fsZoom, setFsZoom] = React.useState(null);   // full-screen-local zoom (own provider)

  // Collapsing drops the full-screen-local zoom; Escape-to-close is handled by Modal.
  React.useEffect(() => { if (!expanded) setFsZoom(null); }, [expanded]);

  const multi = series && series.length > 1;
  const toggleSeries = (key) => setHidden(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    if (next.size >= series.length) return new Set();   // never hide every series → reset
    return next;
  });
  const visible = series ? series.filter(s => !hidden.has(s.key)) : series;

  const controls = !empty && (
    <span className="chart-card__ctrls">
      {allowLog && (
        <button type="button" className={"chart-ctrl chart-ctrl--text" + (logScale ? " on" : "")}
          title={logScale ? "Switch to linear scale" : "Switch to log scale"} onClick={() => setLogScale(v => !v)}>log</button>
      )}
      <button type="button" className="chart-ctrl"
        title={expanded ? "Close full screen (Esc)" : "Full screen"} onClick={() => setExpanded(v => !v)}>
        <Icon name={expanded ? "minimize-2" : "maximize-2"} size={13} strokeWidth={2} />
      </button>
    </span>
  );

  const body = (big) => (
    <div className="chart-brief__body">
      {empty ? empty : (
        <>
          <StatStrip items={stats} />
          <TimeSeriesChart range={range} times={times} domain={domain} events={events} stepSec={stepSec}
            series={visible} anomalies={anomalies} band={band} yMin={yMin}
            yScale={logScale ? "log" : "linear"} height={big ? 380 : 120} />
          {multi ? (
            <div className="chart-card__legend">
              {series.map(s => (
                <button key={s.key} type="button"
                  className={"chart-legend-btn" + (hidden.has(s.key) ? " off" : "")}
                  onClick={() => toggleSeries(s.key)} title={hidden.has(s.key) ? "Show " + s.label : "Hide " + s.label}>
                  <span className="swatch" style={{ background: s.color }}></span>{s.label}
                </button>
              ))}
              <span style={{ marginLeft: "auto" }}>{unit}{logScale ? " · log" : ""}</span>
            </div>
          ) : (legendNote && (
            <div className="chart-card__legend"><span>{legendNote}{logScale ? " · log scale" : ""}</span></div>
          ))}
        </>
      )}
    </div>
  );

  const card = (big) => (
    <BriefCard className="chart-brief" icon={icon}
      title={<>{title} {anomalyCount > 0 && <AnomalyBadge count={anomalyCount} />}</>}
      action={<span className="chart-card__head-right">{controls}{value}</span>}>
      {body(big)}
    </BriefCard>
  );

  return (
    <>
      {expanded ? (
        <div className="chart-brief chart-brief--placeholder">
          <Icon name="maximize-2" size={20} strokeWidth={1.6} />
          <span>{title} is in full screen.</span>
          <button type="button" className="chart-ctrl chart-ctrl--text" onClick={() => setExpanded(false)}>
            <Icon name="minimize-2" size={12} /> Restore
          </button>
        </div>
      ) : card(false)}
      {expanded && (
        <Modal onClose={() => setExpanded(false)} scrimClassName="chart-modal-scrim">
          <div className="chart-modal" role="dialog" aria-modal="true"
            aria-label={typeof title === "string" ? title : "Chart"}>
            <ChartHoverProvider zoom={fsZoom} onZoom={range !== "live" ? setFsZoom : undefined}>
              {card(true)}
            </ChartHoverProvider>
          </div>
        </Modal>
      )}
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

export { StatStrip, AnomalyBadge, MetricChartCard, RangeSelector, EmptyPerf };
