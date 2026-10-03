# src/pages/ — pages & routing

One component per route (and per server/host sub-tab). Pages are the **only**
place that composes `lib/` stores + `components/` into a screen. They are all
**lazy-loaded** by `components/AppRouter.jsx` behind a single `<Suspense>`.

## How routing works (the contract)

The URL hash is the source of truth. The pipeline (see `../lib/router.js` for the
full scheme, and `../hooks/useRouteSync.js` for the sync):

```
location.hash  ──parseHash──▶  route {kind, id?, tab?, hostId?, status?, filter?, serverId?, severity?}
route          ──routeToHash──▶ location.hash        (Back/Forward, deep links, refresh all work)
AppRouter: route.kind ──▶ the matching lazy <Page/>
```

- **`route.kind` is the internal vocabulary; the URL word can differ on purpose**
  — `kind:"attention"` ↔ `#/alerts`, `kind:"chat"` ↔ `#/assistant`
  (`kind:"cluster"` ↔ `#/cluster`; `#/diagnostics` and `#/hosts` are aliases that
  also resolve to it). Keep both sides in sync in `router.js` when you add a route.
- **`persona.resolveRoute()` is the routing chokepoint** (`../lib/persona.js`): a
  forbidden route is remapped to the persona's home *before* it enters state or
  mounts. `App.setRoute` runs every route through it. Don't bypass it.
- Most pages receive **navigation callbacks** from `AppRouter` (`onOpenServer`,
  `onAction`, `onTabChange`, `onAsk`, …) — they don't call `setRoute`
  themselves. They read **domain data straight from the singleton stores** via
  `useStore(...)`, not from props threaded down the shell.
- **A component that can be PINNED reaches the router through `useNav()`**
  (`components/NavContext.jsx`) instead, because a widget on the dashboard has no
  page above it to hand it anything. A card that is rendered both ways takes the
  prop and falls back — `const open = onOpenServer || nav.openServer` — so it works
  on its own page and pinned, with no call site changed. `DashboardPage` takes no
  navigation props at all: every card on it is a widget.
- **CANON: a component does not branch on where it is mounted.** Anything that can be pinned
  renders and behaves identically on its page and on the dashboard. Data is a function of its
  PARAMS, never of its placement — which is why the target-scoped stores are keyed
  (`leafLogsStore.byKey`, `logsStore`/`servicesStore`/`logSourcesStore`.`byHost`) rather than
  holding one slot, and why `useKeyedResource` shares the hold instead of the surface owning it.
- **Lifecycle verbs are `lib/serverActions.js`**, not a callback. `runServerAction`
  owns the optimistic patch, the rollback and the wording, so any surface offering a
  Start button does all three. `App.jsx`'s `handleAction` only resolves WHICH server
  the shell means when a caller names none.

### Adding a page/route

1. Add the `route.kind` ↔ hash mapping to `../lib/router.js` (both `routeToHash`
   and `parseHash`).
2. `const NewPage = React.lazy(() => import("../pages/NewPage.jsx"))` +
   `{route.kind === "new" && <NewPage .../>}` in `AppRouter.jsx`.
3. If it's gated, wire the capability in `../lib/persona.js` so `resolveRoute`
   protects it.

## `FirstRunWelcome.jsx` — the one-time tour

Five cards introducing the composable dashboard: one line of text each over a small animation of the
gesture it describes, drawn from divs so there is nothing to ship and nothing to 404. The dashboard
is composed rather than fixed and nothing on screen says so, which is the whole reason it exists.

**Where it is mounted is the feature.** The shell renders it inside the app frame, past every gate —
`AuthGate`, the pending-approval screen, `AddHostPage`, `ColdStartDown` and `BootLanding` all return
earlier — so it can only meet somebody who is signed in, approved and one render away from the
dashboard. Never mid-login.

Seen-state is `krystal:welcome:v1` in localStorage, and **every way out records it**: Get started,
Skip, the close button and Escape. Re-showing a modal somebody has closed, on every load, teaches
them to close it faster rather than to read it. The key is versioned — bump it to re-show the tour
after the mechanics change, and nobody has the new key.

## `auth/` — the screens in front of the app

`auth/` is not on the router. `components/AuthGate.jsx` renders these instead of the shell,
so they answer to no `route.kind` and no persona: `ClusterPage` (the address of the cluster, for a
panel whose own origin names no provider) and `ClusterUnavailable` (the panel knows where to sign in
and cannot right now — nothing answered, no provider yet, a session that ended while the panel was
open, a provider that sent the browser back without one, or an account the cluster grants nothing).
Nobody signs in on either: that is the provider's own pages. `AuthChrome.jsx` holds what these share
with those pages, which reuse `SignInCard.jsx` and `PendingPage.jsx` from here.

