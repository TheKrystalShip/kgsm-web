// MemberSettings — the Settings tab on a member's page: what can be changed about this member, and
// what can be done to its place in the cluster.
//
// It is one component for both kinds of member because the two questions are the cluster's rather
// than the machine's: what is this called, and is it still one of us. What differs is what each kind
// can answer. A NODE can be renamed, because a node is a host this browser holds a session with and
// its label is that host's to change. An ANCHOR cannot — the cluster's member patch carries the
// enabled flag and nothing else, so there is no name to write and no field is offered for one. An
// anchor instead holds a capability, and moving it is the act that has to happen before it can be
// removed at all.
//
// These controls used to sit on the member rows, where every row spent a second line on them and the
// one a person wanted was as far from the member as the ones they did not. Here there is exactly one
// member in question and the page already says which.

import React from "react";
import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { api } from "../../lib/apiClient.js";
import { can } from "../../lib/persona.js";
import { useStore } from "../../lib/store.js";
import { clusterStore, hostsStore } from "../../lib/stores.js";
import { CapabilityAssignDialog, MemberRemoveDialog, memberRemoval } from "./clusterActions.jsx";

// Renaming a node. The label is what every surface shows and the region is what the identity card
// and the member row carry beside it; the id is neither of them and is not editable anywhere,
// because it is the key every route, stream and stored preference is filed under.
function NodeIdentity({ host }) {
  const [label, setLabel] = React.useState(host.name || "");
  const [region, setRegion] = React.useState(host.region && host.region !== "—" ? host.region : "");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [saved, setSaved] = React.useState(false);

  // A node renamed elsewhere — its own page, another browser — should not be overwritten by a form
  // holding what it was called when this tab mounted.
  React.useEffect(() => {
    setLabel(host.name || "");
    setRegion(host.region && host.region !== "—" ? host.region : "");
  }, [host.id, host.name, host.region]);

  const dirty = label.trim() !== (host.name || "")
    || region.trim() !== (host.region && host.region !== "—" ? host.region : "");

  const save = () => {
    if (busy || !dirty || !label.trim()) return;
    setBusy(true); setErr(null); setSaved(false);
    const next = { label: label.trim(), region: region.trim() };
    // Optimistic, then reconciled from the answer — the same shape the row's control used, so a
    // rename lands on every surface at once rather than after the next roster read.
    hostsStore.update(host.id, { name: next.label, region: next.region || "—" });
    const client = api.host ? api.host(host.id) : api;
    Promise.resolve(client.patch("/hosts/" + host.id, next))
      .then((updated) => {
        if (updated && updated.id) hostsStore.update(host.id, { name: updated.name, region: updated.region });
        setSaved(true);
      })
      .catch((e) => setErr((e && e.message) || "That didn't go through."))
      .finally(() => setBusy(false));
  };

  return (
    <BriefCard icon="pencil" title="Name">
      <div className="member-settings__form">
        <label className="host-field">
          <span className="host-field__label">Display name</span>
          <input className="host-field__input" value={label} maxLength={64}
            placeholder="e.g. Frankfurt box"
            onChange={(e) => { setLabel(e.target.value); setSaved(false); }} />
        </label>
        <label className="host-field">
          <span className="host-field__label">Region <span className="host-field__opt">optional</span></span>
          <input className="host-field__input host-field__input--mono" value={region} maxLength={64}
            placeholder="e.g. eu-west" spellCheck="false"
            onChange={(e) => { setRegion(e.target.value); setSaved(false); }} />
        </label>
        {/* The id is neither of the above and is editable nowhere, because it is the key every
            route, stream and stored preference is filed under. It is shown because it is the name
            a person types. */}
        <div className="host-field">
          <span className="host-field__label">Node id</span>
          <code className="member-settings__id">{host.id}</code>
        </div>
      </div>
      {err && <p className="cluster-dialog__err"><Icon name="triangle-alert" size={13} />{err}</p>}
      <div className="member-settings__foot">
        {saved && !dirty && <span className="member-settings__saved"><Icon name="check" size={13} />Saved</span>}
        <button className="host-btn host-btn--primary" onClick={save} disabled={busy || !dirty || !label.trim()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </BriefCard>
  );
}

// What this anchor serves the cluster, and the control that moves it. Moving it is also the thing
// that has to happen before the member can be removed, which is why it sits above that card.
function AnchorCapability({ member, rosterFrom, members, canManage }) {
  const [assigning, setAssigning] = React.useState(false);
  const capability = member && member.capability;

  return (
    <BriefCard icon="anchor" title="Capability">
      <div className="member-settings__row">
        <div>
          <div className="member-settings__value">
            {capability ? <>Holds this cluster’s <b>{capability}</b></> : "Holds no capability yet"}
          </div>
          <div className="member-settings__hint">{member.nodeId}</div>
        </div>
        {canManage && capability && (
          <button className="host-btn" onClick={() => setAssigning(true)}>Move {capability}</button>
        )}
      </div>
      {assigning && (
        <CapabilityAssignDialog
          hostId={rosterFrom}
          capability={capability}
          currentMemberId={member.nodeId}
          members={members}
          onClose={() => setAssigning(false)}
        />
      )}
    </BriefCard>
  );
}

// Taking a member out of the cluster. The guard is `memberRemoval`'s and is stated in place rather
// than only inside the dialog, because here there is room to say why the button will not act — a
// member that is still gossiping re-asserts itself and comes back, which is what stops a live member
// being buried by a false report.
function MemberMembership({ member, rosterFrom }) {
  const [removing, setRemoving] = React.useState(false);
  const guard = memberRemoval(member);

  return (
    <BriefCard icon="trash-2" title="Membership">
      <div className="member-settings__row">
        <div className="member-settings__value member-settings__value--muted">{guard.ok ? guard.reason || "" : guard.reason}</div>
        <button className="host-btn host-btn--danger" onClick={() => setRemoving(true)} disabled={!guard.ok}>
          Remove from cluster
        </button>
      </div>
      {removing && (
        <MemberRemoveDialog hostId={rosterFrom} member={member} onClose={() => setRemoving(false)} />
      )}
    </BriefCard>
  );
}

// `member` is the roster row — the only thing that carries the peer handle a removal is addressed
// with. `host` is the connected host behind it, present for a node and absent for an anchor.
function MemberSettings({ member, host }) {
  const clusterAdmin = useStore(clusterStore, s => s.admin);
  const rosterFrom = useStore(clusterStore, s => s.rosterFrom);
  const roster = useStore(clusterStore, s => s.nodes);
  const canManage = can("host.manage") && !!clusterAdmin && !!rosterFrom;

  const isAnchor = !!member && member.kind === "anchor";

  return (
    <div className="member-settings">
      {host && <NodeIdentity host={host} />}
      {isAnchor && member && (
        <AnchorCapability member={member} rosterFrom={rosterFrom} members={roster} canManage={canManage} />
      )}
      {canManage && member && <MemberMembership member={member} rosterFrom={rosterFrom} />}
    </div>
  );
}

export { MemberSettings };
