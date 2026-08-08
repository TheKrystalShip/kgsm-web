// MonitorOverview — is the recorder actually recording, and is it keeping what it was told to keep.
//
// Every other surface in the panel consumes this leaf's output. This page is the only one that asks
// whether the output is trustworthy, and it does that with two comparisons the daemon can make but no
// consumer can:
//
//   * the sample cadence it was configured with, against how old the newest frame actually is;
//   * the retention window it was configured with, against the span its store measurably holds.
//
// The second is the reason this page exists. Retention is an intent, and it diverges from reality for
// ordinary reasons — the daemon was down, the store is younger than its window, a retention change
// hasn't been swept yet — but it also diverges when maintenance has quietly stopped running, which is
// invisible everywhere else until a 30-day query returns a week. Both figures are on the wire and both
// are shown; this file compares them and never reconciles them.
//
// Coverage is counted off the newest frame, not off configuration, so an enabled source finding nothing
// and a source that is switched off are told apart by the flag beside the count.

import { BriefCard } from "../../components/BriefCard.jsx";
import { KPI } from "../../components/KPI.jsx";
import { fmtBytes, fmtRelative } from "../../lib/formatting.js";
import { fetchLeafMonitorStats } from "../../lib/stores.js";
import {
  LeafBriefEmpty, LeafBriefItem, LeafFacts, LeafLoading, LeafUnreadable, useLeafResource,
} from "./leafOverviewKit.jsx";

// Often enough that the frame-age reading stays honest, rare enough that an open tab isn't hammering a
// SQLite aggregate. Everything else on this page moves far more slowly than this.
const FRESHNESS_POLL_MS = 10_000;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// A duration in the coarsest unit that still says something. Used for spans measured in the store,
// where "1.9d" is more useful than "45h" and far more useful than a raw millisecond count.
function fmtSpan(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return Math.round(ms / 1000) + "s";
  if (ms < HOUR_MS) return Math.round(ms / 60_000) + "m";
  if (ms < DAY_MS) return (ms / HOUR_MS).toFixed(1) + "h";
  return (ms / DAY_MS).toFixed(1) + "d";
}

// How the measured span reads against the window it was configured with. Deliberately three-valued and
// deliberately forgiving below the window: a store that has been collecting for an hour is not failing
// to retain 24 hours, so only a span in real excess of the window is called out — that one means the
// prune half of maintenance is not running.
function retentionVerdict(spanMs, windowMs) {
  if (spanMs == null || !windowMs) return { tone: "muted", note: null };
  if (spanMs > windowMs * 1.25) {
    return {
      tone: "warn",
      note: "The store holds MORE than the configured window — rows past the cutoff aren’t being pruned, "
        + "which means the maintenance pass isn’t completing.",
    };
  }
  if (spanMs < windowMs * 0.5) {
    return {
      tone: "muted",
      note: "The store holds less than its window. That is normal for a store younger than the window, "
        + "or after downtime — gaps are honest here, never backfilled.",
    };
  }
  return { tone: "ok", note: null };
}

