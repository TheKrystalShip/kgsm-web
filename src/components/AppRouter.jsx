// AppRouter — the page routing switch. Maps route.kind to the right page
// component, threading through all the callbacks and props.

import React from "react";
import { Icon } from "../components/Icon.jsx";
import { HostDeniedNotice } from "../components/host-helpers.jsx";
import { HostExpiredNotice } from "../pages/HostReauth.jsx";
import { ContentError, ErrorBoundary } from "../components/ErrorBoundary.jsx";
import { KrystalRouter } from "../lib/router.js";
import { can } from "../lib/persona.js";
import { selectedHostStore, serversStore } from "../lib/stores.js";
import { useAssistantDock } from "./AssistantDockContext.jsx";
import { ServerGate } from "../pages/ServerGate.jsx";

const AlertsPage = React.lazy(() => import("../pages/AlertsPage.jsx"));
const AuditLogPage = React.lazy(() => import("../pages/AuditLogPage.jsx"));
const DashboardPage = React.lazy(() => import("../pages/DashboardPage.jsx"));
const ClusterPage = React.lazy(() => import("../pages/DiagnosticsPage.jsx"));
const GamePage = React.lazy(() => import("../pages/GamePage.jsx"));
const Library = React.lazy(() => import("../pages/LibraryPage.jsx"));
const LeafConfigPage = React.lazy(() => import("../pages/leafConfig/LeafConfigPage.jsx"));
const LibraryCreatePage = React.lazy(() => import("../pages/library/LibraryCreatePage.jsx"));
const ServerDetailPage = React.lazy(() => import("../pages/ServerDetailPage.jsx"));
const ServersPage = React.lazy(() => import("../pages/ServersPage.jsx"));
const SettingsPage = React.lazy(() => import("../pages/SettingsPage.jsx"));

