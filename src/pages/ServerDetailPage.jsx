import React from "react";
import { ConsolePanel } from "../components/ConsolePanel.jsx";
import { alertsTone, anchoredAlerts } from "../components/ContextualAlerts.jsx";
import { DashBandList, loadBandOrder, saveBandOrder } from "../components/DashLayout.jsx";
import { Icon } from "../components/Icon.jsx";
import { SubTabs } from "../components/SubTabs.jsx";
import { NeedsAttention, useAlerts } from "../components/NeedsAttention.jsx";
import { ServerHero } from "../components/ServerHero.jsx";
import { ServerNotice } from "../components/ServerNotice.jsx";
import { StatTiles } from "../components/StatTiles.jsx";
import { serverOperable } from "../lib/persona.js";
import { serversStore } from "../lib/stores.js";
import { BackupsList } from "./BackupsList.jsx";
import { FileBrowser } from "./FileBrowser.jsx";
import { PerformanceTab } from "./PerformanceTab.jsx";
import { PlayersTab } from "./PlayersTab.jsx";
import { ServerSettings } from "./ServerSettings.jsx";

// ServerGate — the async-state gate for the server-detail route. `serverForRender`
// is legitimately null in three non-crash cases: the servers store is still on its
// first fetch (a deep-link / hard refresh lands here before it resolves), that
// first fetch FAILED, or the store is loaded but no server carries this id. We
// discriminate them off the store's own state machine and render an honest
// loading / error / not-found surface — NEVER ServerDetailPage with a null server,
// whose every child dereferences `server.*` and would throw into the content
// boundary (the crash this replaces). `everLoaded` is the real "first fetch
// finished" signal: a warm refresh preserves the list, so a null past everLoaded
// is a true 404, not a transient.
function ServerGate({ id, status, everLoaded, onBack, onRetry }) {
  const wrap = { textAlign: "center", padding: "64px 0", color: "var(--fg-3)" };
  const title = { marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 };
  const sub = { fontSize: 12.5, maxWidth: 460, margin: "4px auto 0" };
  if (!everLoaded && status === "error") {
    return (
      <div style={wrap}>
        <Icon name="circle-x" size={26} strokeWidth={1.7} />
        <div style={title}>Couldn't load your servers</div>
        <div style={sub}>The server list didn't load, so this page can't open yet.</div>
        <div style={{ marginTop: 18 }}>
          <button className="chip" onClick={onRetry}><Icon name="rotate-cw" size={14} /> Try again</button>
        </div>
      </div>
    );
  }
  if (!everLoaded) {
    return (
      <div style={wrap}>
        <span style={{ display: "inline-block", animation: "act-spin 1.4s linear infinite" }}>
          <Icon name="loader-2" size={26} strokeWidth={1.7} />
        </span>
        <div style={title}>Loading server…</div>
        <div style={sub}>Fetching this server from its host.</div>
      </div>
    );
  }
  return (
    <div style={wrap}>
      <Icon name="server-off" size={26} strokeWidth={1.6} />
      <div style={title}>Server not found</div>
      <div style={sub}>No server with the id "{id}" is on any connected host — it may have been removed, or the link is out of date.</div>
      <div style={{ marginTop: 18 }}>
        <button className="chip" onClick={onBack}><Icon name="arrow-left" size={14} /> Back to servers</button>
      </div>
    </div>
  );
}

