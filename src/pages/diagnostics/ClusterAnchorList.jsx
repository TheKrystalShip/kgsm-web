// ClusterAnchorList — the Anchors card.
//
// A cluster's members are nodes and anchors, and they get separate cards because they are
// separate things. A node runs the engine and game servers, so its row is CPU, memory and a
// live link. An anchor provides ONE capability to the whole cluster and has none of those by
// design — putting it in a card headed "Nodes", beside meters it will never fill, describes
// a node that is failing to report rather than a member doing exactly its job.
//
// The card is absent when there is nothing to say. Most installs are one machine with no
// anchor at all, and an empty card headed "Anchors" invites somebody to go and look for the
// thing that is missing. That is also why the widget is pinned from this card rather than
// offered by the Add-widget catalog: the card exists exactly where there is an anchor to pin.
//
// It is the Cluster page's second card and a pinnable dashboard widget, and it is the same
// component in both places: it reads the roster, the capability assignments and the persona
// from the stores rather than being handed them.
//
// `hovered`/`onHover` are the Cluster page's constellation sync. Absent on a dashboard, where
// there is no map beside the list to sync with.

import React from "react";
import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { useNav } from "../../components/NavContext.jsx";
import { PinButton } from "../../components/widgets/PinButton.jsx";
import { formatLatency } from "../../lib/nodeLabel.js";
import { can } from "../../lib/persona.js";
import { useStore } from "../../lib/store.js";
import { clusterStore, hostsStore } from "../../lib/stores.js";
import { pingStore } from "../../lib/stores/ui.js";
import { CapabilityAssignDialog, MemberRowActions } from "./clusterActions.jsx";
import { MemberState, membershipRowTone } from "./clusterBadges.jsx";
import { anchorEntries, buildClusterNodes } from "./clusterNodes.js";

// A capability nothing serves. It sits here rather than on the Nodes card because a
// capability is what an anchor holds — and it is the one state this page can report that
// nothing else surfaces: the holder was reaped by the failure timers while the assignment
// survived it, so every member stands by against somebody who will never answer, the
// capability is not served, and nothing errors because from the inside nothing failed.
//
// The member it names is precisely the one that is NOT in the list below, which is why the
// notice has to exist separately from the rows.
function OrphanedCapabilities({ capabilities, canReassign, onReassign }) {
  const orphaned = (capabilities || []).filter(c => c.orphaned);
  if (!orphaned.length) return null;
  return (
    <div className="cluster-orphan" role="status">
      <Icon name="alert-triangle" size={15} />
      <span className="cluster-orphan__text">
        {orphaned.map(c => (
          <span key={c.capability} className="cluster-orphan__line">
            <span>
              <b>{c.capability}</b> is assigned to <b>{c.memberId}</b>, which is no longer a member of
              this cluster. Nothing serves it until it is reassigned
              {canReassign ? "." : ", which an administrator can do."}
            </span>
            {canReassign && (
              <button className="host-btn host-btn--sm" onClick={() => onReassign(c)}>Reassign</button>
            )}
          </span>
        ))}
      </span>
    </div>
  );
}

