import React from "react";
import { AssistantDockProvider, useAssistantDock, alertAssistantPrompt } from "./components/AssistantDockContext.jsx";
import { alertsTone, anchoredAlerts } from "./components/ContextualAlerts.jsx";
import { ColdStartDown, ConnectivityBanner, ContentError, ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { KrystalFooter } from "./components/Footer.jsx";
import { Icon } from "./components/Icon.jsx";
import { InstallModal } from "./components/InstallModal.jsx";
import { NeedsAttention, alertBuckets, useAlerts } from "./components/NeedsAttention.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { api, connectionStore } from "./lib/apiClient.js";
import { CONNECTIONS } from "./lib/config.js";
import { KRYSTAL_LABELS } from "./lib/labels.js";
import { can, canOn, homeKind, resolveRoute } from "./lib/persona.js";
import { KrystalRouter } from "./lib/router.js";
import { sessionStore } from "./lib/sessionStore.js";
import { useStore } from "./lib/store.js";
import { auditStore, commandServer, hostsStore, installServer, libraryStore, scopeServers, selectedHostStore, serversStore, useSelectedHostId } from "./lib/stores.js";
import { ChatPage } from "./pages/ChatPage.jsx";
import { FirstRunWelcome } from "./pages/FirstRunWelcome.jsx";
import { AddHostPage, HostDeniedNotice } from "./pages/HostAccess.jsx";
import { HostExpiredNotice, HostReauthModal } from "./pages/HostReauth.jsx";
import { LoginPage } from "./pages/LoginPage.jsx";
import { ServerGate } from "./pages/ServerGate.jsx";

const AlertsPage = React.lazy(() => import("./pages/AlertsPage.jsx"));
const AuditLogPage = React.lazy(() => import("./pages/AuditLogPage.jsx"));
const DashboardPage = React.lazy(() => import("./pages/DashboardPage.jsx"));
const FleetPage = React.lazy(() => import("./pages/DiagnosticsPage.jsx"));
const DiscordPage = React.lazy(() => import("./pages/DiscordPage.jsx"));
const GamePage = React.lazy(() => import("./pages/GamePage.jsx"));
const Library = React.lazy(() => import("./pages/LibraryPage.jsx"));
const ServerDetailPage = React.lazy(() => import("./pages/ServerDetailPage.jsx"));
const ServersPage = React.lazy(() => import("./pages/ServersPage.jsx"));
const SettingsPage = React.lazy(() => import("./pages/SettingsPage.jsx"));

// App — top-level shell. Auth gate + routing.
// Wraps the inner app in AssistantDockProvider so dock state is available
// via useAssistantDock() throughout the tree.

const AUTH_LS_KEY = "krystal:auth";
const AUTH_SS_KEY = "krystal:auth:session";

function readStoredUser() {
  try {
    const persisted = localStorage.getItem(AUTH_LS_KEY);
    if (persisted) return JSON.parse(persisted);
    const sessioned = sessionStorage.getItem(AUTH_SS_KEY);
    if (sessioned) return JSON.parse(sessioned);
  } catch (e) {}
  return null;
}
function writeStoredUser(user) {
  // user.stay controls persistence: true → localStorage (survives reload),
  //                                  false → sessionStorage (cleared on tab close).
  try {
    localStorage.removeItem(AUTH_LS_KEY);
    sessionStorage.removeItem(AUTH_SS_KEY);
    if (!user) return;
    const target = user.stay ? localStorage : sessionStorage;
    target.setItem(user.stay ? AUTH_LS_KEY : AUTH_SS_KEY, JSON.stringify(user));
  } catch (e) {}
}

// BootLanding — the neutral hold shown on a fresh DEFAULT landing while the
// per-host roles resolve. We wait so we can send admins/operators to the
// dashboard and viewers to Servers WITHOUT first flashing the wrong page (the
// per-host-role race: homeKind() runs before the host list / tiers are known and
// buckets everyone as a viewer). Deep links never see this — they carry their own
// route and render immediately. See App's resolve-landing effect.
function BootLanding() {
  return (
    <div className="app app--booting" style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--fg-3)" }}>
      <div style={{ textAlign: "center" }}>
        <span style={{ display: "inline-block", animation: "act-spin 1.4s linear infinite" }}>
          <Icon name="loader-2" size={26} strokeWidth={1.7} />
        </span>
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--fg-2)" }}>Signing you in…</div>
      </div>
    </div>
  );
}

// Breadcrumb — a PROJECTION of the resolved route + the policy, not a
// hand-written ladder (architecture.html §3·f·1). The root "Home" crumb appears
// only when the persona can reach the dashboard; otherwise the section itself is
// the root. This is why a viewer is never shown a "Home" they'd be bounced from:
// the breadcrumb and the route guard read the same policy and can't disagree.
function breadcrumbTrail(route, ctx) {
  const trail = [];
  if (can("nav.dashboard")) trail.push({ label: "Home", kind: "home" });
  switch (route.kind) {
    case "home":      break; // Home is the page itself.
    case "servers":   trail.push({ label: "Servers", kind: "servers" }); break;
    case "server":    trail.push({ label: "Servers", kind: "servers" }, { label: ctx.serverName || "Server" }); break;
    case "library":   trail.push({ label: ctx.catalogLabel }); break;
    case "game":      trail.push({ label: ctx.catalogLabel, kind: "library" }, { label: ctx.gameName || "Game" }); break;
    case "attention": trail.push({ label: "Alerts" }); break;
    case "audit":     trail.push({ label: "Audit log" }); break;
    case "fleet":     route.hostId
                        ? trail.push({ label: "Fleet", kind: "fleet" }, { label: ctx.hostName || "Host" })
                        : trail.push({ label: "Fleet" });
                      break;
    case "discord":   trail.push({ label: "Discord" }); break;
    case "settings":  trail.push({ label: "Settings" }); break;
    case "chat":      trail.push({ label: "Assistant" }); break;
    default:          break;
  }
  return trail;
}

