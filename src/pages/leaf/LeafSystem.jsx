// LeafSystem — everything systemd reports about this leaf's unit, in the one place that owns it.
//
// These facts used to be scattered: a strip repeated on every tab, a "Service" card on the generic
// Overview, and the config page's identity block — three renderings of the same row, none of them
// complete, and a leaf with a bespoke Overview (the assistant) got none of the middle one. They live
// here now. What stays visible everywhere is the page header's status chip, which answers the only
// question worth interrupting another tab for: is this thing up.
//
// Every fact is the services row's, rendered or admitted. An absent one is never a zero.
//
// The facts are what the unit IS right now; the charts below them are what it has BEEN, read from
// kgsm-monitor's recorded history. Two sources, two cadences, kept visibly apart.

import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { fmtBytes, leafStatus, uptimeShort } from "../diagnostics/diagHelpers.js";
import { leafIcon } from "../leafConfig/leafConfigHelpers.js";
import { LeafResources } from "./LeafResources.jsx";

// A runtime fact (pid, memory, start time) is absent for two different reasons, and the difference is
// measured rather than guessed: a unit that isn't running HAS no pid, whereas a running unit whose pid
// we didn't get is genuinely unknown. Neither is ever rendered as 0.
function runtimeFact(value, running, render) {
  if (value != null) return render(value);
  return running ? "unknown" : "not running";
}

function startedAt(since) {
  const d = new Date(since);
  return isNaN(d.getTime()) ? "unknown" : d.toLocaleString();
}

function LeafSystem({ hostId, leafId, svc }) {
  if (!svc) {
    return (
      <div className="proc-unavailable">
        <span className="proc-unavailable__icon"><Icon name="server-cog" size={26} strokeWidth={1.9} /></span>
        <div className="proc-unavailable__title">Reading this leaf’s unit…</div>
        <div className="proc-unavailable__sub">
          The host’s services board is the authority on what systemd reports; nothing is shown until it answers.
        </div>
      </div>
    );
  }

  const status = leafStatus(svc);
  const running = svc.state === "active";

  // Grouped the way you read them: what the unit IS, then what it is DOING, then how this panel
  // reaches it. Each row is [label, value, hint?] — a hint explains a value that would otherwise
  // invite the wrong reading (an idle socket-activated unit is not a stopped one).
  const identity = [
    ["Unit", svc.unit || "unknown"],
    ["Activation", svc.onDemand ? "socket-activated" : "always running",
      svc.onDemand ? "It starts on demand and exits when idle, so “inactive” is its resting state." : null],
    ["Enabled at boot", svc.enabled == null ? "unknown" : svc.enabled ? "yes" : "no"],
  ];
  // `since` is the unit's ActiveEnterTimestamp — when it last became active, which a STOPPED unit
  // still carries from its last run. Reading elapsed time off it as "uptime" would claim a dead
  // service had been up for hours, so a unit that isn't running reports when it last started and no
  // uptime at all: it has none.
  const runtime = [
    ["State", svc.state + (svc.subState ? " (" + svc.subState + ")" : "")],
    [running ? "Started" : "Last started", svc.since ? startedAt(svc.since) : "unknown"],
    ...(running && svc.since ? [["Uptime", uptimeShort(svc.since)]] : []),
    ["Memory", runtimeFact(svc.memoryBytes, running, fmtBytes)],
    ["Main PID", runtimeFact(svc.mainPid, running, String)],
  ];
  const reach = [
    // A null health is not a failing health: it means this API runs no deep probe for this leaf, which
    // is a fact about the panel, not about the service.
    ["Health probe", svc.health ? svc.health.status : "none for this leaf",
      svc.health && svc.health.message ? svc.health.message
        : svc.health ? null : "systemd liveness is still measured; only the deep check is absent."],
    ["Reachable from this API", svc.provisioned == null ? "unknown" : svc.provisioned ? "yes" : "no"],
  ];

  const facts = (rows) => (
    <div className="leaf-facts">
      {rows.map(([label, value, hint]) => (
        <div className="leaf-facts__row" key={label}>
          <span className="leaf-facts__label">{label}</span>
          <span className="leaf-facts__value">{value}</span>
          {hint && <span className="leaf-facts__hint">{hint}</span>}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <div className="lcf-leaf">
        <div className="lcf-leaf__icon"><Icon name={leafIcon(leafId)} size={18} /></div>
        <div className="lcf-leaf__id">
          <div className="lcf-leaf__name">
            {svc.displayName || leafId}
            <span className={"svc-dot svc-dot--" + status.tone}></span>
            <span className="lcf-leaf__state">{status.label}{status.note ? " · " + status.note : ""}</span>
          </div>
          <div className="lcf-leaf__meta">{svc.role || " "}</div>
        </div>
        <div className="lcf-leaf__acts">
          {/* Restarting a leaf on its own has no endpoint yet — it arrives with leaf lifecycle actions.
              Shown disabled rather than hidden so the affordance's place is settled, and never wired to
              an empty config PUT, which returns `unchanged` and restarts nothing. */}
          <button className="lcf-btn lcf-btn--ghost" disabled
            title="Restarting a leaf on its own isn’t available yet — applying a settings change restarts it.">
            <Icon name="refresh-cw" size={13} /> Restart
          </button>
        </div>
      </div>

      <div className="leaf-sysgrid">
        <BriefCard icon="box" title="Unit" meta="What this service is, independent of whether it is up.">
          {facts(identity)}
        </BriefCard>
        <BriefCard icon="activity" title="Runtime" meta="What systemd reports for it right now.">
          {facts(runtime)}
        </BriefCard>
        <BriefCard icon="plug" title="This panel’s view" meta="How the Control Panel API reaches the leaf.">
          {facts(reach)}
        </BriefCard>
      </div>

      <LeafResources hostId={hostId} leafId={leafId} running={running} onDemand={svc.onDemand} />
    </>
  );
}

export { LeafSystem };
