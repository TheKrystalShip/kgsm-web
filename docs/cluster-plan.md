# Cluster Federation — SPA Plan (kgsm-web)

> The browser side of the KGSM cluster: the companion to the backend's
> **`kgsm-api/PLAN-peers.md`**. That doc owns the node-to-node mesh (roster gossip,
> shared-secret trust, the SSO vouch, cluster-wide logout); **this doc owns everything
> the browser does** — populating the node registry from a converged roster ("add one,
> see all"), one Discord login across the whole cluster (lazy vouch-on-401), the Cluster
> page, cross-node install, and the honest rendering of membership.
>
> Present-tense canon: describes how each piece works when built. Phase status lives in
> the legend; the backend phase each SPA phase rides on is named inline. Authority for the
> wire contracts is `WIRING.md` (front↔back ledger) + `kgsm-api/PLAN-peers.md §7`.

---

## Status legend
`built` = exists & verified · `partial` = exists, incomplete · `planned` = designed,
not built · `blocked` = designed, waiting on a named API dependency · `open` = not yet
decided.

---

## 1 · The vision, SPA side

Two experiences, both "one action, whole cluster":

- **Add one, see all.** A user connects the SPA to **one** node's URL. The SPA pulls that
  node's converged roster and auto-populates its node registry with the **whole cluster**,
  each entry addressed by its browser-reachable advertised URL. A new user who logs into any
  node sees the admin-built cluster already assembled, scoped to their tier — no per-node setup.
- **One login, whole cluster.** A user authenticates **once**, at any node. As the SPA
  touches a node it has no session for, that session is provisioned transparently (lazy vouch
  on the first `401`) and the call retries. "Sign out everywhere" revokes across the cluster.

The SPA stays what it already is — a **direct multi-host client** (per-node session, per-node
SSE, the browser fans out and merges client-side; there is no `/fleet` endpoint,
`WIRING.md §8`). The cluster work does not add a server-side rollup; it automates the N logins
and the N registry entries.

---

## 2 · Current reality (the honest baseline)

What already exists is more than it looks, and less:

- **Multi-host read fan-out is built.** `api.fanOut(path)` (`src/lib/apiClient.js`) fans a GET
  across every connection and `src/lib/merge.js` merges the results (`mergeHosts/mergeServers/
  mergeAlerts/mergeLibrary/mergeAuditRows`). The registry (`src/lib/config.js`,
  `krystal:hosts:registry`, entries `{id, url, name}` — **URLs only, never tokens**) and
  per-host SSE (`src/lib/liveStream.js`) are per-connection already.
- **But auth is effectively single-host.** Per-host token routing at N≥2 is deferred
  (`WIRING.md §8`, `:216/:338/:731`), and the connect screen **actively blocks adding a second
  host** (`src/pages/HostAccess.jsx:32-33,87-92`). Tokens live per host id in `sessionStore.js`
  (access → `sessionStorage krystal:hostsession:<id>`, refresh → `localStorage
  krystal:hostrefresh:<id>`), but nothing populates a second host's tokens. So today the SPA
  talks to exactly one authenticated backend.

**Consequence that shapes the phasing:** the SSO phase (**SPA-C1**) is not an add-on — it is the
piece that makes N≥2 real. The fan-out/merge machinery is waiting behind it. Read phases before
it (C0/C0.5) are admin-visible or read-only; the cluster becomes genuinely usable at C1.

There are **no fixtures and no MOCK mode** — the only distinction is `CONNECTIONS.length`
(0 → the connect screen; ≥1 → live; ≥2 → fan-out). Do not reintroduce a mock duality.

---

## 3 · API dependencies (the SPA-facing endpoints)

The backend owns the node-to-node half of P0/P0.5/P1, plus two **SPA-facing** endpoints — both
`built` in `kgsm-api` and folded into `PLAN-peers.md §7`. The client seam for G1 is wired
(`api.peers(id).roster()`, consumed by `clusterStore`); the remaining work behind each is SPA-side.

| # | Endpoint | Why the SPA needs it | Consumed by |
|---|---|---|---|
| **G1** | **A viewer-readable node list** — `GET /api/v1/peers/roster` (viewer-gated). The admin `GET /api/v1/peers` (`PeersController.cs:196`) exposes management detail (gossip URL, enabled flag, apiVersion) a viewer shouldn't see. | "Add one, see all" works for **any** authenticated user (viewer/operator), tier-scoped. The lean, viewer-tier read of the converged roster: `{ nodeId, label, clientUrl (advertised, browser-reachable), membership, status, latencyMs }`, enabled peers only. | SPA-C0.5 (roster mirror), the non-admin Cluster page |
| **G2** | **A user-authed vouch *initiator*** — `POST /auth/cluster-session/request { nodeId }`. Wraps the node-to-node *receiver* (`POST /auth/cluster-session`, cluster-token authed — the SPA holds no cluster secret). Identity/tier come from the caller's own session, never the body. | Lazy vouch-on-401: the SPA, hitting node B with no B session, asks a node it **is** logged into (A) to vouch it onto B. A relays to B's receiver and returns B's tokens. | SPA-C1 (SSO) |

**Already satisfied — no gap:** cluster-wide logout. `POST /auth/session/revoke { all: true }`
(user-authed, `SessionController`) already fans `session.revoke` out over the bus to alive peers.
The SPA's "sign out everywhere" calls it and then clears its own local tokens across nodes.

---

## 4 · Terminology (align the UI to the backend)

| Concept | UI term |
|---|---|
| A connected kgsm-api deployment | **Node** (was "host") |
| The federation of nodes | **Cluster** |
| The connection registry (`krystal:hosts:registry`) | the **node registry** |
| The `#/cluster` page | the **Cluster page** |

Cluster is the canonical vocabulary: `route.kind` is `"cluster"`, the capability is `nav.cluster`, and
the URL is `#/cluster` (the pre-cluster `#/diagnostics`/`#/hosts` words still resolve). The **localStorage
key** `krystal:hosts:registry` and the entry shape `{id, url, name}` stay as-is — renaming the key buys
nothing and costs a migration; the entry is already a generic node. (If a rename is ever wanted, gate it
behind a one-time in-place migration, per `PLAN-peers.md §8`.)

---

## 5 · The seams (where each change lands)

| Concern | File(s) · anchor |
|---|---|
| Node registry (add/list/reconcile, `CONNECTIONS`) | `src/lib/config.js` (`REGISTRY_KEY`, `CONNECTIONS`, `connOf`, `reconcileConnectionId`), `src/lib/connect.js` (`addConnection`) |
| Per-node tokens | `src/lib/sessionStore.js` (`adoptSession`, `writeSession/writeRefresh`, `signOut`, `forgetHosts`) |
| **The 401 heal seam → lazy vouch plugs in here** | `src/lib/apiClient.js` `hostScoped().withRetry` (`:507-511`) |
| API client / per-node calls / fan-out | `src/lib/apiClient.js` (`liveFetch`, `api.host(id)`, `api.fanOut`, `sessionsScoped`), `src/lib/merge.js` |
| Per-node SSE | `src/lib/liveStream.js`, `openPrimary` in `apiClient.js` |
| Routing + nav | `src/lib/router.js` (`kind:"cluster"`), `src/components/AppRouter.jsx`, `src/components/Sidebar.jsx`, `src/components/Breadcrumb.jsx` |
| The Cluster page | `src/pages/DiagnosticsPage.jsx` (`ClusterPage` + `ClusterPanel`) + `src/pages/diagnostics/diagHostCards.jsx` |
| Active Sessions | `src/pages/SettingsSessions.jsx`, `api.sessions(id)` in `apiClient.js` |
| Connect screen + the N≥2 block | `src/pages/HostAccess.jsx` (`AddHostPage`, `:32-33,87-92`) |
| Cross-node install | `src/components/InstallModal.jsx`, `src/lib/servers.js` (`offeringHosts`) |

State pattern: a domain store under `src/lib/stores/*` (hand-rolled `createStore`/`useStore`),
pages subscribe via `useStore`, only `apiClient.js` touches the backend. New reads (the roster)
get a `src/lib/stores/cluster.js` store, not ad-hoc fetches in a page.

---

## 6 · Phased delivery

Each SPA phase rides on the same-named backend phase in `PLAN-peers.md`.

### SPA-C0 — Cluster page + terminology (admin management) · `built`
Rides on API **P0** (`built`). No new API dependency — uses the admin `/peers` surface.
- **Fleet → Cluster.** Cluster is the canonical vocabulary — `route.kind:"cluster"`, `nav.cluster`,
  `#/cluster`, and the nav/header/breadcrumb all read "Cluster". The pre-cluster `#/diagnostics`/`#/hosts`
  URL words still resolve; `ClusterPage` is the page component (`DiagnosticsPage.jsx`).
- **The Cluster page** lists the local node + peers from `GET /api/v1/peers` (admin) with honest
  **membership** (alive/joining/suspect/dead/left) + **status** (reachable/unreachable/disabled) +
  **latency** badges. Admin add/remove/enable/disable wire to `POST /peers`, `DELETE /peers/{id}`,
  `PATCH /peers/{id}` — the real peer roster, distinct from the current in-memory
  `hostsStore.add(skeleton)` stub (`DiagnosticsPage.jsx:68`).
- New `src/lib/stores/cluster.js` + `api.peers(id)` surface (`list/add/remove/setEnabled`).
- **Admin-only this phase** (the read is admin-gated until G1). Non-admins see the cluster at C0.5.
- **Validation:** a gated `#/cluster` route in `smoke-live.mjs` + admin CRUD against a live api
  that has one peer added.

### SPA-C0.5 — "Add one, see all" roster mirror · `planned` (API **G1** `built`)
Rides on API **P0.5** (`built` — the converged roster). G1 (viewer node list) is `built` and its client
seam is wired (`api.peers(id).roster()` → `clusterStore`); the registry-mirror below is the SPA work left.
Sequence it **with or after SPA-C1** — auto-populating peers into the fan-out registry before SSO would
add nodes the SPA can't yet authenticate to.
- On connect+auth to one node, the SPA pulls that node's roster (G1) and calls `addConnection`
  for each peer, addressed by its **advertised client URL** (`PLAN-peers.md §2 #13a`) — never the
  node-to-node gossip URL, or the browser can't reach it. The whole cluster appears in the registry
  from one connect.
- **Honest membership rendering:** a gossip-learned `joining`/hearsay peer renders provisional
  (not a plain "online"); `suspect`/`dead`/`left` render as such. Never fabricate a node's liveness
  (the [no-hardcoded-backend-data] principle — the SPA shows what the roster says, or "unknown").
- **CORS preflight-warn — `built`.** For the browser to call a peer directly, that peer's
  `KGSM_API_CORS_ORIGINS` must list the SPA origin. `ClusterPanel` probes each peer from the browser
  (`fetch(clientUrl + "/api/v1", { mode: "cors" })`) and shows an amber warning on the row on a
  CORS/reachability failure — a browser-reachability axis rendered *alongside* the backend node-to-node
  status chip, never conflated with it (validated against seeded unreachable peers).
- **Validation:** a two-node live check (connect to A, assert B appears in the registry via its
  advertised URL); a peer with a mismatched CORS origin surfaces the warning.

### SPA-C1 — Single sign-on (the N≥2 unblock) · `partial` (API **G2** `built`)
Rides on API **P1** (`built` — vouch receiver + bus logout). G2 (vouch initiator) is `built`.

**The vouch ENGINE is `built`** (dormant at N=1, verified no-regression): a loop-safe, deduped,
tier-resolving `sessionStore.vouch(targetId)` + `api.vouch(sourceId, targetNodeId)` + a hook in
`apiClient.js` `hostScoped().withRetry`. On a 401 for a node with no session, it asks a **live sibling**
(any registry node the SPA already holds a session on) to vouch the user onto the target
(`POST /auth/cluster-session/request { nodeId }`), adopts the minted `{accessToken, refreshToken}`,
resolves the tier via the target's `/me` (the vouch result carries no tier), then retries once.
`vouch()` returns `true` only on a *fresh* mint — an already-live target or a missing live sibling
returns `false` fast, so at N=1 the path is a pure no-op and it can never loop. Vouch storm is bounded
by a per-target in-flight map (`vouchInflight`).

> **C0.5 ⊕ C1 are one unit — the `nodeId` dependency.** Lazy-vouch keys on the target's **`nodeId`**,
> but a *manually*-added auth-enabled peer can't surface its `nodeId` before it has a session (the
> `GET /api/v1` handshake doesn't carry it). The `nodeId` arrives via the **C0.5 roster mirror** (each
> roster row carries `nodeId` + advertised `clientUrl`). So the roster mirror populates vouchable
> targets and lazy-vouch authenticates them: neither delivers "add one, see all, one login" alone.

