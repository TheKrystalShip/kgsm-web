# src/lib/ — the data layer & policy

Everything that isn't a React view lives here: the backend seam, the reactive
stores, the honesty boundary, auth/RBAC policy, and the URL router. **Components
and pages never touch `fetch` or the API directly — they go through a store, and
stores go through `apiClient`.** There is exactly ONE data path: the app always talks to real
`kgsm-api`(s), with no fixtures and no mode switch. The assistant is a separate backend reached on its
own seam (`assistantClient.js`), never through kgsm-api.

## The one data path

```
component/page ──useStore──▶ domainStore ──▶ api.get/post/patch ──▶ adapters ──▶ store
                                (stores/)      (apiClient.js)      (adapters.js)
realtime: liveStream.js (fetch-SSE) ──adaptStreamMessage──▶ same stores
```

## File map

**Backend seam & realtime**
- `authorizedFetch.js` — the **one place a bearer is attached to a request**, and the reason no other
  module has to remember to renew one. `authorized(cred)` takes a CREDENTIAL — `{ get, rotate }` —
  never a token, and that signature is the whole design: a function handed a token can only spend it
  and report the refusal, which is how a call comes to be made with a bearer that died while a tab
  sat idle. Three modes, and the choice is about the REQUEST rather than the token: `json` may be
  sent twice, so a 401 renews once and replays it; `once` may not, so the refusal stands; `stream`
  resolves the bearer at each dial and re-dials once through a renewal. A lapsed `exp` renews ahead
  of every mode — that spends no request — and a refusal is still the authority, since a token can be
  refused for reasons its own `exp` knows nothing about. Answers `{ ok, status, body }` and throws
  nothing, so an unreachable host (`status: 0`) and a session that has ended (`unauthenticated`) stay
  different sentences. **Imports nothing but the design system's `lib/sse`**, which is what lets the
  standalone assistant
  use it. `npm run check:egress` covers every mode; the ESLint egress rules are what stop a second
  implementation appearing beside it.
- `apiClient.js` — the **single** kgsm-api seam. `api.get/post/patch`, per-host
  `api.host(id)` (401-retry / silent renew), `api.fanOut` (multi-host roll-up),
  `api.stream` (subscribe). Owns `connectionStore`
  (REST reachability → cold-start/banner) and `realtimeStore` (per-host SSE
  state). **Every call site only ever sees `api`.** Every stream frame it
  dispatches carries `hostId` — the node whose socket delivered it — so a
  listener never has to guess which node produced an event.

  **`accountDoor()` is where an account call is addressed**, and the only place that decides it:
  the cluster's sign-in provider, under `/auth/cluster/users`. A write that landed in a member's
  read-only replica would be overwritten by the next thing the provider published, so it would
  appear to work and then quietly not have — and every member refuses those calls on that basis. A
  panel knowing no provider refuses the call rather than guessing a member. `api.users` and
  `api.sessions` resolve through it per call; `api.sessions` is the `auth:accounts.disable` view of somebody
  else's sessions, scoped under their account, so ending one asks "is this session that person's"
  rather than "does this session exist". A person's OWN sessions are the provider's account page's.
  `api.authority` goes through the same door: the authority the management pages read, one edit at a
  time against the version it was read at (a stale one answers `409` with the authority as it stands,
  on `e.body`), the rules' verdict on edits nobody has made (`check`), and the caller's own `auth:*`
  answer. A call to the provider leaves the connection signal alone: it is not a node this panel
  drives, and its reachability is not a node's.
- `liveStream.js` — fetch-based SSE. One
  primary stream per host + per-view dynamic streams; drives `realtimeStore` via
  `onMode`.
- `alertsApi.js` — alerts fetch/stream glue, plus `alertHost` / `alertInScope`: which node an
  alert belongs to and whether it falls under a scope. Those two live here rather than beside the
  components that render alerts because the capability layer asks the same question, and a library
  reaching up into a component drags the render tree into every consumer of it — including the
  `check:*` scripts, which load these modules outside a browser and cannot parse JSX.

