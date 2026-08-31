// clusterActions.jsx — the admin controls a member row carries, and the two decisions
// they open: whether a member is still in the cluster, and who holds a capability.
//
// Both are deliberate acts with no automatic equivalent. Nothing promotes itself — an
// automatic failover during a partition produces two members issuing conflicting
// statements about who may do what — and nothing removes a member on its behalf. So
// this is where a person decides, on either card: nodes and anchors are different
// things to look at and the same thing to manage.
//
// Both are CLUSTER acts, which is the only kind this panel offers. Removing records a
// departure that travels to every member and is reaped everywhere; assigning is
// versioned cluster state that converges. Either can be sent to any member holding a
// row for the target, so neither names one.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { Modal } from "../../components/Modal.jsx";
import { api } from "../../lib/apiClient.js";
import { clusterStore } from "../../lib/stores.js";
import { MemberState } from "./clusterBadges.jsx";

// memberRemoval(member) — whether removing this member would do anything, and the sentence
// explaining why not. The counterpart to `verbGuard` for a member, and it exists for the same
// reason: a control that runs and quietly undoes itself is worse than one that says it cannot.
//
// Removal records a terminal state above the incarnation the member last claimed. Only a member may
// raise its OWN incarnation, so one that is still running and still gossiping re-asserts itself and
// comes back — which is what stops a live member being buried by a false report, and what makes
// removing a live member a request the cluster overturns.
//
// So the answer is a fact about the MEMBER and reads the same on every row. It is also why the
// member currently answering for the roster is never removable: it just answered, so it is running.
function memberRemoval(member) {
  const name = (member && (member.label || member.nodeId)) || "this member";
  if (!member || !member.peerId)
    return { ok: false, reason: name + " is the member answering for this roster, so it is running" };
  if (member.membership === "left") return { ok: true };
  if (member.status === "unreachable") return { ok: true };
  return {
    ok: false,
    reason: name + " is still running. Stop it first — a member that is still gossiping re-asserts "
      + "itself and rejoins on its next round",
  };
}

// The one control on a member row. It opens a dialog rather than acting, because removal is the
// choice that can be the wrong one and the dialog is where what it costs is stated.
//
// A member it would not remove keeps the control, disabled, carrying the reason — the same rule
// every lifecycle button in the panel follows. Hiding it would leave an admin hunting for a control
// that is on the row beside it.
function MemberRowActions({ hostId, member }) {
  const [removing, setRemoving] = React.useState(false);
  const name = member.label || member.nodeId;
  const guard = memberRemoval(member);

  return (
    <span className="cluster-node-row__actions">
      <button
        className="icon-btn"
        title={guard.ok ? "Remove " + name + " from the cluster" : guard.reason}
        aria-label={guard.ok ? "Remove " + name + " from the cluster" : guard.reason}
        onClick={(e) => { e.stopPropagation(); setRemoving(true); }}
        disabled={!guard.ok}
      >
        <Icon name="trash-2" size={13} />
      </button>
      {removing && (
        <MemberRemoveDialog hostId={hostId} member={member} onClose={() => setRemoving(false)} />
      )}
    </span>
  );
}

