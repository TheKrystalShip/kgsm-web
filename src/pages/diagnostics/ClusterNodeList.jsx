// ClusterNodeList — the Nodes card: one row per cluster NODE, whether or not this
// browser holds a connected-host session for it.
//
// It is the Cluster page's primitive list and a pinnable dashboard widget, and it is
// the same component in both places: it reads the roster, the connections, the ping
// and the persona from the stores rather than being handed them, so nothing above it
// has to be wired for it to render.
//
// A row states what a node is carrying and navigates to it: status dot, name, round
// trip, the three capacity meters with their absolute readings, and how much is
// running on it. Beneath that sits the federation strip — membership badges, the
// member controls an admin holds (`clusterActions.jsx`, shared with the Anchors card)
// and this node's own menu.
//
// Card height is therefore a function of the node count and nothing else, which is
// what lets the widget declare a one-row span: a grid row span is a MINIMUM, so a
// card that states its own height leaves no cell underfilled.
//
// Everything rendered is a field the host DTO already carries. A node whose metrics
// feed is down has no capacity to show and says so — never a zero.
//
// `hovered`/`onHover` are the Cluster page's constellation sync. Absent on a
// dashboard, where there is no map beside the list to sync with.

import React from "react";

import { BriefCard } from "../../components/BriefCard.jsx";
import { alertsTone, anchoredAlerts } from "../../components/ContextualAlerts.jsx";
import { HostMeters, hostHealth, hostMetricsFreshness } from "../../components/HostCardBody.jsx";
import { Icon } from "../../components/Icon.jsx";
import { useNav } from "../../components/NavContext.jsx";
import { PinButton } from "../../components/widgets/PinButton.jsx";
import { api } from "../../lib/apiClient.js";
import { can } from "../../lib/persona.js";
import { playerTally } from "../../lib/servers.js";
import { useStore } from "../../lib/store.js";
import { clusterStore, hostsStore, serversStore } from "../../lib/stores.js";
import { pingStore } from "../../lib/stores/ui.js";
import { MemberRowActions } from "./clusterActions.jsx";
import { MemberState, membershipRowTone } from "./clusterBadges.jsx";
import { HostEditorModal, NodeEditButton } from "./diagComponents.jsx";
import { buildClusterNodes, nodeEntries } from "./clusterNodes.js";

// What a node is carrying. `unseen` counts servers that cannot report a roster —
// their players are not zero, they are unknown, so the tally says "+" and names
// how many in its tooltip rather than absorbing them into the number.
function NodeCounts({ servers }) {
  const running = servers.filter(s => s.status === "online").length;
  const { total: players, unseen } = playerTally(servers);
  return (
    <span className="dash-fleet-row__counts">
      <b>{running} / {servers.length} running</b>
      <span title={unseen ? unseen + (unseen === 1 ? " server can't report who's on" : " servers can't report who's on") : undefined}>
        {players}{unseen ? "+" : ""} {players === 1 && !unseen ? "player" : "players"} connected
      </span>
    </span>
  );
}