**The assistant seam (a separate backend)**
- `assistantClient.js` — the seam onto an assistant **leaf**, spoken directly on its own
  public origin. `assistant.host(id)` mirrors `api.host(id)`'s shape against the leaf's own
  unprefixed routes (`/turn`, `/confirm`, `/conversations`, `/events`, `/review/conversations/…`).
  It records the id the leaf's `/events` stream hands out and sends it on **every** call as
  `X-Assistant-Origin`, so the events a call causes come back stamped and the surface that made
  it can decline to re-apply its own change. The id is per-connection, not per-host: it is
  dropped when the stream ends, because stamping calls with a stream nothing is listening on
  would make a surface skip echoes it never received. Reconnection and the resync that must
  follow a gap belong to the design system's `useConversationStream`, not here — the seam carries one
  stream and reports when it ends.
  Auth is reactive like the node seam, except the two non-replayable calls — a turn spends
  the user's prompt and a confirm burns a single-use token, so a lapsed access token is
  rotated **before** the call rather than healed from a 401.
  **Speech is here too**: `speech()` asks what the host's engine can do (`{ hear, speak }`) and
  `transcribe(pcm)` posts one voice note as raw bytes. Ask before offering a microphone — a recording
  made on a host that cannot listen is one nobody can read — and note the transcript comes **back**
  to the composer rather than becoming a turn.
  **No fallback:** a host whose capability names no public origin throws `ENOROUTE`. Routing
  the call through kgsm-api's relay instead would restore exactly the coupling this seam
  removes, and the relay is peer transport for another node's assistant.
- `assistants.js` — WHICH assistants this browser can address, and where each one lives. An
  assistant is a **leaf** on a node, discovered from that node's `assistant` capability, or an
  **anchor** — a member of the cluster holding the cluster's `assistant` capability at its own
  member address. Both appear in one list, because a cluster can have both and only a person can
  say which one they mean. The anchor is found through the capability ASSIGNMENT rather than off
  whichever member states an address: only the holder is believed, so pointing this browser
  somewhere else takes a visible reassignment. Pure — every fact arrives as an argument.
  `assistantForHost(targets, hostId)` is the **one gate** behind every "ask the assistant"
  affordance — the cluster's own answers about every node in it, a leaf only about the machine it
  runs on — and the dock resolves its own target through the same list, so a button that offers to
  ask and the dock that would answer cannot disagree about whether there is one.
- `assistantSession.js` — which credential an assistant is spoken to with, and where it is. None
  of its own: every assistant accepts the cluster's session, a leaf verifying it against the host
  file its node writes and an anchor through the holder of the accounts. Both halves are installed
  by the surface — `setCredential` (the panel's `sessionStore`, or the standalone assistant's own
  client of the provider) and `setTargetResolver` (where an assistant is) — because resolving either
  here would mean this module importing the stores, which the standalone surface may not reach.

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

**Preferences** — `stores/prefs.js` holds the account's preferences **local-first**: localStorage is
what the app reads (synchronously, on the first render — the dashboard decides what to mount from
it), and the node is where the value is kept so it outlives the browser and can follow the person.
A write lands locally and returns; the PUT is best-effort and a failure loses nothing.
**Seeding a default is a WRITE, so nothing may seed before the node has answered** — doing so
publishes a default over the stored value. `dashboardStore.hydrate` encodes the ordering, and
`boot.js` hydrates preferences only after `hostsStore.refresh` has reconciled the connection's
backend id, since the home node is addressed by that id.

**Stores** — see `stores/CLAUDE.md`. The tiny reactive primitive (`createStore` + `useStore`,
React 18 `useSyncExternalStore`) is the design system's, imported here from
`@thekrystalship/krystal-ui/lib/store` — the import-free subpath, never the package barrel, because
the `check:*` scripts load this layer in Node. `stores.js` re-exports `stores/` — import from either.

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
  reload) and `reconcileRosterToRegistry`, which keeps the driven node set equal to
  the cluster's: it registers the alive+reachable peers a roster names (dedupes
  against the registry AND the live connection set, so a seeded node is never
  registered twice under a second address) and drops the roster-learned ones a
  roster no longer names. **Leaving the cluster and being unwell are different
  states and must not be collapsed** — an unreachable or suspect MEMBER keeps its
  connection so the banners and the reach footnote can report it; only absence from
  the roster (or `enabled:false`, set under `api:members.manage`) removes a node. An address a person
  typed is theirs to remove (`via` records which is which). `devSeedAutoConnect`
  for auth-disabled dev.

