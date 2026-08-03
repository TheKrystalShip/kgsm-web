# kgsm-web — Cluster transparency

> The SPA drives a **cluster**, not a node. Every surface reads all N nodes;
> the node dimension is an attribute of the objects on screen, never a mode of
> the app. Only cluster administration treats a node as a first-class subject.

Authority for the federation contracts this builds on: `kgsm-api/PLAN-peers.md`
(decisions 13–26, phases P0–P5). This doc owns the SPA half.

## Status legend

`built` · `partial` · `planned` · `open`

---

## 1 · The doctrine

**One rule, stated three ways:**

- A node is an **attribute of an object** (this server runs on node B; this
  blueprint lands on node C), never an ambient app scope.
- Every read is a **fan-out over N nodes**; every write carries an **explicit
  node**, derived from the object being written.
- There is **no "current node"**. No default, no first-node fallback, no
  pre-selection. Code that cannot name its node is a bug, not a case for a
  fallback.

**Corollaries.**

- **Filtering ≠ scoping.** A "Node" column filter on a list is legitimate and
  local to that list. It never changes what any other surface shows.
- **A missing node is honest, never invisible.** A fan-out that reaches 5 of 6
  nodes renders 5 nodes of data *plus* "node C unreachable". Silently dropping
  the sixth reads as "my servers were deleted" — a fabricated state
  (`system-architecture.md`: measured, or explicitly unknown).
- **Node administration is a page, not a chrome control.** Adding, federating,
  editing and inspecting nodes lives on Cluster/Diagnostics, gated on
  `host.manage`. Viewers and operators never pick a node to use the panel.

## 2 · Blast radius

### a · The scope store

| Site | What it is |
|---|---|
| `src/lib/stores/audit.js:10-34` | `selectedHostStore`, the `krystal:selectedHost` key, `useSelectedHostId`, the N=1 auto-pin, the `hostsStore` subscription |
| `src/lib/stores/index.js:11`, `src/lib/stores.js:5` | re-exports |

20 files, 68 references.

### b · Ambient-scope consumers

| Site | Reads scope for |
|---|---|
| `src/App.jsx:41,64,217,229,246,259-264,292,403` | sidebar wiring, alert counts, deny/expired gates, install-modal default node |
| `src/components/Sidebar.jsx:15-90,193,223` | `HostSwitcher` — the control itself |
| `src/pages/DashboardPage.jsx:31,32,67,121,122,149,152,198,269,330` | servers, audit, ping, capacity, watchdog capability, host column |
| `src/pages/ServersPage.jsx:279`, `AlertsPage.jsx:121`, `AuditLogPage.jsx:231` | toolbar "Host" fields that **write the global store** |
| `src/components/Toolbar.jsx:219,242` | reset / chip-clear, which resets the global store |
| `src/components/NeedsAttention.jsx:74`, `ContextualAlerts.jsx:30` | alert bucket scoping |
| `src/components/AssistantDockContext.jsx:113-116` | the assistant's default node |
| `src/components/AppRouter.jsx:44,49` | deny/expired "back to all hosts" |
| `src/pages/DiagnosticsPage.jsx:38,57,112,117,211` | active node, roster refresh anchor, roster-mirror anchor |
| `src/pages/SettingsPage.jsx:50-51`, `SettingsSessions.jsx:109-110` | selected-node-else-`CONNECTIONS[0]` anchor for account surfaces |

### c · Implicit first-node fallbacks — the latent-bug class

These are the sites that make a missing node *look* like it works. Each one is
a place a future feature silently binds to node 1.

| Site | Fallback |
|---|---|
| `src/lib/config.js:72-74` | `connOf()` — an unknown or absent id routes to `CONNECTIONS[0]`. The deepest one: it makes every other fallback survivable |
| `src/lib/apiClient.js:150,164,188` | `liveBearer` / `authorizedBearer` / `freshBearer` — no id ⇒ the selected node's bearer |
| `src/lib/apiClient.js:507` | `liveHostId()` → `list[0]`, keys realtime state |
| `src/lib/stores/servers.js:109` | an install phantom row is attributed to `list[0]` — a **fabricated node attribution** |
| `src/lib/stores/servers.js:243` | `installServer` falls back to `list[0]` |
| `src/pages/DashboardPage.jsx:121-122`, `DiagnosticsPage.jsx:57`, `Sidebar.jsx:31`, `library/BlueprintFileCard.jsx:33-39`, `library/LibraryCreatePage.jsx:47` | selected-else-first-node |

### d · Where N comes from (the structural gap)

Two node lists exist and only one drives the app:

- `CONNECTIONS` (`config.js:13,53`) — a **localStorage registry of manually
  added hosts**, read once at module load. `hostsStore.refresh` fans `/hosts`
  out over it, one host per connection.