// Only the member holding `auth` opens: its page is the cluster's accounts, and that is the whole of
// what there is to see behind an anchor. One holding nothing, or holding a capability with no page,
// has no destination — so the row does not pretend to be a link to one.
function AnchorRow({ entry, capability, hovered, onHover, onOpenAnchor, hostId, canManage, onReassign }) {
  const fed = entry.fed;
  const isHovered = hovered === entry.key;
  const tone = membershipRowTone(fed.membership);
  const latencyLabel = formatLatency(entry.latencyMs);
  const sub = [fed.label && fed.label !== fed.nodeId ? fed.nodeId : null, fed.apiVersion]
    .filter(Boolean).join(" · ");
  const opens = capability === "auth";

  return (
    <div
      className={"cluster-node-row cluster-node-row--anchor" + (isHovered ? " cluster-node-row--hovered" : "")}
      onMouseEnter={() => onHover(entry.key)}
      onMouseLeave={() => onHover(null)}
    >
      <div
        className={"dash-fleet-row dash-fleet-row--" + tone + (opens ? "" : " dash-fleet-row--static")}
        onClick={opens ? () => onOpenAnchor(fed.nodeId) : undefined}
      >
        <span className={"dash-fleet-row__dot dash-fleet-row__dot--" + tone}></span>

        {/* The id under the name, in the same place a node's sits, so the two cards read as one
            family — and dropped when the anchor has not been renamed, because the id and the name
            are then the same word. */}
        <span className="cluster-node-row__ident">
          <span className="cluster-node-row__top">
            <span className="dash-fleet-row__name">{fed.label || fed.nodeId}</span>
          </span>
          {sub && <span className="cluster-node-row__sub">{sub}</span>}
        </span>

        {/* What it holds, never what it is. "Anchor" is the card's own heading; the row's job is to
            say WHICH capability, because a cluster can have more than one and an anchor holding
            none is a promotion candidate rather than a broken member. It sits where a node's chips
            sit, because it is the same question answered about a different kind of member. */}
        <span className="cluster-node-row__chips">
          <span className="cluster-anchor-row__holds">
            <Icon name="anchor" size={13} />
            {capability
              ? <>Holds the cluster&apos;s <b>{capability}</b></>
              : "Holds no capability yet"}
          </span>
        </span>

        <span className={"cluster-node-row__reading" + (entry.latencyMs == null ? " cluster-node-row__reading--none" : "")}>
          {latencyLabel.endsWith("ms") ? latencyLabel.slice(0, -2) : latencyLabel}
          {latencyLabel.endsWith("ms") && <small>ms</small>}
        </span>

        <span className="dash-fleet-row__end">
          {opens && <Icon name="chevron-right" size={16} className="dash-fleet-row__go" />}
        </span>
      </div>
      <div className="cluster-node-row__badges">
        <MemberState membership={fed.membership} status={fed.status} enabled={fed.enabled} />
        {fed.clientUrl && <span className="cluster-node-row__url">{fed.clientUrl}</span>}
        {canManage && capability && (
          <button
            className="host-btn host-btn--sm cluster-node-row__cap"
            onClick={(e) => { e.stopPropagation(); onReassign({ capability, memberId: fed.nodeId }); }}
          >
            Move {capability}
          </button>
        )}
        {canManage && <MemberRowActions hostId={hostId} member={fed} />}
      </div>
    </div>
  );
}

const NOOP = () => {};

function ClusterAnchorList({ hovered, onHover }) {
  const nav = useNav();
  const [assigning, setAssigning] = React.useState(null);
  const hosts = useStore(hostsStore, s => s.list);
  const members = useStore(clusterStore, s => s.nodes);
  const capabilities = useStore(clusterStore, s => s.capabilities);
  const clusterAdmin = useStore(clusterStore, s => s.admin);
  const pingByHost = useStore(pingStore, s => s.byHost);
  const rosterFrom = useStore(clusterStore, s => s.rosterFrom);

  const anchors = React.useMemo(
    () => anchorEntries(buildClusterNodes(hosts, members, pingByHost)),
    [hosts, members, pingByHost]);

  // A capability assignment is cluster state — versioned, gossiped, convergent — so any member
  // serves it, and it goes back to whichever member answered the roster on screen. Removing a
  // member is addressed with `peerId`, which only that member's peer table holds. Nothing is
  // selected here; the panel belongs to no member.
  const canReassign = can("host.manage") && !!clusterAdmin && !!rosterFrom;

  const orphaned = (capabilities || []).filter(c => c.orphaned);
  const hover = onHover || NOOP;
  const capabilityOf = (memberId) => {
    const held = (capabilities || []).find(c => c.held && c.memberId === memberId);
    return held ? held.capability : null;
  };

  if (!anchors.length && !orphaned.length) return null;

  return (
    <BriefCard
      icon="anchor"
      title="Anchors"
      count={anchors.length}
      countTone="neutral"
      pin={<PinButton type="cluster.anchors" label="the cluster's anchors" />}
    >
      <OrphanedCapabilities capabilities={capabilities} canReassign={canReassign} onReassign={setAssigning} />
      <div className="dash-fleet__rows">
        {anchors.map(entry => (
          <AnchorRow
            key={entry.key}
            entry={entry}
            capability={capabilityOf(entry.fed.nodeId)}
            hovered={hovered}
            onHover={hover}
            onOpenAnchor={(memberId) => nav.openHost(memberId)}
            hostId={rosterFrom}
            canManage={canReassign}
            onReassign={setAssigning}
          />
        ))}
      </div>
      {assigning && (
        <CapabilityAssignDialog
          hostId={rosterFrom}
          capability={assigning.capability}
          currentMemberId={assigning.memberId}
          members={members}
          onClose={() => setAssigning(null)}
        />
      )}
    </BriefCard>
  );
}

export { ClusterAnchorList };
export default ClusterAnchorList;
