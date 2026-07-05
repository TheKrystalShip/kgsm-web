import React from "react";
import { AssistantDockProvider, useAssistantDock } from "./components/AssistantDockContext.jsx";
import { alertsTone, anchoredAlerts } from "./components/ContextualAlerts.jsx";
import { ColdStartDown, ConnectivityBanner } from "./components/ErrorBoundary.jsx";
import { KrystalFooter } from "./components/Footer.jsx";
import { InstallModal } from "./components/InstallModal.jsx";
import { alertBuckets, useAlerts } from "./components/NeedsAttention.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { api, connectionStore } from "./lib/apiClient.js";
import { CONNECTIONS } from "./lib/config.js";
import { KRYSTAL_LABELS } from "./lib/labels.js";
import { canOn, homeKind, resolveRoute } from "./lib/persona.js";
import { KrystalRouter } from "./lib/router.js";
import { sessionStore } from "./lib/sessionStore.js";
import { useStore } from "./lib/store.js";
import { commandServer, hostsStore, installServer, libraryStore, selectedHostStore, serversStore, useSelectedHostId } from "./lib/stores.js";
import { FirstRunWelcome } from "./pages/FirstRunWelcome.jsx";
import { AddHostPage } from "./pages/HostAccess.jsx";
import { HostReauthModal } from "./pages/HostReauth.jsx";
import { LoginPage } from "./pages/LoginPage.jsx";

// Extracted modules
import { readStoredUser, writeStoredUser } from "./lib/authStorage.js";
import { Breadcrumb } from "./components/Breadcrumb.jsx";
import { BootLanding } from "./components/BootLanding.jsx";
import { MobileNavToggle } from "./components/MobileNavToggle.jsx";
import { useRouteSync } from "./hooks/useRouteSync.js";
import { useMobileSwipe } from "./hooks/useMobileSwipe.js";
import { AppRouter } from "./components/AppRouter.jsx";

// The assistant dock renders ChatPage inside its own <Suspense> (below), so it's
// lazy-loaded here just like the full-page chat route in AppRouter.
const ChatPage = React.lazy(() => import("./pages/ChatPage.jsx"));

// App — top-level shell. Auth gate + routing.
// Wraps the inner app in AssistantDockProvider so dock state is available
// via useAssistantDock() throughout the tree.

function App() {
  const [user, setUser] = React.useState(() => {
    const forcedOut = new URLSearchParams(window.location.search).get("auth") === "out";
    if (forcedOut) { writeStoredUser(null); return null; }
    return readStoredUser();
  });
  const selectedHostId = useSelectedHostId();
  const hosts = useStore(hostsStore, s => s.list);
  const [route, setRouteRaw] = React.useState(() => resolveRoute({ kind: "home" }));
  const setRoute = React.useCallback((r) => {
    setRouteRaw(prev => resolveRoute(typeof r === "function" ? r(prev) : r));
  }, []);
  return (
    <AssistantDockProvider hosts={hosts} selectedHostId={selectedHostId} setRoute={setRoute}>
      <AppInner user={user} setUser={setUser} route={route} setRoute={setRoute} />
    </AssistantDockProvider>
  );
}

