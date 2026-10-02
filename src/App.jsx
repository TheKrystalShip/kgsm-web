import React from "react";
import { AssistantDockProvider, useAssistantDock } from "./components/AssistantDockContext.jsx";
import { alertsTone, anchoredAlerts } from "./components/ContextualAlerts.jsx";
import { ColdStartDown } from "./components/ErrorBoundary.jsx";
import { NavProvider } from "./components/NavContext.jsx";
import { KrystalFooter } from "./components/Footer.jsx";
import { InstallModal } from "./components/InstallModal.jsx";
import { Toasts } from "./components/Toasts.jsx";
import { toast } from "./lib/toasts.js";
import { alertBuckets, useAlerts } from "./components/NeedsAttention.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { api, connectionStore } from "./lib/apiClient.js";
import { KRYSTAL_LABELS } from "./lib/labels.js";
import { can, homeKind, resolveRoute, serverTabOffered } from "./lib/persona.js";
import { KrystalRouter } from "./lib/router.js";
import { runServerAction } from "./lib/serverActions.js";
import { CONNECTIONS, subscribeConnections } from "./lib/config.js";
import { fleetStore, refreshFleetFromAnchor } from "./lib/fleet.js";
import { sessionStore } from "./lib/sessionStore.js";
import { useStore } from "./lib/store.js";
import { accessStore, clusterStore, hostsStore, installServer, libraryStore, serversStore, servicesStore, startDataLayer, stopDataLayer } from "./lib/stores.js";
import { AddHostPage } from "./pages/HostAccess.jsx";
import { CommandPalette } from "./components/palette/CommandPalette.jsx";
import { FirstRunWelcome, hasSeenWelcome } from "./pages/FirstRunWelcome.jsx";
import AssistantFabIcon from "./components/AssistantFabIcon.jsx";
import { Modal } from "./components/Modal.jsx";
import { AuthGate } from "./components/AuthGate.jsx";
import { BootFailed } from "./pages/auth/BootFailed.jsx";

// Extracted modules
import { noteSessionEnded, readStoredUser, writeStoredUser } from "./lib/authStorage.js";
import { Breadcrumb } from "./components/Breadcrumb.jsx";
import { BootLanding } from "./components/BootLanding.jsx";
import { MobileNavToggle } from "./components/MobileNavToggle.jsx";
import { useRouteSync } from "./hooks/useRouteSync.js";
import { useMobileSwipe } from "./hooks/useMobileSwipe.js";
import { AppRouter } from "./components/AppRouter.jsx";

// The widget catalog, registered at shell load. It MUST be eager: a pin lives on a card anywhere in
// the panel and draws nothing for a type the registry does not hold, so registering it from the
// (lazy) dashboard would mean no card is pinnable until you have visited the dashboard once. Every
// entry's component is a dynamic import, so this costs the metadata and not the code.
import "./pages/dashboard/catalog.js";

// ChatPage is lazy-loaded for both the dock and the full-screen modal.
const ChatPage = React.lazy(() => import("./pages/ChatPage.jsx"));

// App — the chooser: the way in, or the app.
//
// Wraps the inner app in AssistantDockProvider so dock state is available via
// useAssistantDock() throughout the tree.

// Somebody signed in whose account the cluster does not hold active — awaiting approval, switched
// off, or unknown. Read off the session the boot settled before mount, because it has to be true on
// the first render — deciding it later would mean mounting the shell for somebody every one of its
// screens would refuse. An active account that holds no actions is let in: what it holds is each
// page's answer, and "Your access" says so. A host run open grants what it grants.
const holdsNothing = () => {
  const s = sessionStore.getState().session;
  return !!(s && s.status === "live" && !s.open && (s.account || "unknown") !== "active");
};

// Where somebody was going when they were asked to sign in. Kept for this tab only: it is a
// navigation intent, not a preference, and it must not outlive the browser or leak into another.
const INTENT_KEY = "krystal:after-signin";

// How long first paint may wait on a question nobody answers. Every failure the boot can recognise
// ends it at once; this is the backstop for one that never returns at all, and it sits above the
// provider's own request timeout so a slow renewal is still answered rather than cut off.
const BOOT_DEADLINE_MS = 25000;

