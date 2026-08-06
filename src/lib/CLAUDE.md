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
- `apiClient.js` — the **single** kgsm-api seam. `api.get/post/patch`, per-host
  `api.host(id)` (401-retry / silent renew), `api.fanOut` (multi-host roll-up),
  `api.stream` (subscribe). Owns `connectionStore`
  (REST reachability → cold-start/banner) and `realtimeStore` (per-host SSE
  state). **Every call site only ever sees `api`.** Every stream frame it
  dispatches carries `hostId` — the node whose socket delivered it — so a
  listener never has to guess which node produced an event.
- `liveStream.js` — fetch-based SSE (migrated off WebSocket 2026-07-02). One
  primary stream per host + per-view dynamic streams; drives `realtimeStore` via
  `onMode`.
- `sse.js` — the low-level fetch-SSE reader used by `liveStream`.
- `alertsApi.js` — alerts fetch/stream glue.

**The assistant seam (a separate backend)**
- `assistantClient.js` — the seam onto an assistant **leaf**, spoken directly on its own
  public origin. `assistant.host(id)` mirrors `api.host(id)`'s shape against the leaf's own
  unprefixed routes (`/turn`, `/confirm`, `/conversations`, `/admin/conversations/…`).
  Auth is reactive like the node seam, except the two non-replayable calls — a turn spends
  the user's prompt and a confirm burns a single-use token, so a lapsed access token is
  rotated **before** the call rather than healed from a 401.
  **No fallback:** a host whose capability names no public origin throws `ENOROUTE`. Routing
  the call through kgsm-api's relay instead would restore exactly the coupling this seam
  removes, and the relay is peer transport for another node's assistant.
- `assistantSession.js` — the per-host session with that leaf: its own storage prefixes, its
  own refresh rotation against the leaf's `/auth/session/refresh`, and the sign-in bounce.
  `originOf(hostId)` reads the address off the host's assistant capability, which is the only
  thing the aggregator contributes — discovery, not transport.
  **The sign-in is silent.** Every surface on a host is the same Discord application, so a browser
  signed into the panel has already authorized the assistant and `prompt=none` completes with
  nothing rendered. `ensureSession(hostId)` is the one decision point, ranked by cost: live ⇒
  nothing, a held refresh ⇒ a silent rotate, neither ⇒ a redirect. **One redirect per host per
  tab** (a `sessionStorage` marker written before leaving, cleared only when a session arrives), so
  a leaf that keeps refusing cannot loop the browser; the route travels in `sessionStorage` because
  the fragment is the handoff's. `prompt=consent` is passed by the dock's fallback button alone.

**The honesty boundary**
- `adapters.js` — maps kgsm-api's narrow HONEST model to view shapes. A value the
  backend doesn't provide → `null`/`"unknown"`/`[]`, **NEVER `0` or an invented
  default**. Don't hardcode game/domain data the backend can serve. This is the
  ecosystem-wide "never fabricate a metric" rule at the frontend edge.
- `merge.js` — pure per-host → aggregated roll-up; every row carries its owning
  host id; merge only unions/de-dups, never invents attribution.
- `placement.js` — which node an install should land on, **measured**: the
  blueprint's declared RAM/disk (advisory MB) against each node's live headroom
  (GiB — reconcile at ×1024). Verdicts `fits｜tight｜insufficient｜unknown｜
  offline` carry the numbers behind them. **CPU is not a dimension** (no such
  blueprint field, by design). Only a measured fit is ever recommended — an
  `unknown` node is selectable with its honesty shown, never ranked as if it fit,
  and no measurable node means no preselection at all.

**Stores** — see `stores/CLAUDE.md`. `store.js` is the tiny reactive primitive
(`createStore` + `useStore`, React 18 `useSyncExternalStore`). `stores.js` is a
**back-compat re-export barrel** over `stores/` — new code can import from either.

**Connection / config / multi-host**
- `config.js` — the connection model: `CONNECTIONS` (seeded from the localStorage
  host registry at module load, then **grown in place** by cluster discovery via
  `addConnections`; `subscribeConnections` notifies holders of per-connection
  resources) and the **routing rule**: `apiV1Of`/`apiOriginOf` resolve a node by
  backend id **exactly** — an id no connection holds throws in dev and returns
  null in prod, so a call fails rather than landing on another node. The one
  exemption is cold boot (a lone connection whose id isn't reconciled yet); a
  node-less call at N=1 resolves with a loud dev warning. `apiV1ForConn`/
  `streamUrlForConn` address a connection the caller already holds (the fan-out,
  the SSE registry). `originOfHost`/`hostAddressOf` are the soft **lookups** —
  an address to show or store, honestly `""` when we hold no such node.
  **`CONNECTIONS.length` is a topology check (0 → connect screen, ≥2 →
  fan-out), NOT a `LIVE`/`MOCK` mode flag — never reintroduce that duality.**
  `VITE_API_BASE` is an optional single-host *seed*.
- `connect.js` — connect/disconnect a host (mutates the registry → full page
  reload) and `mirrorRosterToRegistry`, which registers the alive+reachable peers
  a roster names (dedupes against the registry AND the live connection set, so a
  seeded node is never registered twice under a second address);
  `devSeedAutoConnect` for auth-disabled dev.

**Auth / RBAC / capabilities**
- `sessionStore.js` — per-host identity (Model A): Discord SSO anchor, each host
  mints its own access (sessionStorage) + refresh (localStorage) token, resolves
  role via that host's bot.
- `authRedirect.js` — captures the OAuth fragment handoff at boot, and **says who issued
  it**. A node login and an assistant-leaf login both land on this origin with the same
  `access`/`refresh`/`error` fragment keys; the `assistant_login=<hostId>` marker that
  `assistantSession.signIn` puts in its return address is what tells them apart. It only
  classifies — `main.jsx` hands an assistant landing to `assistantSession`, so this module
  stays a leaf of the import graph and the two session layers keep their own storage.
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
- `formatting.js` / `labels.js` / `art.js` / `servers.js` / `leaves.js` —
  formatting, display-label vocabulary, key-art helpers, server-shape helpers,
  and the leaf vocabulary (run-state → tone+label, iconography, kind). `leaves.js`
  lives here rather than beside any one surface because the Services board, the
  leaf page and the leaf config page all read it — and because `components/`
  may not import from a page.
- `registerSW.js` — production-only PWA service-worker registration.

## The init-order landmine — do not "tidy"

A few base modules **lazily** `import("...")` upper ones (e.g. `apiClient.js`
defers `stores.js`/`sessionStore.js`/`alertsApi.js`) to keep the ESM graph
**acyclic** — a carryover from the prototype's fixed script order. Converting one
of these to a static `import` can reintroduce a cycle and break boot. Read the
comment before changing an import.
