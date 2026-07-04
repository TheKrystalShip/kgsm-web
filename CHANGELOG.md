# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
