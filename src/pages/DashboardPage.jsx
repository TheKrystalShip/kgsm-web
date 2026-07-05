import React from "react";
import { DashBandList, loadDashOrder, saveDashOrder } from "../components/DashLayout.jsx";
import { Icon } from "../components/Icon.jsx";
import { Kpi } from "../components/KPI.jsx";
import { NeedsAttention } from "../components/NeedsAttention.jsx";
import { ServerTile } from "../components/ServerCard.jsx";
import { DashboardSkeleton, Skel } from "../components/Skeletons.jsx";
import { GameCard } from "../components/GameCard.jsx";
import { HostCapacityStrip } from "../components/host-helpers.jsx";
import { RecentActivity } from "../components/RecentActivity.jsx";
import { capUsable } from "../lib/capabilities.js";
import { parseTs } from "../lib/formatting.js";
import { KRYSTAL_LABELS } from "../lib/labels.js";
import { useStore } from "../lib/store.js";
import { auditInScope, auditStore, favoritesStore, hostsStore, libraryStore, pingStore, scopeServers, serversStore, useSelectedHostId } from "../lib/stores.js";
import { DashFleetStrip } from "./dashboard/DashFleetStrip.jsx";

// DashboardPage — the post-login home. Aggregate stats, a server grid,
// and a recent-activity feed. Designed to answer "what should I care about
// right now?" at a glance.
//
// The server grid here is online-only — the full, filterable inventory lives
// on the dedicated Servers page. ServerTile is shared via ServerCard.jsx.
// The fleet-capacity strip lives in dashboard/DashFleetStrip.jsx.

// The dashboard KPI card lives in KPI.jsx (KPI) and is shared with the
// host diagnostics overview and the server-detail overview stats.

