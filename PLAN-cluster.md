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

## 2 · Where the node dimension lives

Nothing holds "the current node". These are the places a node is named, and what
names it.

### a · Named by the object

| Site | The node is |
|---|---|
| every row on an aggregated list (servers, audit, alerts) | the node that owns it, carried on the row and rendered as a badge when the list actually spans nodes |
| a server action, its console, files, settings, metrics | `server.hostId` |
| a blueprint file read or write | the node whose disk holds that copy — picked on the card, since copies can differ |
| an install | the install modal's measured placement pick (`lib/placement.js`) |
| an assistant turn | the server, blueprint or conversation behind it, else the dock's own picker |
| a peer write (federate, enable/disable, unfederate) | the node whose peer list it edits — the one you have open, else the only one you can manage, else asked for |
| a stream frame | the node whose socket delivered it (`hostId`, stamped by `adaptStreamMessage`) |

### b · Named by the URL

`route.hostId` is the subject of the node-subject pages (Cluster overview → node
detail → leaf config). It is a route, not a scope: leaving the page leaves it
behind, and no other surface reads it.

### c · Named by a local filter

The "Node" field on Servers, Alerts and Audit is `React.useState` on that page.
It narrows its own list and touches nothing else, and hides itself when there is
nothing to choose between.

### d · Named by the connection set

`CONNECTIONS` (`config.js`) is the node set the app drives: seeded from the
localStorage registry, then **grown in place** by cluster discovery
(`clusterStore.discover`, started from `stores/boot.js`), which asks any
reachable node for the converged roster and registers the nodes it names. So the
membership is the *cluster's*, not "whichever addresses this browser was pointed
at by hand", and it does not depend on which page you visited.

Every read fans out over that set (`api.fanOut` → `lib/merge.js`), and every
fan-out records its per-node outcome so a node dropping out is disclosed
(`ClusterReach`) rather than looking like deleted data.

### e · Auth and tier

`persona.js` is the policy: `can(cap)` is the aggregate union across nodes for
nav/reach, `canOn(cap, host)` is scoped for actions. sessionStore authorizes
**every** known node and `api.vouch` implements lazy vouch-on-first-use (peers
decision 15). A node that refuses is named by `NodeAccessNotice`, never by taking
the panel away.

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

- `nodeFilterOptions(hosts)` (`components/host-helpers.jsx`) builds the option
  list from the nodes the page can actually show, so a filter choice can never
  contradict what is already on screen.
- A filter with nothing to choose between hides itself — a property of the
  options (`length <= 2`), not a host-count special case.
- Servers derives the per-row node badge from whether the list actually spans
  nodes, rather than from any app-wide state.

**Done when:** changing or resetting a list filter provably leaves every other
surface untouched. — *Verified: no `selectedHostStore` reference remains in the
three pages; lint 0 errors, build clean, live smoke 247/247 against the
auth-disabled dev api.*

### P1 — Roster-driven node discovery · `built`

N is the cluster's N, on every load, for every tier.

- `clusterStore.discover()` asks the first **addressable** connection for the
  converged roster (`api.peers` needs a reconciled backend id; the env seed
  starts id-less, so discovery waits for the first `GET /hosts` to fill one in)
  and registers the peers it names. `startDiscovery()` runs it from
  `stores/boot.js` and re-runs on a 60s cadence.
- The roster has **one owner**. Pages read `clusterStore`; they do not refresh
  it on mount. The per-node peer *actions* (add / remove / enable) still re-read
  the node they mutated — that read is scoped to the node it acted on.
- The mirror's honesty rules are unchanged: only `alive` + `reachable` +
  `nodeId` + `clientUrl` nodes are registered; anything else stays a visible
  ghost, never a fabricated connection. Dedupe now spans the registry **and**
  the live connection set, so a seeded node is never registered a second time
  under whatever address the roster advertises for it.
- `CONNECTIONS` grows **in place** — the array identity never changes, so every
  holder of the import sees a new node at once.
  `subscribeConnections()` notifies holders of per-connection resources:
  `apiClient` opens the new node's primary stream (pushed in order, so
  `primaryStreams` stays index-aligned with `CONNECTIONS` for `reconnectHost`)
  plus every dynamic topic a view currently subscribes to, then re-hydrates.
- Viewers get the roster through `/peers/roster` — the same fallback inside
  `fetchRoster` that the Cluster page already used.