**`AuthGate` is everything in front of the app** — finding the provider, and going there — and
`App.jsx` renders it *instead of* the shell, so none of the shell's hooks and none of the data layer
run for somebody who has not signed in. A cold load holding nothing leaves for the provider at once,
because nothing is on screen to lose. A session that ends while the panel is open is NOT followed on
its own: the gate says so and offers the way back, because leaving unasked discards whatever somebody
was doing.

**The panel holds no credential settings.** A password, connected accounts and the list of where
somebody is signed in are changed on the provider's account page, behind a recent proof only those
pages can ask for; Settings links there (`SettingsSignIn.jsx`). Administering OTHER people's accounts
stays in the panel, through the provider's account API with the bearer it holds.

**One address, and what answers decides the rest.** Any member of the cluster names its provider,
and so does the provider itself, so the page does not ask which was typed — `discoverProvider`
asks. What was typed is checked before it is kept, so a refusal is what something answered.

## Administering accounts — one screen, two homes

`accounts/AccountsAdmin.jsx` answers "who may do what". Where it is MOUNTED is the cluster's answer,
not the screen's, and `useAccountHolder()` is the one question that decides it.

Held by an **anchor**, the accounts are the cluster's: one list, each account's roles at their scopes, and
`accounts/AnchorPage.jsx` carries the screen — the anchor holds them and is the only writer, so a
node keeps a read-only replica and refuses every write against it. No node's API leaf offers the tab
at all, and a link to one made before the cluster existed lands on the leaf's overview. Held by a
**node**, they are that node's, the screen sits on its API leaf beside the service's logs and its
configuration, and the node is named — a list that did not name it would imply an account exists
somewhere it does not.

The hook reports two facts and they are not the same one. `anchored` says the accounts belong to an
anchor, which is what decides where the screen lives; `anchor` says where THIS browser can reach
them, which is empty for a session opened at a node. They disagree exactly once — a node that held
its own accounts joins a cluster with an anchor — and the anchor's page renders that honestly by
naming the holder rather than offering a table whose every write the node refuses. Because the
capability assignment is re-read on the roster's own cadence, the tab moves with no reload and
nothing redeployed.

The other question — "how do I prove who I am", and where am I signed in — is not the panel's. It is
the provider's account page, behind a recent proof only those pages can ask for, and
`SettingsSignIn.jsx` links there.

No screen decides where its calls go; `accountDoor` in `../lib/apiClient.js` does, once.