function rememberIntent(route) {
  if (!route || KrystalRouter.isAuthRoute(route)) return;
  try { sessionStorage.setItem(INTENT_KEY, KrystalRouter.routeToHash(route)); } catch { /* private mode */ }
}
// One-shot: taken on the way back in, so a second sign-in does not land on a page from the first.
function takeIntent() {
  try {
    const h = sessionStorage.getItem(INTENT_KEY);
    if (h) sessionStorage.removeItem(INTENT_KEY);
    return h ? KrystalRouter.parseHash(h) : null;
  } catch { return null; }
}

function App() {
  const [user, setUser] = React.useState(() => readStoredUser());
  const hosts = useStore(hostsStore, s => s.list);
  const [route, setRouteRaw] = React.useState(() => {
    const hashRoute = KrystalRouter.routeFromHash();
    // An auth route is not a destination for somebody who is already in — they asked for the door
    // of a building they are standing in, so they get the room they would have landed in anyway.
    if (hashRoute && KrystalRouter.isAuthRoute(hashRoute)) return resolveRoute({ kind: "home" });
    return hashRoute ? resolveRoute(hashRoute) : resolveRoute({ kind: "home" });
  });
  const setRoute = React.useCallback((r) => {
    setRouteRaw(prev => resolveRoute(typeof r === "function" ? r(prev) : r));
  }, []);

  // Re-read the stored identity. The gate calls this once it holds a session, rather than reloading
  // the page — which works because the shell is not mounted behind the gate, so there are no hooks
  // below a flipping condition to trip React's rules.
  const refreshUser = React.useCallback(() => setUser(readStoredUser()), []);

  // Everything in front of the app: where the cluster signs people in, and going there. AppInner is
  // not mounted while this is on screen, so none of the shell's hooks — and none of the data layer
  // they drive — runs for somebody who has not signed in.
  //
  // Where they were going is recorded first. Somebody deep-linked to a server and asked to sign in
  // should land on that server, not on a home page that makes them find it again.
  if (!user || holdsNothing()) {
    rememberIntent(KrystalRouter.routeFromHash());
    return <AuthGate onUser={refreshUser} />;
  }

  // NavProvider sits outside everything that renders a card, so a component can navigate by asking
  // rather than by being handed a callback — which is what lets the same card render on its own page
  // and pinned to the dashboard.
  return (
    <NavProvider setRoute={setRoute}>
      <AssistantDockProvider hosts={hosts} setRoute={setRoute}>
        <AppInner user={user} setUser={setUser} route={route} setRoute={setRoute} />
      </AssistantDockProvider>
    </NavProvider>
  );
}

