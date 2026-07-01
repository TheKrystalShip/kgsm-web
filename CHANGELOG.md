# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-01

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