**The access pages hold no copy of the rules.** Every control on them is gated on the request it would
send to the anchor — an edit by its kind, an account change by its method and body (`editRefusal` and
`userRefusal` in `../lib/stores/authority.js`, over the anchor's published operations) — and a control the rules would refuse stays on screen with
the anchor's reason beside it — a role above the assigner's is offered, closed, saying so. The reason
comes from `authorityStore.check`, which asks the anchor's own rules about edits nobody has made; a
page that worked a refusal out for itself would be a second implementation of the rules, and the
first to disagree with them. A change that is refused anyway shows the anchor's sentence where it was
made (`RefusalNote`), and `reauth_required` links to the provider's account page, where the proof is
asked for.

`accounts/AnchorPage.jsx` is a MEMBER page, not a route of its own. A cluster has members and a member
is a node or an anchor, so both are reached at `#/cluster/member/<member>` and `DiagnosticsPage` picks the
body by which kind the roster says it is — checked before the fall-through that would otherwise read
"not a node I hold" as "no member named" and show the grid.

**Its tabs answer two different questions** (`anchorTabs` in `../lib/labels.js`), and they must not
be confused for one.

What EVERY anchor answers is what it is as a component plus what it is as a member. System, Logs and
Configuration are the component's own, served by the member on screen at its own address. Overview
and Settings are the roster's and the cluster's answers about that member — what it is, what it
holds, how far away it is, and whether it is still one — so they render from a session opened
anywhere.

What ONE capability adds is the surface that capability IS: the cluster's accounts belong to the
`auth` holder and to nobody else, a conversation corpus and its command list to the assistant, names
and certificates to DNS. `ROUTE_TABS.anchor` is the vocabulary those names come from; what is on
screen is `anchorTabs(capability)`, and a capability earns a tab by gaining a row in
`ANCHOR_CAPABILITY_TABS` once the member behind it serves one.

**The ADDRESS follows the same rule.** The door's origin is this member's address only when this
member is the door (`holder === member.nodeId`); otherwise it is the member's own, from the roster.

**One place is reached at the DOOR, and only one.** The cluster's accounts and who may do what belong
to the `auth` holder, so its Accounts, Roles, Permissions, Catalog and Services tabs (`DOOR_BODIES`)
are guarded on holding a session with it and say so when there is none. Everything
else on the page is reached at THIS member's own origin with the cluster's credential — an anchor
holding anything other than `auth` has its sign-in shut, so it verifies the session this browser
already carries and there is nothing to sign in to. The assistant's bodies are therefore the leaf
page's own components, unchanged and taking the same single id: what differs is which machine
answers. `CAPABILITY_BODIES`' `overview` renders UNDER the membership card rather than instead of it,
because the two answer different questions — what this member is, and what the capability it holds is
doing.

Each tab is a URL segment and `App.setRoute` moves it. The breadcrumb names it from the anchor's
strip, and asks `anchorOffersTab` before naming one at all: `ctx.memberKind` says which member this
is and `ctx.memberCapability` says which tabs it has, so the trail cannot announce a tab the page
resolved back to Overview.

## A component's own page is one page, reached two ways

**A component owns its configuration, its unit, its journal and the commands it declares wherever it
runs, and only the transport differs.** `pages/component/` holds those bodies and nothing else holds
them: `ComponentConfiguration`, `ComponentSystem`, `ComponentJournal`, `ComponentCommands`, over
`ComponentConfigRow` / `ComponentConfigReview` / `componentConfigHelpers`. A node's leaf page and an
anchor's member page mount the same four.

`lib/componentSurface.js` is the whole of what separates them. It hands a page a `surface` — a read,
an apply, a unit row, a manifest, a journal — and a body cannot tell which kind it was given, which
is what stops the two from drifting into two implementations of one page. `anchorSurface` calls the
member's own origin with the cluster's credential under the prefix that capability serves (a
capability with no entry there has no browser-reachable surface, and the page says so rather than
guessing a path). `leafSurface` goes through the node that runs it. The journal is deliberately not
on the leaf surface: a leaf's comes off the KEYED log store so a page and a pinned widget share one
hydrate and one subscription, and a second reader here would fetch it again beside that one.

**The tab vocabulary carries the distinction.** `Configuration` is the component's own and is spelled
the same on both strips, because it is the same tab reading the same descriptor. `Settings` is a
member's place in the cluster — moving a capability, removing a member — which only a member has, so
it is on the anchor's strip and never a leaf's. A leaf link carrying the older `settings` word
resolves to `config` in `lib/router.js` and is never emitted.

**A component that is this cluster's anchor is not one of the node's leaves.** kgsm-api subtracts it
from the services board, so `LeafPage` would mount a shell with no service row behind it; it reads
the capability assignment and sends the person to the member route instead, carrying the tab, which
the shared vocabulary makes meaningful on either page.

## The split-page folders — keep the entry thin

Big screens live as folders: the entry file stays thin (state + layout) and the
pieces live beside it.
**Don't fold these into their entry file — grow the folder instead.**

| Entry | Folder | Holds |
|---|---|---|
| `ChatPage.jsx` | `../chat/` (shared by both surfaces) | thread/message/parts, evidence cards, context meter, host picker, `chatUtils`/`chatConstants` |
| `DiagnosticsPage.jsx` | `diagnostics/` | the cluster's own tabs — `ClusterKpis` (over `clusterKpis.js`), the two member cards (`ClusterNodeList`, `ClusterAnchorList` — both pinnable), `ClusterRail`, `ClusterMap` (over the generated `euMap.js`) and `ClusterCapabilities` — plus one member's: `DiagOverview/Resources/Services/Logs`, `DiagJobs` (the node's `JobQueue`), a node's own rename control, `LeafConfigModal`, `diagHelpers` (the leaf card itself is `components/LeafCard.jsx`; the placement libraries live on the engine's leaf page — `leaf/KgsmLibraries.jsx`) |
| `PerformanceTab.jsx` | `performance/` | `PerfCards`, `perfHelpers` |
| `ServerSettings.jsx` | `serverSettings/` | `SettingsSections` |
| `accounts/AnchorPage.jsx` | `accounts/` | the member page's capability-scoped tab strip over `AnchorOverview`, the `auth` holder's accounts (`AccountsAdmin` — the roster, the create/edit modal with its roles and sessions) and the access pages in `access/` (`RolesAdmin`, `PermissionsAdmin`, `CatalogAdmin`, `ServiceRequests`, the shared `Assignments` editor a server's Access tab also mounts, and `accessKit`), the component's own four from `component/` read at this member's address, and `CAPABILITY_BODIES`, which mounts the holder's own surfaces against its member id (the assistant's `AssistantOverview` and `AssistantConversations`, from `leaf/`) |
| `DashboardPage.jsx` | `dashboard/` | `catalog.js` (the widget registrations), `widgets/` (the pinnable bodies), `fleetKpis.js` (the fleet KPI figures), `AddWidgetSheet`, `DashboardEmpty` |
| `leafConfig/LeafConfigPage.jsx` | `leafConfig/` | the node's half — which of its leaves publish a surface, which is open, that leaf's unit facts and the host journal beside them; the settings themselves are `component/ComponentConfiguration` |
| — | `component/` | a component's own bodies, mounted by both the leaf page and the anchor page: `ComponentConfiguration`, `ComponentSystem`, `ComponentJournal`, `ComponentCommands`, `ComponentConfigRow`, `ComponentConfigReview`, `componentConfigHelpers` |
| `GamePage.jsx` | `library/` | `GameOverview`, `GamePlacement`, `GameBlueprintTab`, `GameServersTab`, `BlueprintFileCard`, `BlueprintHostPicker`, `LibraryCreatePage` |

Rule of thumb: **a page pushing ~400 lines gets its own `pages/<name>/`
folder** rather than another append.

## The cluster page has tabs of its own, and a member is named under `member/`

`#/cluster` is two tabbed surfaces sharing a word, at two depths. The cluster's own tabs sit
directly under it — `#/cluster/reach` — and a MEMBER is named under an explicit word:
`#/cluster/member/hotrod`, `#/cluster/member/hotrod/services`,
`#/cluster/member/hotrod/services/api`. The two strips are separate tables —
`ROUTE_TABS.clusterRoot` and `ROUTE_TABS.cluster` — because a cluster and a machine offer different
tabs, and the breadcrumb picks the strip the same way the page does.

**That word is what keeps the two vocabularies apart.** Without it the segment after `/cluster`
would have to be read as either a member id or a tab name, which means reserving every tab word out
of the id space forever and shadowing any member unlucky enough to be called one. A member called
`reach` resolves correctly. It also leaves `#/cluster/members` free for a list of them.

The older unprefixed shape still **resolves** so bookmarks keep working, and is never **emitted** —
`useRouteSync` rewrites it to the canonical form on arrival. A tab word wins over it, because a link
made today says `member/` and one that does not is older than the tabs.

**The `member` segment carries no crumb.** It is a namespace rather than a place, and today the list
of members *is* the Cluster page — a crumb there would repeat the link beside it.

**Hover on that page belongs to the PAGE, not to the cards.** `hoveredNode` lives in `ClusterPage`
and every surface takes it as a prop, which is what lets a member pointed at in the reach rail light
up in the map's callout beside it and in the Nodes card on the tab before. A card holding its own
hover state would look identical and silently stop agreeing.

## Server, host & game detail = tabbed pages

`ServerDetailPage.jsx`, `DiagnosticsPage.jsx` (host detail) and `GamePage.jsx`
(a library blueprint) render sub-tabs via `route.tab` (`overview` is the default
and is omitted from the URL). A tab whose read the caller does not hold is left out
of the strip and `safeTab` falls back to overview, so a stale URL never mounts an
empty body — the game page's File tab is offered only on the blueprint read it makes.

**A tab's id, name and place in the strip come from `ROUTE_TABS` in `../lib/labels.js`**,
because a tab is a URL segment and the breadcrumb above the page names it too. The page
keeps what is its own — the badge counting its alerts, and which tabs this persona is
offered — and decorates the shared row. Add a tab there, not in the page. Every server
tab is backed by a real endpoint: `FileBrowser`, `ServerSettings`,
`PerformanceTab` and `PlayersTab` all render measured data.

**A tab whose backend can't answer says so — it never fills itself in.** A value
the API doesn't provide arrives as `null`/`"unknown"`/`[]` from `../lib/adapters.js`
and renders as "—"; a roster that can't be measured renders its own honest
not-measurable state rather than "0 players". Adding a tab means wiring its
endpoint, not inventing numbers to fill it. (Ecosystem-wide "never fabricate a
metric" invariant — see the workspace root `CLAUDE.md` and `../lib/adapters.js`.)
