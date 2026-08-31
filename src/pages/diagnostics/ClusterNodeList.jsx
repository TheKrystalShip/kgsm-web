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
import { homeHostId } from "../../lib/config.js";
import { nodeLabel } from "../../lib/nodeLabel.js";
import { can } from "../../lib/persona.js";
import { playerTally } from "../../lib/servers.js";
import { useStore } from "../../lib/store.js";
import { clusterStore, hostsStore, serversStore } from "../../lib/stores.js";
import { pingStore } from "../../lib/stores/ui.js";
import { MemberRowActions } from "./clusterActions.jsx";
import { MemberState, membershipRowTone } from "./clusterBadges.jsx";
import { HostEditorModal, HostMenu, RemoveHostDialog } from "./diagComponents.jsx";
import { buildClusterNodes, nodeEntries } from "./clusterNodes.js";

// Where these controls write. Every member on this card is reached through ONE member, and it is
// the same one for every row — so it is stated once, at card level, rather than repeated per
// control or hidden in a tooltip that does not exist on a touch screen. What each write then does
// with that is the control's own business: disabling holds only there and says so, and the two
// that converge do not claim a scope they lack.
//
// Absent for somebody who cannot manage members. There is no write to place, so a route to it is
// noise.
function CardMeta({ acting, error }) {
  if (!acting && !error) return null;
  return (
    <span className="cluster-cardmeta">
      {acting && <span className="cluster-cardmeta__acting">Managing · {acting}</span>}
      {error && <span>Federation roster unavailable — showing connected nodes only.</span>}
    </span>
  );
}

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
  const canAct = canManagePeers && !!n.fed.peerId;
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
        {canAct && <MemberRowActions hostId={hostId} member={n.fed} />}
      </div>
    </div>
  );
}

function NodeRow({ n, servers, hovered, onHover, onSelect, hostId, canManagePeers, menuProps }) {
  const h = n.host;
  const alerts = anchoredAlerts(an => an.surface === "diagnostics" && an.hostId === h.id);
  const { denied, metricsDown, meters, tone } = hostHealth(h);
  const fresh = hostMetricsFreshness(h);
  const mine = React.useMemo(() => servers.filter(s => s.hostId === h.id), [servers, h.id]);
  const isHovered = hovered === n.key;
  const canAct = canManagePeers && n.fed && !!n.fed.peerId;
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
        {n.isLocal && (
          <span className="cluster-chip cluster-chip--local">
            <Icon name="map-pin" size={10} strokeWidth={2.2} />local
          </span>
        )}
        {n.fed && <MemberState membership={n.fed.membership} status={n.fed.status} enabled={n.fed.enabled} />}
        {canAct && <MemberRowActions hostId={hostId} member={n.fed} />}
        <span className="cluster-node-row__spacer" />
        <HostMenu host={n.host} {...menuProps} />
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

  // Editing an existing node's name/region, and dropping one. The card owns these because the
  // rows do: a menu whose modal lived on the page would be a dead control the moment the card is
  // pinned. Bringing a NEW node in is the page's "Add node" and goes through AddNodeModal, which
  // federates + connects for real rather than dropping a client-side skeleton.
  const [editing, setEditing] = React.useState(null);
  const [removing, setRemoving] = React.useState(null);

  const homeId = homeHostId();
  // A membership write lands on ONE member's roster, and it is the member serving this panel —
  // the address somebody actually typed, which is the member this browser is demonstrably
  // talking to. Stated at card level (CardMeta) rather than resolved out of sight, because
  // disabling is local to the member it is sent to and no gossip undoes it.
  const actingHostId = homeId;
  const actingLabel = actingHostId ? nodeLabel(actingHostId, hosts) : null;
  const canManagePeers = !!actingHostId && can("host.manage") && !!clusterAdmin;

  const nodes = React.useMemo(
    () => nodeEntries(buildClusterNodes(hosts, clusterNodesRaw, pingByHost, homeId)),
    [hosts, clusterNodesRaw, pingByHost, homeId]);

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
  const menuProps = {
    onEdit: (host) => setEditing(host),
    onToggle: (host) => hostsStore.update(host.id, { online: !host.online, _pending: false }),
    onRemove: (host) => setRemoving(host),
  };

  return (
    <BriefCard
      icon="server-cog"
      title="Nodes"
      count={nodes.length}
      countTone="neutral"
      pin={<PinButton type="cluster.nodes" label="the cluster's nodes" />}
      meta={<CardMeta acting={canManagePeers ? actingLabel : null} error={clusterErrored} />}
    >
      <div className="dash-fleet__rows">
        {nodes.map(n => (n.ghost
          ? <GhostNodeRow key={n.key} n={n} hovered={hovered} onHover={hover} onSelect={select}
              hostId={actingHostId} canManagePeers={canManagePeers} />
          : <NodeRow key={n.key} n={n} servers={servers} hovered={hovered} onHover={hover} onSelect={select}
              hostId={actingHostId} canManagePeers={canManagePeers} menuProps={menuProps} />))}
        {nodes.length === 0 && (
          <div className="chat-brief__empty chat-brief__empty--neutral">No nodes connected.</div>
        )}
      </div>
      {editing && <HostEditorModal host={editing} onSave={saveHost} onClose={() => setEditing(null)} />}
      {removing && (
        <RemoveHostDialog
          host={removing}
          serverCount={servers.filter(s => s.hostId === removing.id).length}
          onConfirm={() => { hostsStore.remove(removing.id); setRemoving(null); }}
          onClose={() => setRemoving(null)} />
      )}
    </BriefCard>
  );
}

export { ClusterNodeList };
export default ClusterNodeList;