function MonitorOverview({ hostId, leafId }) {
  // Polled, not merely re-rendered on a clock. The newest-frame timestamp is the payload's, so ticking
  // a local clock over a frozen one ages a perfectly healthy sampler into a "stalled" warning within a
  // minute of opening the page — the age has to be measured against a timestamp that moves too.
  const { state, data, error, reload } =
    useLeafResource(hostId, leafId, (h) => fetchLeafMonitorStats(h), FRESHNESS_POLL_MS);

  if (state === "loading") return <LeafLoading what="Reading the monitor’s own statistics…" />;
  if (state === "error" || state === "none") {
    return <LeafUnreadable what="Monitor statistics" error={error} onRetry={reload} />;
  }

  const now = Date.now();
  const cov = data.coverage || {};
  const hist = data.history || null;

  // Frame age against the nominal interval. A frame a couple of intervals old is a busy tick, not a
  // fault; several intervals means the sampler is stalled, which nothing else would tell you.
  const frameAge = data.latestSampleMs != null ? now - data.latestSampleMs : null;
  const interval = data.intervalMs || 0;
  const frameTone = frameAge == null ? "muted"
    : interval && frameAge > interval * 5 ? "danger"
      : interval && frameAge > interval * 2 ? "warn"
        : "ok";

  const rawSpan = hist && hist.rawOldestMs != null && hist.rawNewestMs != null
    ? hist.rawNewestMs - hist.rawOldestMs : null;
  const rollupSpan = hist && hist.rollupOldestMs != null && hist.rollupNewestMs != null
    ? hist.rollupNewestMs - hist.rollupOldestMs : null;
  const rawWindow = hist ? hist.rawRetentionHours * HOUR_MS : 0;
  const rollupWindow = hist ? hist.rollupRetentionDays * DAY_MS : 0;
  const rawVerdict = retentionVerdict(rawSpan, rawWindow);
  const rollupVerdict = retentionVerdict(rollupSpan, rollupWindow);

  // Maintenance is the thing that keeps both tiers honest, so a failed or never-run pass leads the
  // attention lane ahead of the spans it would explain.
  const attention = [];
  if (hist) {
    if (hist.lastMaintenanceOk === false) {
      attention.push({
        key: "maint-failed", tone: "danger", icon: "circle-x",
        title: "The last maintenance pass failed",
        detail: "rollup, pruning and vacuum all ride this pass — while it fails the store grows and old "
          + "rows are never swept" + (hist.lastMaintenanceMs
            ? " (last attempt " + fmtRelative(new Date(hist.lastMaintenanceMs), new Date(now)) + ")"
            : ""),
      });
    } else if (hist.lastMaintenanceOk == null) {
      attention.push({
        key: "maint-never", tone: "warn", icon: "circle-help",
        title: "Maintenance hasn’t run yet",
        detail: "the daemon runs a catch-up pass at startup, so this clears within a moment of a restart",
      });
    }
    if (rawVerdict.tone === "warn") {
      attention.push({
        key: "raw-over", tone: "warn", icon: "database",
        title: "The raw tier is over its retention window",
        detail: rawVerdict.note,
      });
    }
    if (rollupVerdict.tone === "warn") {
      attention.push({
        key: "rollup-over", tone: "warn", icon: "database",
        title: "The rollup tier is over its retention window",
        detail: rollupVerdict.note,
      });
    }
  }
  if (frameTone === "danger" || frameTone === "warn") {
    attention.push({
      key: "stale-frame", tone: frameTone === "danger" ? "danger" : "warn",
      icon: "timer",
      title: "The newest frame is " + fmtSpan(frameAge) + " old",
      detail: "the sampler is configured for a " + interval + "ms interval — everything reading this "
        + "monitor is looking at that frame",
    });
  }

  const unknown = <span className="svc-fact svc-fact--unit">not reported</span>;

  return (
    <>
      {/* No summary strip here on purpose. How long this leaf has been up is the System tab's, and
          repeating it is exactly the duplication that got the unit strip removed from every Overview —
          the sample interval belongs to the freshness KPI below, which is the only place it means
          anything, and whether history is on is said by the history cards themselves. */}
      <div className="dash-summary">
        <KPI icon="timer" label="Newest frame"
          value={frameAge == null ? "—" : fmtSpan(frameAge)}
          unit={frameAge == null ? null : "old"}
          tone={frameTone}
          sub={frameAge == null
            ? "nothing sampled yet — the first tick hasn’t landed"
            : "sampled every " + interval + "ms"} />
        <KPI icon="server" label="Servers sampled" value={cov.serversEnabled ? (cov.servers ?? 0) : "—"}
          tone="muted"
          sub={cov.serversEnabled
            ? "measured in the newest frame"
            : "per-server sampling isn’t wired on this host"} />
        <KPI icon="box" label="Leaves sampled" value={cov.leavesEnabled ? (cov.leaves ?? 0) : "—"}
          tone="muted"
          sub={cov.leavesEnabled
            ? "measured in the newest frame"
            : "per-leaf sampling is switched off"} />
        <KPI icon="database" label="History size"
          value={hist && hist.dbBytes != null ? fmtBytes(hist.dbBytes) : "—"}
          tone="muted"
          sub={hist
            ? (hist.dbBytes != null
                ? (hist.rawRows + hist.rollupRows).toLocaleString() + " rows across both tiers"
                : "the store file couldn’t be measured")
            : "history is switched off on this host"} />
      </div>

      <div className="dash-feed">
        <BriefCard icon="triangle-alert" title="Needs a look" count={attention.length || null}
          countTone={attention.length ? "danger" : "neutral"}
          meta="Where what the monitor is doing differs from what it was configured to do.">
          {attention.length === 0 ? (
            <LeafBriefEmpty title="Nothing flagged">
              The sampler is keeping cadence and, where history is on, both tiers are inside their
              retention windows with maintenance completing.
            </LeafBriefEmpty>
          ) : (
            <div className="chat-brief__list">
              {attention.map(a => <LeafBriefItem key={a.key} {...a} />)}
            </div>
          )}
        </BriefCard>

        <BriefCard icon="gauge" title="Coverage"
          meta="What the newest frame actually measured — counted from the frame, not from configuration.">
          <LeafFacts rows={[
            ["Game servers", cov.serversEnabled ? String(cov.servers ?? 0) : "not wired",
              cov.serversEnabled ? null : "Per-server metrics need the engine path configured on this leaf."],
            ["KGSM leaves", cov.leavesEnabled ? String(cov.leaves ?? 0) : "switched off",
              cov.leavesEnabled
                ? "Only leaves that are running and resolvable — an idle socket-activated one has no cgroup and is simply absent."
                : null],
            ["CPU cores", cov.cores ? String(cov.cores) : unknown],
            ["Temperature sensors", cov.sensors != null ? String(cov.sensors) : unknown,
              cov.sensors === 0 ? "No hwmon sources on this host — an empty set, not a failed read." : null],
          ]} />
        </BriefCard>
      </div>

      {hist ? (
        <div className="dash-feed">
          <BriefCard icon="database" title="Raw tier"
            meta="Full-resolution samples — what a short-range chart is drawn from.">
            <LeafFacts rows={[
              ["Configured window", hist.rawRetentionHours + "h"],
              ["Actually held", fmtSpan(rawSpan), rawVerdict.note],
              ["Rows", hist.rawRows.toLocaleString()],
              ["Entities", String(hist.rawEntities),
                "Distinct things being recorded — one server is one entity, whatever its metric count."],
              ["Oldest sample", hist.rawOldestMs
                ? new Date(hist.rawOldestMs).toLocaleString()
                : <span className="svc-fact svc-fact--unit">tier is empty</span>],
            ]} />
          </BriefCard>

          <BriefCard icon="chart-line" title="Rollup tier"
            meta="Bucketed averages — what a long-range chart is drawn from.">
            <LeafFacts rows={[
              ["Configured window", hist.rollupRetentionDays + "d"],
              ["Bucket size", hist.rollupStepMin + " min"],
              ["Actually held", fmtSpan(rollupSpan), rollupVerdict.note],
              ["Rows", hist.rollupRows.toLocaleString()],
              ["Oldest bucket", hist.rollupOldestMs
                ? new Date(hist.rollupOldestMs).toLocaleString()
                : <span className="svc-fact svc-fact--unit">tier is empty</span>],
            ]} />
          </BriefCard>
        </div>
      ) : (
        <BriefCard icon="database" title="History"
          meta="The store behind every chart with a range selector on it.">
          <LeafBriefEmpty title="History is switched off">
            This monitor keeps no metrics history, so every range selector in the panel has nothing to
            draw. That is a configuration on this leaf, not a fault — it is the “historyDisabled” knob in
            Settings.
          </LeafBriefEmpty>
        </BriefCard>
      )}

      {hist && (
        <BriefCard icon="wrench" title="Maintenance"
          meta="The pass that rolls raw samples up, prunes both tiers, and reclaims disk.">
          <LeafFacts rows={[
            ["Runs every", Math.round(hist.maintenanceMs / 1000) + "s"],
            ["Last completed", hist.lastMaintenanceMs
              ? fmtRelative(new Date(hist.lastMaintenanceMs), new Date(now))
                + " · " + new Date(hist.lastMaintenanceMs).toLocaleString()
              : <span className="svc-fact svc-fact--unit">not yet</span>],
            ["Last outcome",
              hist.lastMaintenanceOk === true
                ? <span className="cluster-chip cluster-chip--ok">ok</span>
                : hist.lastMaintenanceOk === false
                  ? <span className="cluster-chip cluster-chip--danger">failed</span>
                  : <span className="svc-fact svc-fact--unit">no pass has completed</span>,
              // Null is not a pass. A daemon that has never swept and one that swept cleanly are
              // different states, and only the second is good news.
              hist.lastMaintenanceOk == null
                ? "Never having run is not the same as having run cleanly."
                : null],
            ["Store path", <code className="lcf-key">{hist.dbPath}</code>],
          ]} />
        </BriefCard>
      )}
    </>
  );
}

export { MonitorOverview };
