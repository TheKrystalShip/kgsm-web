// SchedulerOverview — what this host is going to do to itself, and how the last round went.
//
// The scheduler runs two independent cadences per instance: a restart and a backup. They are genuinely
// separate — a backup is taken against the instance as it is, so it needs no restart window to live in —
// and this page keeps them separate everywhere except the one place an operator thinks of them together:
// "what fires next on this box". That merged lane is the reason this page exists at all, because the
// per-server settings surface can only ever show one instance's half of it.
//
// Every time shown is the leaf's own arithmetic, relayed through the api untouched. This file computes
// no schedule; it sorts and formats what the scheduler already decided. A null next-fire is "not
// scheduled" and a null last-run is "hasn't run yet" — two different silences, worded differently and
// never filled in.

import React from "react";

import { BriefCard } from "../../components/BriefCard.jsx";
import { CardTable } from "../../components/CardTable.jsx";
import { KPI } from "../../components/KPI.jsx";
import { fmtRelative, fmtUntil, parseTs } from "../../lib/formatting.js";
import { fetchLeafSchedules } from "../../lib/stores.js";
import { LeafBriefEmpty, LeafBriefItem, LeafLoading, LeafAbsent, LeafUnreadable, useLeafResource } from "./leafOverviewKit.jsx";

// The leaf writes "off" for a cadence nobody set. It is a real value, not a missing one, so it is
// matched explicitly rather than by falsiness — a future cadence named "" or null would otherwise be
// silently read as scheduled.
const isScheduled = (cadence) => !!cadence && cadence !== "off";

// A parsed timestamp or null. The leaf emits ISO-8601; anything unparseable is treated as absent rather
// than rendered as "Invalid Date", because a broken stamp is not a scheduled time.
function at(ts) {
  if (!ts) return null;
  const d = parseTs(ts);
  return isNaN(d.getTime()) ? null : d;
}

// The cadence in the words it was configured with: "daily at 04:30", "weekly on sun at 04:00". The day
// only means something on a weekly cadence — the leaf still carries one on a daily schedule (it is the
// same stored field) and printing it would imply a restriction that isn't there.
function cadenceText(cadence, time, day) {
  if (!isScheduled(cadence)) return "off";
  const parts = [cadence];
  if (String(cadence).toLowerCase() === "weekly" && day) parts.push("on " + day);
  if (time) parts.push("at " + time);
  return parts.join(" ");
}

// How a completed run reads. `ok` is a tri-state on the wire and stays one here: true is a pass, false is
// a failure, and null is a run the leaf recorded without an outcome — which is not a pass.
function outcome(ok) {
  if (ok === true) return { tone: "ok", label: "ok", icon: "circle-check" };
  if (ok === false) return { tone: "danger", label: "failed", icon: "circle-x" };
  return { tone: "muted", label: "unrecorded", icon: "circle-help" };
}