// AppInner — the real app body. Consumes dock state from context.
function AppInner({ user, setUser, route, setRoute }) {
  const dock = useAssistantDock();
  const { assistantOpen, setAssistantOpen, assistantSeed,
    assistantHost, assistantHostList, setAssistantHostId,
    dockWidth, dockResize, pushingPanel, railMode, desktop, effPush, tw, canPush,
    openAssistant, handleAssistantNavigate, setManualPin } = dock;
  const selectedHostId = useSelectedHostId();
  const hosts = useStore(hostsStore, s => s.list);

  // --- Auth ---
  const qp = new URLSearchParams(window.location.search);
  const forcedFirstRun = qp.has("first-run");

  const firstRun = React.useRef(forcedFirstRun || !!sessionStorage.getItem("krystal:first-run"));
  React.useEffect(() => {
    if (firstRun.current && !forcedFirstRun) {
      sessionStorage.removeItem("krystal:first-run");
      firstRun.current = false;
    }
  }, []);

  const returnTo = React.useRef(null);
  React.useEffect(() => {
    const saved = sessionStorage.getItem("krystal:returnTo");
    if (saved) { try { returnTo.current = JSON.parse(saved); } catch {} }
  }, []);

  const handleLogout = React.useCallback(() => {
    writeStoredUser(null);
    if (user && user.hostId) sessionStore.forget(user.hostId);
    window.location.reload();
  }, [user]);

  // --- Data stores ---
  const servers = useStore(serversStore, s => s.list);
  const libraryList = useStore(libraryStore, s => s.list);
  const hostsLoaded = useStore(hostsStore, s => s.everLoaded);
  const sessionsByHost = useStore(sessionStore, s => s.byHost);

  const authzSettled = hosts.every(h => {
    const s = sessionsByHost[h.id];
    return s && (s.role || s.denied || s.needReauth);
  });

  const initialRoute = React.useMemo(() => {
    if (returnTo.current) return returnTo.current;
    const hash = window.location.hash.replace(/^#\/?/, "");
    if (hash) return KrystalRouter.parseHash();
    if (firstRun.current) return { kind: "addHost" };
    return { kind: homeKind() };
  }, []);

  const [tab] = React.useState(null);
  const [extraLog, setExtraLog] = React.useState({});
  const [installing, setInstalling] = React.useState(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem("krystal:sidebar:collapsed") === "1"; } catch { return false; }
  });
  const [landingResolved, setLandingResolved] = React.useState(
    initialRoute.kind !== "home" || firstRun.current
  );
  const landedDefaultRef = React.useRef(initialRoute.kind === "home" && !firstRun.current);

  useRouteSync(route, setRoute, landingResolved);

  React.useEffect(() => {
    try { localStorage.setItem("krystal:sidebar:collapsed", collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

  React.useEffect(() => { setDrawerOpen(false); }, [route, tab]);

  useMobileSwipe(drawerOpen, setDrawerOpen, assistantOpen, setAssistantOpen);

  // --- Connection ---
  const conn = useStore(connectionStore, s => s);
  const retryConnection = React.useCallback(() => {
    connectionStore.setState(s => ({ ...s, retrying: true, status: s.everLoaded ? s.status : "connecting" }));
    return api.fanOut("/servers").catch(() => {});
  }, []);
  React.useEffect(() => { retryConnection(); }, [retryConnection]);
  const [reauthHostId, setReauthHostId] = React.useState(null);

  React.useEffect(() => {
    if (firstRun.current) setRoute({ kind: "library" });
  }, []);

  React.useEffect(() => {
    if (landingResolved || !landedDefaultRef.current) return;
    if (!authzSettled) return;
    setRoute({ kind: homeKind() });
    setLandingResolved(true);
  }, [authzSettled, landingResolved]);

  const activeServer = route.kind === "server"
    ? servers.find(s => s.id === route.id) || null
    : null;
  const activeGame = route.kind === "game"
    ? (libraryList.find(g => g.id === route.id) || null)
    : null;

  const append = (id, line) => {
    setExtraLog(prev => ({ ...prev, [id]: [...(prev[id] || []), line] }));
  };

  React.useEffect(() => {
    return api.stream.subscribe(["console"], (m) => {
      if (m.type === "console.line" && m.data) append(m.data.serverId, m.data.line);
    });
  }, []);

  const handleAction = (action, targetId) => {
    const s = targetId ? servers.find(x => x.id === targetId) || activeServer : activeServer;
    if (!s) return;
    if (action === "start") {
      const prevStatus = s.status;
      serversStore.patch(s.id, { status: "starting" });
      commandServer(s, action).catch(err => {
        if (err && err.code === 401) setReauthHostId(s.hostId);
        const cur = serversStore.find(s.id);
        if (cur && cur.status === "starting") serversStore.patch(s.id, { status: prevStatus });
      });
      return;
    }
    commandServer(s, action).catch(err => {
      if (err && err.code === 401) setReauthHostId(s.hostId);
    });
  };

  const openGame = (game) => setRoute({ kind: "game", id: game.id });
  const handleInstall = (game) => { setInstalling(game); };

  const confirmInstall = (cfg) => {
    installServer(cfg).then((data) => {
      const job = data && data.job;
      if (job && job.serverId) {
        serversStore.addPhantom(job.serverId, {
          blueprint:   cfg.game.id,
          cover:       cfg.game.cover  ?? null,
          hero:        cfg.game.hero   ?? null,
          displayName: cfg.game.name   ?? cfg.game.id,
          hostId:      cfg.hostId      ?? null,
        });
      }
      setInstalling(null);
      firstRun.current = false;
      setRoute({ kind: "servers" });
    }, err => {
      if (err && err.code === 401) setReauthHostId(cfg.hostId);
    });
  };

  const serverForRender = activeServer ? {
    ...activeServer,
    log: [...activeServer.log, ...(extraLog[activeServer.id] || [])],
  } : null;

  const selectHost = (id) => selectedHostStore.set(id);

  // --- Render ---
  useAlerts();

  if (!CONNECTIONS.length) {
    return <AddHostPage firstRun />;
  }
  if (!user) {
    return <LoginPage />;
  }

  const alertCounts = alertBuckets(selectedHostId);
  const attentionCount = alertCounts.active.length;
  const attentionTone = alertCounts.active.some(i => i.severity === "danger") ? "danger"
    : alertCounts.active.some(i => i.severity === "warn") ? "warn" : "info";

  const diagActive = anchoredAlerts(an => an.surface === "diagnostics");
  const diagnosticsCount = diagActive.length;
  const diagnosticsTone = alertsTone(diagActive);

  const serverAlertsActive = anchoredAlerts(an => an.surface === "server");
  const serversCount = serverAlertsActive.length;
  const serversTone = alertsTone(serverAlertsActive);

  if (route.kind === "addHost" || (hostsLoaded && hosts.length === 0)) {
    return <AddHostPage
      user={user}
      firstRun={hosts.length === 0}
      onAdded={(id) => { selectedHostStore.set(id); setRoute({ kind: "home" }); }}
      onCancel={hosts.length ? () => setRoute({ kind: "home" }) : null}
      onLogout={handleLogout} />;
  }

  if (conn.status === "down" && !conn.everLoaded) {
    return <ColdStartDown retrying={conn.retrying} onRetry={retryConnection} onLogout={handleLogout} />;
  }

  if (!landingResolved) {
    return <BootLanding />;
  }

  const deniedHost = selectedHostId !== "all" ? hosts.find(h => h.id === selectedHostId) : null;
  const scopedDenied = !!(deniedHost && sessionStore.isDenied(selectedHostId));
  const denyGate = scopedDenied && !["fleet", "settings", "discord", "addHost"].includes(route.kind);

  const expiredHost = selectedHostId !== "all" ? hosts.find(h => h.id === selectedHostId) : null;
  const scopedExpired = !!(expiredHost && sessionStore.needsReauth(selectedHostId));
  const expiredGate = scopedExpired && !["fleet", "settings", "discord", "addHost"].includes(route.kind);

  const sidebarCollapsed = desktop ? collapsed : false;
  const railReserve = railMode && !assistantOpen ? 56 : 0;
  const appInset = pushingPanel ? dockWidth : railReserve;

  const sidebarCtx = {
    serverName: serverForRender ? serverForRender.name : null,
    gameName: activeGame ? activeGame.name : null,
    hostName: route.hostId ? ((hosts.find(h => h.id === route.hostId) || {}).name || null) : null,
    catalogLabel: KRYSTAL_LABELS.catalog || "Catalog",
  };

  return (
    <div className="app" style={{ "--dock-push": appInset + "px", ...(collapsed ? { "--sidebar-w": "64px" } : {}) }}>
      <Sidebar
        route={route}
        onNavigate={setRoute}
        serversCount={serversCount}
        serversTone={serversTone}
        fleetCount={diagnosticsCount}
        fleetTone={diagnosticsTone}
        attentionCount={attentionCount}
        attentionTone={attentionTone}
        user={user}
        onLogout={handleLogout}
        hosts={hosts}
        selectedHostId={selectedHostId}
        onSelectHost={selectHost}
        open={drawerOpen}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setCollapsed(c => !c)}
      />

      {drawerOpen && <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />}
      <MobileNavToggle onOpen={() => setDrawerOpen(true)} />

      <main className={"main" + (pushingPanel ? " main--push" : "") + (railReserve ? " main--rail" : "")}>
        <div className="content">
          <ConnectivityBanner conn={conn} onRetry={retryConnection} />
          <Breadcrumb
            route={route}
            onNavigate={setRoute}
            ctx={sidebarCtx} />
          <AppRouter
            route={route}
            setRoute={setRoute}
            user={user}
            activeGame={activeGame}
            serverForRender={serverForRender}
            handleAction={handleAction}
            openGame={openGame}
            handleInstall={handleInstall}
            deniedHost={deniedHost}
            denyGate={denyGate}
            expiredHost={expiredHost}
            expiredGate={expiredGate}
            setReauthHostId={setReauthHostId}
            handleLogout={handleLogout}
            setInstalling={setInstalling}
          />
        </div>
        <KrystalFooter />
      </main>

      <aside className={"assistant-dock" + (assistantOpen ? " assistant-dock--open" : "") + (pushingPanel ? " assistant-dock--push" : "")}
        style={{ width: window.innerWidth <= 768 ? undefined : dockWidth }}>
        {assistantOpen && <div className="assistant-dock__resize" onPointerDown={dockResize} title="Drag to resize"></div>}
        {assistantOpen && (
          <React.Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--fg-3)" }}><span className="oauth-spinner" /></div>}>
          <ChatPage
            user={user}
            docked
            showPin={tw.dockBehavior === "auto" && desktop}
            pinned={effPush}
            pinDisabled={!canPush}
            onTogglePin={() => setManualPin(!effPush)}
            seed={assistantSeed}
            onClose={() => setAssistantOpen(false)}
            onExpand={() => setRoute({ kind: "chat" })}
            onNavigate={handleAssistantNavigate}
            getServerState={dock.getServerState}
            assistantHost={assistantHost}
            assistantHosts={assistantHostList}
            onSelectAssistantHost={setAssistantHostId}
          />
          </React.Suspense>
        )}
      </aside>

      {assistantOpen && pushingPanel && <div className="assistant-dock__scrim" onClick={() => setAssistantOpen(false)} />}
      {railMode && !assistantOpen && (
        <button className="assistant-rail" onClick={openAssistant} title="Open assistant" aria-label="Open assistant">
          <span className="assistant-rail__icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg></span>
        </button>
      )}
      {!assistantOpen && desktop && (
        <button className="assistant-fab" onClick={openAssistant} title="Open assistant" aria-label="Open assistant">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
        </button>
      )}

      {reauthHostId && (
        <HostReauthModal
          hostId={reauthHostId}
          onClose={() => setReauthHostId(null)}
          onExpired={() => { handleLogout(); setReauthHostId(null); }}
        />
      )}

      {installing && (
        <InstallModal
          game={installing}
          hosts={hosts.filter(h => {
            const s = sessionsByHost[h.id];
            return h.online && canOn("server.manage", h.id) && (!s || !s.denied);
          })}
          defaultHost={selectedHostId !== "all" ? selectedHostId : (hosts[0] && hosts[0].id)}
          onConfirm={confirmInstall}
          onClose={() => setInstalling(null)}
        />
      )}

      {firstRun.current && !installing && (
        <FirstRunWelcome onDismiss={() => { firstRun.current = false; }} />
      )}
    </div>
  );
}

export { App };
