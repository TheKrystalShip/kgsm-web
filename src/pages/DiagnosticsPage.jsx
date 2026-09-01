import React from "react";
import { anchoredAlerts, alertsTone } from "../components/ContextualAlerts.jsx";
import { HostConnection } from "../components/HostConnection.jsx";
import { hostMetricsFreshness } from "../components/HostCardBody.jsx";
import { HostDeniedNotice } from "../components/host-helpers.jsx";
import { Icon } from "../components/Icon.jsx";
import { FleetSkeleton } from "../components/Skeletons.jsx";
import { useAlerts } from "../components/NeedsAttention.jsx";
import { SubTabs } from "../components/SubTabs.jsx";
import { can } from "../lib/persona.js";
import { sessionStore } from "../lib/sessionStore.js";
import { useStore } from "../lib/store.js";
import { clusterStore, hostsStore, subscribeHostMetrics } from "../lib/stores.js";
import { pingStore, startPingLoop } from "../lib/stores/ui.js";
import { ROUTE_TABS } from "../lib/labels.js";

// Imports from extracted modules
import { AnchorPage } from "./accounts/AnchorPage.jsx";
import { AddNodeModal } from "./diagnostics/AddNodeModal.jsx";
import { ClusterAnchorList } from "./diagnostics/ClusterAnchorList.jsx";
import { ClusterCapabilities } from "./diagnostics/ClusterCapabilities.jsx";
import { ClusterKpis } from "./diagnostics/ClusterKpis.jsx";
import { ClusterNodeList } from "./diagnostics/ClusterNodeList.jsx";
import { ClusterRail } from "./diagnostics/ClusterRail.jsx";
import { anchorEntries, buildClusterNodes } from "./diagnostics/clusterNodes.js";
import { DiagOverview } from "./diagnostics/DiagOverview.jsx";
import { DiagResources } from "./diagnostics/DiagResources.jsx";
import { DiagServices } from "./diagnostics/DiagServices.jsx";
import { DiagLogs } from "./diagnostics/DiagLogs.jsx";
import { MemberSettings } from "./diagnostics/MemberSettings.jsx";
import { QueuedJobs, RunningJobs } from "./diagnostics/DiagJobs.jsx";

// The map ships Europe's coastlines. That is worth a chunk of its own rather than a share of
// every first paint, so it arrives with the tab that draws it.
const ClusterMap = React.lazy(() => import("./diagnostics/ClusterMap.jsx"));

// Re-export from shared modules so existing consumers don't break.
export { CapacityMeter, HostCapacityStrip, hostCapacityMeters } from "../components/host-helpers.jsx";