function SchedulerOverview({ hostId, leafId }) {
  const { state, data, error, reload } = useLeafResource(hostId, leafId, (h) => fetchLeafSchedules(h));

  // Relative times are the whole point of the upcoming lane, so they tick rather than freezing at the
  // moment of the fetch. A minute is the finest granularity anything here renders.
  const [, setClock] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setClock(c => c + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (state === "loading") return <LeafLoading what="Reading the scheduler’s board…" />;
  if (state === "none") return <LeafAbsent leafId={leafId} what="a scheduler" />;
  if (state === "error") return <LeafUnreadable what="Schedule board" error={error} onRetry={reload} />;

  const rows = Array.isArray(data) ? data : [];
  const now = new Date();

  // The two cadences, flattened into one list of upcoming jobs. Each keeps its kind, because "Ketchup
  // in 9h" is useless without knowing whether that is a restart or a backup.
  const upcoming = [];
  for (const r of rows) {
    const nextRestart = at(r.nextFireUtc);
    const nextBackup = at(r.nextBackupUtc);
    if (nextRestart) upcoming.push({ key: r.name + ":restart", name: r.name, kind: "Restart", icon: "rotate-cw", when: nextRestart });
    if (nextBackup) upcoming.push({ key: r.name + ":backup", name: r.name, kind: "Backup", icon: "database-backup", when: nextBackup });
  }
  upcoming.sort((a, b) => a.when - b.when);

  const withRestart = rows.filter(r => isScheduled(r.scheduledRestart));
  const withBackup = rows.filter(r => isScheduled(r.backupSchedule));

  // A failure is worth surfacing whichever cadence produced it, so both last-run outcomes feed one lane.
  const failures = [];
  for (const r of rows) {
    if (r.lastRunOk === false) {
      failures.push({
        key: r.name + ":restart", tone: "danger", icon: "rotate-cw",
        title: r.name + " — scheduled restart failed",
        detail: (r.lastRunMessage || "the scheduler recorded no reason")
          + (at(r.lastRunUtc) ? " · " + fmtRelative(at(r.lastRunUtc), now) : ""),
      });
    }
    if (r.lastBackupOk === false) {
      failures.push({
        key: r.name + ":backup", tone: "danger", icon: "database-backup",
        title: r.name + " — scheduled backup failed",
        detail: (r.lastBackupMessage || "the scheduler recorded no reason")
          + (at(r.lastBackupUtc) ? " · " + fmtRelative(at(r.lastBackupUtc), now) : ""),
      });
    }
  }

  const next = upcoming[0] || null;

  return (
    <>
      <div className="dash-summary">
        {/* Not toned. Nothing scheduled is a legitimate configuration on a host nobody wants restarted,
            so painting a zero amber would invent a policy this panel doesn't hold. */}
        <KPI icon="rotate-cw" label="Restart schedules" value={withRestart.length} tone="muted"
          sub={rows.length ? "of " + rows.length + " instance" + (rows.length === 1 ? "" : "s") : "no instances known"} />
        <KPI icon="database-backup" label="Backup schedules" value={withBackup.length} tone="muted"
          sub={rows.length ? "of " + rows.length + " instance" + (rows.length === 1 ? "" : "s") : "no instances known"} />
        <KPI icon="timer" label="Next job"
          value={next ? fmtUntil(next.when, now) : "—"} tone={next ? "info" : "muted"}
          sub={next
            ? next.kind.toLowerCase() + " · " + next.name + " · " + next.when.toLocaleString()
            : "nothing is scheduled to fire"} />
        <KPI icon="triangle-alert" label="Failed last run" value={failures.length}
          tone={failures.length ? "danger" : "ok"}
          sub={failures.length
            ? "needs a look"
            : "every recorded run completed"} />
      </div>

      <div className="dash-feed">
        <BriefCard icon="calendar-clock" title="Next up" count={upcoming.length || null} countTone="neutral"
          meta="Restarts and backups across this host, soonest first — as the scheduler computed them.">
          {upcoming.length === 0 ? (
            <LeafBriefEmpty title="Nothing scheduled">
              {rows.length
                ? "The scheduler knows about " + rows.length + " instance" + (rows.length === 1 ? "" : "s")
                  + ", and none of them has a restart or backup cadence set."
                : "The scheduler isn’t tracking any instance on this host."}
            </LeafBriefEmpty>
          ) : (
            <div className="chat-brief__list">
              {upcoming.slice(0, 6).map(u => (
                <LeafBriefItem key={u.key} tone="info" icon={u.icon}
                  title={u.name + " · " + u.kind}
                  detail={fmtUntil(u.when, now) + " · " + u.when.toLocaleString()} />
              ))}
            </div>
          )}
        </BriefCard>

        <BriefCard icon="triangle-alert" title="Needs a look" count={failures.length || null}
          countTone={failures.length ? "danger" : "neutral"}
          meta="A scheduled job the leaf ran and recorded as failed.">
          {failures.length === 0 ? (
            <LeafBriefEmpty title="Nothing flagged">
              No scheduled restart or backup has been recorded as failing.
            </LeafBriefEmpty>
          ) : (
            <div className="chat-brief__list">
              {failures.map(f => <LeafBriefItem key={f.key} {...f} />)}
            </div>
          )}
        </BriefCard>
      </div>

      <CardTable
        icon="rotate-cw" title="Restarts" count={rows.length}
        columns={[
          { key: "name", label: "Instance", width: "minmax(0,1.4fr)", sort: r => r.name },
          {
            key: "scheduledRestart", label: "Cadence", width: "minmax(0,1.2fr)", sort: r => r.scheduledRestart,
            render: r => (isScheduled(r.scheduledRestart)
              ? cadenceText(r.scheduledRestart, r.restartTime, r.restartDay)
              : <span className="svc-fact svc-fact--unit">off</span>),
          },
          {
            key: "timezone", label: "Timezone", width: "minmax(0,1fr)", sort: r => r.timezone,
            // The leaf leaves this blank when the instance inherits the host's zone. Saying which it is
            // matters: a restart "at 04:00" in an unstated zone is the classic way to schedule downtime
            // into someone's evening.
            render: r => (r.timezone || <span className="svc-fact svc-fact--unit">host default</span>),
          },
          {
            // Sorts on the raw instant, not the rendered text — a null sinks to the bottom either way.
            key: "nextFireUtc", label: "Next", width: "120px", align: "right", sort: r => at(r.nextFireUtc),
            defaultDir: "asc",
            render: r => (at(r.nextFireUtc)
              ? <span title={at(r.nextFireUtc).toLocaleString()}>{fmtUntil(at(r.nextFireUtc), now)}</span>
              : "—"),
          },
          {
            key: "lastRunOk", label: "Last run", width: "130px", align: "right", sort: r => at(r.lastRunUtc),
            render: r => {
              const when = at(r.lastRunUtc);
              if (!when) return <span className="svc-fact svc-fact--unit">never</span>;
              const o = outcome(r.lastRunOk);
              return (
                <span className={"cluster-chip cluster-chip--" + (o.tone === "ok" ? "ok" : o.tone === "danger" ? "danger" : "muted")}
                  title={(r.lastRunMessage || o.label) + " · " + when.toLocaleString()}>
                  {o.label} · {fmtRelative(when, now)}
                </span>
              );
            },
          },
        ]}
        rows={rows}
        getKey={r => r.name}
        defaultSort={{ key: "nextFireUtc", dir: "asc" }}
        empty="The scheduler isn’t tracking any instance on this host." />

      <CardTable
        icon="database-backup" title="Backups" count={rows.length}
        columns={[
          { key: "name", label: "Instance", width: "minmax(0,1.4fr)", sort: r => r.name },
          {
            key: "backupSchedule", label: "Cadence", width: "minmax(0,1.2fr)", sort: r => r.backupSchedule,
            render: r => (isScheduled(r.backupSchedule)
              ? cadenceText(r.backupSchedule, r.backupTime, r.backupDay)
              : <span className="svc-fact svc-fact--unit">off</span>),
          },
          {
            key: "nextBackupUtc", label: "Next", width: "120px", align: "right", sort: r => at(r.nextBackupUtc),
            defaultDir: "asc",
            render: r => (at(r.nextBackupUtc)
              ? <span title={at(r.nextBackupUtc).toLocaleString()}>{fmtUntil(at(r.nextBackupUtc), now)}</span>
              : "—"),
          },
          {
            key: "lastBackupOk", label: "Last backup", width: "130px", align: "right", sort: r => at(r.lastBackupUtc),
            render: r => {
              const when = at(r.lastBackupUtc);
              if (!when) return <span className="svc-fact svc-fact--unit">never</span>;
              const o = outcome(r.lastBackupOk);
              return (
                <span className={"cluster-chip cluster-chip--" + (o.tone === "ok" ? "ok" : o.tone === "danger" ? "danger" : "muted")}
                  title={(r.lastBackupMessage || o.label) + " · " + when.toLocaleString()}>
                  {o.label} · {fmtRelative(when, now)}
                </span>
              );
            },
          },
        ]}
        rows={rows}
        getKey={r => r.name}
        defaultSort={{ key: "nextBackupUtc", dir: "asc" }}
        empty="The scheduler isn’t tracking any instance on this host." />
    </>
  );
}

export { SchedulerOverview };