function AppRouter({ route, setRoute, user, activeGame, serverForRender,
  handleAction, openGame, handleInstall,
  deniedHost, denyGate, expiredHost, expiredGate, setReauthHostId,
  handleLogout, setInstalling }) {

  // Assistant/dock state is provided by AssistantDockProvider (an ancestor of this
  // router), so read it from context here rather than threading it down from the
  // shell. Data (servers/hosts/scope) is likewise read by the pages themselves from
  // the singleton stores — this router only owns ROUTING (route → page + callbacks).
  const { askAboutAlert, askCreateBlueprint } = useAssistantDock();

  return (
    <ErrorBoundary
      resetKey={KrystalRouter.routeToHash(route)}
      fallback={(reset, error) => <ContentError error={error} onRetry={reset} onHome={() => setRoute({ kind: "home" })} />}>
    {denyGate ? (
      <HostDeniedNotice host={deniedHost}
        onBack={() => selectedHostStore.set("all")}
        onManage={() => setRoute({ kind: "cluster", hostId: deniedHost.id })} />
    ) : expiredGate ? (
      <HostExpiredNotice host={expiredHost}
        onReauth={() => setReauthHostId(expiredHost.id)}
        onBack={() => selectedHostStore.set("all")} />
    ) : (<>
    <React.Suspense fallback={<div style={{ textAlign: "center", padding: "64px 0", color: "var(--fg-3)" }}><span style={{ display: "inline-block", animation: "act-spin 1.4s linear infinite" }}><Icon name="loader-2" size={26} strokeWidth={1.7} /></span><div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--fg-2)" }}>{"Loading\u2026"}</div></div>}>
    <div className="page" key={KrystalRouter.routeToHash(route)}>
    {route.kind === "home" && <DashboardPage
      user={user}
      canCluster={can("nav.cluster")}
      onOpenServer={(id) => setRoute({ kind: "server", id })}
      onAction={(id, action) => handleAction(action, id)}
      onLibrary={(filter) => setRoute({ kind: "library", filter })}
      onInstall={openGame}
      onAudit={() => setRoute({ kind: "audit" })}
      onDiagnostics={() => setRoute({ kind: "cluster" })}
      onOpenHostDiagnostics={(id) => setRoute({ kind: "cluster", hostId: id })}
      onServers={(status) => setRoute({ kind: "servers", status })}
      onViewAlerts={() => setRoute({ kind: "attention" })}
      onAttention={askAboutAlert}
    />}
    {route.kind === "attention" && <AlertsPage
      key={route.serverId || "all"}
      initialServerId={route.serverId}
      onOpenServer={(id, tab) => setRoute({ kind: "server", id, tab })}
      onOpenHost={(hostId) => setRoute({ kind: "cluster", hostId })}
      onOpenAudit={() => setRoute({ kind: "audit" })}
      onAsk={askAboutAlert}
    />}
    {route.kind === "servers" && <ServersPage
      key={route.status || "all"}
      initialStatus={route.status}
      onOpenServer={(id) => setRoute({ kind: "server", id })}
      onAction={(id, action) => handleAction(action, id)}
      onLibrary={() => setRoute({ kind: "library" })}
    />}
    {route.kind === "library" && <Library key={route.filter || "all"} onOpenGame={openGame} onDeploy={handleInstall} initialFilter={route.filter}
      onCreateBlueprint={() => setRoute({ kind: "library-create" })} />}
    {route.kind === "library-create" && <LibraryCreatePage
      onBrowse={() => setRoute({ kind: "library" })}
      onOpenGame={(id) => setRoute({ kind: "game", id })}
      onAskAssistant={askCreateBlueprint}
    />}
    {route.kind === "game" && (activeGame
      ? <GamePage
          game={activeGame}
          onCreate={(g) => setInstalling(g)}
          onOpenServer={(id) => setRoute({ kind: "server", id })}
          onAction={(id, action) => handleAction(action, id)}
          onBrowse={() => setRoute({ kind: "library" })}
        />
      : <div style={{ padding: "60px 0", textAlign: "center", color: "var(--fg-3)" }}>
          That game isn’t in the library. <button className="dash-servers-empty__link" onClick={() => setRoute({ kind: "library" })}>Back to the library</button>
        </div>)}
    {route.kind === "audit"   && <AuditLogPage key={(route.severity || "all") + "|" + (route.serverId || "all")} initialSeverity={route.severity} initialServer={route.serverId} />}
    {route.kind === "cluster" && <ClusterPage
      focusHostId={route.hostId}
      tab={route.tab || "overview"}
      onTabChange={(t) => setRoute({ kind: "cluster", hostId: route.hostId, tab: t === "overview" ? undefined : t })}
      onFocusHost={(id) => setRoute({ kind: "cluster", hostId: id || undefined })}
      onAsk={askAboutAlert}
      onOpenServer={(id) => setRoute({ kind: "server", id })}
      onOpenServerSettings={(id) => setRoute({ kind: "server", id, tab: "settings" })}
      onViewAlerts={() => setRoute({ kind: "attention" })}
      onViewAudit={() => setRoute({ kind: "audit" })}
      onConfigureLeaf={(hostId, leaf) => setRoute({ kind: "leafConfig", hostId, leaf })}
    />}
    {route.kind === "leafConfig" && <LeafConfigPage
      hostId={route.hostId}
      leafId={route.leaf}
      onSelectLeaf={(leaf) => setRoute({ kind: "leafConfig", hostId: route.hostId, leaf })}
      onBackToHost={() => setRoute({ kind: "cluster", hostId: route.hostId, tab: "services" })}
    />}
    {route.kind === "settings" && <SettingsPage
      user={user} onLogout={handleLogout} />}
    {route.kind === "server" && (serverForRender
      ? <ServerDetailPage server={serverForRender} onAction={handleAction}
          tab={route.tab || "overview"}
          onTabChange={(t) => setRoute({ kind: "server", id: route.id, tab: t === "overview" ? undefined : t })}
          onAsk={askAboutAlert}
          onOpenServer={(id) => setRoute({ kind: "server", id })}
          onViewServerAlerts={(id) => setRoute({ kind: "attention", serverId: id })}
          onViewServerAudit={(id) => setRoute({ kind: "audit", serverId: id })}
          onDeleted={() => setRoute({ kind: "servers" })}
        />
      : <ServerGate id={route.id}
          onBack={() => setRoute({ kind: "servers" })}
          onRetry={() => serversStore.refresh().catch(() => {})} />
    )}
    </div>
    </React.Suspense>
    </>)}
    </ErrorBoundary>
  );
}

export { AppRouter };
