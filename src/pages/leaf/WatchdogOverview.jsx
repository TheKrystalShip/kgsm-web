// WatchdogOverview — what the supervisor intends for each native server, what the kernel says is
// actually true, and why it last changed its mind.
//
// The pairing this page is built around is `desired` against `populated`. The first is the daemon's
// runtime intent; the second is measured from the instance's cgroup.events by the kernel. Neither is
// derived from the other, and them disagreeing is the single most actionable fact the panel can report
// about a native server — a server the watchdog means to be running that the kernel says is empty is a
// crash loop or a failed spawn, and it will not appear anywhere else in this UI as a problem.
//
// `reason` is the daemon's own sentence for its last transition ("crashed (exit 139); restart in 2s").
// It is shown verbatim and never parsed: the moment this page starts extracting an exit code from it,
// the wording becomes a contract the watchdog never agreed to.
//
// The supervisor's own readiness is reported apart from the rows, because it is a different failure: a
// daemon that is up but not in-slice holds a full table and can spawn none of it.

import { BriefCard } from "../../components/BriefCard.jsx";
import { CardTable } from "../../components/CardTable.jsx";
import { KPI } from "../../components/KPI.jsx";
import { fetchLeafSupervision } from "../../lib/stores.js";
import { LeafBriefEmpty, LeafBriefItem, LeafLoading, LeafAbsent, LeafUnreadable, useLeafResource } from "./leafOverviewKit.jsx";

// The supervision phase, in the panel's vocabulary. `restart-pending` is deliberately a warning rather
// than an error: the watchdog is doing its job, and the instance is expected back.
const PHASE = {
  running:            { tone: "ok",     label: "Running" },
  "restart-pending":  { tone: "warn",   label: "Restarting" },
  stopped:            { tone: "muted",  label: "Stopped" },
  failed:             { tone: "danger", label: "Failed" },
  unknown:            { tone: "muted",  label: "Unknown" },
};
const phaseOf = (p) => PHASE[p] || PHASE.unknown;

const chipTone = (tone) => (tone === "ok" ? "ok" : tone === "danger" || tone === "warn" ? "danger" : "muted");

