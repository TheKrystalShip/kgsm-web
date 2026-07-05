# src/lib/ — the data layer & policy

Everything that isn't a React view lives here: the backend seam, the reactive
stores, the honesty boundary, auth/RBAC policy, and the URL router. **Components
and pages never touch `fetch` or the API directly — they go through a store, and
stores go through `apiClient`.** The root `../CLAUDE.md` ("The data layer"
section) is the narrative; this is the per-file map.

## The one data path

```
component/page ──useStore──▶ domainStore ──▶ api.get/post/patch ──▶ adapters ──▶ store
                                (stores/)      (apiClient.js)      (adapters.js)
realtime: liveStream.js (fetch-SSE) ──adaptStreamMessage──▶ same stores
```

## File map

**Backend seam & realtime**
- `apiClient.js` — the **single** backend seam. `api.get/post/patch`, per-host
  `api.host(id)` (401-retry / silent renew), `api.fanOut` (multi-host roll-up),
  `api.stream` (subscribe), the SSE assistant `turn`. Owns `connectionStore`
  (REST reachability → cold-start/banner) and `realtimeStore` (per-host SSE
  state). **Every call site only ever sees `api`.**
- `liveStream.js` — fetch-based SSE (migrated off WebSocket 2026-07-02). One
  primary stream per host + per-view dynamic streams; drives `realtimeStore` via
  `onMode`.
- `sse.js` — the low-level fetch-SSE reader used by `liveStream`.
- `alertsApi.js` — alerts fetch/stream glue.

**The honesty boundary**
- `adapters.js` — maps kgsm-api's narrow HONEST model to view shapes. A value the
  backend doesn't provide → `null`/`"unknown"`/`[]`, **NEVER `0` or an invented
  default**. Don't hardcode game/domain data the backend can serve. This is the
  ecosystem-wide "never fabricate a metric" rule at the frontend edge.
- `merge.js` — pure per-host → aggregated roll-up; every row carries its owning
  host id; merge only unions/de-dups, never invents attribution.

**Stores** — see `stores/CLAUDE.md`. `store.js` is the tiny reactive primitive
(`createStore` + `useStore`, React 18 `useSyncExternalStore`). `stores.js` is a
**back-compat re-export barrel** over `stores/` — new code can import from either.

**Connection / config / multi-host**
- `config.js` — the connection model: `CONNECTIONS` (localStorage host registry,
  read once at module load), `apiV1Of`/`streamUrlOf` per-host routing with the
  sole-connection fallback. **`CONNECTIONS.length` is a topology check (0 →
  connect screen, ≥2 → fan-out), NOT a `LIVE`/`MOCK` mode flag — never
  reintroduce that duality.** `VITE_API_BASE` is an optional single-host *seed*.
- `connect.js` — connect/disconnect a host (mutates the registry → full page
  reload); `devSeedAutoConnect` for auth-disabled dev.

**Auth / RBAC / capabilities**
- `sessionStore.js` — per-host identity (Model A): Discord SSO anchor, each host
  mints its own access (sessionStorage) + refresh (localStorage) token, resolves
  role via that host's bot.
- `authRedirect.js` — captures the OAuth fragment handoff at boot.
- `authStorage.js` — the app-shell user read/write (extracted from `App.jsx`).
- `persona.js` — the authorization **policy, single source of truth**. Roles
  `admin｜operator｜viewer｜none`, resolved **per host**. `can(cap)` = aggregate
  (any host) for nav/reach; `canOn(cap, host)` = scoped for actions — **never
  substitute one for the other**. `resolveRoute()` is the routing chokepoint.
- `capabilities.js` — per-host services (metrics / assistant / watchdog), each
  `provisioned` × `status`. The assistant is per-host with no central fallback.

**Routing & presentation helpers**
- `router.js` — pure URL-hash ↔ `route` object bridge (framework-free). Full URL
  scheme documented in-file.
- `theme.js` — client-only theme preference (`auto｜dark｜light`); LIVE swap of
  `<html data-theme>`, no reload. Mirror the `index.html` boot script when you
  change it.
- `formatting.js` / `labels.js` / `art.js` / `servers.js` — formatting,
  display-label vocabulary, key-art helpers, server-shape helpers.
- `registerSW.js` — production-only PWA service-worker registration.

## The init-order landmine — do not "tidy"

A few base modules **lazily** `import("...")` upper ones (e.g. `apiClient.js`
defers `stores.js`/`sessionStore.js`/`alertsApi.js`) to keep the ESM graph
**acyclic** — a carryover from the prototype's fixed script order. Converting one
of these to a static `import` can reintroduce a cycle and break boot. Read the
comment before changing an import.