**Auth / RBAC / capabilities**
- `oidc.js` — how a surface finds the cluster's sign-in provider and holds a session from it, over
  `oidc-client-ts`. `discoverProvider(address)` asks a member's protected-resource document and,
  failing that, whether the address is the provider itself; `clientIdFor(origin)` is the client id a
  page signs in as (its origin's host, `-port` when named); `createClient` builds the library's
  client with the session in `localStorage` and a round trip's `state` in `sessionStorage`; `renew`
  is the refresh grant, telling a provider that REFUSED apart from one that could not be asked, and
  re-reading storage once before believing a refusal, because every tab shares the stored session.
  **Imports nothing but the library**, so the standalone assistant holds its session through it too.
- `provider.js` — the one stored fact about where the panel signs in (`krystal:provider`: the
  issuer, and the address that named it). Its presence is also what says the provider names the
  fleet. Imports nothing, so the connection modules can read it beneath the session layer.
- `anchor.js` — what the panel asks the provider: `clusterMembers` (the fleet), authorized by a
  **credential the caller passes in** — the credential rather than a token is what keeps this module
  underneath the session layer while still leaving the call able to renew itself — and
  `configuredAnchor`, the build's own cluster address for a static deployment.
- `clusterSignIn.js` — what the panel does once it holds a session: the fleet, who this person is
  (`GET /me` on the home node), and the first hydrate. The session is held first, because it is valid
  on its signature and nothing a member says makes it more so.
- `componentSurface.js` — a COMPONENT's own configuration, unit, journal and command manifest,
  behind one shape whichever transport reaches it. A component owns all of that wherever it runs;
  what differs is only how a browser gets to it, and this is the whole of that difference. Each
  surface also says what a change on it needs (`configWrite`: the leaf's `<leaf>:config.write` on its
  node, the engine's `kgsm:engine.config.write`, or an anchor's own at the cluster), so the shared
  configuration page closes itself for anybody lacking it.
  `anchorSurface({address, capability})` calls the member's own origin with `clusterCredential`,
  under the route prefix that capability serves — a capability with no entry there has no
  browser-reachable surface, and the page says so rather than guessing a path that would 404 on
  every tab. `leafSurface({hostId, leafId})` goes through the node running it. The journal is
  deliberately absent from the leaf surface: a leaf's comes off the keyed log store so a page and a
  pinned widget share one hydrate and one subscription, and a second reader here would fetch it
  again beside that one. The pages that mount it are `pages/component/`.
- `fleet.js` — which nodes the panel drives, and whether that has been asked yet. The answer is the
  PROVIDER's and nobody else's, asked on every load and kept nowhere: a node the cluster no longer
  names is gone on the next one. `fleetStore` exists so the shell can tell "no hosts" from "nobody
  has been asked", which are the same empty set and opposite answers. A member's own roster is read
  for health and capabilities and never to decide who is driven. A host run with auth off names no
  provider, keeps its one node in storage and never runs any of this.
- `sessionStore.js` — **ONE session**, and `clusterCredential`, which is that session as something a
  call can be authorized BY. The provider mints it and renews it through the refresh grant; every
  member accepts it by verifying the provider's signature against the published key; no member ever
  issues this browser a credential or extends one — a member that could would be a second door to the
  same session on every machine in the cluster, permanently. `restore` and `completeSignIn` settle it
  at boot, `signIn` and `signOut` leave for the provider, `anchorOrigin()` is the provider's origin the
  account surfaces address, and `accountPage()` is where a person changes their own credentials.
  **A session proves who, never what.** It holds where the account stands (`accountOf`: active,
  pending, unknown) and nothing about what it may do. A provider session is active by construction —
  the provider gives one to nothing else — so a member's own view of the account never turns the panel
  away: a member that has no account for this person has said nothing about the account, and a
  `me.patch` saying `unknown` is ignored. What the person may do is `stores/access.js`.
  **A member's refusal is not the session's.** `nodes` records who is currently honouring it, which
  is a different fact: a member that has not yet heard which key and issuer to verify against
  refuses a good session with a **401**, which is ambiguous until a renewal settles it and is recorded
  against the member only once a fresh session is still refused. A **403** names one action the
  person does not hold for that request; it says nothing about the session or the member and is
  recorded nowhere.
- `authStorage.js` — the app-shell user read/write, and the two one-shots the gate reads after a
  navigation: what the provider said when it sent the browser back without a session, and that a
  session ended while the panel was open.
- `access.js` — looking an action up in a member's `/me/access` answer. Each browser-facing member
  answers for what it holds, already evaluated: a node for its own components' actions at the cluster,
  itself and each instance (keyed `<node>/<id>#<install nonce>`), the auth anchor for `auth:*`, and
  every other anchor for its own namespace (`dns:*`, `assistant:*`, read from the capability's holder
  by `anchorAccess.js`). `owner` in a report is the one answer a list cannot give: an Owner performs
  actions no manifest declares. **Holds no copy of the rules**, and imports nothing, which is what lets
  the standalone assistant gate on its own `/me/access` with it.
- `operations.js` — which action a request needs, as the member serving it publishes. Every member
  publishes its operations from the metadata it enforces with — kgsm-api at `GET /api/v1/operations`,
  the auth anchor at `GET /auth/cluster/operations`, the DNS anchor and the assistant at
  `GET /operations` — and `requirementOf(manifest, method, path, body)` returns the entries a request
  matches, each filled from the path. A literal route segment is more specific than a parameter, an
  entry with a `field` applies when the body carries it, and every entry matched must be held. **The
  panel names no action**: the only string it shares with a member is the route it already calls.
  Imports nothing, for the same reason as `access.js`.
- `assistantGate.js` — `useAssistantGate(targetId)`: one assistant's operations and `/me/access`,
  read together, and `mayCall(method, path, body)` over them. The dock and the standalone page both ask
  the assistant they are talking to, so a person holds the same power on either.
- `persona.js` — the authorization **policy**, over `operations.js` and `access.js`.
  `mayCall(member, method, path, opts)` is the question, asked about the request a control would make;
  a member is `{ hostId }` or an anchor's namespace (`"auth"`, `"dns"`), and `opts` carries the `body`,
  the `server` a server route is about (its install is the target), a `target` for a request scoped by
  its own body (an assignment's), or `anywhere: true` for what a nav entry asks. A segment the question
  does not care about is `_`. Asking with the server in hand is what lets a grant on one server open
  that server's controls and no other's. `can(cap, target)` names the request behind a navigation or
  control capability (`CAP_REQUESTS`); `serverTabOffered` and `nodeTabOffered` say which tabs a server
  or a node offers, each behind the read it makes; `serverOperable`/`serverAssignable` are the two
  per-server questions; `isOwner()` the one no operation answers. **A write control whose request is
  not held stays on screen, closed, naming the action the member published** — `callRefusal` is that
  sentence, `serverCallRefusal(server, method, subpath, body)` it for a server route, and
  `verbRefusal(server, verb)` it for the command request a lifecycle verb sends, which `verbGuard`
  asks first. A tab is hidden when its read is not held; a control inside one never is. A request the
  member does not publish is closed and recorded (`unpublishedRequests()`), and the smoke fails on any
  — that is what makes a gate that drifted from its member impossible to ship. `may(action)` remains
  only for an action a member hands over as data. Where a surface needs to know whether a MEMBER will
  honour the session at all, that is `sessionStore.nodeRefusal(id)` and a different fact.
  `resolveRoute()` is the routing chokepoint.
- `anchorAccess.js` — what the caller may do with an anchor holding a capability other than `auth`:
  `GET /me/access` at the capability holder's own origin, with the cluster session. The holder comes
  from the capability assignment, so an answer follows a failover.
- `capabilities.js` — per-host services (metrics / assistant / watchdog), each
  `provisioned` (offered?) × `status` (live health). A node's assistant capability is one of the two
  places an assistant is found; `assistants.js` joins it with the cluster's, and there is no central
  fallback for either. An assistant whose capability names no public origin reads **down**, because
  the browser has nowhere to send a turn however healthy the leaf is.

**Routing & presentation helpers**
- `router.js` — pure URL-hash ↔ `route` object bridge (framework-free). Full URL
  scheme documented in-file.
- The theme preference — the LIVE swap of `<html data-theme>` and `THEME_OPTS`, the offered themes
  every picker reads — is the design system's `lib/theme`, and its own comments describe the fields a
  theme carries (`mode`, `cvd`, `tribute`). Mirror the `index.html` / `assistant.html` boot scripts
  when a pin brings a changed list.
- `formatting.js` — the pure formatters, and **the two bindings that turn an audit row
  into pixels**. Both key on a DIMENSION the row carries and never on the event's name:
  `auditTone` reads the severity its producer stamped (`info｜warn｜danger`, with `outcome`
  separating a good routine fact from a neutral one; absent reads `info`, never a guess),
  and `eventIcon` walks a prefix trie over the dotted name where every node is a
  NAMESPACE. A segment matches a key when it STARTS WITH it, so one node covers a verb in
  every tense; the longest key wins at each level and an unrecognised segment falls back to
  the namespace above it, down to a root `circle-dot`. `humanizeAction` spells the name for
  a person and `auditCategories` derives the filter's options from a served vocabulary, or
  from the rows in hand when the feed carries none. **Nothing here holds a per-event-type
  entry** — a table with one arm per event has a missing arm for every event nobody has
  added yet, and a missing arm paints a destructive act neutral. Authority:
  `/home/heisen/tks/event-display-contract.md`.
- `labels.js` / `art.js` / `servers.js` / `leaves.js` —
  display-label vocabulary (including `ROUTE_TABS`, every tabbed
  route's sub-tabs — read by the page that draws the strip AND by the breadcrumb
  that names the tab in the URL, so the two cannot disagree; `anchorTabs`/`anchorOffersTab` pick a
  member's subset from `ROUTE_TABS.anchor`, because an anchor's page is shaped by the capability it
  holds and both readers have to agree about which tabs exist), key-art helpers,
  server-shape helpers,
  and the leaf vocabulary (run-state → tone+label, iconography, kind). `leaves.js`
  lives here rather than beside any one surface because the Services board, the
  leaf page and the leaf config page all read it — and because `components/`
  may not import from a page.
- `sorting.js` — the ONE row comparator, shared by `CardTable`'s sortable columns
  and the card grids' toolbar sort. It orders the **value** a column's accessor
  returns (Date → epoch millis, number → numerically, else digit-aware string),
  and treats `null`/`""`/an unparseable date as **missing**: pinned last in BOTH
  directions, never coerced to `0`. **A sort accessor returns the raw value —
  never `x || 0`, and never the formatted text the cell renders.**
- `device.js` — this browser's id for the per-device half of the preference store (`krystal:device`,
  minted once, sent as `X-Krystal-Device` by every call). **A session id is not device identity**:
  sessions are per host and expire, so the same laptop signing in again would read as a new device
  and lose what was stored against it. Imports nothing, so it can never be what drags `apiClient`
  into the standalone bundle.
- `keyedResource.js` — one hydrate and one live subscription per KEY, however many components want
  it (`useKeyedResource(key, hydrate, follow)`). The counterpart to a keyed store: keying lets two
  targets exist at once, this stops N mounts of the same target hydrating N times or one unmount
  disposing what another still holds. The SSE transport already ref-counts topics, so this is about
  the REST hydrate and the store slot.
- `serverActions.js` — `runServerAction(verb, server|id)`: the optimistic patch, the rollback and
  the wording of a lifecycle verb. **Where the outcome goes is a parameter** (`opts.reporter`,
  defaulting to the toast one): one button pressed once wants a toast, twenty servers asked at once
  wants one summary. The other three obligations stay here whoever is reporting —
  `markCommandIssued(server, verb, state)` makes the patch and hands back the undo, and its `state`
  is the honesty boundary: `"running"` for a command that starts within the second, `"queued"` for a
  batch member that may sit behind seven others. Also `requestBackup(server)` (the POST alone, for a surface that
  owns its own busy state and error line — the Backups tab) and `backupServer(server)` (the POST,
  the job wait and the failure report, for one that has nowhere to render an outcome). A module rather than a shell callback because a card that can be
  PINNED has no shell above it to be handed one, and a surface offering Start has to do all three or
  it lies about what happened.
- `widgets/` — the dashboard's composability: `registry.js` (a type → component, params, capability,
  size; it holds no types itself, so `lib/` never imports a page), `layout.js` (the descriptor, the
  breakpoint ladder, and the span rule) and `dashboardStore.js` (the layout, and the only thing that
  writes it).
  **A size floor is a WIDTH (`minPx`), not a column count.** `columnsForPx` converts it against the
  grid's measured width, so one number holds at every breakpoint — a column count means half the row
  on a wide grid and the whole of it on a narrow one, which forces a card to full width exactly where
  there was room for three. `minW` remains for the few whose constraint really is a column count (a
  KPI tile); the wider of the two wins. The span then snaps to the full row only when the remainder
  is narrower than `MIN_USEFUL_COLS`, i.e. when nothing could be placed beside it anyway.