// A federation peer this SPA holds no connected-host session for. Same row layout as
// a connected node, but the meter slot is replaced by an honest "discovered, not
// connected" state (never fabricated capacity) and the dot's tone comes from
// federation membership, the only axis a ghost has.
function GhostNodeRow({ n, hovered, onHover, onSelect, hostId, canManagePeers }) {
  const isHovered = hovered === n.key;
  const tone = membershipRowTone(n.fed.membership);
  return (
    <div
      className={"cluster-node-row cluster-node-row--ghost" + (isHovered ? " cluster-node-row--hovered" : "")}
      onMouseEnter={() => onHover(n.key)}
      onMouseLeave={() => onHover(null)}
    >
      <button className={"dash-fleet-row dash-fleet-row--" + tone + " dash-fleet-row--ghost dash-fleet-row--counts"}
        onClick={() => onSelect(n.key)}>
        <span className="dash-fleet-row__id">
          <span className={"dash-fleet-row__dot dash-fleet-row__dot--" + tone}></span>
          <span className="dash-fleet-row__name">{n.fed.label}</span>
          {n.latencyMs != null && <span className="dash-fleet-row__latency">{Math.round(n.latencyMs)}ms</span>}
        </span>
        <span className="dash-fleet-row__offline dash-fleet-row__offline--ghost">
          <Icon name="radar" size={13} /> Discovered · not connected
        </span>
        <span className="dash-fleet-row__counts">
          <b>—</b>
          <span>not connected</span>
        </span>
        <span className="dash-fleet-row__end">
          <Icon name="chevron-right" size={16} className="dash-fleet-row__go" />
        </span>
      </button>
      <div className="cluster-node-row__badges">
        <MemberState membership={n.fed.membership} status={n.fed.status} enabled={n.fed.enabled} />
        {n.fed.clientUrl && <span className="cluster-node-row__url">{n.fed.clientUrl}</span>}
        {canManagePeers && n.fed && <MemberRowActions hostId={hostId} member={n.fed} />}
      </div>
    </div>
  );
}

function NodeRow({ n, servers, hovered, onHover, onSelect, hostId, canManagePeers, onEdit }) {
  const h = n.host;
  const alerts = anchoredAlerts(an => an.surface === "diagnostics" && an.hostId === h.id);
  const { denied, metricsDown, meters, tone } = hostHealth(h);
  const fresh = hostMetricsFreshness(h);
  const mine = React.useMemo(() => servers.filter(s => s.hostId === h.id), [servers, h.id]);
  const isHovered = hovered === n.key;
  // Frozen is a statement ABOUT readings, so it is only worth making where there
  // are readings to qualify. A node showing no meters already says why in their
  // place, and saying it twice reads as two different faults.
  const stale = fresh.frozen && meters.length > 0;

  return (
    <div
      className={"cluster-node-row" + (isHovered ? " cluster-node-row--hovered" : "")}
      onMouseEnter={() => onHover(n.key)}
      onMouseLeave={() => onHover(null)}
    >
      <button className={"dash-fleet-row dash-fleet-row--" + tone + " dash-fleet-row--counts" + (stale ? " is-frozen" : "")}
        onClick={() => onSelect(n.key)}>
        <span className="dash-fleet-row__id">
          <span className={"dash-fleet-row__dot dash-fleet-row__dot--" + tone}></span>
          <span className="dash-fleet-row__name">{h.name}</span>
          {h.region && h.region !== "—" && <span className="dash-fleet-row__region">{h.region}</span>}
          {/* Readings we HAVE but that stopped updating are worse than none shown: say
              they are frozen, in place of a round trip that is equally stale. */}
          {stale
            ? <span className="dash-fleet-row__latency dash-fleet-row__latency--stale" title="These are the last readings measured, not live">
                frozen{fresh.label ? " · " + fresh.label.replace(/\s*ago$/, "") : ""}
              </span>
            : n.latencyMs != null && <span className="dash-fleet-row__latency">{Math.round(n.latencyMs)}ms</span>}
        </span>

        {meters.length ? (
          <span className="dash-fleet-row__meters">
            <HostMeters meters={meters} detail />
          </span>
        ) : denied ? (
          <span className="dash-fleet-row__offline dash-fleet-row__offline--denied">
            <Icon name="lock" size={13} /> No access on this node
          </span>
        ) : metricsDown ? (
          <span className="dash-fleet-row__offline dash-fleet-row__offline--metrics">
            <Icon name="activity" size={13} /> Metrics unavailable — capacity unknown
          </span>
        ) : (
          <span className="dash-fleet-row__offline">
            <Icon name={h._pending ? "loader-2" : "moon"} size={13} className={h._pending ? "is-spinning" : ""} />
            {h._pending ? "Awaiting telemetry" : "Disconnected"}
          </span>
        )}

        <NodeCounts servers={mine} />

        <span className="dash-fleet-row__end">
          {alerts.length > 0 && (
            <span className={"fleet-card__alerts fleet-card__alerts--" + (alertsTone(alerts) === "danger" ? "danger" : "warn")}>
              <Icon name="triangle-alert" size={11} strokeWidth={2.4} />{alerts.length}
            </span>
          )}
          <Icon name="chevron-right" size={16} className="dash-fleet-row__go" />
        </span>
      </button>

      <div className="cluster-node-row__badges">
        {n.fed && <MemberState membership={n.fed.membership} status={n.fed.status} enabled={n.fed.enabled} />}
        {canManagePeers && n.fed && <MemberRowActions hostId={hostId} member={n.fed} />}
        <span className="cluster-node-row__spacer" />
        <NodeEditButton host={n.host} onEdit={onEdit} />
      </div>
    </div>
  );
}

