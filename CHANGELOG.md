# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
