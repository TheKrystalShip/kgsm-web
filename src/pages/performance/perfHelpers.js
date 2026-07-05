// perfHelpers — pure constants + formatters for the Performance tab. No React.
// Extracted from PerformanceTab.jsx (#8 big-file split) so the tab file keeps
// only its two stateful views (Live / Historical) + the orchestrator.

export const BUFFER_CAP = 150;
export const STALE_MS   = 10000;
export const NO_SOURCE_MS = 9000;

export const RANGES = [
  { key: "live", label: "Live" },
  { key: "1h",   label: "1h" },
  { key: "24h",  label: "24h" },
  { key: "7d",   label: "7d" },
  { key: "30d",  label: "30d" },
];

export const RANGE_MS = { "1h": 3600e3, "24h": 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3 };

// Lifecycle audit actions worth pinning to the metrics timeline (#3). Tone matches
// the audit log's vocabulary; the label is terse for a chart flag.
export const EVENT_META = {
  "server.start":   { label: "Started",   tone: "success" },
  "server.stop":    { label: "Stopped",   tone: "danger"  },
  "server.restart": { label: "Restarted", tone: "update"  },
  "server.crash":   { label: "Crashed",   tone: "danger"  },
  "server.update":  { label: "Updated",   tone: "info"    },
  "server.install": { label: "Installed", tone: "success" },
};
export function rowsToEvents(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(r => r && EVENT_META[r.action])
    .map(r => ({ t: Date.parse(r.ts), ...EVENT_META[r.action] }))
    .filter(e => isFinite(e.t));
}

export const KiB = 1024, MiB = 1024 * 1024, GiB = 1024 * 1024 * 1024;

export function fmtBytes(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n >= GiB) return (n / GiB).toFixed(2) + " GiB";
  if (n >= MiB) return (n / MiB).toFixed(1) + " MiB";
  if (n >= KiB) return (n / KiB).toFixed(0) + " KiB";
  return Math.round(n) + " B";
}
export function fmtBps(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n >= MiB) return (n / MiB).toFixed(1) + " MiB/s";
  if (n >= KiB) return (n / KiB).toFixed(0) + " KiB/s";
  return Math.round(n) + " B/s";
}

// Summary stats over the visible window (#2). Nulls are skipped, never coerced
// to 0 — an all-null window has no honest avg/peak, so the strip is omitted.
export function seriesStats(vals) {
  let mn = Infinity, mx = -Infinity, sum = 0, n = 0;
  for (const v of vals) {
    if (v == null || !isFinite(v)) continue;
    if (v < mn) mn = v; if (v > mx) mx = v; sum += v; n++;
  }
  return n ? { min: mn, max: mx, avg: sum / n } : null;
}

// Compact "HH:MM–HH:MM" (or with date across days) for the zoom-window pill.
export function fmtZoomRange([ms0, ms1]) {
  const p2 = n => String(n).padStart(2, "0");
  const multiDay = (ms1 - ms0) > 86400e3 || new Date(ms0).getDate() !== new Date(ms1).getDate();
  const f = ms => {
    const d = new Date(ms);
    const t = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    return multiDay ? `${d.toLocaleString(undefined, { month: "short" })} ${d.getDate()} ${t}` : t;
  };
  return f(ms0) + "–" + f(ms1);
}
