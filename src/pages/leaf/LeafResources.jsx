// LeafResources — one leaf's recorded CPU / memory / disk-I/O, on the System tab beside the facts.
//
// kgsm-monitor samples every running leaf's cgroup the same way it samples a game server's and persists
// it under its own entity kind, so this is the server Performance tab's historical view pointed at a
// different entity — same fetch shape, same chart grid, same range selector. Nothing about a leaf's
// numbers needed its own chart.
//
// HISTORY ONLY, on purpose. The facts above are live (the services board refreshes them), and the charts
// read the durable store at the monitor's persist cadence. There is no live per-leaf tick to subscribe
// to, and a "live" range that quietly replayed the last recorded points would be claiming a feed that
// isn't there.

import React from "react";

import { Icon } from "../../components/Icon.jsx";
import { ChartHoverProvider } from "../../components/TimeSeriesChart.jsx";
import { fetchLeafMetricsHistory } from "../../lib/stores.js";
import { MetricsChartGrid } from "../performance/MetricsChartGrid.jsx";
import { EmptyPerf, RangeSelector } from "../performance/PerfCards.jsx";
import { HISTORY_RANGES, RANGE_MS, fmtZoomRange } from "../performance/perfHelpers.js";

function LeafResources({ hostId, leafId, running, onDemand }) {
  const [range, setRange] = React.useState("1h");
  const [data, setData] = React.useState(null);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [zoom, setZoom] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (!hostId || !leafId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setZoom(null);            // a new range or leaf resets any zoom
    setNowMs(Date.now());
    fetchLeafMetricsHistory(hostId, leafId, range).then(
      (d) => { if (!cancelled) { setData(d); setLoading(false); } },
      (e) => { if (!cancelled) { setError(e); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [hostId, leafId, range]);

  // One shared time domain across every chart, so the crosshair lines up by wall-clock.
  const domain = [nowMs - (RANGE_MS[range] || RANGE_MS["1h"]), nowMs];
  const series = (data && data.series) || null;
  const hasSeries = series && Object.keys(series).length > 0;
  const pointCount = (series && series.cpuPctCore ? series.cpuPctCore.length : 0);

  return (
    <div className="leaf-res">
      <div className="players-toolbar">
        <span className="leaf-res__title">
          <Icon name="line-chart" size={14} strokeWidth={1.9} />
          Resource history
        </span>
        <span style={{ flex: 1 }}></span>
        {hasSeries && (
          <span className="leaf-res__meta">
            {data.tier === "rollup" ? `${data.step / 60}min avg` : `~${data.step}s samples`} · {pointCount} point{pointCount === 1 ? "" : "s"}
          </span>
        )}
        {/* History windows only — there is no per-leaf metrics tick to subscribe to, so a Live button
            here could only re-read the store and call it live. */}
        <RangeSelector range={range} setRange={setRange} ranges={HISTORY_RANGES} />
      </div>

      {zoom && (
        <button className="perf-zoom-pill" onClick={() => setZoom(null)} title="Reset zoom (or double-click a chart)">
          <Icon name="zoom-in" size={12} strokeWidth={2} />
          {fmtZoomRange(zoom)}
          <Icon name="x" size={12} strokeWidth={2.2} />
        </button>
      )}

      {loading && <EmptyPerf icon="line-chart" title="Loading history…" spin sub={`Fetching ${range} of recorded metrics.`} />}

      {!loading && error && (
        <EmptyPerf icon="alert-triangle" title="Couldn’t load history"
          sub={error.userMessage || error.message || "An error occurred."} />
      )}

      {/* Nothing recorded is one state with three honest readings. A running leaf with no rows simply
          hasn't accrued history yet. A leaf that is down has nothing TO record — but "down" means two
          different things: a socket-activated leaf is RESTING, which the facts card above is at pains to
          say is not a fault, so calling it stopped here would contradict the same page one card up. */}
      {!loading && !error && !hasSeries && (
        running
          ? <EmptyPerf icon="line-chart" title="No history yet"
              sub="Nothing recorded for this leaf in this range. Data accrues as the monitor samples it — a leaf that just started, or a host whose monitor doesn’t sample leaves, has none." />
          : onDemand
            ? <EmptyPerf icon="power-off" title="Idle — nothing to record"
                sub="This leaf starts on demand and exits when idle, so it uses no resources at rest. Anything measured while it last ran is in a longer range." />
            : <EmptyPerf icon="power-off" title="Not running"
                sub="A stopped leaf has no resource usage to record. Pick a longer range to see what was measured while it last ran." />
      )}

      {!loading && !error && hasSeries && (
        <ChartHoverProvider zoom={zoom} onZoom={setZoom}>
          {/* network={false}: a leaf has no per-instance meter by design (the eBPF meter is attached to
              kgsm.slice and never sees a unit in system.slice), so there is no empty card to show. */}
          <MetricsChartGrid series={series} tier={data.tier} step={data.step}
            range={range} domain={domain} network={false} />
        </ChartHoverProvider>
      )}
    </div>
  );
}

export { LeafResources };