function DashboardPage({ user, onOpenServer, onAction, onLibrary, onInstall, onAudit, onDiagnostics, onOpenHostDiagnostics, onAttention, onServers, onViewAlerts, canFleet = true }) {
  const selectedId = useSelectedHostId();
  const servers = scopeServers(useStore(serversStore, s => s.list), selectedId);
  const onlineCount = servers.filter(s => s.status === "online").length;
  const totalPlayers = servers.reduce((n, s) => n + (s.players?.current || 0), 0);
  // Bottom "Servers" card — a single fit-to-width row (max 4), UNFILTERED by
  // status so it's not a duplicate of the "Online" KPI above. Servers carry no
  // added/created date, so instead of arbitrary list order we surface the ones
  // worth a glance. The user's FAVOURITES always come first (a pinned server is
  // the one they care about most), then within each group: most-active online
  // first, then updating (needs watching), then offline last. "View all" opens
  // the full Servers page.
  const SERVER_STATUS_RANK = { online: 0, updating: 1, offline: 2 };
  const favIds = useStore(favoritesStore, s => s.ids);
  const favSet = React.useMemo(() => new Set(favIds), [favIds]);
  const featuredServers = React.useMemo(() => {
    return [...servers].sort((a, b) => {
      // Favourites jump to the front, regardless of status or player count.
      const fa = favSet.has(a.id) ? 0 : 1;
      const fb = favSet.has(b.id) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      const ra = SERVER_STATUS_RANK[a.status] ?? 3;
      const rb = SERVER_STATUS_RANK[b.status] ?? 3;
      if (ra !== rb) return ra - rb;
      return (b.players?.current || 0) - (a.players?.current || 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- SERVER_STATUS_RANK is a constant rank map, never changes
  }, [servers, favSet]);
  // Recent activity is the same feed as the Audit log page — the dashboard is
  // just a compact window onto it. Use the page's host-scoping (auditInScope)
  // and newest-first order, then show the latest few; the page owns the full
  // searchable list. Single source: auditStore.
  const auditList = useStore(auditStore, s => s.list);
  const hosts = useStore(hostsStore, s => s.list);
  const pings = useStore(pingStore, s => s.byHost);
  const dataLoading = useStore(serversStore, s => s.status === "loading" && !s.everLoaded);
  const auditScoped = React.useMemo(
    () => auditList.filter(ev => auditInScope(ev, selectedId)),
    [auditList, selectedId]
  );
  // Catalog preview — a compact window onto the installable library. The backend
  // blueprint catalog carries no "added" date (the LibraryEntry DTO has no
  // timestamp), so this is a straight slice of the catalog in its natural order,
  // NOT a recency rail; "View all" opens the full Library.
  const libraryList = useStore(libraryStore, s => s.list);
  // Show only as many cards as fit in one row at the current width — drop the
  // overflow entirely rather than wrapping or scrolling. Cards then stretch to
  // fill the row evenly (grid 1fr).
  const catalogRowRef = React.useRef(null);
  const [catalogFit, setCatalogFit] = React.useState(6);
  React.useLayoutEffect(() => {
    const el = catalogRowRef.current;
    if (!el) return;
    const MIN = 158, GAP = 12, PAD = 28; // card min width, gap, row h-padding
    const compute = () => {
      const w = el.clientWidth - PAD;
      setCatalogFit(Math.max(1, Math.floor((w + GAP) / (MIN + GAP))));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dataLoading]);
  const catalogVisible = libraryList.slice(0, catalogFit);
  // Fit-to-width for the bottom Servers row, mirroring Recently added but
  // capped at 4 — show only as many tiles as fit one row, never more than 4.
  // The layout itself is the shared `.server-grid` (same as the Library page),
  // so MIN matches that grid's `minmax(280px, 1fr)` column — this just caps how
  // many featured tiles to render so the preview stays a single row.
  const serverRowRef = React.useRef(null);
  const [serverFit, setServerFit] = React.useState(4);
  React.useLayoutEffect(() => {
    const el = serverRowRef.current;
    if (!el) return;
    const MIN = 280, GAP = 12, PAD = 0; // tile min width, gap (no row padding)
    const compute = () => {
      const w = el.clientWidth - PAD;
      setServerFit(Math.max(1, Math.min(4, Math.floor((w + GAP) / (MIN + GAP)))));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dataLoading]);
  const featuredVisible = featuredServers.slice(0, serverFit);
  // Specific host → that host's capacity strip. "All hosts" → a compact fleet
  // strip (one mini-meter row per host) since capacity can't be averaged.
  const scopedHost = selectedId !== "all" ? (hosts.find(h => h.id === selectedId) || hosts[0] || null) : null;
  const now = auditScoped.length ? parseTs(auditScoped[0].ts) : new Date();

  // ---- KPIs ---------------------------------------------------------------
  // Four glance cards, each reading data that isn't otherwise visible on the
  // dashboard, each stateful, each drilling into the page that owns it.
  const HOUR = 3600000;
  const fmtDur = (ms) => {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h";
    const d = Math.floor(h / 24), rh = h % 24;
    return rh ? `${d}d ${rh}h` : `${d}d`;
  };
  // 1) Ping — operator's live link to the host(s). Lower is better; non-interactive.
  // Client-measured round trip via WebSocket ping/pong (pingStore, keyed by host id). For a
  // single scoped host it's that host's reading; under "all" it's the WORST (max)
  // across hosts that have a reading — the slowest link, matching the other summary
  // tiles' worst-case framing. No reading (probe failed / not yet measured) → null
  // → "no reading" (never a fabricated latency).
  const pingVals = (selectedId === "all" ? hosts : hosts.filter(h => h.id === selectedId))
    .map(h => pings[h.id]).filter(p => p && p.ms != null).map(p => p.ms);
  const pingMs = pingVals.length ? Math.max(...pingVals) : null;
  const pingMultiHost = selectedId === "all" && pingVals.length > 1;
  const pingTone = pingMs == null ? "muted" : pingMs < 60 ? "ok" : pingMs < 120 ? "warn" : "danger";
  // 2) Updates available — servers on an older build, excluding ones already
  //    mid-update. Actionable to-do, not an error → info tone.
  const updatable = servers.filter(s => s.update_available && s.status !== "updating");
  // 3) Oldest backup — the MOST-OVERDUE server (worst-case insurance gap), not
  //    the most recent, so the one actually at risk is what surfaces.
  const backedUp = servers.filter(s => s.last_backup);
  const oldestBackup = backedUp.reduce((w, s) =>
    (!w || +new Date(s.last_backup) < +new Date(w.last_backup)) ? s : w, null);
  const backupAgeMs = oldestBackup ? (now - new Date(oldestBackup.last_backup)) : 0;
  const backupTone = !oldestBackup ? "muted" : backupAgeMs > 24 * HOUR ? "danger" : backupAgeMs > 12 * HOUR ? "warn" : "ok";
  // 4) Crashes / auto-restarts in the last 24h — caught by the watchdog at the
  //    process level, so it's game-agnostic. Reads the same audit feed.
  const crash24h = auditScoped.filter(ev => ev.action === "server.crash" && (now - parseTs(ev.ts)) <= 24 * HOUR);
  const crashTone = crash24h.length === 0 ? "ok" : crash24h.length < 3 ? "warn" : "danger";
  const lastCrash = crash24h[0];
  // Crash detection is the watchdog's job — when the scoped host's watchdog is
  // down we can't claim "all stable", so the KPI reads unknown.
  const scopedWatchdogDown = selectedId !== "all" && scopedHost && !capUsable(scopedHost, "watchdog");
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return "Late one,";
    if (h < 12) return "Morning,";
    if (h < 18) return "Hey,";
    return "Evening,";
  })();

  // ---- Layout customization (client-side, per-browser) --------------------
  // Drag the dashboard's vertical bands to reorder them; the order is remembered
  // per-browser in localStorage — exactly how sidebar collapse and dock width
  // are remembered. Dragging is gated behind an explicit "Customize" mode + a
  // grip handle, so it can never fire against the cards' normal click-to-drill.
  const [dashOrder, setDashOrder] = React.useState(() => loadDashOrder());
  const [customize, setCustomize] = React.useState(false);
  const persistOrder = (order) => { setDashOrder(order); saveDashOrder(order); };
  const resetLayout = () => { setDashOrder([]); saveDashOrder([]); };

  // The reorderable bands in their natural (default) order. Each carries a
  // stable id so a saved order survives content changes; conditional bands are
  // simply omitted when empty and the saved order absorbs the gap (merge-safe).
  const capacityNode = selectedId === "all"
    ? <DashFleetStrip hosts={hosts} onOpenDiagnostics={onDiagnostics} onOpenHost={onOpenHostDiagnostics} />
    : (scopedHost && (
        (scopedHost.online && scopedHost.ram.total_gb > 0 && !scopedHost._pending)
          ? <HostCapacityStrip
              host={scopedHost}
              hostLabel={scopedHost.name}
              hideAlert
              onOpenDiagnostics={() => onOpenHostDiagnostics && onOpenHostDiagnostics(scopedHost.id)} />
          : (
            <section className="cap-strip">
              <div className="cap-strip__head">
                <h2 className="cap-strip__title"><Icon name="server" size={14} /> Host capacity <span className="cap-strip__host">{scopedHost.name}</span></h2>
              </div>
              <div style={{ padding: "22px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
                <Icon name="plug" size={18} /> <span style={{ marginLeft: 6 }}>{scopedHost._pending ? "Awaiting the agent\u2019s first check-in \u2014 capacity appears once it reports in." : "No live telemetry for this host."}</span>
              </div>
            </section>
          )
      ));

  const bands = [];
  bands.push({
    id: "summary", label: "Summary",
    node: (
      <div className="dash-summary">
        <Kpi
          icon="activity" label="Ping"
          value={pingMs == null ? "—" : pingMs} unit={pingMs == null ? null : "ms"}
          sub={pingMs == null ? "no reading" : (pingMultiHost ? `slowest of ${pingVals.length} hosts` : "your connection")}
          tone={pingTone}
        />
        <Kpi
          icon="circle-arrow-up" label="Updates available"
          value={updatable.length}
          sub={updatable.length ? updatable.map(s => s.game).join(", ") : "all up to date"}
          tone={updatable.length ? "info" : "muted"}
          onView={updatable.length ? () => onServers("updates") : null}
        />
        <Kpi
          icon="database-backup" label="Oldest backup"
          value={oldestBackup ? fmtDur(backupAgeMs) : "—"}
          sub={oldestBackup ? oldestBackup.name : "no backups yet"}
          tone={backupTone}
          onView={oldestBackup ? () => onOpenServer(oldestBackup.id) : null}
        />
        <Kpi
          icon="server-crash" label="Crashes · 24h"
          value={scopedWatchdogDown ? "—" : crash24h.length}
          sub={scopedWatchdogDown ? "watchdog down — not monitoring" : (crash24h.length ? `last: ${lastCrash.target?.name || "server"}` : "all stable")}
          tone={scopedWatchdogDown ? "muted" : crashTone}
          onView={onAudit}
        />
      </div>
    )
  });
  // Fleet / host capacity is admin-only — operators see the dashboard without it.
  if (capacityNode && canFleet) bands.push({ id: "capacity", label: "Capacity", node: capacityNode });
  bands.push({
    id: "feed", label: "Alerts & activity",
    node: (
      // Feed band — "needs me now" (Alerts) beside "what just happened" (Recent
      // activity). Two matched compact-list cards; resolved alerts surface in
      // Recent activity, so there's no separate closed-alerts card. Alerts shows
      // its all-clear empty state to keep the band level.
      <div className="dash-feed">
        <NeedsAttention onPick={onAttention} onViewAll={onViewAlerts} max={3} emptyState title="Alerts - Latest" />

        <RecentActivity hostId={selectedId} onViewAll={onAudit} max={3} title="Audit - Recent activity" />
      </div>
    )
  });
  if (libraryList.length > 0) bands.push({
    id: "recent", label: "Catalog",
    node: (
      // Catalog — a single, non-collapsing row of installable games straight from
      // the library. Clicking a card opens the install flow; "View all" opens the
      // full Library catalog.
      <div className="chat-brief">
        <div className="chat-brief__head">
          <span className="chat-brief__title">
            <Icon name="library" size={13} /> {KRYSTAL_LABELS.catalog || "Catalog"}
            <span className="chat-brief__count chat-brief__count--neutral">{libraryList.length}</span>
          </span>
          <button className="dash-section__more" onClick={() => onLibrary && onLibrary()}>
            View all <Icon name="arrow-right" size={11} strokeWidth={2.2} />
          </button>
        </div>
        <div className="dash-recent" ref={catalogRowRef} style={{ gridTemplateColumns: `repeat(${Math.min(catalogFit, libraryList.length)}, 1fr)` }}>
          {catalogVisible.map(g => (
            <GameCard
              key={g.id}
              game={g}
              compact
              onPick={onInstall ? onInstall : () => onLibrary && onLibrary()}
            />
          ))}
        </div>
      </div>
    )
  });
  bands.push({
    id: "servers", label: "Servers",
    node: (
      // Online servers — full-width operational band, mirroring the Servers page
      // exactly (same ServerTile cards). Unfiltered by status — the "Online" KPI
      // above already covers the live count — so this is a quick glance at the
      // fleet, most-active first. A single fit-to-width row (max 4); "View all"
      // opens the full Servers page.
      <div className="chat-brief">
        <div className="chat-brief__head">
          <span className="chat-brief__title">
            <Icon name="server" size={13} /> Servers
            <span className="chat-brief__count chat-brief__count--neutral">{servers.length}</span>
          </span>
          <button className="dash-section__more" onClick={() => onServers()}>
            View all <Icon name="arrow-right" size={11} strokeWidth={2.2} />
          </button>
        </div>
        <div className="chat-brief__body">
          {servers.length === 0 ? (
            <div className="dash-servers-empty">
              <Icon name="moon" size={20} />
              <span>No servers yet.</span>
              <button className="dash-servers-empty__link" onClick={() => onServers()}>View all servers</button>
            </div>
          ) : (
            <div className="server-grid" ref={serverRowRef}>
              {featuredVisible.map(s => (
                <ServerTile key={s.id} server={s} onOpen={onOpenServer} onAction={onAction} showHost={selectedId === "all"} />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  });

  return (
    <>
      <div className="dash-head dash-head--actions">
        <div className="dash-head__titles">
          <h1>{greeting} {user?.display || user?.name || "there"}.</h1>
          <div className="dash-head__sub">
            {dataLoading
              ? <Skel w={300} h={14} />
              : <>{onlineCount} of {servers.length} servers online · {totalPlayers} players connected right now.</>}
          </div>
        </div>
        {!dataLoading && (
          <div className={"dash-customize" + (customize ? " dash-customize--on" : "")}>
            {customize && (
              <span className="dash-customize__hint">
                <Icon name="grip-vertical" size={13} strokeWidth={2} /> Drag a handle to reorder
              </span>
            )}
            {customize ? (
              <>
                <button className="dash-customize__btn" onClick={resetLayout} title="Restore the default order">
                  <Icon name="rotate-ccw" size={14} strokeWidth={2} /> Reset
                </button>
                <button className="dash-customize__btn dash-customize__btn--done" onClick={() => setCustomize(false)}>
                  <Icon name="check" size={14} strokeWidth={2.4} /> Done
                </button>
              </>
            ) : (
              <button className="dash-customize__btn" onClick={() => setCustomize(true)} title="Rearrange your dashboard">
                <Icon name="layout-dashboard" size={14} strokeWidth={2} /> Customize
              </button>
            )}
          </div>
        )}
      </div>

      {dataLoading
        ? <DashboardSkeleton />
        : <DashBandList bands={bands} customize={customize} storedOrder={dashOrder} onReorder={persistOrder} />}
    </>
  );
}

// The KPI card is defined in KPI.jsx (KPI); the diagnostics overview and
// server-detail stats share that same component.
// RecentActivity is shared with the host diagnostics overview (scoped per host).

export { DashboardPage };
export default DashboardPage;
