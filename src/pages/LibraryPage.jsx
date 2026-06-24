import React from "react";
import { SurfaceError } from "../components/ErrorBoundary.jsx";
import { Icon } from "../components/Icon.jsx";
import { Pagination, useDebouncedValue } from "../components/Pagination.jsx";
import { LibrarySkeleton } from "../components/Skeletons.jsx";
import { Toolbar, ToolbarButton, ToolbarCount, ToolbarFilters, ToolbarSearch, ToolbarSpacer } from "../components/Toolbar.jsx";
import { KRYSTAL_LABELS } from "../lib/labels.js";
import { can } from "../lib/persona.js";
import { useStore } from "../lib/store.js";
import { hostsStore, libraryStore, serversStore } from "../lib/stores.js";
import { instancesOfBlueprint } from "./GamePage.jsx";

// Library — Steam-like game catalog with search + category filter.
// Cover art is whatever the backend sends on each catalog entry (game.cover):
// the backend resolves it server-side and keeps any provider key off the
// browser. When cover is absent we fall back to a themed gradient. The frontend
// never talks to an image provider directly — see architecture.html §3·i.

// Honest display of an advisory footprint figure (RAM / disk, in MB) from the
// backend's blueprint `specs`. These are `null` on every blueprint today
// (metadata curation is deferred upstream), so this renders an em dash — never a
// fabricated default. ≥1 GB shows in GB (one decimal, trimmed); smaller in MB.
// Exported so the catalog cards, the blueprint detail page and the install modal
// all format the same backend numbers identically. The instant the API serves a
// value, it renders here with no further wiring.
export function fmtFootprintMb(mb) {
  if (mb == null || !Number.isFinite(mb)) return "—";
  if (mb >= 1024) {
    const gb = mb / 1024;
    return (Number.isInteger(gb) ? gb : Math.round(gb * 10) / 10) + " GB";
  }
  return Math.round(mb) + " MB";
}

// ---------- "Recently added" helpers (shared with the dashboard) ----------
// The catalog carries an `addedAt` ISO date per game. Reference "now" is the
// newest addedAt in the catalog, so the relative labels always read fresh
// regardless of wall-clock.
const RECENT_WINDOW_DAYS = 30;

function libraryNow(list) {
  const times = (list || []).map(g => g.addedAt ? +new Date(g.addedAt) : 0).filter(Boolean);
  return times.length ? new Date(Math.max(...times)) : new Date();
}

// Newest-first, optionally clipped to the recent window / a max count.
function recentlyAddedGames(list, { windowDays = RECENT_WINDOW_DAYS, max = null } = {}) {
  const now = libraryNow(list);
  const cutoff = windowDays ? +now - windowDays * 86400000 : -Infinity;
  const sorted = (list || [])
    .filter(g => g.addedAt && +new Date(g.addedAt) >= cutoff)
    .sort((a, b) => +new Date(b.addedAt) - +new Date(a.addedAt));
  return max ? sorted.slice(0, max) : sorted;
}