function Breadcrumb({ route, ctx, onNavigate }) {
  const trail = breadcrumbTrail(route, ctx);
  return (
    <div className="content__breadcrumb">
      {trail.map((c, i) => {
        const last = i === trail.length - 1;
        const clickable = !last && !!c.kind;
        return (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: "var(--fg-4)" }}>/</span>}
            <span
              style={{
                color: last ? "var(--fg-1)" : "var(--fg-3)",
                fontWeight: last ? 600 : 500,
                cursor: clickable ? "pointer" : "default",
              }}
              onClick={clickable ? () => onNavigate({ kind: c.kind }) : undefined}>
              {c.label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---- Mobile nav toggle ----------------------------------------------------
// The left-edge swipe is a nice accelerator but unreliable: several mobile
// browsers claim an edge-drag as "back", so the drawer never opens. So on phones
// (≤768px) we show a slim handle pinned to the middle of the left edge — exactly
// where the swipe lives — which reads as "the menu pulls out from here". The
// swipe stays as a secondary accelerator.
function MobileNavToggle({ onOpen }) {
  return (
    <button className="mnav mnav--edge" onClick={onOpen} aria-label="Open menu" title="Menu">
      {/* Match the Fleet-row "go" chevron exactly (DashboardPage `dash-fleet-row__go`):
          same icon + default strokeWidth, size 16, muted via the button's fg-4 color. */}
      <Icon name="chevron-right" size={16} />
    </button>
  );
}

// App — top-level shell. Sets up minimal state, wraps in AssistantDockProvider.
function App() {
  const [user, setUser] = React.useState(() => readStoredUser());
  const selectedHostId = useSelectedHostId();
  const hosts = useStore(hostsStore, s => s.list);
  const [route, setRouteRaw] = React.useState(() => resolveRoute({ kind: "home" }));
  const setRoute = React.useCallback((r) => {
    setRouteRaw(prev => resolveRoute(typeof r === "function" ? r(prev) : r));
  }, []);
  return (
    <AssistantDockProvider hosts={hosts} selectedHostId={selectedHostId} setRoute={setRoute}>
      <AppInner user={user} setUser={setUser} />
    </AssistantDockProvider>
  );
}

// AppInner — the real app body. Consumes dock state from context.
function AppInner({ user, setUser }) {
  const dock = useAssistantDock();
  const { assistantOpen, setAssistantOpen, assistantSeed, setAssistantSeed,
    assistantHost, assistantHostList, setAssistantHostId,
    dockWidth, dockResize, pushingPanel, railMode, desktop, effPush, tw,
    askAssistant, askAboutAlert, openAssistant, openView, handleAssistantNavigate } = dock;

  // --- Auth ---
  // Dev/QA query overrides (UI state only, no data faking):
  //   ?auth=out   — force logged-out
  //   ?first-run  — force the welcome overlay even when hosts are already configured
  const qp = new URLSearchParams(window.location.search);
  const forcedOut = qp.get("auth") === "out";
  const forcedFirstRun = qp.has("first-run");

  // First-run welcome fires once after a fresh sign-in. Because login reloads
  // (below), we carry that intent across the reload in a one-shot session flag
  // rather than React state. A forced re-auth return (returnTo stashed) is a
  // continuation, not a first sign-in, so it suppresses the welcome.
  const [firstRun, setFirstRun] = React.useState(() => {
    if (forcedFirstRun) return true;
    try {
      if (sessionStorage.getItem("krystal:justLoggedIn") === "1") {
        sessionStorage.removeItem("krystal:justLoggedIn");
        return !sessionStorage.getItem("krystal:returnTo");
      }
    } catch (e) {}
    return false;
  });

  // After a forced session-loss → re-login, restore the route we stashed so the
  // user lands back where they were. Kept ABOVE the auth gate so it's an
  // unconditional hook (stable order); it only acts once a user is present, so
  // it never clears the stash while the login page is still showing.
  React.useEffect(() => {
    if (!user) return;
    try {
      const back = sessionStorage.getItem("krystal:returnTo");
      if (back != null) {
        sessionStorage.removeItem("krystal:returnTo");
        if (back && back !== window.location.hash) window.location.hash = back;
      }
    } catch (e) {}
  }, [user]);

  const handleLogout = () => {
    // Reload out to the login surface rather than swapping <App> → <LoginPage> in
    // place — keeps App's hook count stable across the auth boundary (several
    // dock-restore hooks live below the `!user` gate, so flipping user in place
    // trips React's Rules of Hooks).
    writeStoredUser(null);
    // Drop the per-host credentials too — the refresh token is long-lived
    // (weeks), so without this a reload would silently rotate straight back in.
    // Keep the host registry (signOut, not forgetHosts) so the user lands on the
    // host's Discord login, not the add-host screen.
    try { sessionStore.signOut(); } catch (e) {}
    try {
      sessionStorage.removeItem("krystal:justLoggedIn");
      sessionStorage.removeItem("krystal:returnTo");
    } catch (e) {}
    window.location.reload();
  };

  // --- Data + routing ---
  // Servers come from the reactive store (server-authoritative cache), not
  // local state. useStore re-renders this tree when the store changes; the
  // store is always current, so delayed post-action reads use serversStore.find.
  const servers = useStore(serversStore, s => s.list);
  // The servers store's own async-state machine — used to gate the server-detail
  // route so a deep-link / hard refresh that lands before the first fetch resolves
  // renders a loading state instead of crashing on a null server. `everLoaded`
  // flips on the first successful hydrate; a warm refresh preserves the list, so a
  // null server PAST everLoaded is genuinely absent (a 404), not still-loading.
  const serversStatus = useStore(serversStore, s => s.status);
  const serversLoaded = useStore(serversStore, s => s.everLoaded);
  const libraryList = useStore(libraryStore, s => s.list);
  const getServerState = (id) => serversStore.find(id);
  // Global host scope (sidebar switcher). "all" → aggregate; else one host.
  // Servers shown on fleet pages are scoped; detail lookups use the full list
  // so deep links survive a scope that would otherwise hide the target.
  const selectedHostId = useSelectedHostId();
  const hosts = useStore(hostsStore, s => s.list);
  const hostsLoaded = useStore(hostsStore, s => s.everLoaded);
  const sessionsByHost = useStore(sessionStore, s => s.byHost); // re-render on per-host auth changes
  const scopedServers = scopeServers(servers, selectedHostId);

  // Authorization readiness — the gate the DEFAULT landing waits on (resolve-landing
  // effect below). We can only pick the persona's home once the host list has loaded
  // AND every host's session has left its in-flight state, because the role lives in
  // each host's session (sessionStore.tierOf). Until then homeKind() runs against an
  // empty host list / unresolved tiers and buckets everyone as a viewer (→ Servers).
  // expired/denied count as settled — a lapsed or refused host must not block the
  // landing forever (its tier is simply absent from the aggregate).
  const authzSettled = hostsLoaded && hosts.every(h => {
    const st = (sessionsByHost[h.id] && sessionsByHost[h.id].status) || "none";
    return st !== "none" && st !== "bootstrapping";
  });

  // Set when the user arrives with NO explicit destination (the fallthrough
  // below), so we owe them the persona's default page — but only AFTER per-host
  // roles resolve. A hash / ?view= / ?tab= is an explicit destination and keeps
  // its own route untouched. Captured into a ref at mount (landedDefaultRef).
  let landedDefault = false;
  const initialRoute = (() => {
    // The URL hash is the source of truth when present (refresh, deep link,
    // Back/Forward). Fall back to the legacy ?view=/?tab= entry params (used by
    // the standalone preview cards), then home.
    const fromHash = KrystalRouter.routeFromHash();
    if (fromHash) return fromHash;
    if (qp.get("view") === "home") return { kind: "home" };
    if (qp.get("view") === "library") return { kind: "library" };
    if (qp.get("view") === "discord") return { kind: "discord" };
    if (qp.get("view") === "audit") return { kind: "audit" };
    if (qp.get("view") === "diagnostics") return { kind: "fleet" };
    if (qp.get("view") === "hosts") return { kind: "fleet" };
    if (qp.get("view") === "fleet") return { kind: "fleet" };
    if (qp.get("view") === "settings") return { kind: "settings" };
    if (qp.get("view") === "chat") return { kind: "chat" };
    // ?tab=… implies a server detail page. Default to the first server when
    // no id is supplied so deep-links like ?tab=files work standalone.
    if (qp.get("tab")) return { kind: "server", id: initial[0].id, tab: qp.get("tab") };
    // Default landing: the persona's home — the ops dashboard if they can reach
    // it, else the servers list (a viewer's actual home). homeKind() reads the
    // one policy; a hash / explicit param above always wins. The result (like
    // every candidate route) is run through resolveRoute below before it lands.
    // This first call runs before per-host roles are known, so it is provisional —
    // the resolve-landing effect re-picks it once authorization settles.
    landedDefault = true;
    return { kind: homeKind ? homeKind() : "home" };
  })();
  const initialTab = qp.get("tab") || "overview";
  const initialInstall = (() => {
    const g = qp.get("install");
    if (!g) return null;
    // Resolve from the library STORE (hydrated from /library). If it hasn't
    // loaded yet, a bare { id } stub is enough — the install modal resolves the
    // full blueprint from libraryList once it lands.
    return libraryStore.getState().list.find(c => c.id === g) || { id: g };
  })();

  // The routing CHOKEPOINT (architecture.html §3·f·1). Route state can only ever
  // hold a surface this persona may occupy: resolveRoute maps a forbidden
  // destination to the persona's home SYNCHRONOUSLY. Because the single setter
  // resolves, every navigation — initial load, hashchange, Back/Forward, and
  // every programmatic call site — is gated by construction. The forbidden page
  // never enters state, never mounts, never fires its effects. No flash, no
  // reactive bounce-effect (the old useEffect guard is gone — this replaces it).
  const [route, setRouteRaw] = React.useState(() => resolveRoute(initialRoute));
  const setRoute = React.useCallback((r) => {
    setRouteRaw(prev => resolveRoute(typeof r === "function" ? r(prev) : r));
  }, []);

  // Default-landing gate (the per-host role race). On a DEFAULT landing the route
  // above was picked before roles were known, so we hold a neutral loading surface
  // (BootLanding) and don't commit it to the URL until the resolve-landing effect
  // re-picks the home once authorization settles. A deep link (landedDefault ===
  // false) starts resolved and renders immediately.
  const landedDefaultRef = React.useRef(landedDefault);
  const [landingResolved, setLandingResolved] = React.useState(() => !landedDefault);
  const [tab, setTab] = React.useState("My Servers");
  const [extraLog, setExtraLog] = React.useState({});
  const [installing, setInstalling] = React.useState(initialInstall);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  // Desktop sidebar collapse (icon rail). Smaller desktops default to the rail;
  // the user's explicit choice wins and is remembered. Mobile ignores this and
  // uses the off-canvas drawer instead.
  const [collapsed, setCollapsed] = React.useState(() => {
    const v = localStorage.getItem("krystal:sidebar:collapsed");
    if (v === "1") return true;
    if (v === "0") return false;
    return window.innerWidth <= 1100;
  });
  React.useEffect(() => {
    try { localStorage.setItem("krystal:sidebar:collapsed", collapsed ? "1" : "0"); } catch (e) {}
  }, [collapsed]);

  // Auto-close the drawer on any route change.
  React.useEffect(() => { setDrawerOpen(false); }, [route, tab]);

  // Mobile edge-swipe: drag in from the LEFT edge opens the nav drawer; drag in
  // from the RIGHT edge opens the assistant dock — a symmetric gesture model
  // (left = where you go, right = who you ask). Swiping the opposite way closes
  // whichever is open. A secondary accelerator only; both have visible buttons.
  React.useEffect(() => {
    if (window.innerWidth > 768) return;
    let sx = 0, sy = 0, fromLeft = false, fromRight = false, tracking = false;
    const EDGE = 28, THRESH = 60;
    const onStart = (e) => {
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY;
      fromLeft = sx <= EDGE;
      fromRight = sx >= window.innerWidth - EDGE;
      tracking = fromLeft || fromRight || drawerOpen || assistantOpen;
    };
    const onEnd = (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < THRESH || Math.abs(dy) > Math.abs(dx)) return;
      if (dx > 0) {              // swipe right
        if (fromLeft && !drawerOpen) setDrawerOpen(true);
        else if (assistantOpen) setAssistantOpen(false);
      } else {                  // swipe left
        if (fromRight && !assistantOpen) setAssistantOpen(true);
        else if (drawerOpen) setDrawerOpen(false);
      }
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [drawerOpen, assistantOpen]);

  // --- URL <-> route sync (the address bar is the source of truth) ---
  // Keep the latest route in a ref so the hashchange listener (registered once)
  // can compare against it without re-subscribing on every navigation.
  const routeRef = React.useRef(route);
  routeRef.current = route;
  const didInitUrl = React.useRef(false);

  // route -> URL. On the very first run we canonicalize the address with
  // replaceState (no spurious history entry); every later navigation writes the
  // hash normally, which pushes a Back-able entry.
  React.useEffect(() => {
    // Hold off while a default landing is still resolving — the route is provisional
    // (likely the viewer fallback). Writing it now would leave a stale #/servers in
    // history that the resolve flips to #/. The first write after landingResolved is
    // the canonical replaceState (didInitUrl is still false), so no history entry.
    if (!landingResolved) return;
    const desired = KrystalRouter.routeToHash(route);
    if (window.location.hash === desired) { didInitUrl.current = true; return; }
    if (!didInitUrl.current) {
      didInitUrl.current = true;
      try { window.history.replaceState(null, "", desired); return; } catch (e) {}
    }
    try { window.location.hash = desired; } catch (e) {}
  }, [route, landingResolved]);

  // URL -> route. Fires on Back/Forward (and any external hash change). We only
  // setRoute when the URL genuinely points somewhere else, so our own writes
  // above don't loop back through here.
  React.useEffect(() => {
    const onHashChange = () => {
      const next = KrystalRouter.parseHash();
      if (!KrystalRouter.sameRoute(next, routeRef.current)) setRoute(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // --- Resilience: connection bootstrap, banner/cold state ---
  const conn = useStore(connectionStore, s => s);
  // The cold bootstrap: one real fetch on mount. Success → 'live' + everLoaded
  // (shell stays); failure → 'down' with nothing loaded → cold-start takeover.
  // Reused by every Retry. The guard() in the api seam flips connectionStore.
  const retryConnection = React.useCallback(() => {
    connectionStore.setState(s => ({ ...s, retrying: true, status: s.everLoaded ? s.status : "connecting" }));
    return api.fanOut("/servers").catch(() => {});
  }, []);
  React.useEffect(() => { retryConnection(); }, [retryConnection]);
  // The host whose session needs interactive re-auth → drives HostReauthModal.
  const [reauthHostId, setReauthHostId] = React.useState(null);

  React.useEffect(() => {
    if (initialInstall) setRoute({ kind: "library" });
  }, []);

  // Resolve the default landing once per-host authorization settles. The initial
  // render computed homeKind() before the host list / tiers were known — so an
  // admin or operator would wrongly land on Servers (the viewer home). Now that
  // roles are resolved, re-pick: admin/operator → the dashboard, viewer/other →
  // Servers. Fires only for a default landing (a deep link / refreshed page keeps
  // its route) and only once; the BootLanding hold below covers the wait.
  React.useEffect(() => {
    if (landingResolved || !landedDefaultRef.current) return;
    if (!authzSettled) return;
    setRoute({ kind: homeKind ? homeKind() : "home" });
    setLandingResolved(true);
  }, [authzSettled, landingResolved]);

  // No `|| servers[0]` fallback: a deep-link to an unknown id must resolve to a
  // genuine "not found", never silently swap in some other server — that fallback
  // both crashed the detail page when the store was empty (null `server` → every
  // child dereferences `server.*`) and showed the WRONG server when it wasn't. The
  // route render below gates on this being null (ServerGate).
  const activeServer = route.kind === "server"
    ? servers.find(s => s.id === route.id) || null
    : null;
  // The catalog blueprint behind a game detail page (#/library/<id>).
  const activeGame = route.kind === "game"
    ? (libraryList.find(g => g.id === route.id) || null)
    : null;

  const append = (id, line) => {
    setExtraLog(prev => ({ ...prev, [id]: [...(prev[id] || []), line] }));
  };

  // Console lines arrive from the server over the `console` channel, not written
  // inline by the action handler.
  React.useEffect(() => {
    return api.stream.subscribe(["console"], (m) => {
      if (m.type === "console.line" && m.data) append(m.data.serverId, m.data.line);
    });
  }, []);

  const handleAction = (action, targetId) => {
    const s = targetId ? servers.find(x => x.id === targetId) || activeServer : activeServer;
    if (!s) return;
    // Optimistic UX for Start only: flip the card to "starting" immediately so it
    // doesn't sit on stale "offline" for the round trip + the backend's own launch
    // work, before the FIRST authoritative server.patch (starting→running) arrives
    // over the same `servers` SSE stream and overwrites this. serversStore.refresh's
    // REST merge already preserves socket-owned `status` for a known row, so this
    // survives a background refetch same as any other socket-driven status.
    // Honesty on failure: if the POST rejects, revert to the prior status — but
    // only if nothing else has since moved status on (a real server.patch may have
    // already landed and raced the rejection; don't clobber that with a stale revert).
    if (action === "start") {
      const prevStatus = s.status;
      serversStore.patch(s.id, { status: "starting" });
      commandServer(s, action).catch(err => {
        if (err && err.code === 401) setReauthHostId(s.hostId);
        const cur = serversStore.find(s.id);
        if (cur && cur.status === "starting") serversStore.patch(s.id, { status: prevStatus });
        // 403 (role removed) surfaces via the scoped denyGate; nothing to do here.
      });
      return;
    }
    // Dispatch through commandServer → the HOST-SCOPED client so the per-host
    // session gate runs: an expired session that can't silently renew rejects 401 →
    // we open the re-auth modal for that host instead of the command failing
    // silently. The command stamps origin:"ui" (M5 provenance); the server then
    // runs the transition and streams its status + job progress + console back over
    // the `servers` / `jobs` / `console` channels.
    commandServer(s, action).catch(err => {
      if (err && err.code === 401) setReauthHostId(s.hostId);
      // 403 (role removed) surfaces via the scoped denyGate; nothing to do here.
    });
  };


  // Library cards are BLUEPRINTS — clicking one opens the game detail page, not
  // a running server. "Create server" on that page opens the install modal
  // (always a NEW instance, even when one already exists).
  const openGame = (game) => setRoute({ kind: "game", id: game.id });
  const handleInstall = (game) => {
    setInstalling(game);
  };

  const confirmInstall = (cfg) => {
    // POST /servers → 202 { job }. Seed a phantom card immediately so the user
    // sees progress before kgsm finishes (which can take minutes for large games).
    // The phantom lives in serversStore and is replaced in-place by server.patch
    // SSE when the install completes. Other users see the phantom via job.patch SSE
    // (the jobs subscriber handles that path reactively).
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
      setFirstRun(false);
      setRoute({ kind: "servers" });
    }, err => {
      // 401 → re-auth that host; other failures (400 bad blueprint / 409 in-flight /
      // 503 engine absent) leave the modal open so the unfinished install stays visible.
      if (err && err.code === 401) setReauthHostId(cfg.hostId);
    });
  };

  const serverForRender = activeServer ? {
    ...activeServer,
    log: [...activeServer.log, ...(extraLog[activeServer.id] || [])],
  } : null;

  // Sidebar host switcher → global scope. Selecting a host re-frames every
  // surface; deep server views stay valid because lookups use the full list.
  const selectHost = (id) => selectedHostStore.set(id);

  // -------------- Render --------------

  // Subscribe to the alert feed BEFORE any conditional return. useAlerts is a
  // real hook (useReducer + useEffect), so it must run on EVERY render — calling
  // it after the `if (!user)` early return changed the hook count across the
  // logout/login boundary and crashed the tree ("rendered fewer hooks").
  const useAl = useAlerts || (() => null);
  useAl();

  // No host connected yet → the connect screen is the entry surface. There's no
  // global API to sign into before you pick one, so this comes BEFORE the login
  // gate. The connection set is read at module load (a successful connect writes
  // the registry + reloads), so this early return is stable across the mount —
  // safe alongside the other post-hooks gates below.
  if (!CONNECTIONS.length) {
    return <AddHostPage firstRun />;
  }
  if (!user) {
    return <LoginPage />;
  }

  // Live alert counts for the sidebar badge — driven by the server feed and
  // re-rendered the instant the feed changes (server push or local action echo).
  const alertCounts = alertBuckets ? alertBuckets(selectedHostId) : { active: [] };
  const attentionCount = alertCounts.active.length;
  const attentionTone = alertCounts.active.some(i => i.severity === "danger") ? "danger"
    : alertCounts.active.some(i => i.severity === "warn") ? "warn" : "info";

  // Diagnostics sidebar badge — active alerts that originate on the host
  // machine (disk / processes / host events), so the nav hints before you open.
  const diagActive = anchoredAlerts ? anchoredAlerts(an => an.surface === "diagnostics") : [];
  const diagnosticsCount = diagActive.length;
  const diagnosticsTone = alertsTone ? alertsTone(diagActive) : "info";

  // Servers sidebar badge — firing alerts anchored to a game server (surface
  // "server"), mirroring the Fleet badge for host/diagnostics alerts. Real
  // counts straight off the alert feed.
  const serverAlertsActive = anchoredAlerts ? anchoredAlerts(an => an.surface === "server") : [];
  const serversCount = serverAlertsActive.length;
  const serversTone = alertsTone ? alertsTone(serverAlertsActive) : "info";

  // Cold start: the very first load couldn't reach the backend, so there's
  // nothing to show — the one case that warrants a full-screen takeover. A warm
  // drop (everLoaded) degrades to the banner + per-surface errors instead.
  // No host configured yet (first run, or every host forgotten) — the Add-host
  // intermediate instead of an empty dashboard. Also the explicit #/hosts/add
  // route. Placed AFTER all hooks (below) so the hook order stays constant.
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

  // Default landing still waiting on per-host roles → hold a neutral loading
  // surface instead of flashing Servers and then jumping to the dashboard once an
  // admin/operator's role lands (resolve-landing effect above). Placed after the
  // add-host / cold-start gates so those takeovers still win, and after every hook
  // so the hook order stays constant across the pending → resolved transition.
  // Deep links never reach here (landingResolved starts true).
  if (!landingResolved) {
    return <BootLanding />;
  }

  // Scoped to a host where this Discord role is denied → the terminal 403
  // surface replaces data pages. Fleet / Settings / Discord stay reachable so
  // you can switch scope or manage the host. (403 is never re-authed.)
  const deniedHost = selectedHostId !== "all" ? hosts.find(h => h.id === selectedHostId) : null;
  const scopedDenied = !!(deniedHost && sessionStore && sessionStore.isDenied(selectedHostId));
  const denyGate = scopedDenied && !["fleet", "settings", "discord", "addHost"].includes(route.kind);

  // Scoped to a host whose session lapsed and couldn't silently renew → the
  // (non-terminal) expired surface replaces data pages, offering Re-authorize.
  // Same scope carve-outs as 403 so you can still switch away or manage the host.
  const expiredHost = selectedHostId !== "all" ? hosts.find(h => h.id === selectedHostId) : null;
  const scopedExpired = !!(expiredHost && sessionStore && sessionStore.needsReauth && sessionStore.needsReauth(selectedHostId));
  const expiredGate = scopedExpired && !["fleet", "settings", "discord", "addHost"].includes(route.kind);

  // Collapse (icon rail) is a DESKTOP-only affordance. On mobile the sidebar is a
  // full-width off-canvas drawer with room to spare, so it always renders
  // expanded — host switcher and account show their full form, same as desktop.
  const sidebarCollapsed = desktop ? collapsed : false;
  const railReserve = railMode && !assistantOpen ? 56 : 0;
  const appInset = pushingPanel ? dockWidth : railReserve;

  return (
    <div className="app" style={{ "--dock-push": appInset + "px", ...(collapsed ? { "--sidebar-w": "64px" } : {}) }}>
      <Sidebar
        onHome={() => setRoute({ kind: "home" })}
        homeActive={route.kind === "home"}
        onServers={() => setRoute({ kind: "servers" })}
        serversActive={route.kind === "servers"}
        serversCount={serversCount}
        serversTone={serversTone}
        onLibrary={() => setRoute({ kind: "library" })}
        libraryActive={route.kind === "library"}
        onDiscord={() => setRoute({ kind: "discord" })}
        discordActive={route.kind === "discord"}
        onAudit={() => setRoute({ kind: "audit" })}
        auditActive={route.kind === "audit"}
        onFleet={() => setRoute({ kind: "fleet" })}
        fleetActive={route.kind === "fleet"}
        fleetCount={diagnosticsCount}
        fleetTone={diagnosticsTone}
        onChat={() => setRoute({ kind: "chat" })}
        chatActive={route.kind === "chat"}
        onAttention={() => setRoute({ kind: "attention" })}
        attentionActive={route.kind === "attention"}
        attentionCount={attentionCount}
        attentionTone={attentionTone}
        onSettings={() => setRoute({ kind: "settings" })}
        settingsActive={route.kind === "settings"}
        user={user}
        onLogout={handleLogout}
        hosts={hosts}
        selectedHostId={selectedHostId}
        onSelectHost={selectHost}
        open={drawerOpen}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setCollapsed(c => !c)}
      />
      {drawerOpen && <div className="sidebar-scrim sidebar-scrim--open" onClick={() => setDrawerOpen(false)}></div>}
      {/* Mobile-only visible toggle for the off-canvas nav drawer — a slim handle
          on the left edge, exactly where the swipe lives (the swipe stays as a
          secondary accelerator but is unreliable across browsers). Hidden while
          the drawer itself is open. */}
      {!drawerOpen && (
        <MobileNavToggle onOpen={() => setDrawerOpen(true)} />
      )}
      <main className="app__main">
        <ConnectivityBanner onRetryRest={retryConnection} />
        {/* The Files tab fills all remaining height down to the footer (editing
            wants vertical room), so .content stops being a fixed flow box and
            grows — the flex chain continues into the FileBrowser card. */}
        <div className={"content" + (route.kind === "server" && route.tab === "files" ? " content--fill" : "")}>
          <Breadcrumb
            route={route}
            onNavigate={setRoute}
            ctx={{
              serverName: serverForRender ? serverForRender.name : null,
              gameName: activeGame ? activeGame.name : null,
              hostName: route.hostId ? ((hosts.find(h => h.id === route.hostId) || {}).name || null) : null,
              catalogLabel: (KRYSTAL_LABELS && KRYSTAL_LABELS.catalog) || "Catalog",
            }} />
          <ErrorBoundary
            resetKey={KrystalRouter.routeToHash(route)}
            fallback={(reset, error) => <ContentError error={error} onRetry={reset} onHome={() => setRoute({ kind: "home" })} />}>
          {denyGate ? (
            <HostDeniedNotice host={deniedHost}
              onBack={() => selectHost("all")}
              onManage={() => setRoute({ kind: "fleet", hostId: deniedHost.id })} />
          ) : expiredGate ? (
            <HostExpiredNotice host={expiredHost}
              onReauth={() => setReauthHostId(selectedHostId)}
              onBack={() => selectHost("all")} />
          ) : (<>
          <React.Suspense fallback={<div style={{ textAlign: "center", padding: "64px 0", color: "var(--fg-3)" }}><span style={{ display: "inline-block", animation: "act-spin 1.4s linear infinite" }}><Icon name="loader-2" size={26} strokeWidth={1.7} /></span><div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--fg-2)" }}>Loading…</div></div>}>
          {route.kind === "home" && <DashboardPage
            user={user}
            servers={scopedServers}
            canFleet={can("nav.fleet")}
            onOpenServer={(id) => setRoute({ kind: "server", id })}
            onAction={(id, action) => handleAction(action, id)}
            onLibrary={(filter) => setRoute({ kind: "library", filter })}
            onInstall={openGame}
            onAudit={() => setRoute({ kind: "audit" })}
            onDiagnostics={() => setRoute({ kind: "fleet" })}
            onOpenHostDiagnostics={(id) => setRoute({ kind: "fleet", hostId: id })}
            onServers={(status) => setRoute({ kind: "servers", status })}
            onViewAlerts={() => setRoute({ kind: "attention" })}
            onAttention={askAboutAlert}
          />}
          {route.kind === "attention" && <AlertsPage
            key={route.serverId || "all"}
            initialServerId={route.serverId}
            onOpenServer={(id, tab) => setRoute({ kind: "server", id, tab })}
            onOpenHost={(hostId) => setRoute({ kind: "fleet", hostId })}
            onOpenAudit={() => setRoute({ kind: "audit" })}
            onAsk={askAboutAlert}
          />}
          {route.kind === "servers" && <ServersPage
            key={route.status || "all"}
            servers={scopedServers}
            hosts={hosts}
            selectedHostId={selectedHostId}
            onSelectHost={selectHost}
            initialStatus={route.status}
            onOpenServer={(id) => setRoute({ kind: "server", id })}
            onAction={(id, action) => handleAction(action, id)}
            onLibrary={() => setRoute({ kind: "library" })}
          />}
          {route.kind === "library" && <Library key={route.filter || "all"} onOpenGame={openGame} onDeploy={handleInstall} initialFilter={route.filter} />}
          {route.kind === "game" && (activeGame
            ? <GamePage
                game={activeGame}
                servers={servers}
                onCreate={(g) => setInstalling(g)}
                onOpenServer={(id) => setRoute({ kind: "server", id })}
                onAction={(id, action) => handleAction(action, id)}
                onBrowse={() => setRoute({ kind: "library" })}
              />
            : <div style={{ padding: "60px 0", textAlign: "center", color: "var(--fg-3)" }}>
                That game isn’t in the library. <button className="dash-servers-empty__link" onClick={() => setRoute({ kind: "library" })}>Back to the library</button>
              </div>)}
          {route.kind === "discord" && <DiscordPage />}
          {route.kind === "audit"   && <AuditLogPage key={(route.severity || "all") + "|" + (route.serverId || "all")} initialSeverity={route.severity} initialServer={route.serverId} />}
          {route.kind === "fleet" && <FleetPage
            focusHostId={route.hostId}
            onFocusHost={(id) => setRoute({ kind: "fleet", hostId: id || undefined })}
            onAsk={askAboutAlert}
            onOpenServer={(id) => setRoute({ kind: "server", id })}
            onOpenServerSettings={(id) => setRoute({ kind: "server", id, tab: "settings" })}
            onViewAlerts={() => setRoute({ kind: "attention" })}
            onViewAudit={() => setRoute({ kind: "audit" })}
          />}
          {route.kind === "settings" && <SettingsPage user={user} onLogout={handleLogout} />}
          {route.kind === "chat" && <ChatPage user={user}
            assistantHost={assistantHost}
            assistantHosts={assistantHostList}
            onSelectAssistantHost={setAssistantHostId}
            onOpenServer={(id, tab) => setRoute({ kind: "server", id, tab })}
            onOpenView={openView}
            onNavigate={handleAssistantNavigate}
            getServerState={getServerState} />}
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
            : <ServerGate id={route.id} status={serversStatus} everLoaded={serversLoaded}
                onBack={() => setRoute({ kind: "servers" })}
                onRetry={() => serversStore.refresh().catch(() => {})} />
          )}
          </React.Suspense>
          </>)}
          </ErrorBoundary>
        </div>
        <KrystalFooter />
      </main>
      {/* Global assistant dock — slides in from the right over any page. */}
      <aside className={"assistant-dock" + (assistantOpen ? " assistant-dock--open" : "") + (pushingPanel ? " assistant-dock--push" : "")}
        style={{ width: window.innerWidth <= 768 ? undefined : dockWidth }}>
        {assistantOpen && <div className="assistant-dock__resize" onPointerDown={dockResize} title="Drag to resize"></div>}
        {assistantOpen && (
          <ChatPage
            user={user}
            docked
            showPin={tw.dockBehavior === "auto" && desktop}
            pinned={effPush}
            pinDisabled={!canPush}
            onTogglePin={() => setManualPin(!effPush)}
            assistantHost={assistantHost}
            assistantHosts={assistantHostList}
            onSelectAssistantHost={setAssistantHostId}
            seed={assistantSeed}
            onClose={() => setAssistantOpen(false)}
            onExpand={() => { setAssistantOpen(false); setRoute({ kind: "chat" }); }}
            onNavigate={handleAssistantNavigate}
            onOpenServer={(id, tab) => setRoute({ kind: "server", id, tab })}
            onOpenView={openView}
            getServerState={getServerState} />
        )}
      </aside>
      {assistantOpen && <div className="assistant-dock-scrim" onClick={() => setAssistantOpen(false)}></div>}
      {/* Persistent rail (behavior: rail) — always docked, reserves its own slim
          column, expands to the full panel on click. */}
      {railMode && !assistantOpen && assistantHostList.length > 0 && (
        <div className="assistant-rail">
          <button className="assistant-rail__btn" onClick={openAssistant} title="Open assistant" aria-label="Open assistant">
            <Icon name="bot" size={20} />
          </button>
          <span className="assistant-rail__label">Assistant</span>
          <span className="assistant-rail__spacer"></span>
        </div>
      )}
      {/* Floating assistant launcher — the global way in. Sits bottom-right, the
          side the dock grows from. Hidden while the dock is open, on the
          full-screen assistant page, or when the persistent rail is showing. */}
      {!assistantOpen && !drawerOpen && route.kind !== "chat" && assistantHostList.length > 0 && !railMode && (
        <button className="assistant-fab" onClick={openAssistant} title="Ask the assistant" aria-label="Ask the assistant">
          <Icon name="bot" size={22} />
        </button>
      )}
      {reauthHostId && (
        <HostReauthModal
          host={hosts.find(h => h.id === reauthHostId) || { id: reauthHostId, name: reauthHostId }}
          onClose={() => setReauthHostId(null)}
          onDone={() => setReauthHostId(null)}
        />
      )}
      {installing && (() => {
        // Install targets only hosts the user can create on (scoped server.create).
        // The entry points are already create-gated; this keeps the picker honest
        // for a mixed-role user (operator on one host, viewer on another).
        const operable = canOn ? hosts.filter(h => canOn("server.create", h.id)) : hosts;
        const scopedDefault = (selectedHostId !== "all" && operable.some(h => h.id === selectedHostId))
          ? selectedHostId
          : ((operable.find(h => h.online) || operable[0] || {}).id || null);
        return (
        <InstallModal
          game={libraryList.find(g => g.id === installing.id) || installing}
          hosts={operable}
          defaultHostId={scopedDefault}
          onClose={() => setInstalling(null)}
          onInstall={confirmInstall}
        />
        );
      })()}
      {firstRun && (
        <FirstRunWelcome
          user={user}
          onStart={() => { setFirstRun(false); setRoute({ kind: "library" }); }}
          onSkip={() => setFirstRun(false)}
        />
      )}
    </div>
  );
}

export { App };
