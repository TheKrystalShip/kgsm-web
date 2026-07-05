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
kicks off the initial hydrate (servers/library/hosts/audit refresh + ping loop)
exactly once at module load. Keep boot as its own module; don't scatter hydrate
calls into the domain stores.

## The modules (each owns one domain)

| Module | Owns |
|---|---|
| `servers.js` | game servers, jobs, command actions (`commandServer`, `confirmCommand`, `awaitJob`), install/delete, settings fetch/patch, console input, game-name resolution |
| `hosts.js` | hosts/diagnostics store + metrics & capability subscriptions (`subscribeHostMetrics`, `subscribeServerMetrics`, `syncCapabilitySubscriptions`, metrics history/events) |
| `audit.js` | the **selected-host GLOBAL scope** (`selectedHostStore`, `useSelectedHostId`, `scopeServers`) + the audit log store |
| `diagnostics.js` | host logs, log sources, services, leaf provisioning/config (`logsStore`, `servicesStore`, `applyLeafConfig`) |
| `files.js` | per-server working-dir file tree + editor cache (self-contained; only `api.host()`, no WS channel) |
| `library.js` | the installable game catalog (mostly static; hydrate from `/library`) |
| `ui.js` | client-local prefs: favorites (persisted) + link-latency ping KPI |
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