- `batchRun.js` — one verb fired at a SET of servers. A **run** is what a person starts (one verb,
  one cluster-wide set, one outcome); a **batch** is one node's share of it, and the node owns it
  from the moment it accepts. So this mints a `runId`, groups the selection by node, fires one POST
  per node and reconciles the answers — it paces nothing and retries nothing. Three properties:
  the run id is **client-minted** and stored verbatim by every node, which is what lets any client
  reassemble the run afterwards without a coordinator; a node that never answered is reported
  **undispatched, never failed** (its commands were never issued); and each node's `refused[]` is
  the authority for its own servers, so the summary reads the responses rather than the local
  prediction. `cancelRun` is the same shape in reverse — one `DELETE` per node holding a share, of
  **pending** members only — and it carries out what it could NOT stop: a kgsm invocation under way
  is not interruptible, and a node that did not answer the cancel keeps running its share.
- `hooks/useJobPhase.js` — pending work in three states: **idle · queued · running**. Derived once
  and read by every surface that draws a lifecycle button (the tile, the hero, an alert card's
  suggested action), because a fourth derivation is how one of them comes to disagree about a server
  nobody is watching. `useJobPhase` subscribes; `jobPhaseOf` is the same answer for a caller that has
  already returned early and cannot take a hook.
- `registerSW.js` — production-only PWA service-worker registration.
- `push.js` — the browser half of Web Push: capability probe, subscribe/unsubscribe, device list.
  `support()` distinguishes **`needs-install`** from `unsupported`, because on iOS push works only
  for a Home-Screen install and that is a step away rather than a dead end. Two platform rules it
  encodes: permission must come from a user gesture (a load-time prompt earns a permanent refusal
  that cannot be re-prompted), and Chrome's `userVisibleOnly` means every push shows a notification —
  push is not a quiet data channel. A subscription is per HOST (signed by that host's VAPID key), so
  every call is node-scoped. It also carries the per-account event **preferences** — note the
  default: an event with no stored row is ON, so treat a missing entry as yes, never as no.

## The init-order landmine — do not "tidy"

A few base modules **lazily** `import("...")` upper ones (e.g. `apiClient.js`
defers `stores.js`/`sessionStore.js`/`alertsApi.js`) to keep the ESM graph
**acyclic**. Converting one
of these to a static `import` can reintroduce a cycle and break boot. Read the
comment before changing an import.