**Done when:** a node federated on another machine appears in the SPA's
fan-out on the next poll, for a viewer, without visiting Cluster and without a
reload. — *Verified live in Chromium: on `#/` (not Cluster) the SPA issues
exactly one roster call at boot, and with a roster naming a reachable peer it
registers that peer, opens its primary + dynamic SSE streams, and fans
`/hosts` `/servers` `/library` `/audit` out to it — one page load, no reload, no
console errors. The viewer branch is unexercised here: the dev api authenticates
every request as admin.*

### P2 — Aggregate-always surfaces · `built`

- **Fan-out partials are visible.** `api.fanOut` records every per-node outcome
  into `reachStore` (`apiClient.js`), and `<ClusterReach />` renders the honest
  footnote on Home, Servers, Alerts and Audit: *"1 of 2 nodes reported · Node B
  couldn't be signed in to"*. Recording happens at the one place every
  aggregated read passes through, so a new fan-out caller is covered for free.
  This is peers decision 25 (fail-open to honest "unknown") carried into the UI,
  and it is what makes removing the selector safe.
  - Keyed by the connection **URL**, not its id: an id is null until `GET /hosts`
    reconciles it, and id-keying strands the earlier reads under a second key
    and inflates the node count.
  - A `preflight` auth failure reads *"couldn't be signed in to"*, never
    *"refused this session"* — the call never left, so the node never refused
    anything. A node that is simply down surfaces through this path.
  - Silent at N=1 (a lone node's failure is the connectivity banner's story) and
    silent when every node answered.
- **Dashboard** renders the cluster: servers, audit, ping, capacity and the
  watchdog KPI all read every node. The crash KPI reads unknown when ANY node's
  watchdog is down, rather than reporting a count that excludes it. No node is
  marked "local" in the fleet strip.
- **Alerts** are cluster-wide by default — the page, the dashboard card and the
  sidebar badge. `alertBuckets` keeps its `serverId` scope and its explicit
  `hostId` for the node deep-dive, where the node is the subject on screen.
- **Audit** matches nodes STRICTLY, with events belonging to no node (auth,
  account) as their own selectable class — the same "panel" the timeline already
  chips them as — instead of being silently counted into whichever node you pick.
- **The node badge on a server row** is derived from the data: shown when the
  cluster has more than one node and the list is not pinned to one, on both the
  dashboard and the Servers page.
- **Settings / Sessions** fan symmetrically over every live node with no primary;
  sessions and recent logins are unions over whatever answered, with an honest
  partial note and a real error only when every node fails. A single-row revoke
  goes to the node that row came from; "Sign out everywhere" is cluster-wide, so
  any live node is a valid entry point. `isAdmin` uses the aggregate persona rule
  (`isAdminAnywhere`).

**Done when:** no non-administrative surface reads a node id it did not derive
from an object on screen. — *Servers and Audit still apply the sidebar's scope as
an upstream narrowing, deliberately: removing it before P5 deletes the control
would leave a selector that silently does nothing on two pages. Everything else
is aggregate. Verified live in Chromium with a stubbed two-node cluster: two
healthy nodes aggregate to 4 servers with per-node badges and no notice; a node
that joins and then stops answering produces the disclosure on all three list
surfaces. Lint 0 errors, build clean, smoke 247/247.*

### P3 — Entity-derived node targets · `built`

Where the user genuinely picks a node, it is a **placement decision**, presented
as such.

- **`lib/placement.js` is the rule.** A blueprint's declared RAM/disk (advisory
  MB integers on `specs`) against each node's live headroom (GiB doubles on the
  host record, sampled by the monitor); units reconcile at 1 GiB = 1024 MiB.
  Verdicts are `fits｜tight｜insufficient｜unknown｜offline`, each carrying the
  numbers that produced it so the UI shows the reasoning, not a bare word.
  - **CPU is not a dimension** — the blueprint schema has no CPU requirement and
    won't get one: a single number can't represent CPU capability.
  - Free disk is the **roomiest mount**, named in the summary. The SPA can't know
    which filesystem KGSM installs into, so the claim is "this node has room
    somewhere, here", never a silent guess at the target mount.
  - **Only a measured fit is recommended.** `unknown` is an absence of evidence,
    so it is selectable with its honesty shown and never ranked as if it fit;
    ties break on measured free RAM, never list order.
