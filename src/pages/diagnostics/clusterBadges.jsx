// clusterBadges.jsx — what a member's state looks like, in one place, so no Cluster-page
// surface assembles its own. The Nodes card, the Anchors card and the assignment dialog
// render `MemberState`; the constellation and the fleet strip take the tone mapping the
// same vocabulary produces, so a dot and a badge can never disagree about one member.
//
// The individual chips are the pieces MemberState composes and are deliberately not
// exported: a surface picking two of the three is how a departed member came to state its
// departure three times, in three vocabularies, one of which read as a fault.

import { Icon } from "../../components/Icon.jsx";

// membership (a gossip/liveness axis) -> badge tone + label. Never invented —
// an unrecognized/missing value falls back to the honest "unknown" tone.
const MEMBERSHIP_META = {
  alive:   { tone: "ok",          label: "alive" },
  joining: { tone: "provisional", label: "joining" },
  suspect: { tone: "warn",        label: "suspect" },
  dead:    { tone: "danger",      label: "dead" },
  left:    { tone: "muted",       label: "left" },
  unknown: { tone: "muted",       label: "unknown" },
};

function membershipMeta(membership) {
  return MEMBERSHIP_META[membership] || MEMBERSHIP_META.unknown;
}

// membershipRowTone(membership) — maps the membership badge's tone vocabulary
// ("ok/provisional/warn/danger/muted") onto the dash-fleet-row/-dot modifier
// vocabulary ("success/warn/danger/off") a fleet row's status dot uses, so a
// ghost row (a federation peer with no connected host, hence no measured
// health tone of its own) still gets a meaningful dot color from the ONE axis
// it has: federation membership.
const ROW_TONE_BY_MEMBERSHIP_TONE = { ok: "success", provisional: "warn", warn: "warn", danger: "danger", muted: "off" };
function membershipRowTone(membership) {
  return ROW_TONE_BY_MEMBERSHIP_TONE[membershipMeta(membership).tone] || "off";
}

function MembershipBadge({ membership }) {
  const meta = membershipMeta(membership);
  return (
    <span className={"cluster-badge cluster-badge--" + meta.tone}>
      <span className="cluster-badge__dot"></span>
      {meta.label}
    </span>
  );
}

// status (a separate reachability axis) -> chip. `enabled === false` wins over
// status — a disabled peer is shown as disabled regardless of reachability.
function StatusChip({ status, enabled }) {
  if (enabled === false) {
    return (
      <span className="cluster-chip cluster-chip--disabled">
        <Icon name="power-off" size={11} strokeWidth={2.2} />disabled
      </span>
    );
  }
  if (status === "reachable") {
    return (
      <span className="cluster-chip cluster-chip--ok">
        <Icon name="wifi" size={11} strokeWidth={2.2} />reachable
      </span>
    );
  }
  if (status === "unreachable") {
    return (
      <span className="cluster-chip cluster-chip--danger">
        <Icon name="wifi-off" size={11} strokeWidth={2.2} />unreachable
      </span>
    );
  }
  return (
    <span className="cluster-chip cluster-chip--muted">
      <Icon name="circle-help" size={11} strokeWidth={2.2} />unknown
    </span>
  );
}

// What state a member is in, as ONE statement, so no surface assembles its own.
//
// IT SPEAKS ONLY WHEN THERE IS SOMETHING TO SAY. A member that is alive, reachable and enabled is
// the ordinary case, and on a card of members it is nearly every row — two green pills per row
// saying nothing that the row's status dot does not already say in the same colour, on a line of
// their own, on every row. The dot carries the ordinary case; this carries the exceptions.
//
// A member that is still one has two axes and both are worth showing when either departs from
// ordinary: what the mesh converged on, and what this node's own probe found. They answer different
// questions and a member can be alive to the mesh while this node cannot reach it.
//
// A member that has LEFT never reaches here: it is not shown at all (`clusterNodes.js`), because a
// machine that is gone is not a member in a state worth reporting.
//
// `always` is for a surface with no dot beside it to lean on — the assignment dialog lists members
// as candidates, where the ordinary case is exactly what has to be legible.
function memberIsOrdinary(membership, status, enabled) {
  return membership === "alive" && status === "reachable" && enabled !== false;
}

function MemberState({ membership, status, enabled, always = false }) {
  if (!always && memberIsOrdinary(membership, status, enabled)) return null;
  return (
    <>
      <MembershipBadge membership={membership} />
      <StatusChip status={status} enabled={enabled} />
    </>
  );
}

export { MEMBERSHIP_META, memberIsOrdinary, membershipMeta, membershipRowTone, MemberState };