- `clusterStore` (`stores/cluster.js`) — the **converged cluster roster**
  (`GET /peers`, falling back to the viewer-safe `GET /peers/roster`).

`mirrorRosterToRegistry` (`connect.js:78`) closes the loop, but it runs **only
from the Cluster page** (`DiagnosticsPage.jsx:77-84`), anchored on the selected
node, and takes effect only after a full page reload. A federated node the user
never opened Cluster to see is invisible to every other surface.

**A cluster whose membership depends on which page you visited is not a
cluster.** Roster-driven discovery at boot is the load-bearing change; the
selector removal is cosmetic next to it.

### e · Auth and tier

`persona.js` is already correct: `can(cap)` is the aggregate union across nodes,
`canOn(cap, host)` is scoped. sessionStore already authorizes **every** known
node (`sessionStore.js:397-398`) and `api.vouch` (`apiClient.js:786`) implements
lazy vouch-on-first-use (peers decision 15). One violation:
`SettingsSessions.jsx:133` reads `tierOf(hostId)` for a single node instead of
the aggregate rule.

### f · Docs, styles, tests

`WIRING.md:300` (selected-node bearer), `src/lib/stores/CLAUDE.md:25` (the
global scope), `src/styles/kit/{extras,hosts,chat}.css` (`host-switch`),
`scripts/smoke-live.mjs`.

## 3 · Non-goals

- **No single-endpoint relay.** Peers decision 17 keeps the SPA a direct
  multi-host client: per-node session, per-node SSE, browser fans out. This plan
  makes that invisible, not different.
- **No removal of per-node administration.** Cluster and Diagnostics stay
  node-subject surfaces, `host.manage`-gated.
- **No removal of node filters** on lists. They become local state.

---

## 4 · Phases

Ordered so the crutches come out **last**, after every caller names its node.

### P0 — Un-globalize list filters · `built`

A page-local-looking filter mutating persisted global state means *Clear
filters* on Servers re-scopes Home, the assistant's target node and the install
default. The `host` field on Servers, Alerts and Audit is local page state,
named **Node**, and writes nothing outside its own list.

- `nodeFilterOptions(hosts, scopeId)` (`components/host-helpers.jsx`) builds the
  option list from the nodes the page can actually show, so a filter choice can
  never contradict what is already on screen. It is the one place P5 rewrites
  when the app-wide scope disappears.
- A filter with nothing to choose between hides itself — a property of the
  options (`length <= 2`), not a host-count special case.
- Servers derives the per-row node badge from whether the list actually spans
  nodes, rather than from the app scope.
- The sidebar selector still works and still narrows these pages; the local
  filter narrows further within it.

**Done when:** changing or resetting a list filter provably leaves every other
surface untouched. — *Verified: no `selectedHostStore` reference remains in the
three pages; lint 0 errors, build clean, live smoke 247/247 against the
auth-disabled dev api.*

### P1 — Roster-driven node discovery · `planned`

Make N the cluster's N, on every load, for every tier.

- Hoist the roster fetch + `mirrorRosterToRegistry` out of `DiagnosticsPage`
  into app boot (alongside the `hostsStore` hydrate), anchored on **any**
  reachable connection rather than the selected node.
- Keep the mirror's honesty rules verbatim (`connect.js:78-97`): only
  `alive` + `reachable` + `nodeId` + `clientUrl` nodes are registered; a node
  missing either stays a visible ghost, never a fabricated connection.
- Replace the once-per-load `window.location.reload()` with a live
  `CONNECTIONS` update. This is the one piece of real refactor: `config.js`
  reads the registry once at module load and exports frozen `CONNECTIONS`,
  `API_BASE` and friends. Turn the connection set into a subscribable store so
  a newly mirrored node joins the fan-out without a reload.
- Viewers get the roster through `/peers/roster` (already the fallback path).

**Done when:** a node federated on another machine appears in the SPA's
fan-out on the next poll, for a viewer, without visiting Cluster and without a
reload.

### P2 — Aggregate-always surfaces · `planned`

- **Dashboard** drops its scope reads and renders the cluster: totals across
  nodes, with per-node breakdown as *content* (a node capacity strip / node
  column), not a mode. `showHost` becomes unconditional.
- **Alerts** — `alertBuckets(hostId)` keeps its `serverId` scope and its
  optional explicit `hostId` (used by server detail); the ambient default
  becomes "every node". `ContextualAlerts.jsx:30` likewise.
- **Fan-out partials become visible.** `api.fanOut` already returns per-node
  `{conn, ok, err}` (`apiClient.js:761-769`) and callers mostly discard `err`.
  Introduce one shared reachability summary the list surfaces render:
  *"5 of 6 nodes reported · node C unreachable"*. This is peers decision 25
  (fail-open to honest "unknown") carried into the UI, and it is what makes
  removing the selector safe.
