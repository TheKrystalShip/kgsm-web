import React from "react";
import { ConsolePanel } from "./components/ConsolePanel.jsx";
import { alertsTone, anchoredAlerts } from "./components/ContextualAlerts.jsx";
import { DashBandList, loadBandOrder, saveBandOrder } from "./components/DashLayout.jsx";
import { ColdStartDown, ConnectivityBanner, ContentError, CrashNow, DevPanel, ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { KrystalFooter } from "./components/Footer.jsx";
import { Icon } from "./components/Icon.jsx";
import { InstallModal } from "./components/InstallModal.jsx";
import { NeedsAttention, alertBuckets, useAlerts } from "./components/NeedsAttention.jsx";
import { ServerHero } from "./components/ServerHero.jsx";
import { ServerNotice } from "./components/ServerNotice.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { StatTiles } from "./components/StatTiles.jsx";
import { api, connectionStore } from "./lib/apiClient.js";
import { assistantHosts, assistantHostsAll, capUsable } from "./lib/capabilities.js";
import { KRYSTAL_DATA, KRYSTAL_LABELS } from "./lib/data.js";
import { can, canOn, homeKind, resolveRoute, serverOperable } from "./lib/persona.js";
import { KrystalRouter } from "./lib/router.js";
import { sessionStore } from "./lib/sessionStore.js";
import { useStore } from "./lib/store.js";
import { auditStore, hostsStore, libraryStore, scopeServers, selectedHostStore, serverHostId, serversStore, useSelectedHostId } from "./lib/stores.js";
import { AlertsPage } from "./pages/AlertsPage.jsx";
import { AuditLogPage, fmtRelative, parseTs } from "./pages/AuditLogPage.jsx";
import { BackupsList } from "./pages/BackupsList.jsx";
import { ChatPage } from "./pages/ChatPage.jsx";
import { DashboardPage, RecentActivity } from "./pages/DashboardPage.jsx";
import { FleetPage } from "./pages/DiagnosticsPage.jsx";
import { DiscordPage } from "./pages/DiscordPage.jsx";
import { FileBrowser } from "./pages/FileBrowser.jsx";
import { FirstRunWelcome } from "./pages/FirstRunWelcome.jsx";
import { GamePage } from "./pages/GamePage.jsx";
import { AddHostPage, HostDeniedNotice } from "./pages/HostAccess.jsx";
import { HostExpiredNotice, HostReauthModal } from "./pages/HostReauth.jsx";
import { Library } from "./pages/LibraryPage.jsx";
import { LoginPage } from "./pages/LoginPage.jsx";
import { PerformanceTab } from "./pages/PerformanceTab.jsx";
import { PlayersTab } from "./pages/PlayersTab.jsx";
import { ServerSettings } from "./pages/ServerSettings.jsx";
import { ServersPage } from "./pages/ServersPage.jsx";
import { SettingsPage } from "./pages/SettingsPage.jsx";

// App — top-level shell. Auth gate, routing, fake state machine.

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

// Build the question the "Ask assistant" button seeds into the composer. We
// pre-fill (not auto-send) so the user stays in control. Grounded in the
// specific alert: title, where it's firing, how long it's been up, and — when
// it has escalated past auto-recovery — framed as a hands-on "walk me through
// it" rather than an open "what's wrong".
function alertAssistantPrompt(item) {
  if (!item) return "";
  const srv = item.serverId && serversStore ? serversStore.find(item.serverId) : null;
  const where = srv ? " on " + srv.name : "";
  const when = (parseTs && fmtRelative && item.raisedAt)
    ? fmtRelative(parseTs(item.raisedAt), new Date())
    : null;
  const raised = when ? " (raised " + when + ")" : "";
  if (item.escalated) {
    return "The alert \u201C" + item.title + "\u201D" + where + " escalated \u2014 auto-recovery gave up after "
      + item.attempts + " attempt" + (item.attempts === 1 ? "" : "s") + " and it needs a human. "
      + "Walk me through diagnosing and fixing it.";
  }
  return "The alert \u201C" + item.title + "\u201D is firing" + where + raised
    + ". What's likely causing it, and how do I fix it?";
}

function SubTabs({ tabs, active, onChange }) {
  const current = tabs.find(t => t.id === active) || tabs[0];
  return (
    <>
      <div className="subtabs">
        {tabs.map(t => (
          <button key={t.id}
            className={"subtab" + (t.id === active ? " subtab--active" : "")}
            onClick={() => onChange(t.id)}>
            <Icon name={t.icon} size={14} />
            {t.label}
            {t.badge > 0 && <span className={"subtab__badge subtab__badge--" + (t.badgeTone || "info")}>{t.badge}</span>}
          </button>
        ))}
      </div>
      <label className="subtabs-mobile" aria-label="Section">
        <Icon name={current.icon} size={16} />
        <span className="subtabs-mobile__label">{current.label}</span>
        <select value={active} onChange={e => onChange(e.target.value)}>
          {tabs.map(t => (
            <option key={t.id} value={t.id}>{t.label}{t.badge ? " · " + t.badge + " alert" + (t.badge === 1 ? "" : "s") : ""}</option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} />
      </label>
    </>
  );
}

function ServerDetailPage({ server, onAction, tab: tabProp, onTabChange, onAsk, onOpenServer, onViewServerAlerts, onViewServerAudit }) {
  if (useAlerts) useAlerts();
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
      {safeTab === "files"       && <FileBrowser />}
      {safeTab === "backups"     && <BackupsList />}
      {safeTab === "settings"    && <ServerSettings server={server} />}
    </>
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

function App() {
  // --- Auth ---
  // Query overrides for the design-system demo:
  //   ?auth=out   — force logged-out
  //   ?first-run  — force the welcome overlay even with seed data
  const qp = new URLSearchParams(window.location.search);
  const forcedOut = qp.get("auth") === "out";
  const forcedFirstRun = qp.has("first-run");

  const [user, setUser] = React.useState(forcedOut ? null : readStoredUser());
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

  const handleLogin = (u) => {
    // Persist, then hard-reload into the app. A full reload (rather than an
    // in-place setUser) keeps App's hook count stable across the auth boundary —
    // several dock-restore hooks live below the `!user` gate, so flipping user
    // null→set in place trips React's Rules of Hooks. It also mirrors a real
    // OAuth callback landing on a fresh document. We strip the logged-out demo
    // overrides so ?auth=out / ?first-run don't bounce us back to the login.
    writeStoredUser(u);
    try { sessionStorage.setItem("krystal:justLoggedIn", "1"); } catch (e) {}
    const url = new URL(window.location.href);
    url.searchParams.delete("auth");
    url.searchParams.delete("first-run");
    const target = url.toString();
    // Stripping a demo param changes the URL → replace navigates + reloads.
    // With no param to strip the URL is unchanged, so replace() wouldn't reload
    // (it'd be a no-op / hash-only) — force a full reload in that case.
    if (target !== window.location.href) window.location.replace(target);
    else window.location.reload();
  };
  const handleLogout = () => {
    // Same reasoning as handleLogin: reload out to the login surface rather than
    // swapping <App> → <LoginPage> in place.
    writeStoredUser(null);
    try {
      sessionStorage.removeItem("krystal:justLoggedIn");
      sessionStorage.removeItem("krystal:returnTo");
    } catch (e) {}
    window.location.reload();
  };
  // The PANEL identity itself lapsed (a global 401, distinct from a per-host
  // session expiry). Eject to the full LoginPage — but stash the current route
  // first so re-auth lands them back exactly here (the hash router, #01, makes
  // this a one-liner). This is the ONLY auth case that takes over the whole app.
  // Reload (not in-place) for the same hook-stability reason as login/logout;
  // returnTo survives in sessionStorage and the effect above restores it.
  const handleSessionLost = () => {
    try {
      sessionStorage.setItem("krystal:returnTo", window.location.hash || "");
    } catch (e) {}
    writeStoredUser(null);
    window.location.reload();
  };

  // --- Data + routing ---
  // Servers come from the reactive store (server-authoritative cache), not
  // local state. useStore re-renders this tree when the store changes; the
  // store is always current, so delayed post-action reads use serversStore.find.
  const servers = useStore(serversStore, s => s.list);
  const libraryList = useStore(libraryStore, s => s.list);
  const getServerState = (id) => serversStore.find(id);
  // Global host scope (sidebar switcher). "all" → aggregate; else one host.
  // Servers shown on fleet pages are scoped; detail lookups use the full list
  // so deep links survive a scope that would otherwise hide the target.
  const selectedHostId = useSelectedHostId();
  const hosts = useStore(hostsStore, s => s.list);
  const hostsLoaded = useStore(hostsStore, s => s.everLoaded);
  useStore(sessionStore, s => s.byHost); // re-render on per-host auth changes
  const scopedServers = scopeServers(servers, selectedHostId);

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
    return { kind: homeKind ? homeKind() : "home" };
  })();
  const initialTab = qp.get("tab") || "overview";
  const initialInstall = (() => {
    const g = qp.get("install");
    if (!g) return null;
    return KRYSTAL_DATA.catalog.find(c => c.id === g) || null;
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
  // Global assistant dock — toggled from anywhere, slides in from the right
  // and overlays whatever page the user is on. Width is user-resizable and
  // persisted.
  const [assistantOpen, setAssistantOpen] = React.useState(false);
  // A question seeded into the docked assistant by the "Ask assistant" button
  // on an alert. { prompt, serverId, nonce } — the nonce makes each click a
  // fresh seed even when the prompt text repeats. Consumed by ChatPage, which
  // pre-fills the composer (does not auto-send).
  const [assistantSeed, setAssistantSeed] = React.useState(null);
  // Dock layout behavior (fixed): the OPEN dock pushes content left when there's
  // room and overlays when it'd get tight, opening by default on large screens.
  const tw = { dockBehavior: "auto", contentFloor: 1000, openByDefault: true };
  // Pin override for 'auto' mode (the in-dock pin button). Persisted, so the
  // user's choice is remembered across sessions. null = follow the auto rule;
  // true/false = user forced push/overlay.
  const [manualPin, setManualPin] = React.useState(() => {
    const v = localStorage.getItem("krystal:dock:pin");
    return v === "1" ? true : v === "0" ? false : null;
  });
  // Viewport width, tracked so push/overlay recomputes live on resize.
  const [vw, setVw] = React.useState(() => window.innerWidth);
  // Which host's assistant the dock/page targets. The assistant is a per-host
  // capability with no central fallback (capabilities.js); this resolves below
  // to an assistant-capable host or null.
  const [assistantHostId, setAssistantHostId] = React.useState(null);
  const [dockWidth, setDockWidth] = React.useState(() => {
    const saved = parseInt(localStorage.getItem("krystal:dock:width") || "", 10);
    return saved && saved >= 320 && saved <= 900 ? saved : 420;
  });
  const dockResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = dockWidth;
    const min = 320, max = Math.min(900, window.innerWidth - 80);
    const onMove = (ev) => {
      const w = Math.max(min, Math.min(max, startW + (startX - ev.clientX)));
      setDockWidth(w);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      const handle = document.querySelector(".assistant-dock__resize");
      if (handle) handle.classList.remove("assistant-dock__resize--active");
    };
    document.body.style.userSelect = "none";
    e.currentTarget.classList.add("assistant-dock__resize--active");
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };
  React.useEffect(() => {
    try { localStorage.setItem("krystal:dock:width", String(dockWidth)); } catch (e) {}
  }, [dockWidth]);
  React.useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Persist the pin preference so it survives reloads.
  React.useEffect(() => {
    try {
      if (manualPin == null) localStorage.removeItem("krystal:dock:pin");
      else localStorage.setItem("krystal:dock:pin", manualPin ? "1" : "0");
    } catch (e) {}
  }, [manualPin]);

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
    const desired = KrystalRouter.routeToHash(route);
    if (window.location.hash === desired) { didInitUrl.current = true; return; }
    if (!didInitUrl.current) {
      didInitUrl.current = true;
      try { window.history.replaceState(null, "", desired); return; } catch (e) {}
    }
    try { window.location.hash = desired; } catch (e) {}
  }, [route]);

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

  // --- Resilience: connection bootstrap, banner/cold state, dev crash ---
  const conn = useStore(connectionStore, s => s);
  const devMode = qp.has("dev") || (() => { try { return localStorage.getItem("krystal:dev") === "1"; } catch (e) { return false; } })();
  // The cold bootstrap: one real fetch on mount. Success → 'live' + everLoaded
  // (shell stays); failure → 'down' with nothing loaded → cold-start takeover.
  // Reused by every Retry. The guard() in the api seam flips connectionStore.
  const retryConnection = React.useCallback(() => {
    connectionStore.setState(s => ({ ...s, retrying: true, status: s.everLoaded ? s.status : "connecting" }));
    return api.get("/servers").catch(() => {});
  }, []);
  React.useEffect(() => { retryConnection(); }, [retryConnection]);
  // Dev-only: a render crash to demonstrate the content boundary. Cleared on
  // navigation (and by the boundary's Try-again), so recovery is one click.
  const [crash, setCrash] = React.useState(false);
  // The host whose session needs interactive re-auth → drives HostReauthModal.
  const [reauthHostId, setReauthHostId] = React.useState(null);
  React.useEffect(() => { setCrash(false); }, [route]);
  const [slowOn, setSlowOn] = React.useState(() => { try { return api.__slow ? api.__slow() : false; } catch (e) { return false; } });
  const toggleSlow = () => {
    const next = !slowOn;
    setSlowOn(next);
    api.__setSlow(next);
    // Re-enter loading on every surface so skeletons appear right now.
    if (next) {
      serversStore.refresh().catch(() => {});
      libraryStore.refresh().catch(() => {});
      hostsStore.refresh().catch(() => {});
      auditStore.refresh().catch(() => {});
    }
  };

  React.useEffect(() => {
    if (initialInstall) setRoute({ kind: "library" });
  }, []);

  const activeServer = route.kind === "server"
    ? servers.find(s => s.id === route.id) || servers[0]
    : null;
  // The catalog blueprint behind a game detail page (#/library/<id>).
  const activeGame = route.kind === "game"
    ? (libraryList.find(g => g.id === route.id) || null)
    : null;

  const setServer = (id, patch) => {
    serversStore.patch(id, patch);
  };
  const append = (id, line) => {
    setExtraLog(prev => ({ ...prev, [id]: [...(prev[id] || []), line] }));
  };

  // Console lines now arrive from the server over the `console` channel (the
  // mock backend emits them while processing a command), instead of being
  // written inline by the action handler.
  React.useEffect(() => {
    return api.stream.subscribe(["console"], (m) => {
      if (m.type === "console.line" && m.data) append(m.data.serverId, m.data.line);
    });
  }, []);

  const handleAction = (action, targetId) => {
    const s = targetId ? servers.find(x => x.id === targetId) || activeServer : activeServer;
    if (!s) return;
    // Dispatch through the HOST-SCOPED client so the per-host session gate runs:
    // an expired session that can't silently renew rejects 401 → we open the
    // re-auth modal for that host instead of the command failing silently. The
    // server then runs the transition and streams status + console back over the
    // `servers` / `console` channels.
    const client = (s.hostId && api.host) ? api.host(s.hostId) : api;
    client.post(`/servers/${s.id}/commands`, { verb: action }).catch(err => {
      if (err && err.code === 401) setReauthHostId(s.hostId);
      // 403 (role removed) surfaces via the scoped denyGate; nothing to do here.
    });
  };

  // An action the assistant proposed and the user confirmed in chat. Runs the
  // exact same handler as the UI buttons (so behaviour can't diverge), then
  // writes an audit entry crediting the user but flagging it as assistant-
  // initiated — the paper trail makes clear the bot didn't act on its own.
  const handleAssistantAction = (a) => {
    const now = new Date();
    // open_ports doesn't map to a server-lifecycle verb — handle it here:
    // flip the server's closed required ports to open in the host data and
    // log a network audit entry.
    if (a.verb === "open_ports") {
      const hosts = KRYSTAL_DATA.hosts || [];
      const srv = servers.find(s => s.id === a.serverId);
      const host = hosts.find(h => h.id === (srv && srv.hostId)) || hosts[0];
      let opened = [];
      if (host && srv) {
        // Recompute closed ports the same way the registry does.
        const openSet = new Set(host.network.open_ports.filter(p => p.server === srv.id).map(p => p.port));
        const cfg = srv.config || {};
        const base = typeof cfg.port === "number" ? cfg.port : null;
        const extras = { valheim: (p)=>[p,p+1,p+2], ark:(p)=>[p,27015], rust:(p)=>[p,p+1] }[srv.id];
        let required = base != null ? (extras ? extras(base) : [base]) : [];
        if (typeof cfg.query === "number") required.push(cfg.query);
        required = [...new Set(required)];
        const proto = host.network.open_ports.find(p => p.server === srv.id)?.proto || "udp";
        opened = required.filter(p => !openSet.has(p));
        opened.forEach(port => host.network.open_ports.push({ port, proto, server: srv.id, app: srv.id + "_server" }));
      }
      const entry = {
        id: "evt_" + now.getTime().toString(36),
        ts: now.toISOString().slice(0, 19),
        actor: { name: user?.name || "haru", provider: user?.provider || "discord" },
        action: "network.ports.open",
        severity: "info",
        target: { kind: "server", id: a.serverId, name: a.serverName },
        serverId: a.serverId,
        summary: `opened port${opened.length === 1 ? "" : "s"} ${opened.join(", ")} for ${a.serverName}`,
        meta: { source: "assistant", ports: opened.join(", ") },
      };
      auditStore.prepend(entry);
      return;
    }
    handleAction(a.verb, a.serverId);
    const VERB_SUMMARY = {
      start: "started", stop: "stopped", restart: "restarted", update: "ran an update check on",
    };
    const VERB_ACTION = {
      start: "server.start", stop: "server.stop", restart: "server.restart", update: "server.update",
    };
    const VERB_SEV = { start: "success", stop: "warn", restart: "info", update: "info" };
    const entry = {
      id: "evt_" + now.getTime().toString(36),
      ts: now.toISOString().slice(0, 19),
      actor: { name: user?.name || "haru", provider: user?.provider || "discord" },
      action: VERB_ACTION[a.verb] || "server." + a.verb,
      severity: VERB_SEV[a.verb] || "info",
      target: { kind: "server", id: a.serverId, name: a.serverName },
      serverId: a.serverId,
      summary: `${VERB_SUMMARY[a.verb] || a.verb} ${a.serverName}`,
      meta: { source: "assistant" },
    };
    // Prepend so the audit page + dashboard feed show it at the top.
    auditStore.prepend(entry);
  };

  // Library cards are BLUEPRINTS — clicking one opens the game detail page, not
  // a running server. "Create server" on that page opens the install modal
  // (always a NEW instance, even when one already exists).
  const openGame = (game) => setRoute({ kind: "game", id: game.id });
  const handleInstall = (game) => {
    setInstalling(game);
  };

  const confirmInstall = (cfg) => {
    const newServer = {
      id: cfg.game.id + "-" + cfg.id,
      rawg_slug: cfg.game.rawg_slug,
      name: cfg.name,
      game: cfg.game.name,
      status: cfg.autostart ? "updating" : "offline",
      uptime: "—",
      ip: `50.20.248.${100 + servers.length}:${cfg.port}`,
      players: { current: 0, max: cfg.slots },
      cpu: 0,
      ram: { used: 0, max: 4 },
      version: cfg.version,
      hostId: cfg.hostId || null,
      art: cfg.game.art,
      log: [
        { ts: new Date().toTimeString().slice(0,8), tag: "info", text: `Downloading ${cfg.game.name} server (${cfg.version})…` },
      ],
    };
    serversStore.add(newServer);
    setInstalling(null);
    setRoute({ kind: "server", id: newServer.id });
    setFirstRun(false);
    if (cfg.autostart) {
      setTimeout(() => {
        setServer(newServer.id, { status: "online", uptime: "0h 0m 02s" });
        append(newServer.id, { ts: new Date().toTimeString().slice(0,8), tag: "ok", text: "Server online" });
      }, 1800);
    } else {
      setTimeout(() => {
        append(newServer.id, { ts: new Date().toTimeString().slice(0,8), tag: "ok", text: "Install complete. Ready to start." });
      }, 1400);
    }
  };

  const serverForRender = activeServer ? {
    ...activeServer,
    log: [...activeServer.log, ...(extraLog[activeServer.id] || [])],
  } : null;

  // Page context handed to the docked assistant so it tracks where the user is.
  const pageContext = React.useMemo(() => {
    const hostScope = selectedHostId === "all"
      ? { scope: "all", label: "All hosts" }
      : (() => { const h = hosts.find(x => x.id === selectedHostId); return { scope: selectedHostId, label: h ? h.name : selectedHostId }; })();
    if (route.kind === "server") {
      const s = servers.find(x => x.id === route.id);
      return { view: "server", serverId: route.id, serverName: s ? s.name : null, tab: route.tab || "overview", host: hostScope };
    }
    return { view: route.kind, host: hostScope };
  }, [route, servers, selectedHostId, hosts]);

  // Nav chips in chat → real routes. Keeps the dock open so the conversation
  // persists while the page behind it changes.
  const handleAssistantNavigate = (target) => {
    if (!target) return;
    if (target.kind === "server") setRoute({ kind: "server", id: target.serverId, tab: target.tab });
    else if (target.kind === "audit") setRoute({ kind: "audit" });
    else setRoute({ kind: target.kind === "diagnostics" ? "fleet" : target.kind });
  };

  // Sidebar host switcher → global scope. Selecting a host re-frames every
  // surface; deep server views stay valid because lookups use the full list.
  const selectHost = (id) => selectedHostStore.set(id);
  // Assistant view links; the legacy "diagnostics" view now lives under Fleet.
  const openView = (view) => setRoute({ kind: view === "diagnostics" ? "fleet" : view });

  // -------------- Render --------------

  // Subscribe to the alert feed BEFORE any conditional return. useAlerts is a
  // real hook (useReducer + useEffect), so it must run on EVERY render — calling
  // it after the `if (!user)` early return changed the hook count across the
  // logout/login boundary and crashed the tree ("rendered fewer hooks").
  const useAl = useAlerts || (() => null);
  useAl();

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
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

  // Per-host assistant capability (capabilities.js). assistantHostList drives
  // the dock's host picker AND whether the FAB exists at all; assistantHost is
  // the resolved target — the chosen host if it still qualifies, else the first
  // available one.
  const assistantHostList = assistantHostsAll ? assistantHostsAll(hosts) : (assistantHosts ? assistantHosts(hosts) : []);
  const usableAssistants = assistantHosts ? assistantHosts(hosts) : [];
  // Resolve the selected host from the FULL host list so a host whose assistant
  // just dropped STAYS selected (the chat shows the drop) instead of silently
  // switching to another host. Falls back to the first usable assistant.
  const assistantHost = hosts.find(h => h.id === assistantHostId) || usableAssistants[0] || assistantHostList[0] || null;
  // Lock in the resolved host id once, so a later drop doesn't re-resolve away.
  React.useEffect(() => {
    if (!assistantHostId && assistantHost) setAssistantHostId(assistantHost.id);
  }, [assistantHost && assistantHost.id, assistantHostId]);
  // Open the assistant, pointing it at a server's host when that host serves one
  // (otherwise it falls back to the resolved default).
  const askAssistant = (serverId) => {
    if (serverId && serverHostId) {
      const hid = serverHostId(serverId);
      const h = hid && hosts.find(x => x.id === hid);
      if (h && capUsable && capUsable(h, "assistant")) setAssistantHostId(hid);
    }
    setAssistantOpen(true);
  };

  // "Ask assistant" on an alert → open the dock pointed at the alert's host AND
  // seed the composer with a grounded question about THAT alert, so the user
  // lands in a conversation already about the thing they clicked instead of a
  // blank box. Pre-filled, not sent. Replaces the old open-to-nothing behaviour
  // and is shared by every alert surface (board, dashboard, in-context cards).
  const askAboutAlert = (item) => {
    if (item && item.serverId) setRoute({ kind: "server", id: item.serverId });
    askAssistant(item && item.serverId);
    if (item) setAssistantSeed({ prompt: alertAssistantPrompt(item), serverId: item.serverId || null, nonce: Date.now() });
  };

  // Open the dock pointed at the current scope's host (mirrors the FAB).
  const openAssistant = () => {
    const sh = hosts.find(h => h.id === selectedHostId);
    if (!assistantHostId && sh && capUsable && capUsable(sh, "assistant")) setAssistantHostId(sh.id);
    setAssistantOpen(true);
  };
  // Restore the dock's open/closed state across sessions. Captured once at first
  // render so the persist effect below can't clobber it before we read it.
  const storedOpenRef = React.useRef(localStorage.getItem("krystal:dock:open"));
  const didInitOpen = React.useRef(false);
  React.useEffect(() => {
    if (didInitOpen.current) return;
    if (assistantHostList.length === 0) return;   // wait until hosts are known
    didInitOpen.current = true;
    // Mobile: never auto-open — the dock is a summoned fullscreen surface there.
    if (window.innerWidth <= 768) return;
    const stored = storedOpenRef.current;
    if (stored === "0") return;                    // user hid it last time
    if (stored === "1") { openAssistant(); return; } // user had it open
    // First visit (no saved preference): default-open on large screens.
    if (tw.openByDefault && tw.dockBehavior !== "rail") openAssistant();
  }, [assistantHostList.length]);
  // Persist open/closed whenever it changes, so the choice is remembered.
  React.useEffect(() => {
    try { localStorage.setItem("krystal:dock:open", assistantOpen ? "1" : "0"); } catch (e) {}
  }, [assistantOpen]);

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
    return <ColdStartDown retrying={conn.retrying} onRetry={retryConnection} onLogout={handleLogout} devMode={devMode} />;
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

  // --- Dock layout resolution ---------------------------------------------
  // The decision is driven by AVAILABLE width, not device class: the dock only
  // pushes when the content keeps at least `contentFloor` px. Drag the dock
  // wider than that and it flips itself back to overlay.
  const desktop = vw > 768;
  const canPush = desktop && (vw - dockWidth) >= tw.contentFloor;
  const effPush = manualPin == null ? canPush : (manualPin && canPush);
  const pushingPanel = desktop && assistantOpen && (
    tw.dockBehavior === "auto" ? effPush
    : tw.dockBehavior === "rail" ? canPush
    : false
  );
  const railMode = tw.dockBehavior === "rail" && desktop;
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
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(c => !c)}
      />
      {drawerOpen && <div className="sidebar-scrim sidebar-scrim--open" onClick={() => setDrawerOpen(false)}></div>}
      {/* Mobile-only floating menu button — opens the nav drawer now that the
          top bar (and its hamburger) is gone. Backed by a left-edge swipe.
          Hidden while the drawer itself is open. */}
      {!drawerOpen && (
        <button className="app__mobile-menu" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
          <Icon name="menu" size={20} />
        </button>
      )}
      <main className="app__main">
        <ConnectivityBanner onRetryRest={retryConnection} />
        <div className="content">
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
            fallback={(reset, error) => <ContentError error={error} onRetry={() => { setCrash(false); reset(); }} onHome={() => setRoute({ kind: "home" })} />}>
          {crash && <CrashNow />}
          {denyGate ? (
            <HostDeniedNotice host={deniedHost}
              onBack={() => selectHost("all")}
              onManage={() => setRoute({ kind: "fleet", hostId: deniedHost.id })} />
          ) : expiredGate ? (
            <HostExpiredNotice host={expiredHost}
              onReauth={() => setReauthHostId(selectedHostId)}
              onBack={() => selectHost("all")} />
          ) : (<>
          {route.kind === "home" && <DashboardPage
            user={user}
            servers={scopedServers}
            canFleet={can("nav.fleet")}
            onOpenServer={(id) => setRoute({ kind: "server", id })}
            onAction={(id, action) => { setRoute({ kind: "server", id }); setTimeout(() => handleAction(action), 0); }}
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
            onOpenServer={(id) => setRoute({ kind: "server", id })}
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
            onAction={(id, action) => { setRoute({ kind: "server", id }); setTimeout(() => handleAction(action), 0); }}
            onLibrary={() => setRoute({ kind: "library" })}
          />}
          {route.kind === "library" && <Library key={route.filter || "all"} onOpenGame={openGame} initialFilter={route.filter} />}
          {route.kind === "game" && (activeGame
            ? <GamePage
                game={activeGame}
                servers={servers}
                onCreate={(g) => setInstalling(g)}
                onOpenServer={(id) => setRoute({ kind: "server", id })}
                onAction={(id, action) => { setRoute({ kind: "server", id }); setTimeout(() => handleAction(action), 0); }}
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
            getServerState={getServerState}
            onRunAction={handleAssistantAction} />}
          {route.kind === "server" && (
            <ServerDetailPage server={serverForRender} onAction={handleAction}
              tab={route.tab || "overview"}
              onTabChange={(t) => setRoute({ kind: "server", id: route.id, tab: t === "overview" ? undefined : t })}
              onAsk={askAboutAlert}
              onOpenServer={(id) => setRoute({ kind: "server", id })}
              onViewServerAlerts={(id) => setRoute({ kind: "attention", serverId: id })}
              onViewServerAudit={(id) => setRoute({ kind: "audit", serverId: id })}
            />
          )}
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
            pageContext={pageContext}
            seed={assistantSeed}
            onClose={() => setAssistantOpen(false)}
            onExpand={() => { setAssistantOpen(false); setRoute({ kind: "chat" }); }}
            onNavigate={handleAssistantNavigate}
            onOpenServer={(id, tab) => setRoute({ kind: "server", id, tab })}
            onOpenView={openView}
            getServerState={getServerState}
            onRunAction={handleAssistantAction} />
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
      {devMode && <DevPanel
        health={api.__health ? api.__health() : "ok"}
        connStatus={conn.status}
        slow={slowOn}
        onToggleHealth={() => api.__setHealth(api.__health() === "down" ? "ok" : "down")}
        onToggleSlow={toggleSlow}
        onCrash={() => setCrash(true)}
        onExpireSession={handleSessionLost}
      />}
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