function WatchdogOverview({ hostId, leafId }) {
  const { state, data, error, reload } = useLeafResource(hostId, leafId, (h) => fetchLeafSupervision(h));

  if (state === "loading") return <LeafLoading what="Reading the watchdog’s supervision table…" />;
  if (state === "none") return <LeafAbsent leafId={leafId} what="a watchdog" />;
  if (state === "error") return <LeafUnreadable what="Supervision table" error={error} onRetry={reload} />;

  const rows = (data && data.data) || [];
  const ready = data ? data.ready : null;

  const running = rows.filter(r => r.populated);
  const enabled = rows.filter(r => r.enabled);
  // Intent that the kernel contradicts, in both directions. The second is rarer and stranger — something
  // is alive in a cgroup the watchdog means to be empty — so it is called out by name rather than folded
  // into a single "mismatch" count.
  const shouldRunButIsnt = rows.filter(r => r.desired === "running" && !r.populated);
  const shouldBeStoppedButIsnt = rows.filter(r => r.desired === "stopped" && r.populated);
  const streaking = rows.filter(r => r.restarts > 0);

  const attention = [];
  // Readiness leads: while the supervisor cannot spawn, every other row on this page is explained by it,
  // and fixing an individual instance would be chasing a symptom.
  if (ready === false) {
    attention.push({
      key: "not-ready", tone: "danger", icon: "shield-off",
      title: "The supervisor cannot spawn",
      detail: data.detail || "the watchdog reports it is not in-slice; nothing here can be started until that clears",
    });
  }
  for (const r of shouldRunButIsnt) {
    attention.push({
      key: "down:" + r.name, tone: "danger", icon: "circle-x",
      title: r.name + " should be running",
      detail: r.reason
        ? "the cgroup is empty — " + r.reason
        : "the watchdog holds it as running, but its cgroup is empty and it gave no reason",
    });
  }
  for (const r of shouldBeStoppedButIsnt) {
    attention.push({
      key: "stray:" + r.name, tone: "warn", icon: "triangle-alert",
      title: r.name + " is alive but wasn’t asked to be",
      detail: r.reason || "something is running in a cgroup the watchdog holds as stopped",
    });
  }
  for (const r of streaking) {
    // A streak on an instance already reported as down would say the same thing twice.
    if (shouldRunButIsnt.some(x => x.name === r.name)) continue;
    attention.push({
      key: "streak:" + r.name, tone: "warn", icon: "rotate-cw",
      title: r.name + " · " + r.restarts + " consecutive restart" + (r.restarts === 1 ? "" : "s"),
      detail: r.reason || "it hasn’t stayed up long enough to clear the streak",
    });
  }

  return (
    <>
      <div className="players-toolbar">
        <div className="svc-summary">
          <span className="svc-summary__stat">supervising <b>{rows.length}</b></span>
          <span className="svc-summary__sep">&middot;</span>
          <span className="svc-summary__stat">running <b>{running.length}</b></span>
          <span className="svc-summary__sep">&middot;</span>
          <span className="svc-summary__stat">autostart <b>{enabled.length}</b></span>
        </div>
        <span style={{ flex: 1 }}></span>
        {/* Null is not false. A readiness we couldn't read is muted and says so, because claiming the
            supervisor is fine on the strength of an unanswered question is exactly the fabrication the
            ecosystem forbids. */}
        <span className={"cluster-chip cluster-chip--" + (ready === true ? "ok" : ready === false ? "danger" : "muted")}
          title={data && data.detail ? data.detail : undefined}>
          {ready === true ? "ready to spawn" : ready === false ? "cannot spawn" : "readiness unknown"}
        </span>
      </div>

      <div className="dash-summary">
        <KPI icon="shield" label="Supervised" value={rows.length} tone="muted"
          sub={rows.length ? "native instances in the table" : "the watchdog holds no instances"} />
        <KPI icon="play" label="Running" value={running.length}
          tone={running.length ? "ok" : "muted"}
          sub="measured from each cgroup, not from intent" />
        <KPI icon="circle-x" label="Down but wanted" value={shouldRunButIsnt.length}
          tone={shouldRunButIsnt.length ? "danger" : "ok"}
          sub={shouldRunButIsnt.length
            ? "intent says running, the kernel says empty"
            : "intent and reality agree everywhere"} />
        <KPI icon="rotate-cw" label="Restart streaks" value={streaking.length}
          tone={streaking.length ? "warn" : "ok"}
          sub={streaking.length
            ? "instances that haven’t stabilized"
            : "no instance is in a failure streak"} />
      </div>

      <div className="dash-feed">
        <BriefCard icon="triangle-alert" title="Needs a look" count={attention.length || null}
          countTone={attention.length ? "danger" : "neutral"}
          meta="Where the watchdog’s intent and the kernel’s measurement disagree.">
          {attention.length === 0 ? (
            <LeafBriefEmpty title="Nothing flagged">
              Every supervised instance is in the state the watchdog intends, and none is in a restart streak.
            </LeafBriefEmpty>
          ) : (
            <div className="chat-brief__list">
              {attention.map(a => <LeafBriefItem key={a.key} {...a} />)}
            </div>
          )}
        </BriefCard>

        <BriefCard icon="power" title="Boot autostart" count={enabled.length || null} countTone="neutral"
          meta="The persisted set the watchdog restores at boot — independent of what is running now.">
          {rows.length === 0 ? (
            <LeafBriefEmpty title="Nothing supervised">
              The watchdog isn’t holding any native instance on this host.
            </LeafBriefEmpty>
          ) : enabled.length === 0 ? (
            <LeafBriefEmpty title="No instance starts at boot">
              Nothing here comes back on its own after a reboot — every server would need starting by hand.
            </LeafBriefEmpty>
          ) : (
            <div className="chat-brief__list">
              {enabled.map(r => (
                <LeafBriefItem key={r.name} tone={r.populated ? "info" : "warn"} icon="power"
                  title={r.name}
                  detail={r.populated
                    ? "enabled and running"
                    : "enabled, but not running right now"} />
              ))}
            </div>
          )}
        </BriefCard>
      </div>

      <CardTable
        icon="shield" title="Supervision" count={rows.length}
        columns={[
          { key: "name", label: "Instance", width: "minmax(0,1.2fr)", sort: r => r.name },
          {
            key: "desired", label: "Intent", width: "100px", sort: r => r.desired,
            render: r => <span className="svc-fact svc-fact--unit">{r.desired}</span>,
          },
          {
            key: "phase", label: "Phase", width: "120px", sort: r => r.phase,
            render: r => {
              const p = phaseOf(r.phase);
              return <span className={"cluster-chip cluster-chip--" + chipTone(p.tone)}>{p.label}</span>;
            },
          },
          {
            key: "populated", label: "Cgroup", width: "110px", sort: r => (r.populated ? 1 : 0),
            // The kernel's answer, labelled as such. "Alive"/"empty" rather than yes/no, because the
            // question this column answers is not "is it running" (that's the phase) but "is there
            // anything in the cgroup".
            render: r => (r.populated
              ? <span className="cluster-chip cluster-chip--ok">alive</span>
              : <span className="svc-fact svc-fact--unit">empty</span>),
          },
          {
            key: "enabled", label: "At boot", width: "90px", sort: r => (r.enabled ? 1 : 0),
            render: r => (r.enabled ? "yes" : <span className="svc-fact svc-fact--unit">no</span>),
          },
          {
            key: "restarts", label: "Streak", width: "80px", align: "right", sort: r => r.restarts,
            defaultDir: "desc",
            render: r => (r.restarts > 0
              ? <span className="cluster-chip cluster-chip--danger">{r.restarts}</span>
              : "—"),
          },
          {
            key: "reason", label: "Last transition", width: "minmax(0,1.8fr)", sort: r => r.reason,
            // Verbatim, and title-attributed so a long sentence is readable without widening the column.
            render: r => (r.reason
              ? <span title={r.reason}>{r.reason}</span>
              : <span className="svc-fact svc-fact--unit">nothing recorded</span>),
          },
        ]}
        rows={rows}
        getKey={r => r.name}
        defaultSort={{ key: "name", dir: "asc" }}
        empty="The watchdog isn’t supervising any instance on this host." />
    </>
  );
}

export { WatchdogOverview };