// Removing a member from the cluster. The dialog exists to say what that is: not a row deleted here,
// but a departure recorded above the member's last incarnation, which supersedes the alive every
// other member holds and is reaped everywhere once the reap window passes. An absence does not
// travel — anti-entropy exists to repair a roster that is missing something, so a deleted row would
// be handed straight back by the first member that still holds it.
//
// It is refused outright when the member holds a capability for the cluster, because removing the
// holder leaves the cluster pointing at somebody who is gone and nothing promotes itself to fill the
// gap. The member says which capability to move first, and that sentence is shown verbatim.
function MemberRemoveDialog({ hostId, member, onClose }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const label = member.label || member.nodeId;
  const departed = member.membership === "left";

  const run = () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    api.members(hostId).remove(member.peerId)
      .then(() => { clusterStore.refresh(hostId); onClose(); })
      .catch((e) => { setErr((e && e.message) || "That didn't go through."); setBusy(false); });
  };

  return (
    <Modal onClose={onClose} canClose={!busy}>
      <div className="modal host-remove">
        <div className="host-remove__icon host-remove__icon--danger">
          <Icon name="trash-2" size={20} />
        </div>
        <h2 className="host-remove__title">Remove {label} from the cluster?</h2>
        <p className="host-remove__text">
          {departed ? (
            <><b>{label}</b> has announced its departure. Removing it clears the record the cluster
            is still carrying, and there is nothing running to come back.</>
          ) : (
            <><b>{label}</b> is not answering. Removing it tells the rest of the cluster it has gone,
            and every member drops it once the record is reaped.</>
          )}
        </p>
        {err && (
          <p className="cluster-dialog__err"><Icon name="triangle-alert" size={13} />{err}</p>
        )}
        <div className="host-remove__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="host-btn host-btn--danger" onClick={run} disabled={busy}>
            <Icon name={busy ? "loader" : "trash-2"} size={14} className={busy ? "cluster-spin" : ""} />
            {busy ? "Working…" : "Remove"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Moving a capability. The candidates are the cluster's members verbatim, each with the
// membership it actually has, because the backend accepts a member that is unreachable
// on purpose: reassigning is what an admin does when the holder is GONE, and refusing on
// liveness would block the operation at the only moment it is needed. Showing the state
// rather than filtering on it leaves that judgement where it belongs.
//
// The member that answered is absent because a member is never in its own roster, and the
// backend requires the target to be one — so the option it cannot accept is not offered.
//
// Nobody is a real choice and is written as one. It converges as a decision, which is a
// different thing from an assignment nobody has heard about yet.
function CapabilityAssignDialog({ hostId, capability, currentMemberId, members, onClose }) {
  const [choice, setChoice] = React.useState(currentMemberId || "");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const candidates = (members || []).filter(m => m.nodeId);

  const submit = () => {
    if (busy || choice === (currentMemberId || "")) return;
    setBusy(true);
    setErr(null);
    api.members(hostId).assign(capability, choice)
      .then(() => { clusterStore.refresh(hostId); onClose(); })
      .catch((e) => { setErr((e && e.message) || "That didn't go through."); setBusy(false); });
  };

  return (
    <Modal onClose={onClose} canClose={!busy}>
      <div className="modal cluster-assign">
        <h2 className="cluster-assign__title">Holder of <b>{capability}</b></h2>
        <div className="cluster-assign__list" role="radiogroup" aria-label={"Which member holds " + capability}>
          {candidates.map(m => (
            <label
              key={m.nodeId}
              className={"cluster-assign__opt" + (choice === m.nodeId ? " cluster-assign__opt--on" : "")}
            >
              <input
                type="radio"
                name="cluster-assign"
                checked={choice === m.nodeId}
                onChange={() => setChoice(m.nodeId)}
                disabled={busy}
              />
              <span className="cluster-assign__name">{m.label || m.nodeId}</span>
              <span className="cluster-assign__id">{m.nodeId}</span>
              <MemberState membership={m.membership} status={m.status} enabled={m.enabled} />
            </label>
          ))}
          <label className={"cluster-assign__opt" + (choice === "" ? " cluster-assign__opt--on" : "")}>
            <input
              type="radio"
              name="cluster-assign"
              checked={choice === ""}
              onChange={() => setChoice("")}
              disabled={busy}
            />
            <span className="cluster-assign__name">Nobody</span>
            <span className="cluster-assign__id">not served</span>
          </label>
        </div>
        {err && (
          <p className="cluster-dialog__err"><Icon name="triangle-alert" size={13} />{err}</p>
        )}
        <div className="host-remove__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="host-btn host-btn--primary"
            onClick={submit}
            disabled={busy || choice === (currentMemberId || "")}
          >
            <Icon name={busy ? "loader" : "anchor"} size={14} className={busy ? "cluster-spin" : ""} />
            {busy ? "Assigning…" : "Assign"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export { MemberRowActions, MemberRemoveDialog, CapabilityAssignDialog };
