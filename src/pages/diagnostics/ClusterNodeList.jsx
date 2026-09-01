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
import { hostHealth, hostMetricsFreshness } from "../../components/HostCardBody.jsx";
import { Icon } from "../../components/Icon.jsx";
import { useNav } from "../../components/NavContext.jsx";
import { PinButton } from "../../components/widgets/PinButton.jsx";
import { api } from "../../lib/apiClient.js";
import { formatLatency } from "../../lib/nodeLabel.js";
import { can } from "../../lib/persona.js";
import { playerTally } from "../../lib/servers.js";
import { useStore } from "../../lib/store.js";
import { clusterStore, hostsStore, serversStore } from "../../lib/stores.js";
import { pingStore } from "../../lib/stores/ui.js";
import { MemberRowActions } from "./clusterActions.jsx";
import { MemberState, membershipRowTone } from "./clusterBadges.jsx";
import { HostEditorModal, NodeEditButton } from "./diagComponents.jsx";
import { buildClusterNodes, nodeEntries } from "./clusterNodes.js";

// What a node is carrying, as chips beside what it holds — a count is a fact about the machine
// in the same way its capability is, and the two read as one answer to "what is this node doing".
//
// `unseen` counts servers that cannot report a roster — their players are not zero, they are
// unknown, so the tally says "+" and names how many in its tooltip rather than absorbing them
// into the number.
function NodeCountChips({ servers }) {
  const running = servers.filter(s => s.status === "online").length;
  const { total: players, unseen } = playerTally(servers);
  return (
    <>
      <span className="cluster-chip cluster-chip--kind">{running} / {servers.length} running</span>
      {(players > 0 || unseen > 0) && (
        <span className="cluster-chip cluster-chip--kind"
          title={unseen ? unseen + (unseen === 1 ? " server can't report who's on" : " servers can't report who's on") : undefined}>
          {players}{unseen ? "+" : ""} {players === 1 && !unseen ? "player" : "players"}
        </span>
      )}
    </>
  );
}

// One capacity meter, in the narrow column a fleet row can spare for three of them.
//
// The label is abbreviated because the column is 136px and "Memory" spends a third of it on a
// word the bar beside it already identifies; the absolute reading the meter carries — the number
// an operator actually reasons with — moves to the row's tooltip rather than to a line of its
// own, because a fleet row is scanned and the node's own page is where it is read.
const METER_SHORT = { cpu: "CPU", ram: "RAM", disk: "DISK" };
function MeterLine({ meter }) {
  const detail = [meter.detail, meter.flag].filter(Boolean).join(" · ");
  return (
    <span className={"nrm nrm--" + meter.tone} title={meter.label + " " + meter.value + (detail ? " · " + detail : "")}>
      <span className="nrm__k">{METER_SHORT[meter.key] || meter.label}</span>
      <i className="nrm__bar"><b style={{ width: Math.max(2, Math.min(100, meter.pct)) + "%" }}></b></i>
      <span className="nrm__v">{meter.value}</span>
    </span>
  );
}

// A federation peer this SPA holds no connected-host session for. Same row layout as
// a connected node, but the meter slot is replaced by an honest "discovered, not
// connected" state (never fabricated capacity) and the dot's tone comes from
// federation membership, the only axis a ghost has.
// The round trip, given a column of its own. It is the one number on a member row that is about
// the LINK rather than about the machine, and it is what a fleet is read for: which of these is
// far away. `formatLatency` still owns the wording — the unit is only split back off it so the
// figure can carry the size and the unit can stay quiet beside it.
function Reading({ ms }) {
  const text = formatLatency(ms);
  const unit = text.endsWith("ms") ? "ms" : null;
  return (
    <span className={"cluster-node-row__reading" + (unit ? "" : " cluster-node-row__reading--none")}>
      {unit ? text.slice(0, -2) : text}{unit && <small>{unit}</small>}
    </span>
  );
}