**`built` (verified at N=1, degrade-safe):**
- **Sign-out fixed** — app-level "Sign out" now revokes this device's session on every node the SPA
  holds one and clears all per-host credentials (closed a real gap: it used to revoke nothing and leave
  the refresh token behind; it also called the non-existent `sessionStore.forget`).
- **Cross-node "Active sessions"** in `SettingsSessions.jsx` — fans the list across every node the SPA
  holds a live session on; this browser's own sessions collapse into one "This device" row, other devices
  render per-node, partial fetch failures degrade to an honest note. Identical to today at N=1.

**Still to wire (needs a two-node auth-enabled rig to validate):**
- **Roster→registry mirror (C0.5):** on connect+auth, `addConnection` each peer from `GET /peers/roster`
  keyed by `nodeId`, addressed by advertised `clientUrl`.
- **Drop the N≥2 guard** in `AddHostPage` (`HostAccess.jsx`) — sequence it with the mirror so a second
  node is a vouchable peer, not an id-less unauthable entry.
- **Validation (two-node):** log into A, navigate to a B-scoped view → transparent vouch (the engine)
  → B session minted, view renders; "sign out everywhere" clears A and B locally and the peer session is
  revoked over the bus; N≥2 connect works end-to-end. The roster mirror + guard drop close this loop.