const NOOP = () => {};

function ClusterNodeList({ hovered, onHover }) {
  const nav = useNav();
  const hosts = useStore(hostsStore, s => s.list);
  const servers = useStore(serversStore, s => s.list);
  const clusterNodesRaw = useStore(clusterStore, s => s.nodes);
  const clusterAdmin = useStore(clusterStore, s => s.admin);
  const clusterErrored = useStore(clusterStore, s => s.status === "error");
  const pingByHost = useStore(pingStore, s => s.byHost);
  const rosterFrom = useStore(clusterStore, s => s.rosterFrom);

  // Renaming a node. The card owns the form because the row owns the control: one whose modal lived
  // on the page would be dead the moment the card is pinned. Bringing a NEW node in is the page's
  // "Add node" and goes through AddNodeModal, which federates and connects for real.
  const [editing, setEditing] = React.useState(null);

  // A membership write is addressed with `peerId` — an id in one member's own peer table, which
  // means nothing anywhere else — so it goes back to whichever member answered the roster these
  // rows came from. Nothing is selected: the panel belongs to no member and reaches every one of
  // them across a network.
  const canManagePeers = !!rosterFrom && can("host.manage") && !!clusterAdmin;

  const nodes = React.useMemo(
    () => nodeEntries(buildClusterNodes(hosts, clusterNodesRaw, pingByHost)),
    [hosts, clusterNodesRaw, pingByHost]);

  const hover = onHover || NOOP;
  const select = (key) => nav.openHost(key);

  const saveHost = (fields) => {
    const id = editing && editing.id;
    if (!id) { setEditing(null); return; }
    hostsStore.update(id, { name: fields.label, region: fields.region || "—" });
    setEditing(null);
    const client = api.host ? api.host(id) : api;
    Promise.resolve(client.patch("/hosts/" + id, { label: fields.label, region: fields.region }))
      .then((updated) => {
        if (updated && updated.id) hostsStore.update(id, { name: updated.name, region: updated.region });
      })
      .catch(() => {});
  };
  return (
    <BriefCard
      icon="server-cog"
      title="Nodes"
      count={nodes.length}
      countTone="neutral"
      pin={<PinButton type="cluster.nodes" label="the cluster's nodes" />}
      meta={clusterErrored ? "Federation roster unavailable — showing connected nodes only." : null}
    >
      <div className="dash-fleet__rows">
        {nodes.map(n => (n.ghost
          ? <GhostNodeRow key={n.key} n={n} hovered={hovered} onHover={hover} onSelect={select}
              hostId={rosterFrom} canManagePeers={canManagePeers} />
          : <NodeRow key={n.key} n={n} servers={servers} hovered={hovered} onHover={hover} onSelect={select}
              hostId={rosterFrom} canManagePeers={canManagePeers} onEdit={setEditing} />))}
        {nodes.length === 0 && (
          <div className="chat-brief__empty chat-brief__empty--neutral">No nodes connected.</div>
        )}
      </div>
      {editing && <HostEditorModal host={editing} onSave={saveHost} onClose={() => setEditing(null)} />}
    </BriefCard>
  );
}

export { ClusterNodeList };
export default ClusterNodeList;