function GhostNodeRow({ n, hovered, onHover, onSelect, hostId, canManagePeers }) {
  const isHovered = hovered === n.key;
  const tone = membershipRowTone(n.fed.membership);
  return (
    <div
      className={"cluster-node-row cluster-node-row--ghost" + (isHovered ? " cluster-node-row--hovered" : "")}
      onMouseEnter={() => onHover(n.key)}
      onMouseLeave={() => onHover(null)}
    >
      <button className={"dash-fleet-row dash-fleet-row--" + tone + " dash-fleet-row--ghost"}
        onClick={() => onSelect(n.key)}>
        <span className={"dash-fleet-row__dot dash-fleet-row__dot--" + tone}></span>
        <span className="cluster-node-row__ident">
          <span className="cluster-node-row__top">
            <span className="dash-fleet-row__name">{n.fed.label}</span>
          </span>
          <span className="cluster-node-row__sub">{n.fed.nodeId}</span>
        </span>
        <span className="cluster-node-row__chips">
          <span className="cluster-chip cluster-chip--kind"><Icon name="radar" size={11} strokeWidth={2.2} />discovered</span>
        </span>
        <Reading ms={n.latencyMs} />
        <span className="cluster-node-row__meters">
          <span className="cluster-node-row__nometers">Not connected — no capacity to read</span>
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

// The line under the name: the id first, because it is the one a person types, then whatever the
// node reported about itself. A field the node did not report is left out rather than dashed — this
// is a subtitle, and a row of em-dashes in one reads as a fault. The id goes too when nobody has
// renamed the node, since printing the same word twice says nothing about it.
function identity(h) {
  return [h.id === h.name ? null : h.id,
    h.region && h.region !== "—" ? h.region : null,
    h.panel_version && h.panel_version !== "—" ? h.panel_version : null]
    .filter(Boolean).join(" · ");
}

function NodeRow({ n, servers, capability, hovered, onHover, onSelect, hostId, canManagePeers, onEdit }) {
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
      className={"cluster-node-row" + (isHovered ? " cluster-node-row--hovered" : "")
        + (!h.online && !h._pending ? " cluster-node-row--down" : "")}
      onMouseEnter={() => onHover(n.key)}
      onMouseLeave={() => onHover(null)}
    >
      <button className={"dash-fleet-row dash-fleet-row--" + tone + (stale ? " is-frozen" : "")}
        onClick={() => onSelect(n.key)}>
        <span className={"dash-fleet-row__dot dash-fleet-row__dot--" + tone}></span>

        {/* The id under the name, because a machine has two names and only one of them is the one
            you type. Whatever else the node reported about itself rides the same line. */}
        <span className="cluster-node-row__ident">
          <span className="cluster-node-row__top">
            <span className="dash-fleet-row__name">{h.name}</span>
          </span>
          <span className="cluster-node-row__sub">{identity(h)}</span>
        </span>

        {/* What the node holds and what it is carrying, then whatever is wrong with it. Readings we
            HAVE but that stopped updating are worse than none shown, so a frozen feed says so among
            the chips rather than being left to look like live capacity. */}
        <span className="cluster-node-row__chips">
          {capability && <span className="cluster-chip cluster-chip--cap">{capability}</span>}
          <NodeCountChips servers={mine} />
          {stale && (
            <span className="cluster-chip cluster-chip--warn" title="These are the last readings measured, not live">
              frozen{fresh.label ? " \u00b7 " + fresh.label.replace(/\s*ago$/, "") : ""}
            </span>
          )}
          {denied && <span className="cluster-chip cluster-chip--danger"><Icon name="lock" size={11} strokeWidth={2.2} />no access</span>}
          {!denied && metricsDown && <span className="cluster-chip cluster-chip--warn"><Icon name="activity" size={11} strokeWidth={2.2} />no metrics</span>}
          {!denied && !h.online && (
            <span className="cluster-chip cluster-chip--muted">
              <Icon name={h._pending ? "loader-2" : "moon"} size={11} strokeWidth={2.2} className={h._pending ? "is-spinning" : ""} />
              {h._pending ? "connecting" : "disconnected"}
            </span>
          )}
        </span>

        <Reading ms={n.latencyMs} />

        {/* Capacity, or the reason there is none. A node that cannot be measured says WHICH of the
            three reasons it is, because they need different things done about them. */}
        <span className="cluster-node-row__meters">
          {meters.length ? meters.map(m => <MeterLine key={m.key} meter={m} />) : (
            <span className="cluster-node-row__nometers">
              {denied ? "No access on this node"
                : metricsDown ? "Metrics unavailable \u2014 capacity unknown"
                : h._pending ? "Awaiting telemetry"
                : "Disconnected \u2014 no capacity to read"}
            </span>
          )}
        </span>


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
  const capabilities = useStore(clusterStore, s => s.capabilities);
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
  // What a node serves the whole cluster, stated on its own row. A node holds at most one
  // assignment, so this is a lookup and not a list.
  const capabilityOf = (memberId) => {
    const held = (capabilities || []).find(c => c.held && !c.orphaned && c.memberId === memberId);
    return held ? held.capability : null;
  };

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
          : <NodeRow key={n.key} n={n} servers={servers} capability={capabilityOf(n.host.id)}
              hovered={hovered} onHover={hover} onSelect={select}
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