- **Audit** — `auditInScope`'s unknown-node ⇒ in-scope fallback
  (`audit.js:44-49`) becomes an explicit `unknown` node value in the Node
  column rather than silent attribution.
- **Settings / Sessions** — drop the selected-else-first anchor. Sessions
  already fans out and merges (peers decision 18); make the fan symmetric with
  no "primary" node. "Sign out everywhere" enqueues the cluster-wide revoke
  from any reachable node. `isAdmin` uses the aggregate persona rule.

**Done when:** no non-administrative surface reads a node id it did not derive
from an object on screen.

### P3 — Entity-derived node targets · `planned`

Where the user genuinely picks a node, it is a **placement decision**, presented
as such:

- **Install modal** — a Node field that defaults to a *recommendation*, not to
  node 1. Compute it from peers decision 22/23 inputs: blueprint-declared
  RAM/disk against each node's live free RAM/disk, CPU saturation as a coarse
  gate. **Undeclared requirement ⇒ "unknown fit", never a guess** — an
  unknown-fit node is selectable with the honesty shown, never silently ranked.
  `GET /peers/{id}/resources` is `built` (peers P2), so this needs no backend
  work; the API-side advisory redirect (peers P3) refines it later.
- **Library create / blueprint push** — keep the existing local node pickers
  (`LibraryCreatePage.jsx:44`, `BlueprintFileCard.jsx:32`); remove their
  first-node defaults in favour of an explicit choice when N > 1.
- **Assistant dock** — target node derives from the conversation's subject (the
  server or blueprint being discussed), falling back to an explicit picker
  among assistant-capable nodes, never to the ambient selection.
- **Install phantom rows** (`servers.js:109`) carry the node from the job event.
  No node ⇒ `hostId: null` rendered as unknown.

**Done when:** every node-valued input on screen is either a user choice or a
measured recommendation, and none is a positional default.

### P4 — Delete the implicit fallbacks · `planned`

Nothing depends on them after P0–P3. This is the phase that prevents the next
bug.

- `config.js connOf()` — an unresolvable host id **throws** (dev) / returns
  `null` and fails the call honestly (prod). Keep exactly one narrow exemption,
  documented in place: the cold-boot lone seed connection with `id: null`,
  before `GET /hosts` reconciles its real id.
- `apiClient` — `liveBearer` / `authorizedBearer` / `freshBearer` require an
  explicit host id; no id is a programming error, not a silent default.
- `liveHostId()` (`apiClient.js:507`) — key realtime state by connection id
  only.
- `installServer` (`servers.js:243`) — already rejects without a host id; drop
  the `list[0]` fallback above it.
- Remove `API_BASE`-style sole-connection conveniences (`config.js:127-131`)
  wherever a caller can name its node.
- **Add the guard:** a dev-mode invariant that logs loudly on any host-less
  routed call, plus a smoke assertion that the app boots and renders with **two
  connections configured** and no selection state — the regression test for the
  whole doctrine.

**Done when:** grep finds no `list[0]` / `CONNECTIONS[0]` node defaults outside
the documented cold-boot seed.

### P5 — Remove the selector · `planned`

- Delete `HostSwitcher` (`Sidebar.jsx:15-90`) and its props; delete the
  `host-switch` styles.
- Delete `selectedHostStore`, `useSelectedHostId`, the `krystal:selectedHost`
  key and the re-exports.
- Replace it in the sidebar with a **cluster health chip**: `N nodes · M online`
  plus a degraded count, which navigates to Cluster and **sets nothing**. This
  keeps the ambient reachability signal (the only one in the collapsed rail)
  without scoping semantics.
- Deny/expired gates (`App.jsx:259-264`, `AppRouter.jsx:44,49`) become a
  per-node degradation list rather than a full-page gate on "the current node":
  under lazy vouch (peers decision 15) a missing session self-heals, so what
  remains is honest reporting of the nodes that genuinely refuse.
- Update `WIRING.md:300` and `src/lib/stores/CLAUDE.md:25` to present-tense
  canon describing the fan-out model.

**Done when:** no code can express "the current node".

---

## 5 · Risks

| Risk | Handling |
|---|---|
| A node drops out of the fan-out and reads as deleted data | P2's reachability summary is a hard prerequisite for P5 |
| `CONNECTIONS` becoming live breaks the read-once assumption | P1 converts it to a store; audit every module-load consumer (`config.js:127-131`, `apiClient` stream registry, `SettingsSessions.jsx:110`) |
| Roster mirroring registers an unreachable node | Keep the existing `alive` + `reachable` gate; a ghost row is the honest outcome |
| Placement recommends a node that fills up before install | Peers decision 24: accept the race, fail honestly at start time |
| Per-node auth failure becomes invisible without a selector | P5's per-node degradation list; fail-closed auth stays distinct from fail-open availability (decisions 25/26) |
