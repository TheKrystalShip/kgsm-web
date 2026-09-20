// ComponentSystem — everything systemd reports about this component's unit, in the one place that
// owns it.
//
// One body wherever the component runs. A node's API reads the row for each of its leaves; a
// component with no node above it reads its own and serves it in the same shape, so the two are the
// same render against the same fields and cannot drift into disagreeing about what a unit is doing.
//
// Every fact is the services row's, rendered or admitted. An absent one is never a zero.
//
// The facts are what the unit IS right now; `resources` below them is what it has BEEN, which only a
// node can answer — kgsm-monitor records that history per machine, and a component serving its own
// row has none to offer. Two sources, two cadences, kept visibly apart.

import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { fmtBytes, uptimeShort } from "../../lib/formatting.js";
import { leafIcon, leafStatus } from "../../lib/leaves.js";
import { LeafFacts } from "../leaf/leafOverviewKit.jsx";

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

/**
 * @param svc         the component's services row — `ComponentService` on the wire, whoever read it.
 * @param componentId what to call it before the row arrives, and which icon to draw.
 * @param selfServed  whether the component read this row about ITSELF, which changes what some of
 *                    the absences mean rather than how they are rendered.
 * @param resources   the recorded history below the facts, where something records it.
 */
function ComponentSystem({ svc, componentId, selfServed = false, resources = null }) {
  if (!svc) {
    return (
      <div className="proc-unavailable">
        <span className="proc-unavailable__icon"><Icon name="server-cog" size={26} strokeWidth={1.9} /></span>
        <div className="proc-unavailable__title">Reading this component’s unit…</div>
        <div className="proc-unavailable__sub">
          {selfServed
            ? "The component reports on its own unit; nothing is shown until it answers."
            : "The host’s services board is the authority on what systemd reports; nothing is shown until it answers."}
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
  // A null health is not a failing health: it means no deep probe is run for this component, which
  // is a fact about who is looking, not about the service.
  //
  // The link row is a question only something holding a CONNECTION to the component can answer. A
  // component that read this row about itself holds none — it is the thing being reached — so null
  // there is "does not apply" rather than "not known", and saying "unknown" would invite somebody
  // to go looking for a link that was never meant to exist.
  const reach = [
    ["Health probe", svc.health ? svc.health.status : "none for this component",
      svc.health && svc.health.message ? svc.health.message
        : svc.health ? null : "systemd liveness is still measured; only the deep check is absent."],
    selfServed && svc.provisioned == null
      ? ["Reached", "directly, at its own address",
        "It answers for itself, so there is no relay between this panel and the facts above."]
      : ["Reachable from this API", svc.provisioned == null ? "unknown" : svc.provisioned ? "yes" : "no"],
  ];

  const facts = (rows) => <LeafFacts rows={rows} />;

  return (
    <>
      <div className="lcf-leaf">
        <div className="lcf-leaf__icon"><Icon name={leafIcon(componentId)} size={18} /></div>
        <div className="lcf-leaf__id">
          <div className="lcf-leaf__name">
            {svc.displayName || componentId}
            <span className={"svc-dot svc-dot--" + status.tone}></span>
            <span className="lcf-leaf__state">{status.label}{status.note ? " · " + status.note : ""}</span>
          </div>
          <div className="lcf-leaf__meta">{svc.role || " "}</div>
        </div>
        <div className="lcf-leaf__acts">
          {/* Restarting a component on its own has no endpoint — it arrives with lifecycle actions.
              Shown disabled rather than hidden so the affordance's place is settled, and never wired to
              an empty config PUT, which returns `unchanged` and restarts nothing. */}
          <button className="lcf-btn lcf-btn--ghost" disabled
            title="Restarting this on its own isn’t available yet — applying a settings change restarts it.">
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
        <BriefCard icon="plug" title="This panel’s view" meta="How the Control Panel reaches it.">
          {facts(reach)}
        </BriefCard>
      </div>

      {resources}
    </>
  );
}

export { ComponentSystem };
export default ComponentSystem;
