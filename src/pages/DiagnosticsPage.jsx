import React from "react";
import { alertsTone, anchoredAlerts } from "../components/ContextualAlerts.jsx";
import { HostConnection } from "../components/ErrorBoundary.jsx";
import { hostMetricsFreshness } from "../components/HostCardBody.jsx";
import { HostDeniedNotice } from "../components/host-helpers.jsx";
import { Icon } from "../components/Icon.jsx";
import { KPI } from "../components/KPI.jsx";
import { Pagination, useDebouncedValue } from "../components/Pagination.jsx";
import { FleetSkeleton } from "../components/Skeletons.jsx";
import { useAlerts } from "../components/NeedsAttention.jsx";
import { SubTabs } from "../components/SubTabs.jsx";
import { Toolbar, ToolbarCount, ToolbarSearch, ToolbarSpacer } from "../components/Toolbar.jsx";
import { api } from "../lib/apiClient.js";
import { sessionStore } from "../lib/sessionStore.js";
import { useStore } from "../lib/store.js";
import { hostsStore, selectedHostStore, serversStore, subscribeHostMetrics, useSelectedHostId } from "../lib/stores.js";

// Imports from extracted modules
import { makeHostSkeleton } from "./diagnostics/diagHelpers.js";
import { FleetHostCard, HostEditorModal, RemoveHostDialog } from "./diagnostics/diagComponents.jsx";
import { DiagOverview } from "./diagnostics/DiagOverview.jsx";
import { DiagResources } from "./diagnostics/DiagResources.jsx";
import { DiagServices } from "./diagnostics/DiagServices.jsx";
import { DiagLogs } from "./diagnostics/DiagLogs.jsx";

// Re-export from shared modules so existing consumers don't break.
export { CapacityMeter, HostCapacityStrip, hostCapacityMeters } from "../components/host-helpers.jsx";