function fmtAddedLabel(addedAt, now) {
  if (!addedAt) return "";
  const date = new Date(addedAt);
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dd = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((d0 - dd) / 86400000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return diff + "d ago";
  if (diff < 14) return "1w ago";
  if (diff < 30) return Math.floor(diff / 7) + "w ago";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Count server instances created from a catalog blueprint, regardless of run
// state (online / updating / stopped / errored). Uses the shared blueprint join
// (see instancesOfBlueprint) so the count never drifts from the detail page.
function instanceCountFor(game, servers) {
  return instancesOfBlueprint(game, servers).length;
}
// Whether the operator runs at least one server from this blueprint. This is the
// SINGLE source of truth for "installed" — derived live from the servers store,
// never a static catalog flag (those drift out of sync the moment a server is
// created or deleted). The card's run pill, the Installed/Available filters and
// the Status grouping all read through here, so they can never disagree.
function gameIsInstalled(game, servers) {
  return instanceCountFor(game, servers) > 0;
}

// ---------- Host availability ----------
// A blueprint is offered by one or more connected hosts. `game.hosts` (a list
// of host ids) names them; ABSENT means "offered everywhere" (identical catalog
// across the fleet — the common case). Only a subset is worth surfacing.
function offeringHosts(game, allHosts) {
  const ids = Array.isArray(game.hosts) ? game.hosts : null;
  if (!ids) return allHosts || [];
  return (allHosts || []).filter(h => ids.includes(h.id));
}
// Short label shown on the card / detail page — null when the game is on every
// host (nothing to flag). One host → "Primary only"; a subset → "2 of 3 hosts".
function hostAvailabilityLabel(game, allHosts) {
  const all = allHosts || [];
  const off = offeringHosts(game, all);
  if (!all.length || off.length >= all.length || off.length === 0) return null;
  if (off.length === 1) return off[0].name + " only";
  return off.length + " of " + all.length + " hosts";
}

// Category → icon + accent. The hue tints only the small category glyph so the
// chip itself stays neutral — restrained, but enough to tell genres apart.
const CATEGORY_META = {
  Survival: { icon: "flame",     color: "#FB923C" },
  Sandbox:  { icon: "boxes",     color: "#4ADE80" },
  FPS:      { icon: "crosshair", color: "#FB7185" },
  "Co-op":  { icon: "users",     color: "#7DD3FC" },
};
function categoryMeta(cat) {
  return CATEGORY_META[cat] || { icon: "gamepad-2", color: "var(--fg-2)" };
}
// "Brand new" window for the NEW badge — tighter than the 30-day recent filter
// so the badge stays meaningful.
const NEW_WINDOW_DAYS = 14;

function GameCard({ game, onPick, onDeploy, addedNow, compact }) {
  // Single source of truth for "how many do I run": the servers store. Both the
  // library grid and the dashboard's Recently added band read this, so the
  // count is always consistent.
  const servers = useStore(serversStore, s => s.list);
  const allHosts = useStore(hostsStore, s => s.list);
  const instances = instancesOfBlueprint(game, servers);
  const count = instances.length;
  const onlineCount = instances.filter(s => s.status === "online").length;
  const bg = game.cover
    ? `linear-gradient(180deg, transparent 0%, rgba(11,15,20,0.55) 100%), url("${game.cover}")`
    : game.art;

  // --- Compact variant — the dashboard's "Recently added" rail. Kept lean so
  // that surface is unchanged by the richer library card below. ---
  if (compact) {
    return (
      <div className="game-card" onClick={() => onPick(game)}>
        <div className="game-card__art" style={{ background: bg, backgroundSize: "cover", backgroundPosition: "center" }}>
          {count > 0 && (
            <span className="game-card__installed" title={count + " server" + (count === 1 ? "" : "s") + " created"}>
              <Icon name="server" size={11} strokeWidth={2.2} /> {count}
            </span>
          )}
        </div>
        <div className="game-card__body">
          <div className="game-card__title">{game.name}</div>
          <div className="game-card__meta">
            <span className="game-card__metarow"><Icon name="users" size={12} /> {game.players} players</span>
            {addedNow && (
              <span className="game-card__added"><Icon name="clock" size={11} /> {fmtAddedLabel(game.addedAt, addedNow)}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- Full blueprint card (library grid). Art still leads, but the deploy
  // facts that actually matter are made legible: footprint, run-state, recency. ---
  const now = addedNow || libraryNow([game]);
  const addedMs = game.addedAt ? +new Date(game.addedAt) : 0;
  const isNew = !count && addedMs && (+now - addedMs) <= NEW_WINDOW_DAYS * 86400000;
  const installed = count > 0;
  // Only flag host availability when the game ISN'T on every host (a subset).
  const hostLabel = hostAvailabilityLabel(game, allHosts);
  // A not-yet-installed blueprint that THIS persona may deploy gets a real
  // "Deploy" action: the CTA opens the install modal directly (onDeploy) instead
  // of bubbling to the card's open-detail click. `can("server.create")` is the
  // aggregate reach (held on any host); the modal then scopes hosts per-host.
  const canDeploy = !installed && !!onDeploy && can && can("server.create");

  return (
    <article
      className={"bp-card" + (installed ? " bp-card--installed" : "")}
      onClick={() => onPick(game)}
      role="button" tabIndex={0}
      // Guard on target===currentTarget so an Enter/Space landing on the nested
      // Deploy button fires only that button, not the card's open-detail too.
      onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); onPick(game); } }}
    >
      <div className="bp-card__art" style={{ background: bg, backgroundSize: "cover", backgroundPosition: "center" }}>
        {hostLabel && (
          <span className="bp-card__host" title={"Only available on " + hostLabel.replace(/ only$/, "")}>
            <Icon name="server" size={11} strokeWidth={2.1} /> {hostLabel}
          </span>
        )}
        {installed ? (
          <span className="bp-card__run" title={count + " server" + (count === 1 ? "" : "s") + " from this blueprint"}>
            <span className={"bp-card__rundot" + (onlineCount ? " is-live" : "")}></span>
            {count} {count === 1 ? "server" : "servers"}
          </span>
        ) : isNew ? (
          <span className="bp-card__new">New</span>
        ) : null}
        <div className="bp-card__veil"></div>
        <h3 className="bp-card__name">{game.name}</h3>
      </div>

      <div className="bp-card__specs">
        <div className="bp-spec">
          <span className="bp-spec__val"><Icon name="users" size={12} strokeWidth={2} /> {game.players}</span>
          <span className="bp-spec__lbl">Players</span>
        </div>
        <div className="bp-spec">
          <span className="bp-spec__val"><Icon name="memory-stick" size={12} strokeWidth={2} /> {fmtFootprintMb(game.specs && game.specs.recommendedRamMb)}</span>
          <span className="bp-spec__lbl">RAM</span>
        </div>
        <div className="bp-spec">
          <span className="bp-spec__val"><Icon name="hard-drive" size={12} strokeWidth={2} /> {fmtFootprintMb(game.specs && game.specs.baseDiskMb)}</span>
          <span className="bp-spec__lbl">Disk</span>
        </div>
      </div>

      <div className="bp-card__foot">
        {installed ? (
          <span className="bp-card__status bp-card__status--on">
            {onlineCount > 0
              ? <><span className="bp-card__livedot"></span>{onlineCount} online</>
              : <>Idle · not running</>}
          </span>
        ) : (
          <span className="bp-card__status">
            <Icon name="clock" size={11} /> Added {fmtAddedLabel(game.addedAt, now)}
          </span>
        )}
        {/* CTA reflects what THIS persona can do (architecture.html §3·f·1): a
            read-only viewer can only view the blueprint, never deploy/manage.
            "Deploy" is a real action — it opens the install modal directly
            rather than the card's open-detail navigation. */}
        {canDeploy ? (
          <button
            type="button"
            className="bp-card__cta bp-card__cta--act"
            title={"Deploy a new " + game.name + " server"}
            onClick={e => { e.stopPropagation(); onDeploy(game); }}
          >
            Deploy <Icon name="arrow-right" size={13} strokeWidth={2.2} />
          </button>
        ) : (
          <span className="bp-card__cta">
            {(installed
              ? (can && can("server.operate") ? "Manage" : "View")
              : "View")} <Icon name="arrow-right" size={13} strokeWidth={2.2} />
          </span>
        )}
      </div>
    </article>
  );
}

// ---------- Grouping (Windows-Explorer-style foldable sections) ----------
// Grouping is an organizing axis, orthogonal to Sort: it buckets the (already
// filtered + sorted) games under collapsible headers. "None" keeps the flat,
// paginated grid. We deliberately don't offer "group by name" — alphabetical
// buckets only pay off at hundreds of items; name lives as a Sort instead.
function dateBucket(game, now) {
  if (!game.addedAt) return "Earlier";
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dd = new Date(game.addedAt);
  const dday = new Date(dd.getFullYear(), dd.getMonth(), dd.getDate());
  const diff = Math.round((d0 - dday) / 86400000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "Earlier this week";
  if (diff < 30) return "Earlier this month";
  return "Older";
}

// Which host(s) can run this blueprint. "On every host" is the common case
// (identical catalogs across the fleet); a single-host exclusive reads
// "{Host} only"; a subset lists the hosts. Mirrors the card's host badge and
// the Servers page's host grouping, so the two surfaces speak the same language.
function availabilityBucket(game, allHosts) {
  const all = allHosts || [];
  const off = offeringHosts(game, all);
  if (!all.length || off.length === 0 || off.length >= all.length) return "On every host";
  if (off.length === 1) return off[0].name + " only";
  return off.map(h => h.name).join(" & ");
}

// Fixed, sensible section order per grouping. Keys absent here fall to the end,
// alphabetically. Items WITHIN a section keep the active Sort order.
const GROUP_ORDER = {
  category: null,
  status: ["Installed", "Available"],
  added: ["Today", "Yesterday", "Earlier this week", "Earlier this month", "Older"],
  availability: ["On every host"],
};

function groupAccessor(gkey, now, isInstalled, allHosts) {
  if (gkey === "category")     return g => g.category || "Other";
  if (gkey === "status")       return g => (isInstalled(g) ? "Installed" : "Available");
  if (gkey === "added")        return g => dateBucket(g, now);
  if (gkey === "availability") return g => availabilityBucket(g, allHosts);
  return () => "All games";
}

function buildGroups(items, gkey, now, isInstalled, allHosts) {
  const of = groupAccessor(gkey, now, isInstalled, allHosts);
  const map = new Map();
  items.forEach(g => {
    const k = of(g);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(g);
  });
  const order = GROUP_ORDER[gkey];
  const keys = [...map.keys()].sort((a, b) => {
    if (order) {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      const ra = ia < 0 ? 999 : ia, rb = ib < 0 ? 999 : ib;
      if (ra !== rb) return ra - rb;
    }
    return a.localeCompare(b);
  });
  return keys.map(k => ({ key: k, items: map.get(k) }));
}

// Header glyph per section — category gets its genre icon (tinted), status and
// date get their own marks. Mirrors the card's visual language.
function groupVisual(gkey, key) {
  if (gkey === "category") { const m = categoryMeta(key); return { icon: m.icon, color: m.color }; }
  if (gkey === "status") return key === "Installed"
    ? { icon: "server", color: "var(--krystal-teal)" }
    : { icon: "package-plus", color: "var(--fg-3)" };
  if (gkey === "added") return { icon: "calendar-clock", color: "var(--fg-2)" };
  if (gkey === "availability") return section_is_every_host(key)
    ? { icon: "layers", color: "var(--krystal-teal)" }
    : { icon: "server", color: "var(--fg-3)" };
  return { icon: "folder", color: "var(--fg-2)" };
}
function section_is_every_host(key) { return key === "On every host"; }

function LibraryGroup({ gkey, section, collapsed, onToggle, onOpenGame, onDeploy, now, isInstalled }) {
  const vis = groupVisual(gkey, section.key);
  const installedHere = section.items.filter(isInstalled).length;
  // "N installed" is noise when the grouping IS status — the header already says so.
  const showInstalledSub = gkey !== "status" && installedHere > 0;
  return (
    <section className="lib-group">
      <button
        className="lib-group__head"
        aria-expanded={!collapsed}
        onClick={() => onToggle(section.key)}
      >
        <Icon name="chevron-down" size={16} strokeWidth={2.2} className="lib-group__chev" />
        <span className="lib-group__icon"><Icon name={vis.icon} size={15} strokeWidth={2} style={{ color: vis.color }} /></span>
        <span className="lib-group__title">{section.key}</span>
        <span className="lib-group__count">{section.items.length}</span>
        {showInstalledSub && (
          <span className="lib-group__sub"><span className="lib-group__subdot"></span>{installedHere} installed</span>
        )}
      </button>
      {!collapsed && (
        <div className="game-grid lib-group__grid">
          {section.items.map(g => <GameCard key={g.id} game={g} onPick={onOpenGame} onDeploy={onDeploy} addedNow={now} />)}
        </div>
      )}
    </section>
  );
}

const LIB_COLLAPSE_KEY = "krystal.library.collapsed.v1";

function Library({ onOpenGame, onDeploy, initialFilter }) {
  const all = useStore(libraryStore, s => s.list);
  // Run-state is derived from the servers store — the one source of truth shared
  // with the cards — so "installed" can never disagree with the "N servers" pill.
  const servers = useStore(serversStore, s => s.list);
  const isInstalled = g => instanceCountFor(g, servers) > 0;
  // Host roster drives the Host-availability grouping (and the card's host
  // badge) — read from the same store the cards use so they never disagree.
  const allHosts = useStore(hostsStore, s => s.list);
  // The library lists GAMES, not server runtimes. The only state we know
  // about each game is whether we already host a server for it.
  const recentCount = recentlyAddedGames(all).length;
  const filters = [
    { id: "all",       label: "All games" },
    { id: "installed", label: "Installed" },
    { id: "available", label: "Available" },
    { id: "recent",    label: "Recently added" },
  ];
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState(initialFilter || "all");
  const [sort, setSort] = React.useState("recent");
  const [groupBy, setGroupBy] = React.useState("none");
  // Collapsed sections persist across reloads (and across grouping modes) so
  // your layout survives the refresh churn of iterating on a server fleet.
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LIB_COLLAPSE_KEY) || "[]")); }
    catch (e) { return new Set(); }
  });
  const persistCollapsed = next => {
    setCollapsed(next);
    try { localStorage.setItem(LIB_COLLAPSE_KEY, JSON.stringify([...next])); } catch (e) {}
  };
  const [refreshing, setRefreshing] = React.useState(false);
  // Debounce the search so we filter + re-paginate only after a 250ms quiet
  // window, not on every keystroke. `searchPending` drives the input spinner.
  const dq = useDebouncedValue(query, 250);
  const searchPending = query.trim() !== dq.trim();
  const queryLc = dq.trim().toLowerCase();
  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    // Keep the spinner up for at least a beat so the action reads as "fetched",
    // even if the API resolves quickly.
    const settle = new Promise(r => setTimeout(r, 450));
    Promise.all([libraryStore.refresh(), settle]).finally(() => setRefreshing(false)).catch(() => {});
  };
  const libStatus = useStore(libraryStore, s => s.status);
  // Cold-load only — a background refresh keeps the current grid visible.
  const dataLoading = useStore(libraryStore, s => s.status === "loading" && !s.everLoaded);
  const now = libraryNow(all);
  const recentCutoff = +now - RECENT_WINDOW_DAYS * 86400000;
  let filtered = all.filter(g => {
    if (filter === "installed" && !isInstalled(g)) return false;
    if (filter === "available" && isInstalled(g))  return false;
    if (filter === "recent" && !(g.addedAt && +new Date(g.addedAt) >= recentCutoff)) return false;
    if (queryLc && !g.name.toLowerCase().includes(queryLc)) return false;
    return true;
  });
  // Catalog sort — a real storefront lets you reorder. Newest-first by default
  // so fresh games surface; footprint sort reads the recommended RAM straight
  // from the backend `specs` (null today → 0, so the order is stable until the
  // API serves real figures — never sorted by a fabricated number).
  const ramGB = g => (g.specs && g.specs.recommendedRamMb) || 0;
  const SORTS = {
    recent: (a, b) => +new Date(b.addedAt || 0) - +new Date(a.addedAt || 0),
    name:   (a, b) => a.name.localeCompare(b.name),
    ram:    (a, b) => ramGB(b) - ramGB(a),
  };
  filtered = filtered.slice().sort(SORTS[sort] || (() => 0));
  const installedCount = all.filter(isInstalled).length;

  // ---- Grouping ----
  const grouping = groupBy !== "none";
  const groups = grouping ? buildGroups(filtered, groupBy, now, isInstalled, allHosts) : [];
  // Collapsed keys are namespaced per grouping (`category::Survival`) so the
  // same section name under different groupings doesn't clash.
  const ck = key => groupBy + "::" + key;
  const toggleSection = key => {
    const next = new Set(collapsed);
    next.has(ck(key)) ? next.delete(ck(key)) : next.add(ck(key));
    persistCollapsed(next);
  };
  const anyOpen = groups.some(s => !collapsed.has(ck(s.key)));
  const toggleAll = () => {
    const next = new Set(collapsed);
    if (anyOpen) groups.forEach(s => next.add(ck(s.key)));   // collapse all
    else groups.forEach(s => next.delete(ck(s.key)));        // expand all
    persistCollapsed(next);
  };

  // ---- Pagination (25 / page) ----
  const PAGE_SIZE = 25;
  const [page, setPage] = React.useState(0);
  // Any change to the active query or filter is a fresh result set — back to
  // page 1 so you're never stranded past the end of the list.
  React.useEffect(() => { setPage(0); }, [queryLc, filter, sort, groupBy]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  return (
    <>
      <div className="library-head">
        <h1>{(KRYSTAL_LABELS && KRYSTAL_LABELS.catalog) || "Catalog"}</h1>
        <div className="library-head__sub">Pick a game and we'll handle the install, port-forwarding, and config defaults. You bring the world.</div>
      </div>
      {dataLoading ? <LibrarySkeleton /> : (<>
      <Toolbar>
        <ToolbarSearch value={query} onChange={setQuery} pending={searchPending} placeholder="Search games…" />

        <ToolbarFilters
          fields={[
            { id: "filter", label: "Show", value: filter, onChange: setFilter, default: "all",
              options: filters.map(f => ({
                value: f.id, label: f.label,
                count: f.id === "all" ? all.length
                  : f.id === "installed" ? installedCount
                  : f.id === "available" ? all.length - installedCount
                  : recentCount,
              })) },
            { id: "sort", label: "Sort", value: sort, onChange: setSort, default: "recent", options: [
              { value: "recent", label: "Recently added" },
              { value: "name",   label: "Name (A–Z)" },
              { value: "ram",    label: "Largest footprint" },
            ] },
            { id: "groupBy", label: "Group", value: groupBy, onChange: setGroupBy, default: "none", options: [
              { value: "none",         label: "None" },
              { value: "category",     label: "Category" },
              { value: "status",       label: "Status" },
              { value: "availability", label: "Host availability" },
              { value: "added",        label: "Date added" },
            ] },
          ]}
          onReset={() => setQuery("")} />

        <ToolbarSpacer />
        {grouping && groups.length > 0 && (
          <ToolbarButton
            icon={anyOpen ? "chevrons-down-up" : "chevrons-up-down"}
            onClick={toggleAll}
            title={anyOpen ? "Collapse every section" : "Expand every section"}>
            {anyOpen ? "Collapse all" : "Expand all"}
          </ToolbarButton>
        )}
        <ToolbarCount shown={filtered.length} total={all.length} unit="games" />
        <ToolbarButton
          icon="refresh-cw"
          onClick={refresh}
          disabled={refreshing}
          spinning={refreshing}
          title="Re-fetch the catalog from the backend">
          {refreshing ? "Refreshing…" : "Refresh"}
        </ToolbarButton>
      </Toolbar>
      {libStatus === "error" && (
        <SurfaceError
          title="Couldn't refresh the library."
          detail="Showing the last games we loaded."
          onRetry={refresh}
          retrying={refreshing}
        />
      )}
      <div className="game-grid">
        {!grouping && pageItems.map(g => <GameCard key={g.id} game={g} onPick={onOpenGame} onDeploy={onDeploy} addedNow={now} />)}
      </div>
      {grouping && (
        <div className="lib-groups">
          {groups.map(section => (
            <LibraryGroup
              key={section.key}
              gkey={groupBy}
              section={section}
              collapsed={collapsed.has(ck(section.key))}
              onToggle={toggleSection}
              onOpenGame={onOpenGame}
              onDeploy={onDeploy}
              now={now}
              isInstalled={isInstalled}
            />
          ))}
        </div>
      )}
      {filtered.length === 0 && (
        <div style={{ padding: "60px 0", textAlign: "center", color: "var(--fg-3)" }}>No games match that filter.</div>
      )}
      {!grouping && (
        <Pagination
          page={safePage}
          pageCount={pageCount}
          total={filtered.length}
          pageSize={PAGE_SIZE}
          onPage={setPage}
          unit="games"
        />
      )}
      </>)}
    </>
  );
}

export { CATEGORY_META, GameCard, Library, RECENT_WINDOW_DAYS, fmtAddedLabel, gameIsInstalled, hostAvailabilityLabel, instanceCountFor, libraryNow, offeringHosts, recentlyAddedGames };