- **Install modal** — a Node field carrying each node's verdict, and a summary
  line stating the measurement (*"Fits — 16.7 GB RAM free of 8 GB wanted · 670.5
  GB free on / for a 15 GB install"*). A sole candidate is preselected because it
  is the only choice; beyond that only a measured fit is. Nothing measurable ⇒
  **no preselection, Install disabled until a node is named**. A half-declared
  blueprint still gets its measured dimension, with the undeclared one stated.
  - The field had never rendered: it gated on `canOn("server.manage")`, a
    capability that does not exist in `persona.js`, so the host list was always
    empty and every install fell through to the `list[0]` default underneath. It
    gates on `server.create` — the capability every other create surface uses.
  - The SPA reads each node's own capacity directly (it is a direct multi-host
    client). `GET /peers/{id}/resources` is the admin-gated server-side relay and
    stays off the SPA.
- **Library create / blueprint push** keep their local node pickers and preselect
  only a sole candidate. A blueprint file lives on ONE node's disk and the copies
  can differ, so opening whichever node sorted first would present one node's copy
  as if it were *the* blueprint; unpicked, the surface says so and mounts no
  editor. The card is offered when the user can read on ANY node holding it.
- **Assistant dock** — the target derives from the subject: the server behind
  `askAssistant`, the blueprint behind `askCreateBlueprint`, the node a picked
  conversation lives on. With no subject, a node is taken only when it is the
  only assistant-capable one; otherwise the target stays unset and the dock's
  host picker reads *"Choose a node"* and opens (it renders that unset state
  rather than disappearing, which would leave no way to choose).
- **Install phantom rows** carry the node whose stream delivered the job —
  `adaptStreamMessage` stamps `hostId` on every frame, since a node's socket is
  proof of the frame's origin. No origin ⇒ `hostId: null`, rendered as unknown.

**Done when:** every node-valued input on screen is either a user choice or a
measured recommendation, and none is a positional default. — *Verified live in
Chromium (55 checks): against the real node, 7dtd reads `fits` with its real
numbers and barotrauma (declaring nothing) reads `fit unknown`; against a stubbed
two-node cluster, a node measured too small and a node with no telemetry are both
stated and neither is preselected, and with neither node measurable the modal
asks and Install is blocked. The fit matrix is asserted against the app's own
`placement.js`. An install job pushed on node B's primary stream lands on a
phantom row attributed to node B, not to the first connection. Lint 0 errors,
build clean, smoke 247/247.*

### P4 — Delete the implicit fallbacks · `built`

**Routing is exact.** `connOf()` resolves a node by backend id and nothing else:
an id no connection holds is a routing failure, which **throws in dev** (the bug
surfaces at its source) and in prod logs and returns `null`, so the call is
rejected with *"That node isn't connected"* rather than answered by a different
node. There is one documented exemption — **cold boot**: a lone connection whose
backend id isn't known yet (the `VITE_API_BASE` seed, or a registry entry before
`GET /hosts` reconciles it) answers to any id, because there is nothing to match
and only one node it could mean. A node-less call against a lone *identified*
connection still resolves and **warns loudly in dev**: unambiguous today, a bug
the moment a second node joins. At N ≥ 2 it is simply unrouted.

- **The fan-out and the SSE registry address a connection directly**
  (`apiV1ForConn` / `streamUrlForConn`) rather than through its id. They iterate
  `CONNECTIONS`, so the node is already in hand — naming the entry is exactly as
  specific as naming its id, and it keeps a not-yet-reconciled node reachable
  without a positional fallback underneath it. Such a connection carries **no
  bearer**: sessions are keyed by backend id, so no token belongs to it.
- **Bearers require the node they are for.** `liveBearer` / `authorizedBearer` /
  `freshBearer` take the id as given — no ambient node to borrow a token from,
  which is how a request became both wrong and authenticated.
- **Realtime state is keyed by the connection whose socket produced it.** A
  connection with no id yet keys under `_cold-boot` — its own state, attributed
  to nothing — and the `hostsStore` subscription re-emits it under the reconciled
  id.
- **`installServer` rejects an install with no node.** Where a server lands is a
  decision, never a default.
- **Signing in picks a doorway, not a node to read from.** Identity is a global
  SSO anchor, so with several nodes connected the login page offers them and
  blocks *Continue* until one is named; a sole node is simply it. The chosen
  origin is remembered, and the return leg (`/me`, `/hosts`, the registry entry)
  addresses **that** node — asking the first one would have adopted the session
  under another node's id.