### SPA-C2 — Cross-node resource visibility + cross-node install · `planned`
Rides on API **P2** (`planned`). Largely automatic once C1 gives the SPA a session per node.
- **Per-node resources stay on per-node pages** (`PLAN-peers.md §8`) — once a node is connected +
  vouched, its existing detail/Performance/Services pages render unchanged. The Cluster page keeps
  **no resource dashboard** (no server-side rollup).
- **Cross-node install:** populate `InstallModal`'s node dropdown (`InstallModal.jsx:100-112`,
  `servers.js offeringHosts`) from the cluster roster, not just the in-memory `hostsStore`. Selecting
  a peer makes the install POST go **directly** to that peer (`api.host(peerId)`, which now holds a
  vouched session) — the source node drops out of the loop.
- **Validation:** install a server onto a peer selected in the modal; assert it lands on the peer.

### SPA-C3 — Placement recommendation · `planned`
Rides on API **P3** (`planned`).
- When a node reports it is full and the API advises a peer with headroom, the SPA surfaces the
  suggestion and opens the **target peer's** install form pre-filled (talking directly to the target,
  which validates-at-use). A thin UI over C2's cross-node install.

### SPA-C4 — Federated assistant · `planned`
Rides on API **P4** (`planned`). Mostly backend (the `nodeId` tool param + service-token relay).
- The assistant chat already exists; the SPA change is small — render cross-node answers with their
  **node attribution** and keep the two-axis honesty (a non-`alive` peer's data is never presented as
  fact; a fan-out answer degrades to a partial, never a fabricated node state).