function ClusterPage({ focusHostId, tab: tabProp, onTabChange, onFocusHost, onAsk, onRunAlertAction, onOpenServer, onViewAlerts, onViewAudit, onOpenLeaf, onOpenAnchor }) {
  useAlerts();
  const hosts = useStore(hostsStore, s => s.list);
  const dataLoading = useStore(hostsStore, s => s.status === "loading" && !s.everLoaded);
  const tab = tabProp || "overview";
  const setTab = onTabChange || (() => {});
  const [, setClock] = React.useState(0);
  React.useEffect(() => {
    if (!focusHostId) return;
    const t = setInterval(() => setClock(c => c + 1), 1000);
    return () => clearInterval(t);
  }, [focusHostId]);
  React.useEffect(() => subscribeHostMetrics(focusHostId), [focusHostId]);
  const [addingNode, setAddingNode] = React.useState(false);

  // Which member the pointer is over. The constellation and the two member cards are one
  // instrument, so hovering a dot lights its row and hovering a row lights its dot — the state
  // is the page's because it is the only thing that holds both.
  const [hoveredNode, setHoveredNode] = React.useState(null);
  const manageable = hosts.filter(h => can("host.manage"));
  const clusterNodesRaw = useStore(clusterStore, s => s.nodes);
  const clusterAdmin = useStore(clusterStore, s => s.admin);
  const clusterCapabilities = useStore(clusterStore, s => s.capabilities);
  // "Add node" federates through one node's peer roster (admin-only) as part of
  // the unified add flow. The modal names that node itself — a sole manageable
  // node is it, otherwise it asks — so the flow never guesses where to federate.
  const canFederate = manageable.length > 0 && !!clusterAdmin;
  const pingByHost = useStore(pingStore, s => s.byHost);
  React.useEffect(() => { startPingLoop(); }, []);
  // The roster has ONE owner: cluster discovery keeps clusterStore current for
  // the whole app, at boot and on its own cadence. This page reads it.
  //
  // Every Cluster-page surface plots every member, because latency and position are facts about a
  // member and not about a kind. The anchors are split back out here for one question the page
  // alone asks — which kind of member a cluster route names — while the cards build their own lists.
  const clusterNodes = React.useMemo(
    () => buildClusterNodes(hosts, clusterNodesRaw, pingByHost),
    [hosts, clusterNodesRaw, pingByHost]);
  const clusterAnchorRows = React.useMemo(() => anchorEntries(clusterNodes), [clusterNodes]);
  const selectNode = (key) => onFocusHost(key);

  const modals = addingNode
    ? <AddNodeModal federateHosts={manageable} canFederate={canFederate} onClose={() => setAddingNode(false)} />
    : null;

  if (!hosts.length) {
    return (
      <>
        <div className="dash-head">
          <div className="dash-head__row">
            <h1>Cluster</h1>
            <button className="fb-editor__btn servers-toolbar__new" onClick={() => setAddingNode(true)}>
              <Icon name="plus" size={13} strokeWidth={2.4} />&nbsp;Add node
            </button>
          </div>
          <div className="dash-head__sub">No nodes connected yet.</div>
        </div>
        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-sm)", padding: 60, textAlign: "center", color: "var(--fg-3)" }}>
          <Icon name="server-off" size={28} />
          <div style={{ marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>No nodes configured</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>Add a node to start aggregating servers and diagnostics.</div>
        </div>
        {modals}
      </>
    );
  }

  // A cluster route names a MEMBER, and a member is a node or an anchor. An anchor is not in the
  // connection set — this browser drives nodes, and an anchor serves one capability rather than
  // anything to drive — so it is looked up in the roster and its own page is rendered here. Checked
  // before the fall-through below, which would otherwise read "not a node I hold" as "no member
  // named" and quietly show the grid.
  const anchorMember = focusHostId
    ? (clusterAnchorRows.find(e => e.fed && e.fed.nodeId === focusHostId) || null)
    : null;

  if (anchorMember) {
    const held = clusterCapabilities.find(c => c.held && c.memberId === focusHostId);
    return (
      <>
        <AnchorPage
          member={{ ...anchorMember.fed, capability: held ? held.capability : null }}
          tab={tab}
          onSelectTab={setTab} />
        {modals}
      </>
    );
  }

  // A member the roster names that this browser holds no session with — discovered by gossip, or
  // departed. It reports no telemetry, so there is no deep-dive to render; what it can still answer
  // is what the cluster should do about it, and a departed member is precisely the one somebody
  // came here to remove.
  const rosterOnly = focusHostId && !hosts.find(h => h.id === focusHostId)
    ? (clusterNodes.find(e => e.ghost && e.fed && e.fed.nodeId === focusHostId) || null)
    : null;

  if (rosterOnly) {
    const fed = rosterOnly.fed;
    return (
      <>
        <div className="diag-head">
          <div className="diag-head__title">
            <h1>{fed.label || fed.nodeId}</h1>
            <div className="dash-head__sub">
              {fed.nodeId}{fed.clientUrl ? " · " + fed.clientUrl : ""}
            </div>
          </div>
        </div>
        <SubTabs tabs={ROUTE_TABS.member} active="settings" onChange={() => {}} />
        <MemberSettings host={null} member={fed} />
        {modals}
      </>
    );
  }

  if (!focusHostId || !hosts.find(h => h.id === focusHostId)) {
    // The cluster's own tabs. A member's tabs use the same `tab` prop one segment deeper, so the
    // page falls back to its own default rather than rendering a member's tab name here.
    const rootTab = ROUTE_TABS.clusterRoot.some(t => t.id === tab) ? tab : "overview";
    return (
      <>
        <div className="dash-head">
          <div className="dash-head__row">
            <h1>Cluster</h1>
            <button className="fb-editor__btn servers-toolbar__new" onClick={() => setAddingNode(true)}>
              <Icon name="plus" size={13} strokeWidth={2.4} />&nbsp;Add node
            </button>
          </div>
          <div className="dash-head__sub">Every member of this cluster — what it holds, how far away it is, and where it is.</div>
        </div>

        <div className="subtabs-row">
          <SubTabs tabs={ROUTE_TABS.clusterRoot} active={rootTab} onChange={setTab} />
        </div>

        {dataLoading ? <FleetSkeleton /> : (
          <>
            {rootTab === "overview" && (
              <>
                <ClusterKpis entries={clusterNodes} capabilityRows={clusterCapabilities} />
                <ClusterNodeList hovered={hoveredNode} onHover={setHoveredNode} />
                <ClusterAnchorList hovered={hoveredNode} onHover={setHoveredNode} />
              </>
            )}
            {rootTab === "reach" && (
              <>
                <ClusterRail
                  entries={clusterNodes}
                  capabilityRows={clusterCapabilities}
                  hovered={hoveredNode}
                  onHover={setHoveredNode}
                  onSelect={selectNode}
                />
                <React.Suspense fallback={null}>
                  <ClusterMap
                    entries={clusterNodes}
                    hovered={hoveredNode}
                    onHover={setHoveredNode}
                    onSelect={selectNode}
                  />
                </React.Suspense>
              </>
            )}
            {rootTab === "capabilities" && (
              <ClusterCapabilities
                hovered={hoveredNode}
                onHover={setHoveredNode}
                onSelect={selectNode}
              />
            )}
          </>
        )}
        {modals}
      </>
    );
  }

  const host = hosts.find(h => h.id === focusHostId);

  if (sessionStore.nodeRefusal(host.id)) {
    return (
      <>
        <div className="diag-head">
          <div className="diag-head__title">
            <h1>{host.name}</h1>
            <div className="dash-head__sub">{host.hostname} · {host.region}</div>
          </div>
        </div>
        <HostDeniedNotice host={host} embedded
          onBack={() => onFocusHost(null)} />
        {modals}
      </>
    );
  }

  const ping = pingByHost[host.id];
  const memberRow = clusterNodes.find(e => e.fed && e.fed.nodeId === host.id);
  const headerChrome = (
    <div className="diag-head">
      <div className="diag-head__title">
        <h1>
          {host.name}
          {/* The way to the name, beside the name. It opens the tab that holds it rather than a
              dialog of its own, so there is one place a member is renamed and one form doing it. */}
          <button className="diag-head__edit" onClick={() => setTab("settings")}
            title={"Rename " + host.name} aria-label={"Rename " + host.name}>
            <Icon name="pencil" size={13} />
          </button>
        </h1>
        <div className="dash-head__sub">{host.hostname} · {host.region} — host machine health, distinct from per-game-server metrics.</div>
      </div>
      {host.online && (
        <span className="diag-head__link">
          <HostConnection hostId={host.id} full />
          {/* The pill says whether the channel is up; the round trip says how far
              away it is. Same subject, so they sit together. */}
          {ping && ping.ms != null && (
            <span className="dash-fleet-row__latency">{Math.round(ping.ms)}ms</span>
          )}
        </span>
      )}
    </div>
  );

  if (!host.online || host.ram.total_gb === 0) {
    return (
      <>
        {headerChrome}
        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-sm)", padding: 56, textAlign: "center", color: "var(--fg-3)" }}>
          <Icon name="plug-zap" size={26} />
          <div style={{ marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>{host.name} is {host._pending ? "connecting" : host.online ? "awaiting telemetry" : "disconnected"}</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>{(host._pending || host.online) ? "Waiting for the agent\u2019s first check-in \u2014 diagnostics appear once it reports in." : "Reconnect this host from its \u2026 menu to resume telemetry."}</div>
        </div>
        {modals}
      </>
    );
  }

  const hostAlerts = anchoredAlerts(an => an.surface === "diagnostics" && an.hostId === host.id);
  const fresh = hostMetricsFreshness(host);
  const resourceAlerts = hostAlerts.filter(a => a.anchor.tab === "resources");
  const serviceAlerts  = hostAlerts.filter(a => a.anchor.tab === "services");
  const badge = (items) => items.length ? { badge: items.length, badgeTone: alertsTone(items) } : {};
  // The strip's names and order are shared with the breadcrumb (lib/labels.js); what belongs to this
  // page is the alert count each tab carries.
  const tabBadges = { resources: badge(resourceAlerts), services: badge(serviceAlerts) };
  const tabs = ROUTE_TABS.cluster.map(t => ({ ...t, ...(tabBadges[t.id] || {}) }));

  return (
    <>
      {headerChrome}
      <SubTabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === "overview"  && <DiagOverview host={host} fresh={fresh} onAsk={onAsk} onRun={onRunAlertAction} onViewAlerts={onViewAlerts} onViewAudit={onViewAudit} onViewServices={() => setTab("services")} />}
      {tab === "resources" && <DiagResources host={host} fresh={fresh} />}
      {tab === "services"  && <DiagServices host={host} onOpenLeaf={(leaf, leafTab) => onOpenLeaf && onOpenLeaf(host.id, leaf, leafTab)} />}
      {tab === "jobs"      && (
        // The page arranges them; neither component knows the other exists.
        <div className="jobq-grid">
          <QueuedJobs host={host} />
          <RunningJobs host={host} />
        </div>
      )}
      {tab === "logs"      && <DiagLogs host={host} />}
      {tab === "settings"  && <MemberSettings host={host} member={memberRow ? memberRow.fed : null} />}
      {modals}
    </>
  );
}

export { ClusterPage };
export default ClusterPage;
