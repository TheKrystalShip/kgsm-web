# src/lib/stores/ — the domain-split reactive stores

This folder **was one file** (`../stores.js`, a monolith). The refactor
(`1af2146`, phase-7) split it by domain. `../stores.js` now only re-exports from
here for back-compat. **Don't grow a new monolith — a new domain gets a new
module in this folder, wired into the barrel.**

## The barrel

`index.js` re-exports every public symbol so the old `import { … } from
"../stores.js"` API is unchanged; `../stores.js` is a one-line pass-through to
it. Import from either — both resolve here.

`index.js` also ends with `import "./boot.js"` — a **side-effecting** import that
kicks off the initial hydrate (servers/library/hosts/audit refresh + ping loop +
cluster discovery) exactly once at module load. Keep boot as its own module; don't
scatter hydrate calls into the domain stores.

## The modules (each owns one domain)

| Module | Owns |
|---|---|
| `servers.js` | game servers, jobs, command actions (`commandServer`, `confirmCommand`, `awaitJob`), install/delete, settings fetch/patch, console input, game-name resolution |
| `hosts.js` | hosts/diagnostics store + metrics & capability subscriptions (`subscribeHostMetrics`, `subscribeServerMetrics`, `syncCapabilitySubscriptions`, metrics history/events) |
| `audit.js` | the cluster-wide audit log, plus the node-attribution helpers every surface labels or filters rows with (`auditEventHost`, `auditInScope`, `serverHostId`). **There is no app-wide node scope** — a node is an attribute of a row, and narrowing is local to the list that offers it |
| `diagnostics.js` | host logs, log sources, services, leaf provisioning/config (`logsStore`, `servicesStore`, `applyLeafConfig`) |
| `files.js` | per-server working-dir file tree + editor cache (self-contained; only `api.host()`, no WS channel) |
| `library.js` | the installable game catalog (mostly static; hydrate from `/library`) |
| `ui.js` | client-local prefs: favorites (persisted) + link-latency ping KPI |
| `cluster.js` | the converged cluster roster **and** node discovery — `discover()` asks any addressable connection for the roster and registers the peers it names, `startDiscovery()` runs it at boot and on a slow cadence. It is the roster's ONE owner: pages read `clusterStore`, they don't refresh it on mount (per-node peer *actions* still re-read the node they mutated) |
| `boot.js` | one-shot hydrate side effect (imported by `index.js`) |
| `index.js` | the re-export barrel + boot import |

## Conventions

- Every store is a `createStore(...)` from `../store.js`; components subscribe
  with `useStore(store, selector)`. Stores start **empty** and populate on
  `refresh()` — never seed with fabricated defaults.
- All data reaches a store through `../apiClient.js` → `../adapters.js` (the
  honesty boundary) → `../merge.js` for multi-host roll-up. A store doesn't call
  `fetch` directly.
- **Intra-folder imports are downward:** `boot`/`audit`/`ui` may import
  `servers`/`hosts`/`library`; the base domain stores don't import back up. Watch
  for cycles — mirror the existing import direction.