### SPA-C5 — Cross-node audit · `open`
Rides on API **P5** (`open`). Mostly built already on the SPA side.
- An "all cluster events" view is a **client-side fan-out**: `merge.mergeAuditRows` already unions
  `/audit` across connections (`merge.js:58-68`). This matches the keystone's client-side-rollup rule
  (no server-side cluster audit store). Deferred pending the API P5 shape.

---

## 7 · Validation strategy

The SPA has **no unit-test runner and no typecheck** — the gates are `npm run lint` (0 errors),
`npm run build`, and `npm run smoke` (`scripts/smoke-live.mjs`, jsdom against a running
auth-disabled kgsm-api). Smoke stands up a **single** seeded host, so it covers per-node contracts,
gated routes, and render — extend it with a gated `#/cluster` case (as the sessions milestone added
`#/settings`). **Multi-node behaviors (roster mirror, vouch-on-401, cross-node install) cannot be
proven by single-host smoke** — validate them with a two-node live check against two real kgsm-api
instances (the same way P0.5/P1 were validated on the backend) plus `merge.js`-level reasoning.
Visual/layout regressions go through the out-of-repo Playwright harness (`../scripts/visual-harness/`).

---

## 8 · Open items

1. **Registry key rename.** Kept as UI-vocabulary-only (§4). Revisit only if a durable reason to
   rename `krystal:hosts:registry` appears; if so, ship a one-time in-place migration.
2. **Per-device identity for session aggregation.** "One row per browser, cluster-wide" aggregates
   the SPA's **own** known sessions (it holds the tokens). Presenting another device as a single
   cluster-wide row would need a stable device id threaded through the vouch — deferred; per-node rows
   are the honest fallback (mirrors the backend's deferred per-device *cluster* revoke).
3. **Advertised-URL trust.** The SPA addresses peers by the roster's advertised client URL. If a node
   advertises an unreachable/wrong URL, the CORS preflight-warn (C0.5) is the surfaced signal — decide
   whether a persistently-unreachable advertised peer is hidden or shown disabled-with-reason.
4. **Vouch storm on cold start.** Lazy vouch-on-401 across many nodes at once (e.g. a cluster-wide
   view loading) could fan out N vouches. Decide whether to serialize/debounce vouches per target and
   cache the "no session yet" state so one 401 per node triggers at most one in-flight vouch.