// AppInner — the real app body. Consumes dock state from context.
function AppInner({ user, setUser, route, setRoute }) {
  const dock = useAssistantDock();
  const { assistantOpen, setAssistantOpen, assistantSeed,
    assistantHost, assistantHostList, chooseAssistant,
    dockWidth, dockResize, pushingPanel, railMode, desktop, effPush, tw, canPush,
    openAssistant, openView, handleAssistantNavigate, setManualPin,
    review, exitReview } = dock;
  const hosts = useStore(hostsStore, s => s.list);
  const clusterMembers = useStore(clusterStore, s => s.nodes);
  // Which member holds each of the cluster's capabilities. A capability belongs to the cluster
  // rather than to a member, so it is not a field on a roster row — and an anchor's page is
  // shaped by the one it holds.
  const clusterCapabilities = useStore(clusterStore, s => s.capabilities);

  // --- Auth ---

  // Signing out is the provider's: it ends its own session and every session minted under it, tells
  // every member, and sends the browser back here — where nothing is held, so the next sign-in asks
  // for a credential. A panel holding no provider session (a host run open) has only the local drop
  // to do, and reloads into the gate.
  const handleLogout = React.useCallback(async () => {
    writeStoredUser(null);
    const leaving = await sessionStore.signOut();
    if (!leaving) window.location.reload();
  }, []);

  // --- Data stores ---
  const servers = useStore(serversStore, s => s.list);
  const libraryList = useStore(libraryStore, s => s.list);
  const hostsLoaded = useStore(hostsStore, s => s.everLoaded);
  const conn = useStore(connectionStore, s => s);
  // The fan-out answered and nothing it answered can draw a shell: every node refused or failed, with
  // no roster ever loaded. An all-401 answer is not this — it settles the roster and the session's own
  // renewal decides what happens next.
  const hostsError = useStore(hostsStore, s => (s.status === "error" && !s.everLoaded ? s.error || {} : null));
  const fleet = useStore(fleetStore, s => s);
  const session = useStore(sessionStore, s => s.session);
  const refusingNodes = useStore(sessionStore, s => s.nodes);
  // What this person may do, as every member answered it. Read here so a change re-renders the shell
  // and every gate below it asks again.
  const access = useStore(accessStore, s => s.sources);
  const accessSettled = useStore(accessStore, s => s.settled);
  // Read for the breadcrumb's leaf crumb only — the leaf page is what hydrates this board, so this
  // reads whichever node's board is currently held and shows nothing when none is.
  const servicesByHost = useStore(servicesStore, s => s.byHost);

  // One session, so authentication settles once.
  const authzSettled = !!session && session.status !== "none" && session.status !== "bootstrapping";

  const [tab] = React.useState(null);
  const [installing, setInstalling] = React.useState(null);
  // The refusal the last install came back with. Held here because the shell owns the POST, and
  // rendered by the modal, which is the surface that has the fields it is about.
  const [installError, setInstallError] = React.useState(null);
  const [chatFullscreen, setChatFullscreen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem("krystal:sidebar:collapsed") === "1"; } catch { return false; }
  });
  const [landingResolved, setLandingResolved] = React.useState(false);
  // The one-time tour of the composable dashboard. Read once, at mount, so it cannot flicker back on
  // when the modal writes the key and closes. It renders below, inside the app frame — past the
  // sign-in screen, the approval wait, the add-a-host screen, the cold-start failure and the boot
  // landing, all of which return earlier — so it only ever meets somebody who can reach the
  // dashboard, never somebody mid-login.
  const [showWelcome, setShowWelcome] = React.useState(() => !hasSeenWelcome());

  // The data layer runs exactly as long as the shell is mounted, which is exactly as long
  // as there is somebody signed in to run it for. It used to start at module load, so a
  // browser sitting on the sign-in screen hydrated four stores and dialled one SSE stream
  // per connection on behalf of nobody — every call 401ing, every stream backing off
  // against a host that had not been chosen yet.
  // A clustered panel keeps no node list, so at mount there is often nothing to hydrate against yet
  // — the anchor has not answered. Starting anyway spends every store's first read on an empty
  // connection set, and since the roster load happens once, the shell then waits forever for hosts
  // that were never asked for. So it waits for the first node instead. A standalone deployment has
  // its node from the moment somebody chose it and starts immediately.
  // Who is in the cluster, asked before anything else and independently of the data layer — that
  // waits for a node, and in a cluster the only thing that knows of any node is this call. A
  // reload has a session and a door and nothing else, so without this the panel waits for a fleet
  // nobody ever asked for. The discovery timer keeps it fresh afterwards; this is only the first.
  React.useEffect(() => { refreshFleetFromAnchor().catch(() => {}); }, []);

  const [wired, setWired] = React.useState(() => CONNECTIONS.length > 0);
  React.useEffect(() => {
    if (wired) return undefined;
    return subscribeConnections(() => { if (CONNECTIONS.length) setWired(true); });
  }, [wired]);

  React.useEffect(() => {
    if (!wired) return undefined;
    startDataLayer();
    return () => stopDataLayer();
  }, [wired]);

  // The fan-out has answered, or there was never one to make. A panel whose nodes come from a
  // cluster holds no connection until the anchor names one, so a cluster that names nobody — and one
  // that could not be asked — leaves no `GET /hosts` in flight and none coming. Waiting for it then
  // holds the boot cover over a question that is already answered, which is how a boot never ends.
  //
  // A roster that DID name somebody is still waited for: the nodes are being called, and rendering a
  // panel that says nothing is connected is a wrong answer rather than an early one.
  const hostsSettled = hostsLoaded
    || (!wired && (fleet.state === "unreachable" || (fleet.state === "ready" && !fleet.count)));

  // Authorization is settled once every member has answered `/me/access`, whatever it said: a member
  // answering with an outage does not hold the panel back, and the controls it gates stay closed until
  // it answers. With no node to ask the data layer never starts, and there is nothing to wait for.
  const authzReady = hostsSettled && authzSettled && (accessSettled || !wired);

  // The boot cover waits only while a question is being answered. An answer the shell cannot be drawn
  // from ends the boot on BootFailed, which always offers a way forward, and the deadline catches any
  // question that is never answered at all — so first paint ends on the shell or on that screen.
  //
  // A roster that named nodes and registered none of them is an answer, not a wait: reconciling adds
  // every node it keeps before the fleet reads `ready`, and nothing re-asks the anchor until the data
  // layer starts, which needs a connection.
  const [bootExpired, setBootExpired] = React.useState(false);
  React.useEffect(() => {
    if (landingResolved) return undefined;
    const t = setTimeout(() => setBootExpired(true), BOOT_DEADLINE_MS);
    return () => clearTimeout(t);
  }, [landingResolved]);
  const bootFailure = landingResolved ? null
    : hostsError ? { kind: "refused", error: hostsError.userMessage || hostsError.message || null }
    : (fleet.state === "ready" && fleet.count > 0 && !CONNECTIONS.length) ? { kind: "unaddressable", count: fleet.count }
    : bootExpired ? { kind: "timeout" }
    : null;

  useRouteSync(route, setRoute, landingResolved);

  React.useEffect(() => {
    try { localStorage.setItem("krystal:sidebar:collapsed", collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

  React.useEffect(() => { setDrawerOpen(false); }, [route, tab]);

  React.useEffect(() => {
    const el = document.querySelector(".app__main");
    if (el) el.scrollTo({ top: 0, behavior: "smooth" });
  }, [route.kind, route.id, route.tab]);

  useMobileSwipe(drawerOpen, setDrawerOpen, assistantOpen, setAssistantOpen);

  // --- Connection ---
  const retryConnection = React.useCallback(() => {
    connectionStore.setState(s => ({ ...s, retrying: true, status: s.everLoaded ? s.status : "connecting" }));
    return api.fanOut("/servers").catch(() => {});
  }, []);
  React.useEffect(() => { retryConnection(); }, [retryConnection]);
  // An action that came back 401 after the seam already replayed it means that host's
  // session is genuinely gone rather than merely lapsed. Marking it expired is all this
  // does: the seam's 30-second grace then decides whether it healed, and if it did not,
  // the effect below drops the identity and AuthGate takes over. Reacting harder here
  // would log somebody out over one unlucky request.
  const noteAuthFailure = React.useCallback(() => { sessionStore.expire(); }, []);

  // Where to land, resolved once roles are known. In order: the page somebody was on their way to
  // when the gate stopped them, then the address bar, then this persona's home. The first is taken
  // one time only — a later sign-in is not still owed a page from an earlier one.
  //
  // An auth route in the bar is not a destination: it is the door somebody just came through, and
  // leaving it there would put the sign-in screen one Back press away from a signed-in panel.
  React.useEffect(() => {
    if (landingResolved) return;
    if (!authzReady) return;
    const intended = takeIntent();
    const deepRoute = KrystalRouter.routeFromHash();
    const fromBar = deepRoute && !KrystalRouter.isAuthRoute(deepRoute) ? deepRoute : null;
    setRoute(intended || fromBar || { kind: homeKind() });
    setLandingResolved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolves the landing route once hosts + roles are known; deps are stable setters + the async gate
  }, [authzReady, landingResolved]);

  // A session that ran out and could not be renewed sends somebody back to the sign-in. `reauthDue`
  // rather than raw `expired` is what makes this survivable: the access token lapses every ~15
  // minutes by design and the seam renews it silently, so reacting to the lapse itself would throw
  // everybody out four times an hour. The seam only surfaces one it failed to heal, 30 seconds later.
  //
  // Dropping the stored identity is the whole mechanism — App re-renders, sees no user, and shows
  // AuthGate. It is told the session ended here rather than never having been, so it offers the way
  // back instead of leaving for the provider over whatever was on screen.
  //
  // A session found ended while the boot is still settling — `login_required`, which is written only
  // when nothing is left to renew with — goes to the gate at once and is NOT noted as ended: nothing
  // has been on screen yet, so this is a cold load holding nothing, and the gate leaves for the
  // provider exactly as it would for one.
  React.useEffect(() => {
    if (!session) return;
    const endedAtBoot = !landingResolved && session.status === "expired" && session.error === "login_required";
    if (!(session.reauthDue || endedAtBoot || session.status === "denied")) return;
    if (session.reauthDue && !endedAtBoot) noteSessionEnded();
    writeStoredUser(null);
    setUser(null);
  }, [session, setUser, landingResolved]);

  // A role can change under somebody who is already standing on a page. `resolveRoute` is the
  // chokepoint every navigation passes through, so re-running it against the route currently held is
  // the whole guard: a route this role may still occupy comes back identical and nothing happens, a
  // route it may not comes back as the reachable home and `setRoute` takes them there. It waits for
  // `landingResolved` because nothing is allowed until every member has answered, and bouncing on
  // that would land a deep link on the servers list a beat before the answers arrived.
  React.useEffect(() => {
    if (!landingResolved) return;
    const allowed = resolveRoute(route);
    if (allowed !== route) setRoute(allowed);
  }, [session, access, hosts, route, setRoute, landingResolved]);

  // What a change of access costs is visible immediately — controls and tabs go, and the page may
  // change under them — and nothing else on the panel says why. So the shell says it, once. "Your
  // access" on the settings page says what it now is.
  React.useEffect(() => accessStore.onChange(() => {
    toast.info("Your access changed");
  }), []);

  // The nodes an install could land on: online, this person may install there, and the member is not
  // refusing this session. The grant is the node's answer; the refusal is the member's session state,
  // and both have to hold for a target to be offerable.
  const installTargets = hosts.filter(h => {
    const refusal = refusingNodes[h.id];
    return h.online && can("server.create", { hostId: h.id }) && !(refusal && refusal.accepts === "refusing");
  });
  // An install nobody may make does not stay on screen with its fields. A role can be regraded while
  // the form is open, and a form with no node left to install on is one whose button can only be
  // refused — so it closes rather than collecting a config for a request that cannot be made.
  React.useEffect(() => {
    if (installing && !installTargets.length) { setInstalling(null); setInstallError(null); }
  }, [installing, installTargets.length]);

  const activeServer = route.kind === "server"
    ? servers.find(s => s.id === route.id) || null
    : null;
  const activeGame = route.kind === "game"
    ? (libraryList.find(g => g.id === route.id) || null)
    : null;

  // The verb itself — the optimistic patch, the rollback, the wording — lives in
  // lib/serverActions.js, because a pinned card has no shell above it to be handed a callback. This
  // only resolves WHICH server the shell means when a caller names none.
  const handleAction = (action, targetId, opts) => {
    const s = targetId ? servers.find(x => x.id === targetId) || activeServer : activeServer;
    if (!s) return;
    runServerAction(action, s, opts);
  };

  const openGame = (game) => setRoute({ kind: "game", id: game.id });
  const handleInstall = (game) => { setInstallError(null); setInstalling(game); };

  const confirmInstall = (cfg) => {
    setInstallError(null);
    installServer(cfg).then((data) => {
      const job = data && data.job;
      if (job && job.serverId) {
        serversStore.addPhantom(job.serverId, {
          blueprint:   cfg.game.id,
          cover:       cfg.game.cover  ?? null,
          hero:        cfg.game.hero   ?? null,
          displayName: cfg.game.name   ?? cfg.game.id,
          hostId:      cfg.hostId      ?? null,
          // The label typed into the form. The engine assigned the id in `job.serverId`; the label is
          // what the person will read the row by, and it is theirs, so the tile carries it from the
          // moment the install is accepted rather than waiting out the download.
          label:       cfg.name        || null,
        });
      }
      setInstalling(null);
      setRoute({ kind: "servers" });
    }, err => {
      if (err && err.code === 401) noteAuthFailure(cfg.hostId);
      // The modal is left open on purpose — the config is still on screen and the failure is usually
      // something to change and retry, so the sentence goes back into it beside the fields rather than
      // into a toast over the form that would have to be re-read anyway.
      setInstallError((err && (err.userMessage || err.message))
        || ("Couldn't install " + ((cfg.game && cfg.game.name) || "the server")));
    });
  };

  // The server the detail page renders is the store's row as-is. The console is its own feed —
  // ConsolePanel hydrates a REST tail and follows the per-server topic itself — so the shell holds
  // no console state and a line arriving does not re-render the whole app.
  const serverForRender = activeServer;

  // --- Render ---
  useAlerts();

  // Where the cluster signs people in is AuthGate's — this component is not mounted until there is
  // a session with an active account behind it.

  // The sidebar badge counts the CLUSTER's firing alerts — an alert on any node
  // needs a human, so hiding it behind a scope would hide the work.
  const alertCounts = alertBuckets("all");
  const attentionCount = alertCounts.active.length;
  const attentionTone = alertCounts.active.some(i => i.severity === "danger") ? "danger"
    : alertCounts.active.some(i => i.severity === "warn") ? "warn" : "info";

  const diagActive = anchoredAlerts(an => an.surface === "diagnostics");
  const diagnosticsCount = diagActive.length;
  const diagnosticsTone = alertsTone(diagActive);

  const serverAlertsActive = anchoredAlerts(an => an.surface === "server");
  const serversCount = serverAlertsActive.length;
  const serversTone = alertsTone(serverAlertsActive);

  // A node that cannot be reached at all is ColdStartDown's to say, below; everything else the boot
  // could not settle is said here, ahead of every hold.
  const coldDown = conn.status === "down" && !conn.everLoaded;
  if (bootFailure && !coldDown) {
    return <BootFailed reason={bootFailure} onRetry={() => window.location.reload()} onSignOut={handleLogout} />;
  }

  // A clustered panel keeps no node list, so an empty connection set on a fresh load means the
  // anchor has not answered yet — not that this account has no hosts. Offering to add one then is a
  // confident wrong answer, and the node it would ask somebody to type is one the cluster already
  // knows about. `unreachable` falls through deliberately: an anchor that cannot be asked is a
  // cluster this browser cannot currently reach, and the connection banner is what says so.
  if (!wired && fleet.state === "asking") {
    return <BootLanding label="Finding your cluster…" />;
  }

  if (route.kind === "addHost" || (hostsLoaded && hosts.length === 0)) {
    return <AddHostPage
      user={user}
      firstRun={hosts.length === 0}
      onAdded={() => setRoute({ kind: "home" })}
      onCancel={hosts.length ? () => setRoute({ kind: "home" }) : null}
      onLogout={handleLogout} />;
  }

  if (coldDown) {
    return <ColdStartDown retrying={conn.retrying} onRetry={retryConnection} onLogout={handleLogout} />;
  }

  if (!landingResolved) {
    return <BootLanding />;
  }

  const sidebarCollapsed = desktop ? collapsed : false;
  const railReserve = railMode && !assistantOpen ? 56 : 0;
  const appInset = pushingPanel ? dockWidth : railReserve;

  const sidebarCtx = {
    serverName: serverForRender ? serverForRender.name : null,
    // A server tab whose read this person lacks is hidden, and the page falls back to the overview —
    // so the breadcrumb has to know, or it would name a tab that isn't on screen.
    serverTabOffered: serverForRender ? serverTabOffered(serverForRender, route.tab || "overview") : false,
    gameName: activeGame ? activeGame.name : null,
    // A cluster route names a MEMBER, and a member is a node or an anchor. A node is in the
    // connection set with a friendly name; an anchor is not driven by this browser at all and is
    // known only from the roster, so both are looked up and the crumb reads the same either way.
    hostName: route.hostId
      ? ((hosts.find(h => h.id === route.hostId) || {}).name
         || (clusterMembers.find(m => m.nodeId === route.hostId) || {}).label
         || null)
      : null,
    // Which kind, so the breadcrumb names the tab from that member's own strip. The two offer
    // different tabs, and naming one from the other's list silently drops the crumb.
    memberKind: route.hostId
      ? ((clusterMembers.find(m => m.nodeId === route.hostId) || {}).kind || "node")
      : null,
    // And which capability it holds, because an anchor's tabs are its capability's. Without it the
    // trail would name a tab from the full anchor vocabulary while the page shows its overview.
    memberCapability: route.hostId
      ? ((clusterCapabilities.find(c => c.held && c.memberId === route.hostId) || {}).capability || null)
      : null,
    // The leaf's display name is the services board's to give, and that board is host-scoped — a row
    // read while it still holds another host's list would name the wrong machine's leaf.
    leafName: (route.leaf && route.hostId && servicesByHost[route.hostId]
      ? (servicesByHost[route.hostId].list.find(s => s.id === route.leaf) || {}).displayName : null) || null,
    catalogLabel: KRYSTAL_LABELS.catalog || "Catalog",
  };

  return (
    <div className="app" style={{ "--dock-push": appInset + "px", ...(collapsed ? { "--sidebar-w": "64px" } : {}) }}>
      <Sidebar
        route={route}
        onNavigate={setRoute}
        serversCount={serversCount}
        serversTone={serversTone}
        clusterCount={diagnosticsCount}
        clusterTone={diagnosticsTone}
        attentionCount={attentionCount}
        attentionTone={attentionTone}
        user={user}
        onLogout={handleLogout}
        hosts={hosts}
        open={drawerOpen}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setCollapsed(c => !c)}
      />

      {drawerOpen && <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />}
      <MobileNavToggle onOpen={() => setDrawerOpen(true)} />

      <main className="app__main">
        <div className="content">
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
            handleLogout={handleLogout}
            setInstalling={setInstalling}
          />
        </div>
        <KrystalFooter />
      </main>

      <aside className={"assistant-dock" + (assistantOpen ? " assistant-dock--open" : "") + (pushingPanel ? " assistant-dock--push" : "") + (dockWidth < 550 ? " assistant-dock--compact" : "")}
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
            onExpand={desktop ? () => { setAssistantOpen(false); setChatFullscreen(true); } : undefined}
            onNavigate={handleAssistantNavigate}
            onOpenServer={(id, tab) => setRoute({ kind: "server", id, tab })}
            onOpenView={openView}
            getServerState={dock.getServerState}
            assistantHost={assistantHost}
            assistantHosts={assistantHostList}
            onSelectAssistantHost={chooseAssistant}
            review={review}
            onExitReview={exitReview}
          />
          </React.Suspense>
        )}
      </aside>

      {chatFullscreen && (
        <Modal onClose={() => setChatFullscreen(false)} scrimClassName="chat-modal-scrim">
          <div className="chat-modal" role="dialog" aria-modal="true" aria-label="Assistant">
            <ChatPage
              user={user}
              docked={false}
              seed={null}
              onClose={() => setChatFullscreen(false)}
              assistantHost={assistantHost}
              assistantHosts={assistantHostList}
              onSelectAssistantHost={chooseAssistant}
              onOpenServer={(id, tab) => setRoute({ kind: "server", id, tab })}
              onOpenView={openView}
              onNavigate={handleAssistantNavigate}
              getServerState={dock.getServerState}
            />
          </div>
        </Modal>
      )}

      {railMode && !assistantOpen && (
        <button className="assistant-rail" onClick={openAssistant} title="Open assistant" aria-label="Open assistant">
          <span className="assistant-rail__icon"><AssistantFabIcon size={18} /></span>
        </button>
      )}
      {!assistantOpen && (
        <button className="assistant-fab" onClick={openAssistant} title="Open assistant" aria-label="Open assistant">
          <AssistantFabIcon size={22} />
        </button>
      )}

      <Toasts />

      {/* Mounted once, renders nothing until ⌘K. It owns the hotkey itself rather than being
          handed one, so nothing in the shell has to know it exists. */}
      <CommandPalette onInstall={handleInstall} />

      {showWelcome && (
        <FirstRunWelcome user={user} onClose={() => setShowWelcome(false)} />
      )}

      {installing && (
        <InstallModal
          game={installing}
          hosts={installTargets}
          onInstall={confirmInstall}
          error={installError}
          onClose={() => { setInstalling(null); setInstallError(null); }}
        />
      )}
    </div>
  );
}

export { App };