function ServerDetailPage({ server, onAction, tab: tabProp, onTabChange, onAsk, onOpenServer, onViewServerAlerts, onViewServerAudit, onDeleted }) {
  if (useAlerts) useAlerts();
  // Pull this server's DETAIL superset on entry — specifically the `network` block
  // (required ports), which the list/stream omit. It's what gives the connect
  // address its port (ServerConnect → serverJoin); merged onto the cached row so the
  // hero re-renders with host:port when it lands. Keyed on id/host → one fetch per
  // server visit, no churn. (Hook declared unconditionally — Rules of Hooks.)
  const _srvId = server && server.id;
  const _srvHost = server && server.hostId;
  React.useEffect(() => {
    if (_srvId) serversStore.fetchDetail(_srvId, _srvHost);
  }, [_srvId, _srvHost]);
  // Controlled by the route so the tab lives in the URL (#/servers/<id>/<tab>):
  // clicking a sub-tab navigates, and Back/Forward move between tabs.
  const tab = tabProp || "overview";
  const setTab = onTabChange || (() => {});
  // Can this user operate the host? Players get a stripped overview (note + Join
  // + status) and none of the operator sub-tabs.
  const canOps = serverOperable ? serverOperable(server) : true;
  // Active alerts anchored to this server, grouped by the tab they concern.
  const srvAlerts = anchoredAlerts
    ? anchoredAlerts(an => an.surface === "server" && an.serverId === server.id)
    : [];
  const tabAlerts = (id) => srvAlerts.filter(a => (a.anchor.tab || "overview") === id);
  const badge = (id) => { const it = tabAlerts(id); return it.length ? { badge: it.length, badgeTone: alertsTone(it) } : {}; };
  const allTabs = [
    { id: "overview",    label: "Overview",    icon: "layout-grid", ...badge("overview") },
    { id: "performance", label: "Performance", icon: "line-chart", ...badge("performance") },
    { id: "files",       label: "Files",       icon: "folder" },
    { id: "backups",     label: "Backups",     icon: "database" },
    { id: "settings",    label: "Settings",    icon: "settings" },
  ];
  // Files / Backups / Settings / Performance are operator surfaces — hidden for
  // players, not merely disabled. safeTab keeps a stale tab in the URL from
  // rendering an empty body when the tab isn't available to this user.
  const tabs = canOps ? allTabs : allTabs.filter(t => t.id === "overview");
  const safeTab = tabs.some(t => t.id === tab) ? tab : "overview";

  // ---- Overview layout customization (client-side, per-browser) -----------
  // Same model as the dashboard (DashLayout): drag whole bands up/down behind an
  // explicit "Customize" mode + grip handle, order remembered in localStorage.
  // One shared order for every server's overview, since the bands are identical.
  // Hooks declared unconditionally here (Rules of Hooks) though only used by the
  // overview tab below.
  const OVERVIEW_ORDER_KEY = "krystal:server:overview:order";
  const [ovOrder, setOvOrder] = React.useState(() => (loadBandOrder ? loadBandOrder(OVERVIEW_ORDER_KEY) : []));
  const [customize, setCustomize] = React.useState(false);
  const persistOverview = (order) => { setOvOrder(order); if (saveBandOrder) saveBandOrder(OVERVIEW_ORDER_KEY, order); };
  const resetOverview = () => { setOvOrder([]); if (saveBandOrder) saveBandOrder(OVERVIEW_ORDER_KEY, []); };
  // Leaving the overview tab exits Customize, so you never return to a half-
  // finished arrange session on another tab's content.
  React.useEffect(() => { if (safeTab !== "overview" && customize) setCustomize(false); }, [safeTab]);
  return (
    <>
      <ServerHero server={server} onAction={onAction} />
      <div className="subtabs-row">
        <SubTabs tabs={tabs} active={safeTab} onChange={setTab} />
        {safeTab === "overview" && canOps && DashBandList && (
          <div className={"dash-customize" + (customize ? " dash-customize--on" : "")}>
            {customize && (
              <span className="dash-customize__hint">
                <Icon name="grip-vertical" size={13} strokeWidth={2} /> Drag a handle to reorder
              </span>
            )}
            {customize ? (
              <>
                <button className="dash-customize__btn" onClick={resetOverview} title="Restore the default order">
                  <Icon name="rotate-ccw" size={14} strokeWidth={2} /> Reset
                </button>
                <button className="dash-customize__btn dash-customize__btn--done" onClick={() => setCustomize(false)}>
                  <Icon name="check" size={14} strokeWidth={2.4} /> Done
                </button>
              </>
            ) : (
              <button className="dash-customize__btn" onClick={() => setCustomize(true)} title="Rearrange this overview">
                <Icon name="layout-dashboard" size={14} strokeWidth={2} /> Customize
              </button>
            )}
          </div>
        )}
      </div>
      {safeTab === "overview" && (() => {
        const notice = ServerNotice ? <ServerNotice server={server} canEdit={canOps} /> : null;
        // Player overview: the operator's note, an at-a-glance status strip, then
        // the roster and console — both READ-ONLY (no kick/ban, no command input).
        // Joining lives in the hero above; no ops feed or arrange mode.
        if (!canOps) {
          return (
            <>
              {notice}
              <StatTiles server={server} />
              {PlayersTab && <PlayersTab server={server} readOnly />}
              {ConsolePanel && <ConsolePanel server={server} readOnly />}
            </>
          );
        }
        // The reorderable bands in their natural (default) order. Same shape as
        // the dashboard's: { id, label, node }. Ids are stable so a saved order
        // survives content changes (merge-safe restore in DashLayout).
        const ovBands = [
          { id: "stats", label: "Stats", node: <StatTiles server={server} /> },
          {
            id: "feed", label: "Alerts & activity",
            node: (
              <div className="dash-feed">
                {NeedsAttention && (
                  <NeedsAttention serverId={server.id} onPick={onAsk} emptyState max={3}
                    onViewAll={() => onViewServerAlerts && onViewServerAlerts(server.id)} />
                )}
                {RecentActivity && (
                  <RecentActivity serverId={server.id} max={3}
                    onViewAll={() => onViewServerAudit && onViewServerAudit(server.id)} />
                )}
              </div>
            )
          },
          { id: "players", label: "Players", node: <PlayersTab server={server} /> },
          { id: "console", label: "Console", node: <ConsolePanel server={server} /> },
        ];
        return (
          <>
            {notice}
            {DashBandList
              ? <DashBandList bands={ovBands} customize={customize} storedOrder={ovOrder} onReorder={persistOverview} />
              : ovBands.map(b => <React.Fragment key={b.id}>{b.node}</React.Fragment>)}
          </>
        );
      })()}
      {safeTab === "performance" && (
        <>
          <PerformanceTab server={server} onAsk={onAsk} />
        </>
      )}
      {safeTab === "files"       && <FileBrowser server={server} />}
      {safeTab === "backups"     && <BackupsList server={server} />}
      {safeTab === "settings"    && <ServerSettings server={server} onDeleted={onDeleted} />}
    </>
  );
}

export { ServerGate, ServerDetailPage };
