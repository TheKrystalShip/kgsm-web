# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed (v1.4.17)
- **Library grid shows two cards side by side on small phones (≤480px).** The `≤480px` breakpoint forced `.game-grid` to a single column; changed to `repeat(2, 1fr)` to match the `≤768px` layout.

### Fixed (v1.4.16)
- **Assistant FAB button now visible on mobile.** The floating action button was gated to `desktop` only, so mobile users had no visible way to open the assistant dock (only an unreliable right-edge swipe). The CSS already had mobile styles ready; removed the JS guard.

### Fixed (v1.4.15)
- **Files tab: file explorer/editor no longer fills to the footer / squishes.**
  Two parts, both traced to the same phase-6 refactor (`989b9cb`) plus a stale floor:
  - The refactor dropped the conditional that put `content--fill` on the shell
    `.content` for the Files tab (`route.kind === "server" && route.tab === "files"`),
    so the vertical fill-chain (`.app__main → .content--fill → .fb-briefcard →
    .fb-card`) never engaged and the browser fell back to its `min-height:460px`.
    Restored the conditional in `App.jsx` (works now that `.app__main` is back — v1.4.14).
  - Moved the "generous minimum" floor from `.content--fill` (the **whole column**,
    which the tall cinematic `ServerHero` + sub-tabs already ate ~480px of, leaving the
    card collapsed to ~158px) down onto `.fb-briefcard` (the file-browser container):
    `min-height: 520px`. Made `.content--fill` `flex: 1 0 auto` (grow, never shrink) so
    it fills to the footer on a tall viewport but keeps its content height on a short
    one — `.app__main` scrolls instead of squashing the card or riding the footer up
    under the hero (the collapse `kit/responsive.css` guards against on mobile).
  - Verified live in Chromium: at 900px the card holds **448px** and the page scrolls
    (footer reachable, flush at the bottom when scrolled); at 1300px it grows to
    **558px** and fills right down to the footer (25px content-padding gap). Lint clean,
    build green.

### Fixed (v1.4.14)
- **Shell layout regression: page scroll + sticky footer.** The refactor's phase-6
  extraction (commit `989b9cb`) silently renamed the shell `<main>` from
  `className="app__main"` to `className="main"` (plus invented `main--push` /
  `main--rail` modifiers), but the CSS was never renamed — the entire `kit/` layer
  still targets `.app__main`. So the live `<main>` matched no rule and lost
  `overflow-y:auto`, `display:flex; flex-direction:column`, and
  `container-type:inline-size` at once:
  - **the Catalog (and any tall page) could not scroll** — `body{overflow:hidden}`
    clipped the content with no scroll container;
  - **the footer was no longer pinned to the bottom** — `.kfoot { margin-top:auto }`
    is inert without a flex-column parent, so it floated right after the content.
  Restored `<main className="app__main">` (the pre-refactor class; the `main--*`
  modifiers had no CSS anywhere — the dock push is handled by `.app`'s
  `padding-right:var(--dock-push)`). Verified live in Chromium: Catalog scrolls
  (`scrollHeight 4141 > clientHeight 900`) and the footer bar sits flush at the
  viewport bottom; lint clean, build green.

### Fixed (v1.4.13)
- **JSX-text `\uXXXX` escapes rendering literally.** A `’`/`—`/`·`/
  `…`/`↑` escape only decodes inside a JavaScript string literal; in a JSX
  **text node or attribute value** the JSX transform emits a doubled backslash, so the
  DOM literally contains `’` and the browser paints it verbatim (confirmed in
  Chromium — the game-not-found fallback showed `That game isn’t in the library.`).
- Classified all 110 source occurrences (strip JS-string spans → a surviving escape is
  JSX text; plus an attribute-value pass) and fixed the **19 that ship as literal-in-DOM**
  across 10 files (AppRouter, ChatPage, EvidenceCards, ChatContextMeter, ChatHistory,
  ChatMessageParts, AssistantHostPicker, DiagServices, LeafConfigModal, DiagResources),
  converting each JSX-text/attribute escape to the literal UTF-8 character. The other ~91
  occurrences are in JS-string context (`{"…"}`, `label:`, concatenation) and decode
  correctly — left untouched. `LeafConfigModal.jsx:110` was surgical: its JSX-text `’`
  was fixed but the same line's ` — ` inside a `{" … "}` string was left as-is.
  Also tidied a lone non-rendering `—` in a `BootLanding.jsx` comment so it won't
  re-trip the classifier.