**Done when:** grep finds no `list[0]` / `CONNECTIONS[0]` node defaults outside
the documented cold-boot seed. — *Verified live in Chromium (24 checks): against
a stubbed two-node cluster the SPA boots with no selection state and renders both
nodes' rosters, the peer is fetched from its own origin, six routes produce no
routing failure, an unknown id and a node-less call both throw, and the login
page blocks sign-in until a node is named then records it. Against the sole seed
connection the cold-boot exemption holds — roster and host-scoped detail pages
render with no routing failure. Lint 0 errors, build clean, smoke 256/256, whose
last phase is the permanent regression test: grow to two connections at runtime
(P1's append path), then assert exact routing, both guards firing, no persisted
selection, and the app still rendering.*

### P5 — Remove the selector · `built`

**Nothing can express "the current node".** `selectedHostStore`,
`useSelectedHostId`, `scopeServers`, the `krystal:selectedHost` key and every
re-export are gone, along with `HostSwitcher` and the `host-switch` styles. There
is no store to read, no hook to call and no key to persist, so a future surface
cannot bind to a selection by accident — the shape that made the P4 fallbacks
invisible is no longer expressible.

- **The sidebar reports instead of scoping.** `ClusterStatus` is a chip reading
  `Cluster · N nodes · M online`, plus a degraded count (offline, refusing this
  session, or needing a re-auth). It navigates to Cluster and sets nothing. In
  the collapsed rail it degrades to the glyph and the node count, keeping the
  only ambient reachability signal that rail ever had.
- **A node that refuses the session is reported, not a gate.** `NodeAccessNotice`
  lists those nodes above the content with the one action each admits —
  *Re-authorize* for a lapsed session, *Details* for a terminal role refusal —
  while the rest of the cluster stays usable. It is driven by the SESSION
  records, not the host list: a node that refuses us contributes no `GET /hosts`
  row, so reading the host list would drop the very nodes it exists to name.
  - **A node we couldn't REACH is not a node that refused us** and is absent
    here. Its session lands on `expired/unreachable`, which says nothing about
    whether we'd be let in; that is `ClusterReach`'s "didn't answer".
  - The identity probe now separates the three answers it can get. A **403** is
    the node answering and refusing the role — terminal, `denied`. A 401 is a
    lapsed sign-in. Anything else is unreachable. Every 403 used to be recorded
    as `expired/unreachable`, which made `denied` unreachable in practice and
    offered a re-auth that could not have helped.
- **Servers and Audit read the whole cluster.** The sidebar's scope no longer
  narrows them upstream; each keeps its own local Node field, which narrows that
  list and nothing else.
- **Cluster keeps a node subject, taken from the URL.** Peer writes (federate,
  enable/disable, unfederate) edit one node's peer list, so they name it: the
  node you have open, else the only one you can manage. `AddNodeModal` asks which
  node to federate through when several are manageable, and blocks until told —
  the same sole-candidate rule as the install modal. The per-node "Set as active
  scope" menu item and the "active" tags went with the store.

**Done when:** no code can express "the current node". — *Verified live in
Chromium (14 checks): with two nodes and no selection the switcher is absent, the
chip reads `2 nodes · 2 online`, both nodes' servers render, clicking the chip
navigates to Cluster and writes nothing, the collapsed rail fits, and the Servers
toolbar still offers its own three-option Node filter. A node stubbed to refuse
with 403 is reported as a named row while the healthy node's servers stay on
screen — no full-page takeover. Lint 0 errors, build clean, smoke 257/257, which
now also asserts the store, the hook and the scope helper no longer exist.*

---

## 5 · Risks

| Risk | Handling |
|---|---|
| A node drops out of the fan-out and reads as deleted data | P2's reachability summary is a hard prerequisite for P5 |
| `CONNECTIONS` becoming live breaks the read-once assumption | P1 grows it in place and notifies holders; P4 removed the module-load snapshots, so every consumer resolves per call |
| Roster mirroring registers an unreachable node | Keep the existing `alive` + `reachable` gate; a ghost row is the honest outcome |
| Placement recommends a node that fills up before install | Peers decision 24: accept the race, fail honestly at start time |
| Per-node auth failure becomes invisible without a selector | P5's per-node degradation list; fail-closed auth stays distinct from fail-open availability (decisions 25/26) |
