import React from "react";

// TimeSeriesChart — bare-SVG multi-series line chart with optional fill,
// grid lines, anomaly bands, a comparison series (dashed), and a "current
// value" dot at the rightmost point.
//
// props.series    : [{ key, color, fill?, values: number[] }]
// props.compare   : optional { label, values: number[] }  — drawn as a
//                   faded dashed line behind the main series.
// props.anomalies : optional [{ start, end, peakIdx, peakValue, ... }]
//                   — windows highlighted in a soft amber band on the chart.
// props.height    : px
// props.range     : "1h" | "24h" | "7d" | "30d"
// props.yMin / yMax : optional bounds; auto-computed if missing

function TimeSeriesChart({ series, height = 120, range = "24h", yMin, yMax, yLabel, anomalies, compare }) {
  const W = 600;
  const H = height;
  const padL = 30, padR = 12, padT = 8, padB = 22;

  const allVals = series.flatMap(s => s.values).concat(compare?.values || []);
  const min = yMin != null ? yMin : Math.min(...allVals, 0);
  const max = yMax != null ? yMax : Math.max(...allVals, 1);
  const span = (max - min) || 1;

  const N = series[0]?.values.length || 0;
  const sx = (i) => padL + (i / Math.max(1, N - 1)) * (W - padL - padR);
  const sy = (v) => padT + (1 - (v - min) / span) * (H - padT - padB);

  const gridYs = [0, 0.5, 1].map(p => padT + p * (H - padT - padB));

  const xTicks = {
    "1h":  [{ i: 0, l: "-60m" }, { i: 0.25, l: "-45" }, { i: 0.5, l: "-30" }, { i: 0.75, l: "-15" }, { i: 1, l: "now" }],
    "24h": [{ i: 0, l: "-24h" }, { i: 0.25, l: "-18" }, { i: 0.5, l: "-12" }, { i: 0.75, l: "-6" }, { i: 1, l: "now" }],
    "7d":  [{ i: 0, l: "-7d" },  { i: 0.5, l: "-3d" },  { i: 1, l: "now" }],
    "30d": [{ i: 0, l: "-30d" }, { i: 0.5, l: "-15d" }, { i: 1, l: "now" }],
  }[range] || [];

  const fmtY = (v) => {
    if (max > 1000) return Math.round(v) + "";
    if (max > 100)  return v.toFixed(0);
    return v.toFixed(1);
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }} preserveAspectRatio="none">
      {/* Anomaly bands — drawn under everything else as soft amber rectangles
          marking the time windows where the metric crossed the threshold. */}
      {anomalies && anomalies.map((a, i) => {
        const x1 = sx(a.start);
        const x2 = sx(a.end);
        return (
          <rect key={"an" + i}
            x={x1} y={padT}
            width={Math.max(2, x2 - x1)}
            height={H - padT - padB}
            fill="var(--warning)" opacity="0.13" />
        );
      })}

      {/* Gridlines + Y labels */}
      {gridYs.map((y, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--border-subtle)" strokeWidth="1" />
          <text x={padL - 6} y={y + 3} fill="var(--fg-4)" fontSize="9" fontFamily="var(--font-mono)" textAnchor="end">
            {fmtY(min + (1 - (y - padT) / (H - padT - padB)) * span)}
          </text>
        </g>
      ))}

      {/* X labels */}
      {xTicks.map((t, i) => (
        <text key={i}
          x={padL + t.i * (W - padL - padR)}
          y={H - 6}
          fill="var(--fg-4)" fontSize="9" fontFamily="var(--font-mono)"
          textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>
          {t.l}
        </text>
      ))}

      {/* Comparison series — dashed, faded, sits below the main line. */}
      {compare && compare.values && (() => {
        const d = compare.values
          .map((v, i) => `${i === 0 ? "M" : "L"} ${sx(i)} ${sy(v)}`)
          .join(" ");
        return (
          <path d={d}
            fill="none"
            stroke="var(--fg-3)"
            strokeWidth="1.2"
            strokeDasharray="3 4"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.6" />
        );
      })()}

      {/* Series — fills first so they sit under the lines */}
      {series.map((s, idx) => {
        if (!s.fill) return null;
        const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"} ${sx(i)} ${sy(v)}`).join(" ")
          + ` L ${sx(N - 1)} ${sy(min)} L ${sx(0)} ${sy(min)} Z`;
        return <path key={"fill-" + idx} d={d} fill={s.color} opacity="0.12" />;
      })}
      {series.map((s, idx) => {
        const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"} ${sx(i)} ${sy(v)}`).join(" ");
        return <path key={"ln-" + idx} d={d} fill="none" stroke={s.color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />;
      })}

      {/* Current-value dot on the last point */}
      {series.map((s, idx) => {
        const v = s.values[s.values.length - 1];
        return (
          <circle key={"dot-" + idx} cx={sx(N - 1)} cy={sy(v)} r="3.5"
            fill={s.color} stroke="var(--surface-1)" strokeWidth="2" />
        );
      })}
    </svg>
  );
}

// detectAnomalies — robust z-score over the visible window. Marks any
// point > (mean + sigma·std) for at least `minRun` consecutive points.
// Returns an array of windows {start, end, peakIdx, peakValue, mean, std, threshold}.
function detectAnomalies(values, opts = {}) {
  const { sigma = 2, minRun = 2 } = opts;
  if (!values || values.length < 5) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  // Flat-ish series — nothing to flag.
  if (std < Math.max(0.5, mean * 0.04)) return [];
  const threshold = mean + sigma * std;
  const out = [];
  let run = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > threshold) {
      if (!run) run = { start: i, end: i, peakIdx: i, peakValue: values[i] };
      else {
        run.end = i;
        if (values[i] > run.peakValue) { run.peakIdx = i; run.peakValue = values[i]; }
      }
    } else if (run) {
      if (run.end - run.start + 1 >= minRun) out.push({ ...run, mean, std, threshold });
      run = null;
    }
  }
  if (run && run.end - run.start + 1 >= minRun) out.push({ ...run, mean, std, threshold });
  return out;
}

// Tiny sparkline used in dashboard server tiles. No labels, just the line.
function Sparkline({ values, color = "var(--krystal-teal)", height = 28 }) {
  const W = 200, H = height, padY = 3;
  const min = Math.min(...values), max = Math.max(...values);
  const span = (max - min) || 1;
  const N = values.length;
  const sx = (i) => (i / Math.max(1, N - 1)) * W;
  const sy = (v) => padY + (1 - (v - min) / span) * (H - padY * 2);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"} ${sx(i)} ${sy(v)}`).join(" ");
  const fillD = d + ` L ${sx(N - 1)} ${H} L 0 ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block" }}>
      <path d={fillD} fill={color} opacity="0.14" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export { Sparkline, TimeSeriesChart, detectAnomalies };