- These sit on rare/conditional screens (invalid game route, swap >30%, the admin
  leaf-config modal mid-apply, voice-note recording), which is why they went unnoticed.
- Verified: the fresh production bundle contains **0** doubled-backslash escapes (was 19),
  the game-not-found screen now renders a real `’` in Chromium (DOM `innerText` check +
  screenshot), lint clean (0/0), build green.

### Changed (v1.4.12)
- **`exhaustive-deps` backlog — silenced with intent, not "fixed".** A narrow triage
  pass over all 43 `react-hooks/exhaustive-deps` warnings (25 hook sites) found
  **zero genuine staleness bugs** — every one is either a deliberate `[obj.id]`-not-
  `[obj]` choice (the primitive *is* in the deps; listing the whole object would
  resubscribe/refetch on every render), a run-once/edge-detector effect where a
  ref/guard is the real trigger, or a constant false-positive (`tw` is a fresh-per-
  render literal with frozen contents; `SERVER_STATUS_RANK` is a constant map). In
  each case the linter's only available "fix" — adding the missing dep — would
  **introduce** a regression (a refetch storm, a clobbered in-progress edit, a reset
  live buffer), the opposite of the goal.
- Rather than leave the warnings as a trap for a future session to "fix", added a
  scoped `// eslint-disable-next-line react-hooks/exhaustive-deps -- <reason>` at
  each of the 27 anchor lines, each carrying the specific why (e.g. ChatPage's history
  loader excludes `convos` because depping it would refetch on every streamed
  message; AuditLog's `now` keeps `[scoped]` as a deliberate recompute trigger).
- **No behaviour change** — comment-only. `npm run lint` is now fully clean (0 errors,
  0 warnings, down from 43); build green.

### Changed (v1.4.11)
- **#8 Big-file splits — finished the remaining page files.** Same technique as
  v1.4.10 (extract to sibling modules, keep public exports identical → no consumer
  changed):
  - **`ServerSettings.jsx` 469 → 279.** The three gated setting groups → new
    `serverSettings/SettingsSections.jsx` (`StartupSection`, `ScheduleSection`,
    `ResourcesSection`) as presentational components fed their state slice + setters;
    all form state + the load/save/reset/delete handlers stay in the parent (they
    read every field). The tiny Updates group stays inline.
  - **`DashboardPage.jsx` 420 → 366.** `DashFleetStrip` (the all-hosts capacity
    strip) → new `dashboard/DashFleetStrip.jsx`; dropped the two imports it solely
    used. The customizable band render stays inline (entangled with local layout
    state — extracting it would add prop-drilling for no real gain).
  - **`ChatPage.jsx` 528 → 507.** The message-role dispatch → new
    `chat/ChatThread.jsx` (a pure render switch), moving nine message-part imports
    out of ChatPage. The composer/header seams were **left inline** — they'd each
    need ~15-19 props from the shared chat state, so extracting them would add
    drilling, not remove it (ChatPage was already reduced 1944→528 in Phase 5).
- **Left as-is (documented):** `TimeSeriesChart` (single cohesive chart) and
  `apiClient.js`/`adapters.js` (data-layer seams — splitting risks the acyclic-import
  invariant).
- No behaviour change. Verified: lint 0 errors, build green, and the Settings tab
  (all four sections), Dashboard, and the docked Chat render with `errs:[]` in the
  visual harness.

### Changed (v1.4.10)
- **#8 Big-file splits (refactor problem row 4).** Carved the two worst offenders
  into cohesive sibling modules, keeping each original file's **public exports
  identical** so no consumer changed:
  - **`PerformanceTab.jsx` 654 → 432.** Pure constants + formatters → new
    `performance/perfHelpers.js`; the presentational pieces (`StatStrip`,
    `AnomalyBadge`, `MetricChartCard`, `RangeSelector`, `EmptyPerf`) → new
    `performance/PerfCards.jsx`. The tab file keeps only its two stateful views
    (Live / Historical) + the range orchestrator.
  - **`diagComponents.jsx` 393 → 11-line barrel.** The nine-component grab-bag split
    by cohesion into `diagnostics/diagLeafCards.jsx` (leaf/service cards) and
    `diagnostics/diagHostCards.jsx` (host/fleet cards + host modals); `diagComponents.jsx`
    now just re-exports both, so `DiagServices`/`DiagResources`/`DiagOverview`/
    `LeafConfigModal`/`DiagnosticsPage` keep their existing imports.
- **Fixed (incidental, found during #8 verification):** several `\uXXXX` escapes sat
  in **JSX text nodes / attributes** on the Fleet page, where the build does **not**
  process them (the v1.4.6 class), so they rendered literally — the Fleet header
  em-dash, the host-search placeholder ellipsis, the "no hosts match" curly quotes,
  and the host subtitles' `·`/`—`. Replaced with literal characters in
  `DiagnosticsPage.jsx`; the migrated diag cards were converted at the same time.
  (A broader cross-file sweep for the same class is flagged as a follow-up.)
- No behaviour change from the splits. Verified: lint 0 errors, build green, and the
  Performance tab + Fleet page + edit-host modal render with `errs:[]` and no stray
  escapes live in the visual harness.

### Changed (v1.4.9)
- **#7 Shared `<Modal>` primitive (refactor problem-adjacent).** Eight modals each
  hand-rolled the same three things — an Escape `keydown` effect, a fixed scrim, and
  a click-outside check (three of them also duplicated `createPortal`). Extracted one
  `src/components/Modal.jsx` that owns that behaviour (portal-to-`<body>` + Escape +
  scrim mouse-down close, both gated by a `canClose` prop) and migrated every site to
  it. Net −41 lines across the call sites.
  - **Behaviour-only primitive:** the caller keeps its exact scrim *visual* class via
    `scrimClassName` (`.k-backdrop` / `.modal-scrim` / `.console-modal-scrim` / …),
    so there is **no visual change** — all three scrim classes are already
    `position:fixed; inset:0`, so portaling to `<body>` only lifts them out of any
    clipping ancestor.
  - **Migrated (8):** `InstallModal`, `HostReauthModal` (its `!busy` guard → `canClose`),
    `LeafConfigModal`, `HostEditorModal` + `RemoveHostDialog` (diagComponents), and the
    three fullscreen pop-outs `ConsoleView` / `FileBrowser` / `PerformanceTab`.
  - **Small consistency wins:** the `onClick={onClose}` sites now close on a *mouse-down
    outside the box* (target-checked) instead of any bubbled click, and
    `RemoveHostDialog` gained Escape-to-close (it had none).
  - **Deliberately not migrated:** `Toolbar`'s filters/sort dropdown and the chat
    popovers (`usePortalPopover`) are *anchored popovers*, not scrim modals — a
    different pattern, left alone.
  - Verified: lint 0 errors, build green, and in the visual harness `InstallModal`
    (Family A) + `ConsoleView` pop-out (Family B) open portaled-to-`<body>`, close on
    Escape and scrim-click, with `errs:[]` and unchanged appearance.

### Changed (v1.4.8)
- **#3 Prop-drilling cleanup (refactor problem-table row 5).** The Phase-6 App
  extraction *relocated* the god-component prop list onto `AppRouter` (~31 props)
  rather than eliminating it. Thinned `AppRouter` to routing only (~15 props) by
  splitting the props by ownership:
  - **Store-derived data now read in the pages, not threaded.** `DashboardPage`,
    `ServersPage`, `GamePage` read `serversStore`/`hostsStore`/scope directly (via
    `useStore` + `scopeServers` + `useSelectedHostId`), and `ServerGate` reads the
    store's `status`/`everLoaded` — the same pattern `FleetPage`/`ServerDetailPage`
    already used. Dropped `servers`/`scopedServers`/`hosts`/`selectedHostId`/
    `serversStatus`/`serversLoaded` from the router.
  - **Assistant/dock state read from context in the router.** `AppRouter` now calls
    `useAssistantDock()` for `askAboutAlert`/`getServerState`/`assistantHost`/…
    instead of receiving 7 props from the shell (it renders inside
    `AssistantDockProvider`).
  - **Dead props removed:** `activeServer` and `installing` were passed to
    `AppRouter` but never used in its body.
  - Genuinely shell-local props stay threaded (route/setRoute, `serverForRender`
    with merged console `extraLog`, the deny/expired gates, `handleAction`, install
    + reauth + logout, `user`) — and routing callbacks stay on the router (they keep
    pages decoupled from the router). Host-selection in the router's deny/expired
    gates calls `selectedHostStore.set` directly.
  - No behaviour change. Both sides of every contract were updated together (the
    v1.4.7 lesson). Verified: lint 0 errors, build green, and every page renders
    with `errs:[]` live in the visual harness (Servers/ServerDetail/Game confirmed
    populated with real data).

### Fixed (v1.4.7)
- Sidebar nav links (Home / Servers / Catalog / Alerts / Fleet / Audit log /
  Settings) were dead no-ops — a refactor contract mismatch. `App` was passing the
  new `route` + `onNavigate` props, but the `Sidebar` component still expected the
  old individual `on<Page>` / `<page>Active` handlers, so every nav `onClick` was
  `undefined`. Wired `Sidebar` to consume `route` + `onNavigate` (derives active
  state from `route.kind`, emits `onNavigate({ kind })`), completing the intended
  contract instead of reverting it. Also restored the dropped `open={drawerOpen}`
  prop (mobile drawer). Verified live: all 7 items route correctly.

### Fixed (v1.4.6)
- Boot/auth hold screen ("Signing you in…"): fixed two bugs found during the v1.4.5
  browser verification.
  - The ellipsis rendered as a literal `…` — the escape sat in a JSX **text
    node**, where `\u` is not processed. Wrapped it in a JS string expression
    (`{"…"}`) so it renders "…". Fixed the identical case in `AppRouter`'s
    Suspense fallback ("Loading…").
  - The content leaned left on mobile: `BootLanding` reused the `.app` shell class,
    whose `grid-template-columns: var(--sidebar-w) 1fr` pinned the centred content
    into the narrow sidebar column (and the inline `display:grid` even overrode the
    mobile `.app{display:block}`). Replaced with a self-contained `position:fixed;
    inset:0` flex overlay centred on both axes at every breakpoint.

### Fixed (v1.4.5)
- **Four latent crashes** the dead-code sweep + a new lint rule surfaced, all
  used-but-not-imported in JSX-tag position (the same class as v1.4.3 #1, which
  plain `no-undef` misses):
  - `App.jsx` rendered `<ChatPage>` in the assistant dock but no longer imported it
    (the refactor dropped the import; the dock opens by default on desktop, so this
    was a white-screen on load — the dock sits outside the router's ErrorBoundary).
    Now lazy-loaded, matching the existing `<Suspense>` wrapper.
  - `AppRouter.jsx` rendered `<ServerGate>` (the not-yet-loaded/bad-id fallback)
    without importing it → crash on a server route before the list loads. Imported.
  - `ChatPage.jsx` had no default export, but `AppRouter` lazy-loads it via
    `React.lazy(() => import(...))` (which requires a default) → the full-page chat
    route crashed. Added `export default ChatPage` (every other lazy page had one).
  - `ServerSettings.jsx` used `<Select>` but only imported it aliased as an unused
    `KSelect` → `ReferenceError` on the Server Settings tab. Imported `Select`.
- Also fixed a latent `store.patch(...)` reference in `capabilities.js` (leftover
  from a removed alias) that would have thrown at runtime → `hostsStore.patch(...)`.

### Changed (v1.4.5)
- Added `react/jsx-no-undef` (error) to the lint gate — `no-undef` does not catch
  undefined JSX-tag identifiers (`<Foo/>` with no import), which is exactly how the
  four crashes above hid from the build. This closes that blind spot.
- Dead-code / vestigial-guard sweep ("#6") across the whole `src/` tree: removed all
  183 `no-unused-vars` (dead imports, unused `React` imports under the automatic JSX
  runtime, unused locals, `catch (e)` → `catch`) and the vestigial
  `Import ? Import(...) : fallback` / `{Import && <Import/>}` guards left over from the
  prototype's window-globals era (the imported symbol is always defined). Net −107
  lines. Runtime-data guards (`server && …`, `host.online && …`) were deliberately
  left. Remaining lint backlog: 43 `react-hooks/exhaustive-deps` warnings.

### Added (v1.4.4)
- ESLint gate (`npm run lint`, ESLint 9 flat config in `eslint.config.js`).
  Deliberately narrow: `no-undef` and `react-hooks/rules-of-hooks` are **errors**
  (the two static bug classes the build silently passed in v1.4.3);
  `react-hooks/exhaustive-deps` and `no-unused-vars` are **warnings** (a tracked
  backlog). No typecheck or unit-test runner is added.

### Fixed (v1.4.4)
- Fixed 7 `rules-of-hooks` violations the new gate flagged, all the same vestigial
  `useHook ? useHook() : fallback` / `if (useHook) useHook()` guard pattern left over
  from the prototype's window-globals era (the imported hooks are always defined).
  Sites: `NeedsAttention`, `AlertsPage`, `Toolbar` (`useFilters`), `DashboardPage`,
  `DiagnosticsPage`, `ServerDetailPage`. In `ServerCard`, `useIsFavorite` was called
  *after* the phantom-tile early return — hoisted it above the return so hook order
  is stable regardless of `server._phantom`.

### Fixed (v1.4.3)
- Follow-up to the architecture-cleanup refactor: fixed regressions the extraction
  introduced.
  - `ServerDetailPage` referenced `RecentActivity` without importing it — an
    undeclared identifier that threw `ReferenceError` (caught by the ErrorBoundary)
    whenever an operator opened a server's Overview tab. Added the missing import.
  - The assistant dock's "pin" toggle was a no-op: `App` kept a dead local
    `manualPin` state and wired `onTogglePin` to it, while the real pin state
    (driving `effPush`/`pushingPanel`) lived in `AssistantDockContext`. Removed the
    dead state; the toggle now uses the context's `setManualPin`.
  - `App` cleared stored auth and returned `<LoginPage />` mid-render (a render-phase
    side effect) above ~20 hook calls (a Rules-of-Hooks hazard). Moved the `?auth=out`
    handling into the top-level `user` state initializer; the null-user case is now
    handled by the existing post-hooks guard.
  - `AssistantDockContext`'s context-value `useMemo` never actually memoized — two
    derived host-list arrays were rebuilt every render and used as deps, so every
    consumer re-rendered on every provider render. Memoized the lists (and
    `dockResize`) and completed the dependency array; the value is now stable on a
    no-op render.

### Fixed (v1.4.2)
- Auth pipeline hardened across the board: `api.host(null/undefined)` now throws
  immediately rather than silently building a broken unauthenticated client. Every
  `(hostId && api.host) ? api.host(hostId) : api` fallback removed from stores and
  components (11 sites in `stores.js`, plus `BackupsList`, `ConsolePanel`,
  `PlayersTab`, `DiscordPage`). Read functions now bail with `null`/`[]` when
  `hostId` is missing; write functions reject with an explicit error. `_fetchAuditPage`
  switched to `api.fanOut` (consistent with every other multi-host read, closes the
  unauthenticated-audit hole for id-less seed connections). `DiscordPage` host
  derivation made reactive via `useStore(hostsStore)` so the page re-renders
  correctly when `hostsStore` hydrates after a deep-link cold boot.

### Fixed (v1.4.1)
- `GET /servers` always 401s on every page reload: `retryConnection` used the
  unscoped `api.get("/servers")`, which resolves auth via `selectedHostStore.id`.
  On cold load that store initialises to `"all"` (hostsStore is empty until the
  first REST round-trip), triggering the `id === "all"` guard in `authorizedBearer`
  → no token → unauthenticated request. Fix: use `api.fanOut("/servers")` instead,
  which routes per-connection through `hostScoped(conn.id)` with a concrete host ID
  → `authorizedBearer` succeeds on the first call.

### Added (v1.4.0)
- iOS PWA polish: multi-resolution `apple-touch-icon` tags (180×180, 167×167, 152×152 px)
  so the home-screen icon renders at the correct size on every iPhone and iPad variant.
- iOS launch / splash screens: `apple-touch-startup-image` entries with `media` queries
  covering every current iPhone and iPad, eliminating the blank flash on cold-start.
  13 portrait splash sizes generated (640–2048 px wide), all using the app canvas colour
  (#0B0F14) with the icon centred — no white or system-default grey frame.
- `format-detection` meta tag (`telephone=no, date=no, email=no, address=no`) to suppress
  iOS auto-linking of phone numbers, dates, and addresses in rendered text.

### Fixed (v1.4.0)
- **iOS notch / status-bar overlap** — `@media (max-width: 768px)` reset `.topbar`'s
  shorthand padding to `0 16px`, silently overriding the `@supports` block's
  `padding-top: env(safe-area-inset-top)`. The topbar content was running straight
  into the status bar when launched in standalone mode on any iPhone with a notch.
  Fixed by re-applying the safe-area padding inside the mobile block and changing
  `height: 56px` → `min-height: 56px` so the bar grows rather than the content
  shrinking.
- **Assistant FAB hidden behind home indicator** — `.assistant-fab { bottom: 16px }`
  on mobile doesn't respect `env(safe-area-inset-bottom)`, so the FAB overlapped
  the home bar on all edge-to-edge iPhones. Fixed with
  `bottom: max(16px, env(safe-area-inset-bottom, 0px))` (and matching `right:` for
  landscape notch clearance).

### Added (v1.3.0)
- Phantom install card: when a new game server install starts, a dashed card appears in the
  fleet immediately showing install progress. The pill text updates through "Preparing…",
  "Downloading…", and "Deploying…" phases as kgsm emits events. All connected users see the
  phantom — the card is driven by `job.patch` SSE, not just by the user who initiated the install.
- On install failure the card switches to a red "Failed" pill with a Dismiss button.
- The phantom is replaced in-place by the real server card when install completes.

### Added
- Crash-policy rows in the Startup & recovery card: "Restart on crash" toggle and
  "Max consecutive restarts" select (shown only when restart-on-crash is on).
  Wired to `crashRestart` / `crashMaxRestarts` in GET/PATCH /servers/{id}/settings;
  watchdog-gated alongside autostart.
- Auto-backup rows in Scheduled tasks card: "Back up before restart" toggle and
  "Keep N backups" retention input (shown only when a restart cadence is set).
  "Last backup" read-only row shows most-recent backup timestamp and status from
  the scheduler socket.

## [1.0.0] - 2026-07-03

### Added
- **Scheduled restart card** in server Settings. Cadence (off/daily/weekly/6h), time,
  day-of-week (weekly only), optional timezone override, and next-scheduled-restart
  timestamp from the kgsm-scheduler leaf. Scheduler-gated — gracefully absent when
  the leaf is not deployed.

## [0.9.0] - 2026-07-03

### Added
- **Settings Phase 2 — Resources.** CPU priority (Low/Normal/High) and Memory cap (MiB, 0=uncapped)
  rows are now live in the Settings tab, watchdog-gated. CPU priority is live-applied to the running
  cgroup; memory cap persists to config and takes effect at next restart (noted in the sub-label).
  Both show the current values from the API on load.

## [0.8.0] - 2026-07-03

### Added
- **Settings Phase 1 — Autostart.** The Startup & recovery section is now live: shows an Autostart
  toggle when the watchdog capability is healthy (Save/Reset wire through). When watchdog is offline,
  shows an honest "Watchdog offline — autostart unavailable" message instead of the Phase 1 placeholder.
  The "—" sentinel appears when the watchdog is provisioned but the GET couldn't read the value.

## [0.7.0] - 2026-07-03

### Added
- **Settings tab wired (Phase 0).** `ServerSettings.jsx` is now live: loads settings from
  `GET /servers/{id}/settings`, auto-update toggle is wired end-to-end, Save and Reset buttons
  call `PATCH /servers/{id}/settings`, Delete button calls `DELETE /servers/{id}` with a
  two-step confirmation and navigates to the server list on 202 acceptance. Startup & recovery,
  Scheduled tasks, and Resources sections show honest "Available in Phase N" placeholders until
  their primitives land. `fetchSettings`, `patchSettings`, and `deleteServer` added to `stores.js`.

## [0.6.0] - 2026-07-02

### Changed
- **Realtime transport migrated from WebSocket to fetch-based SSE.** `GET /api/v1/stream`
  is now `text/event-stream` (topics chosen via `?topics=`, bearer sent as an `Authorization`
  header instead of `?access_token=`). Fixes the class of WS-401 incidents caused by a
  browser being unable to set headers on a WS handshake and an opaque `1006` close on
  auth failure — SSE surfaces a readable `401` that heals through the same reactive
  rotate-on-401 path as every REST call. One persistent **primary** stream per host
  (global topics, drives `realtimeStore` mode + `rehydrateAll`) plus ref-counted
  **dynamic** per-topic streams for resource-scoped views. Dropped all client-side token
  expiry prediction (`tokenExpMs`/`tokenExpired`/`wsBearer`); the Dashboard Ping KPI is
  now REST-timed (`GET /health` RTT) instead of a WS ping/pong.

## [0.5.1] - 2026-07-01

### Fixed
- **Player roster desktop layout**: Status, First seen, and Last seen columns no longer
  shrink excessively on wider screens. Added minimum column widths (`110px`/`120px`) to
  prevent squishing while preserving the mobile layout.

## [0.5.0] - 2026-07-01

### Added
- **Unified permanent player roster view**: `GET /servers/{id}/players` now returns the
  full history roster (every player who has ever connected, with status, first seen, last seen).
  Status indicator with colored dot + text label. Mobile responsive: time columns hidden on
  small screens, status label visible.

## [0.4.0] - 2026-07-01

### Added
- **Players tab wired to the frozen player-presence contract** (`player-presence-contract.md`
  §5): `GET /servers/{id}/players` hydrates the roster, then the `players` WS topic
  (`players.join`/`players.leave`, keyed by `sessionKey`) follows live joins/leaves —
  tail-then-follow, same ordering guarantee as the Console tab. Replaces the old
  prototype scaffold (ping/playtime/online-banned-allowlist status/kick-ban actions —
  none of which the backend can honestly source) with a thin, honest roster: a row's
  label falls back name → addr → sessionKey (never blank), and `detection:"unknown"`
  renders an explicit "presence not available for this game" — never a fabricated
  "0 players online".
- **`players.reset` handling**: the api clears its own roster on an instance
  stop/start/restart (a killed process emits no `players.leave` lines), so a
  `{type:"players.reset", data:{serverId}}` frame tells an already-open tab to drop
  its stale rows too — no REST refetch needed, a rejoin flows back in as an
  ordinary `players.join`. Prevents phantom "connected" rows surviving a restart.

## [0.3.0] - 2026-07-01

### Changed
- **Session handling rewritten to a reactive model — the API is the authority.**
  The client no longer predicts access-token expiry. It uses whatever token it
  holds and rotates only when told to: an HTTP `401` response rotates the refresh
  token and replays the call once (`hostScoped.withRetry`), and that is the entire
  REST freshness story. Removed the proactive-refresh `setTimeout`, the
  `EXPIRY_SKEW_MS` margin, the separately-tracked shadow `exp`/`capExp` fields, and
  the `visibilitychange` pre-freshen — every WebSocket 401 bug we've had came from
  one of those trying to *predict* expiry and drifting out of sync with the real
  token. `sessionStore` collapses to `token()` / `rotate()` / `authorize()`.
- **WebSocket auth:** because a browser hides a WS-handshake `401` as an opaque
  `1006` close, the socket can't heal reactively like REST. It (and only it) reads
  the access token's own JWT `exp` claim right before dialing (`tokenExpired`) and
  rotates a lapsed token first, so it never opens a connection the API would reject.
  This subsumes the v0.2.1 stop-gap.

## [0.2.1] - 2026-07-01

### Fixed
- Realtime WebSocket 401-loop after a token lapses (e.g. a tab left open overnight,
  then refreshed). The session freshness gate keyed off a client-tracked `exp` field
  that could drift ahead of — or be missing from — the access token's real expiry,
  so a dead token read back as `live`, the funnel handed it to the socket, and it
  401-looped forever without ever attempting a refresh. The token's own JWT `exp`
  claim (exactly what the API validates) is now authoritative in the freshness gate,
  the persisted-session read, and the proactive-refresh timing; the stored `exp` is
  demoted to a faithful cache of that claim (written from the token, never computed
  independently). Auth-disabled hosts and non-JWT bearers are unaffected.

### Added
- Metrics-threshold alerts: the alert feed now surfaces the new kgsm-api `metrics`
  (per-server) and `host-monitor` (host-scope) sources alongside `watchdog` crashes —
  same page, dashboard, sidebar badge, and filters, no new surface. Host-scope alerts
  (no `serverId`, `anchor.surface: "host"`) render cleanly and get an **Open host**
  click-through to the host page; per-server metric alerts deep-link to that server's
  Performance tab. Source→icon already covered `metrics` (gauge) / `host-monitor`
  (server); this wires the navigation for the null-serverId host case.

## [0.1.1] - 2026-06-30

### Fixed
- Realtime WebSocket no longer 401s on every fresh page load. The first `/stream`
  dial runs during `apiClient` module eval, before the lazy `sessionStore` import
  resolves, so the egress auth funnel fell through to a tokenless connect → a
  guaranteed 401, healed only by the ~2.5s reconnect backoff. `authorizedBearer`
  now awaits the session-module-ready promise, so the first dial already carries
  the access token (restored synchronously from `sessionStorage` on an in-tab
  reload — no extra round-trip).

## [0.1.0] - 2026-06-30

### Added
- Initial versioned release.