function FleetPage({ focusHostId, tab: tabProp, onTabChange, onFocusHost, onAsk, onOpenServer, onOpenServerSettings, onViewAlerts, onViewAudit }) {
  useAlerts();
  const hosts = useStore(hostsStore, s => s.list);
  const dataLoading = useStore(hostsStore, s => s.status === "loading" && !s.everLoaded);
  const servers = useStore(serversStore, s => s.list);
  const activeId = useSelectedHostId();
  const tab = tabProp || "overview";
  const setTab = onTabChange || (() => {});
  const [, setClock] = React.useState(0);
  React.useEffect(() => {
    if (!focusHostId) return;
    const t = setInterval(() => setClock(c => c + 1), 1000);
    return () => clearInterval(t);
  }, [focusHostId]);
  React.useEffect(() => subscribeHostMetrics(focusHostId), [focusHostId]);
  const [editing, setEditing] = React.useState(null);
  const [removing, setRemoving] = React.useState(null);
  const [hostQuery, setHostQuery] = React.useState("");
  const [hostPage, setHostPage] = React.useState(0);
  const dq = useDebouncedValue(hostQuery, 250);
  const searchPending = hostQuery.trim() !== dq.trim();
  const hostQ = dq.trim().toLowerCase();
  React.useEffect(() => { setHostPage(0); }, [hostQ]);

  const countFor = (hostId) => servers.filter(s => s.hostId === hostId).length;

  const saveHost = (fields) => {
    if (editing && editing.id) {
      const id = editing.id;
      hostsStore.update(id, { name: fields.label, region: fields.region || "\u2014" });
      setEditing(null);
      const client = api.host ? api.host(id) : api;
      Promise.resolve(client.patch("/hosts/" + id, { label: fields.label, region: fields.region }))
        .then((updated) => {
          if (updated && updated.id) hostsStore.update(id, { name: updated.name, region: updated.region });
        })
        .catch(() => {});
    } else {
      hostsStore.add(makeHostSkeleton(fields));
      setEditing(null);
    }
  };
  const toggleHost = (host) => hostsStore.update(host.id, { online: !host.online, _pending: false });
  const confirmRemove = () => {
    if (!removing) return;
    const id = removing.id;
    hostsStore.remove(id);
    if (activeId === id) selectedHostStore.set("all");
    if (focusHostId === id) onFocusHost(null);
    setRemoving(null);
  };
  const menuProps = {
    onSetActive: (id) => selectedHostStore.set(id),
    onEdit: (host) => setEditing(host),
    onToggle: toggleHost,
    onRemove: (host) => setRemoving(host),
  };
  const modals = (
    <>
      {editing && <HostEditorModal host={editing.id ? editing : null} onSave={saveHost} onClose={() => setEditing(null)} />}
      {removing && <RemoveHostDialog host={removing} serverCount={countFor(removing.id)} onConfirm={confirmRemove} onClose={() => setRemoving(null)} />}
    </>
  );

  if (!hosts.length) {
    return (
      <>
        <div className="dash-head">
          <div className="dash-head__row">
            <h1>Fleet</h1>
            <button className="fb-editor__btn servers-toolbar__new" onClick={() => setEditing({})}>
              <Icon name="plus" size={13} strokeWidth={2.4} />&nbsp;Add host
            </button>
          </div>
          <div className="dash-head__sub">No hosts connected yet.</div>
        </div>
        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-lg)", padding: 60, textAlign: "center", color: "var(--fg-3)" }}>
          <Icon name="server-off" size={28} />
          <div style={{ marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>No hosts configured</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>Add a host to start aggregating servers and diagnostics.</div>
        </div>
        {modals}
      </>
    );
  }

  if (!focusHostId || !hosts.find(h => h.id === focusHostId)) {
    const fleetAlerts = anchoredAlerts(an => an.surface === "diagnostics");
    const PAGE_SIZE = 25;
    const matched = hosts.filter(h =>
      !hostQ || (h.name + " " + h.hostname + " " + (h.region || "")).toLowerCase().includes(hostQ));
    const onlineHosts = hosts.filter(h => h.online).length;
    const offlineCount = hosts.length - onlineHosts;
    const pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
    const safePage = Math.min(hostPage, pageCount - 1);
    const pageHosts = matched.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
    const onLastPage = safePage === pageCount - 1;
    return (
      <>
        <div className="dash-head">
          <div className="dash-head__row">
            <h1>Fleet</h1>
            <button className="fb-editor__btn servers-toolbar__new" onClick={() => setEditing({})}>
              <Icon name="plus" size={13} strokeWidth={2.4} />&nbsp;Add host
            </button>
          </div>
          <div className="dash-head__sub">Every host this panel aggregates — health, diagnostics and management in one place.</div>
        </div>

        {dataLoading ? <FleetSkeleton /> : (<>
        <div className="dash-summary">
          <KPI
            icon="server" label="Hosts"
            value={hosts.length}
            sub={hosts.length === 1 ? "machine aggregated" : "machines aggregated"}
            tone="muted" />
          <KPI
            icon="circle-check" label="Online"
            value={onlineHosts}
            sub={offlineCount ? offlineCount + (offlineCount === 1 ? " offline" : " offline") : "all reachable"}
            tone={onlineHosts ? "ok" : "muted"} />
          <KPI
            icon="box" label="Servers"
            value={servers.length}
            sub="across the fleet"
            tone="muted" />
          <KPI
            icon="triangle-alert" label="Host alerts"
            value={fleetAlerts.length}
            sub={fleetAlerts.length ? "need attention" : "all clear"}
            tone={fleetAlerts.length ? "warn" : "muted"}
            onView={fleetAlerts.length ? onViewAlerts : null} />
        </div>

        <Toolbar>
          <ToolbarSearch
            value={hostQuery}
            onChange={setHostQuery}
            pending={searchPending}
            placeholder="Search hosts…" />
          <ToolbarSpacer />
          <ToolbarCount shown={matched.length} total={hosts.length} unit="hosts" />
        </Toolbar>

        <div className="fleet-grid">
          {pageHosts.map(h => (
            <FleetHostCard
              key={h.id}
              host={h}
              serverCount={countFor(h.id)}
              alerts={anchoredAlerts(an => an.surface === "diagnostics" && an.hostId === h.id)}
              isActive={activeId === h.id}
              onInspect={onFocusHost}
              menuProps={menuProps}
            />
          ))}
          {!hostQ && onLastPage && (
            <button className="host-card host-card--add" onClick={() => setEditing({})}>
              <span className="host-card__add-icon"><Icon name="plus" size={22} /></span>
              <span className="host-card__add-title">Add a host</span>
              <span className="host-card__add-sub">Register another machine to aggregate here</span>
            </button>
          )}
        </div>
        {matched.length === 0 && (
          <div style={{ padding: "48px 0", textAlign: "center", color: "var(--fg-3)" }}>No hosts match “{hostQuery.trim()}”.</div>
        )}
        <Pagination
          page={safePage}
          pageCount={pageCount}
          total={matched.length}
          pageSize={PAGE_SIZE}
          onPage={setHostPage}
          unit="hosts"
        />
        </>)}
        {modals}
      </>
    );
  }

  const host = hosts.find(h => h.id === focusHostId);
  const isActive = activeId === host.id;

  if (sessionStore.isDenied(host.id)) {
    return (
      <>
        <div className="diag-head-row">
          <button className="diag-back-btn" onClick={() => onFocusHost(null)} title="All hosts" aria-label="Back to all hosts">
            <Icon name="arrow-left" size={18} />
          </button>
          <div className="diag-head">
            <div className="diag-head__title">
              <h1>{host.name}</h1>
              <div className="dash-head__sub">{host.hostname} · {host.region}</div>
            </div>
          </div>
        </div>
        <HostDeniedNotice host={host} embedded
          onBack={() => onFocusHost(null)}
          onManage={() => selectedHostStore.set("all")} />
        {modals}
      </>
    );
  }

  const headerChrome = (
    <div className="diag-head-row">
      <button className="diag-back-btn" onClick={() => onFocusHost(null)} title="All hosts" aria-label="Back to all hosts">
        <Icon name="arrow-left" size={18} />
      </button>
      <div className="diag-head">
        <div className="diag-head__title">
          <h1>{host.name}{isActive && <span className="host-picker__active-tag">active</span>}</h1>
          <div className="dash-head__sub">{host.hostname} · {host.region} — host machine health, distinct from per-game-server metrics.</div>
        </div>
        {host.online && <HostConnection hostId={host.id} full />}
      </div>
    </div>
  );

  if (!host.online || host.ram.total_gb === 0) {
    return (
      <>
        {headerChrome}
        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-lg)", padding: 56, textAlign: "center", color: "var(--fg-3)" }}>
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
  const tabs = [
    { id: "overview",  label: "Overview",  icon: "layout-grid" },
    { id: "resources", label: "Resources", icon: "activity", ...badge(resourceAlerts) },
    { id: "services",  label: "Services",  icon: "server-cog", ...badge(serviceAlerts) },
    { id: "logs",      label: "Logs",      icon: "scroll-text" },
  ];

  return (
    <>
      {headerChrome}
      <SubTabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === "overview"  && <DiagOverview host={host} fresh={fresh} onAsk={onAsk} onViewAlerts={onViewAlerts} onViewAudit={onViewAudit} onViewServices={() => setTab("services")} />}
      {tab === "resources" && <DiagResources host={host} fresh={fresh} servers={servers} onOpenServerSettings={onOpenServerSettings} />}
      {tab === "services"  && <DiagServices host={host} />}
      {tab === "logs"      && <DiagLogs host={host} />}
      {modals}
    </>
  );
}

export { FleetPage };
export default FleetPage;
