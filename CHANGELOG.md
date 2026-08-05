# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Resource history on a leaf's System tab** — recorded CPU, memory and disk I/O for the leaf itself,
  under the unit facts. kgsm-monitor samples every running leaf's cgroup the way it samples a game
  server's, so this is the Performance tab's historical view pointed at a different entity: the same
  fetch shape, the same `MetricsChartGrid`, the same range selector. The facts above are live and the
  charts are recorded — two sources on two cadences, kept visibly apart.
  - **History windows only, no Live button.** There is no per-leaf metrics tick to subscribe to, and a
    Live range that re-read the history store would be advertising a feed that doesn't exist.
    `RangeSelector` takes a `ranges` prop for this; `HISTORY_RANGES` is the set without it.
  - **No Network card.** A leaf has no per-instance meter by design — the eBPF meter is attached to
    `kgsm.slice` and never sees a unit in `system.slice` — which is a different fact from a server whose
    meter has nothing recorded yet. `MetricsChartGrid` takes `network={false}` for the first; the second
    keeps its honest empty card.
  - **Empty reads three ways, matching what the page already says.** Running with no rows means history
    hasn't accrued; a stopped leaf has nothing to record; a socket-activated one is *resting*, not
    stopped — the same distinction the Activation hint one card up makes.
- Thumbs up/down under every assistant answer, live and in replayed history. The vote is recorded on
  click; a thumbs-down then offers an optional one-line "what went wrong". Read-only transcripts in the
  review dock show the owner's verdict as a badge and offer no control.
- Assistant leaf Overview: a "Rated helpful" KPI that reports its own coverage (a rate with no votes
  renders "—", never 0%), a "What people said" card listing the thumbs-down notes, and a prompt-version
  table whose verdict column makes "did that prompt edit help?" answerable.
- Assistant leaf Conversations: a thumbs-down chip per conversation and a filter for the ones somebody
  marked unhelpful.


### Added — a page per leaf, starting with the assistant

`#/cluster/{host}/services/{leaf}` is one leaf on one node, with its own sub-tabs. The page hangs off
the node's Services tab because that is the only place it is opened from, so the URL keeps descending
instead of jumping to a sibling top-level word — the path reads as the trail you walked, and the
breadcrumb names each step. The flat `#/leaf/{host}/{leaf}` word still resolves, so an older link
still lands.

The shell is deliberately generic — breadcrumb, identity header, the live service strip, the tab
switcher, Logs and Settings are identical for every leaf, because all of it comes from the services
row and the leaf config descriptor each leaf already ships. A leaf with nothing special gets Overview
+ Logs + Settings and needs no code; a leaf with more to say registers a body in `LeafPage`. The
Services board's leaf cards open this page (the all-leaves config page is still at `#/config/{host}`).

**Logs is a tab on the leaf, reading that leaf's journal alone.** It asks journald for the one source
(`?source={leaf}`) rather than filtering the host's merged feed: that feed is capped across every leaf
at once, so a quiet leaf beside a chatty one holds almost none of it — measured on this host, a
300-line merged window carried four sources and none of the monitor's, while the scoped read returned
a full 300. A leaf the host publishes no log source for says so, which is a different fact from
having been quiet. Since the journal is now a tab, the Settings body no longer carries its own Logs
toggle when it is embedded there.

**A System tab owns the unit's facts, which three surfaces had been rendering.** The unit, its
activation, whether it is enabled at boot, its state, when it started, uptime, memory and pid were
split across a strip repeated above every tab, a "Service" card on the generic Overview, and the
config page's identity block — none of them complete, and a leaf with a bespoke Overview (the
assistant) got none of the middle one. They live on System now, which every leaf has. The page header
keeps the leaf's name and its status chip: whether the thing is up is the one fact worth seeing from
whatever tab you are on. The Settings body drops its identity block when embedded, since the page
hosting it names the leaf already.

The tab distinguishes what it cannot measure from what is simply absent: a unit that isn't running
HAS no pid or memory and says "not running", while a running unit whose pid didn't come back is
"unknown", and neither is ever a 0. A leaf the API runs no deep probe for reports "none for this leaf"
rather than an unhealthy-looking blank. `since` is systemd's `ActiveEnterTimestamp` and a stopped unit
still carries it from its last run, so a unit that is down reports when it LAST started and no uptime
at all — reading elapsed time off it claims a dead service has been up for hours.

**One breadcrumb, and it mirrors the URL.** The leaf page drew its own trail, which landed under the
shell's rather than replacing it — two breadcrumbs, disagreeing. Its crumbs moved into the app's own
`Breadcrumb`, which every route already renders: `Home / Cluster / {node} / Services / {leaf}`. A crumb
now carries the route it opens rather than only a route kind, so a trail can step through a
parameterised place — which is what lets the node and Services crumbs be real links back up the path.

**Settings is the existing config surface, not a second one.** `LeafConfigPage` gained an `embedded`
mode that renders its body without its own title and leaf strip — nesting those under the leaf page's
tabs would stack two tab rows. Search, filters, grouped rows, provenance, review and apply are shared
verbatim; a reimplementation would only be free to drift.

**The assistant's Overview** shows how it is actually behaving, ordered by how often a panel would
make you act: clean-answer rate, answer-time distribution, tool problems and people, then a measured
"needs a look" queue and the latest conversations, then per-tool call counts / durations / failures,
then prompt versions, context occupancy, tool steps and thinking share. Every figure is derived by the
leaf from its conversation log and relayed verbatim; this surface formats and never fills in. An
unmeasured distribution renders as "—", never `0` — a zero median would read as "instant".

**The assistant's Conversations tab** walks people → their conversations → the transcript. Every
conversation is listed, including soft-deleted ones (flagged) and the synthetic `dev`/probe actors:
the corpus is what it is. A person with no recorded name shows their raw id — a name is never derived
from a Discord snowflake.

**Transcripts replay read-only in the assistant dock.** The admin transcript DTO is identical to a
user's own history by design, so it goes through the very same `scaffoldHistory` → `ChatThread` path
the person saw — no second renderer able to drift. Review mode removes the rail and the composer
outright rather than disabling them (a greyed input still invites typing into a conversation that
cannot be replied to) and carries a banner that cannot be scrolled away.

`CardTable` gained an optional `onRowClick`, which hands the handler the **row record** rather than an
index — the table sorts internally, so anything resolving a click by position picks the wrong record
the moment a column header is used.

### Added — the assistant tells you its conversations are kept and reviewable

A line on the fresh-conversation screen, under what the assistant can do: *"Conversations are saved
and may be reviewed by an administrator to improve the assistant."* Conversations are stored
server-side by the assistant leaf — they are its memory between turns and the record its tuning is
judged from — and a user should learn that before they type, not after. It sits on the screen that
opens every new chat, which costs the composer no height; a line pinned under the composer instead
would push the input box up on every screen for the whole conversation.

### Changed — the empty chat screen greets and orients instead of labelling

The heading is a greeting drawn at random per conversation ("Hi there — what can I help with?"),
replacing a title that only restated the page. Beneath it, what the assistant can actually do —
health, logs, configuration, lifecycle, troubleshooting — in place of a line describing the routing
topology, which meant nothing to anyone who did not already know the architecture. The capability
line follows the caller's own authority: without operator rights it does not offer to start or stop
anything, so it never promises what the composer then refuses.

### Fixed — a lapsed session is reported only once it stays lapsed

An access token lives 15 minutes, and the seam heals it reactively: the API answers `401`, the host is
marked `expired`, one `POST /auth/session/refresh` rotates a fresh token and the rejected call replays.
Every surface keyed on that status therefore appeared four times an hour for the ~100ms of the
rotation — the node-access notice ("needs your sign-in re-confirmed") flashing at the top of the page
being the visible one, with the auth badge, the cluster chip's degraded count and the stale-credential
auto-logout all reading the same transient state.

The session record now carries `reauthDue`: an `expired` that has *persisted* past a 30s surfacing
window, i.e. one the silent rotation did not heal. Everything that asks the user for something keys
on that; the raw `status` stays instantaneous and is what the seam itself keeps gating on. The routine
renewal now passes under the window silently, and a session that genuinely needs re-authorizing is
still named — 30s later, which is the honest cost of not claiming a failure that hasn't happened.

`denied` is untouched: it is terminal, not a state a rotation can heal, and is surfaced immediately.

### Changed — the live smoke never mutates the host

`scripts/smoke-live.mjs` is read-only against the backend, plus interception at the fetch seam for
every write. Each run previously left ~10 permanent rows in the operator's audit log: seven synthetic
`server.start` events emitted through `kgsm.sh events emit`, and three `config.set` rows from real
note writes on whichever server happened to be first on the live roster.

The teardown that was supposed to absorb this could not. kgsm's event transport is a single host-wide
journal indexed by one kgsm-monitor, and every kgsm-api on the box — including the operator's `:8097`
— merges its engine history from that one monitor, so pointing the smoke at the auth-disabled dev api
never scoped its writes. The purge deleted probe rows from the monitor's index only: the journal kept
the raw lines (a rebuild resurrects them), the note rows were never covered by the predicate at all,
and the "restore" put the note body back but not its attribution. A run now leaves nothing behind
because it writes nothing.

What changed, assertion by assertion:

- `audit.append` is injected at the dispatch seam, like `server.patch`/`server.removed`/`job.patch`
  already were. The stream still has to reach `mode: "live"` against the real backend.
- Audit paging and pushdown run against the host's real log instead of a seeded one, and the scoped
  `serverId` and the `since` bound are derived from it. This is a stronger proof than the synthetic
  seed gave: the filter now runs over a log that holds other servers' rows.
- The note read path is proven against a server that genuinely has one; the write path asserts the
  request the SPA builds, including the empty-body → DELETE routing.
- The file editor keeps its read, stale-etag `412` and traversal `404` — all non-mutating — and
  asserts the save request at the seam rather than performing a 200 that writes an audit row.

The dead socket-isolation block went with it (kgsm dropped the socket transport; it staged a config
override for a key that no longer exists). The smoke no longer needs `sqlite3` or to run next to the
engine. Coverage deliberately handed to kgsm-api's own suite: the journal→api→stream relay and the
note's verbatim round trip through a SOURCED config.

### Added — player moderation in the roster

Kick / ban / unban per player, on the Players band of a server's overview.
Operator-only: the read-only (player-facing) view never renders the column.

**The browser never names who gets moderated.** A request sends the roster's
opaque `playerIdentity` and nothing else — no address, no name. The API resolves
that against its own record of who has been on this server and builds the game's
command from it, so a client cannot aim a ban at someone the roster never saw.
`moderatePlayer()` carries a comment saying so, because the "helpful" change here
is to pass the address along, and it would quietly move the authority for who
gets banned into the browser.

**Only real actions are offered.** The roster response's `moderation` block
({ kick, ban, unban, targetKind }) says what the game's blueprint actually
declares, so a game with no ban command shows no ban button instead of one that
409s on click. It defaults to nothing, so a backend that predates the field
renders no controls rather than broken ones. Beyond that:

- A banned player is offered **unban** and not ban — offering both would state a
  change that wouldn't happen.
- **An action the game declares is always rendered, and disabled when the moment
  is wrong** — a control that vanishes tells the operator nothing, while a
  disabled one that says why separates "this game can't" from "not right now".
  Three gates, broadest first: the server has to be **running** (moderation is a
  console command, and the engine refuses one for a stopped instance — `starting`
  and `unknown` are not running either); the player has to carry an identity of
  the kind the game addresses (a Steam-relay player on an `ip`-keyed game has
  none); and **kick** needs them currently connected. The reason rides the
  tooltip on desktop and a second line in the menu on touch, where no tooltip
  exists. This mirrors the API's own resolution as a courtesy — the API
  re-resolves on every request and remains free to refuse.
- Kick and ban arm-then-confirm (the existing `useConfirmAction` misclick guard);
  unban doesn't, because restoring access is not destructive.
- No optimistic status write. The row changes when the engine's event comes back
  through the `players` topic — because the action landed, not because it was
  asked for.

**The controls are the panel's square ghost icon buttons** (`.icon-btn`, the same
row action the backups list and the host cards use), tinted by tone on hover —
amber for kick, red for ban, green for unban. The label lives in the tooltip and
the accessible name, and both follow the state, so an armed button announces the
confirm rather than the action it still shows.

**On phones the controls collapse into a "⋯" menu** that keeps both icons and
labels — a tooltip, which is what labels an icon button, is not something a touch
screen offers.
The panel is portalled to `<body>` and positioned from the trigger's rect,
because the roster card and its cells both clip overflow — an in-row panel is cut
off, most visibly on the last row. It flips above the trigger when the viewport
is short, and closes on scroll or resize rather than pointing at a stale rect.
The mobile column rule now hides the two date columns by name instead of
"everything past the second", so the actions column survives at phone width —
where an operator is most likely to need it.

### Fixed

- **The `banned` status dot was invisible in every theme.** It referenced
  `--krystal-red`, a token no theme defines (the only use of that name in the
  codebase), so the dot rendered with no colour. It now uses `--danger`, the
  semantic token all 18 themes carry. Latent until now — nothing in the SPA could
  put a player into `banned` before this release.

### Removed — there is no "current node" any more

The sidebar's host switcher is gone, and so is everything behind it: the selected-node store, the
hook that read it, the helper that narrowed lists by it, and the setting that persisted it. The
panel shows the whole cluster on every surface, so there was nothing left for it to mean — and
while it existed, any new feature could quietly bind to it without anyone noticing.

- **In its place, a chip that reports:** `Cluster · N nodes · M online`, plus a count of the ones
  that are degraded. It opens the Cluster page and changes nothing about what you are looking at.
  Collapsed to the rail it shows the node count.
- **Servers and the audit log now show the whole cluster.** Each still has its own Node field,
  which narrows that list and nothing else.
- **Picking a node on the Cluster page** no longer reframes the app; the page's subject is the node
  you opened, which is in the URL.

### Changed — a node that refuses you is reported, not a wall

Losing access to one node used to replace the entire panel with a notice about it. Now it is a row
above the content naming the node, with the one action that helps — *Re-authorize* for a lapsed
sign-in, *Details* for a role you don't have there — and the rest of the cluster keeps working.
A node that simply couldn't be reached is not listed there: not answering says nothing about
whether you'd be let in, and the reachability footnote already covers it.

### Fixed — a node refusing your role was reported as an expired session

The identity check treated every failure that wasn't a 401 the same way, so a node answering *"your
role doesn't grant access here"* came back as *"your session expired — try re-authorizing"*.
Re-authorizing could never have fixed it. The three answers are now kept apart: refused, lapsed,
and no answer at all.

### Changed — federating names the node it federates through

Adding a node to the cluster edits one node's peer list. With more than one node you can manage,
"Add node" asks which one to go through instead of picking for you.

### Changed — a call names the node it is for, or it fails

- **Routing is exact.** Reaching a node the browser doesn't hold now fails — loudly in development,
  and in production with *"That node isn't connected"* — instead of quietly answering from a
  different one. Reading node A's data under node B's name is worse than reading nothing.
- **One exemption, on purpose:** a lone connection whose backend id isn't known yet (a fresh boot,
  before the host list confirms it) still answers, because there is nothing to mistake it for. A
  call that names no node at all still works while exactly one is connected, but says so in
  development — it breaks the moment a second node joins.
- **A token only goes to the node it belongs to.** Sessions are per node, so a call that doesn't
  name one no longer borrows the last-selected node's credentials.
- **Installing a server requires naming where it goes.** No node, no install — instead of landing
  on whichever host happened to load first.
- **Live-connection state is attributed to the socket that produced it**, never to whichever node
  loaded first.

### Changed — signing in picks a doorway, not a node

Your identity is cluster-wide: whichever node signs you in vouches you onto the rest. With several
nodes connected the sign-in page now asks which one to go through and waits until you choose, and
it remembers that choice so the trip back lands on the same node. Before, the return leg always
asked the first configured node — with someone else's token.

### Added — where a server lands is a measured decision

- **The install modal recommends a node from what it can measure**: the blueprint's declared RAM
  and disk against each node's live free RAM and disk. Every node shows its verdict and the numbers
  behind it — *"Fits — 16.7 GB RAM free of 8 GB wanted · 670.5 GB free on / for a 15 GB install"*.
- **A blueprint that declares nothing reads "fit unknown"**, and an unknown node is never
  recommended — it stays pickable with that shown. When nothing measures as having room, the modal
  asks you to choose and Install waits until you do.
- **CPU isn't part of it**, deliberately: a single number can't represent CPU capability.

### Fixed — the install modal's Host field was never rendered

It gated on a permission that doesn't exist, so the field's node list was always empty and every
install silently landed on whichever node came first. The field (now **Node**) gates on the same
create permission every other create surface uses.

### Changed — nothing binds to "the first node" any more

- **A blueprint file names its node.** Each node keeps its own copy, so with several holding one,
  the editor and the create page ask which before opening anything rather than showing one node's
  copy as if it were the blueprint. A single node is still opened straight away.
- **The assistant follows the conversation**: the server you asked about, the blueprint you're
  authoring, the node a picked chat lives on. With several assistants and nothing to go on, the
  dock asks instead of quietly picking one — and opening a past conversation switches to the node
  that holds it.
- **An install in progress shows the node it's actually running on**, taken from the node that
  reported the job. Unknown stays unknown.

### Added — a node that goes quiet says so, instead of its servers just vanishing

- **Every aggregated list discloses which nodes didn't answer.** Home, Servers, Alerts and Audit
  show *"1 of 2 nodes reported · Node B couldn't be signed in to"* when a read comes back partial.
  Fewer rows used to be indistinguishable from servers having been deleted.
- **The reason is the measured one**: a node that couldn't be signed in to is never reported as
  having refused you, and the notice stays silent when every node answers or when there's one node.

### Changed — the dashboard and alerts are cluster-wide

- **The dashboard reads every node** — servers, activity, ping, capacity. The crash KPI reads
  unknown when any node's watchdog is down, instead of quietly reporting a count that leaves that
  node out.
- **Alerts are cluster-wide** on the board, the dashboard card and the sidebar badge: an alert on
  any node needs a human, so a scope can't hide it.
- **Server rows show which node they run on** whenever the cluster has more than one and the list
  isn't pinned to one.
- **The audit's Node filter matches strictly**, with account-level events (auth, tokens) as their
  own selectable "Panel-wide" class rather than being counted into whichever node you picked.
- **Active sessions treat every node equally** — sessions and recent logins are merged from all of
  them, with an honest note when one doesn't respond. "Sign out everywhere" still ends everything
  everywhere.

### Added — the panel drives the cluster's nodes, not the ones you typed in

- **Node discovery runs at boot, for every tier.** The SPA asks a node it can reach for the
  converged cluster roster and starts driving the peers it names, so a node federated on another
  machine shows up in servers, alerts, audit and the catalog on its own. Discovery re-runs on a slow
  cadence, so a node that joins later arrives without anyone doing anything.
- **A discovered node joins live — no page reload.** It gets its realtime streams and is folded into
  the next fan-out immediately. Connecting or disconnecting a host still reloads, because that
  changes who you are signed in as.
- **The roster has one owner.** Pages read it instead of each fetching their own copy, so opening
  the dashboard or the Cluster page is no longer what keeps the node list current. Peer actions
  still re-read the node they changed.
- **A seeded node can't be registered twice** under a second address the roster advertises for it.

Only nodes the cluster reports as alive and reachable are driven; anything else stays a visible
ghost on the Cluster page rather than becoming a dead connection (`PLAN-cluster.md`).

### Fixed — a list filter filters its list, and nothing else

- **The Node filter on Servers, Alerts and Audit is local to its page.** Each list holds its own
  node filter, so narrowing one list leaves every other surface exactly where it was. Clearing or
  resetting a page's filters no longer re-scopes the dashboard, the assistant's target node or the
  install form's default node, and no longer writes a persisted app-wide selection.
- **The filter offers only the nodes its page can show**, and hides itself when there is nothing to
  choose between — one shared option builder (`nodeFilterOptions`) for all three lists.
- **A server row carries its node badge while the list spans nodes**, derived from the rows on
  screen rather than from an app-wide scope.

Groundwork for the cluster-transparency work in `PLAN-cluster.md`: the SPA drives a cluster, so a
node is an attribute of the objects on screen, never a mode of the app.

### Fixed — the settings dropdowns save what you picked

- **Backup cadence, restart cadence, backup/restart day, CPU priority and max consecutive restarts
  now save.** `Select` hands its `onChange` the native `<select>` event, the way every other consumer
  reads it; these six Scheduled-tasks and Runtime handlers took it as a bare value. The dropdown's
  choice therefore never reached state — Save shipped a React event object in the request body, the
  body failed to serialize, and the page reported *"Can't reach the Krystal backend (network)"* with
  the connection banner, against a healthy API that was never contacted.
- **A request body that can't be serialized reports itself.** `liveFetch` serializes before the
  transport `try`, so only a real transport failure marks the host unreachable; a caller passing an
  unserializable body surfaces its own `TypeError` instead of a false "backend is down".

### Changed — a server's backup schedule stands on its own

- **Scheduled tasks offers a Backup cadence alongside the Restart cadence.** The old "Back up
  before restart" toggle is gone: a backup runs against the server as it is, running or not, so it
  no longer needs a restart schedule to hang off and is no longer nested under one. Backup time,
  weekly day and retention appear once a cadence is chosen; Next backup renders beside Next
  restart, both from the scheduler leaf.
- **The timezone applies to both schedules** and is offered as soon as either one is on.

### Changed — a server with no backups is the dashboard's worst case

- **"Oldest backup" ranks a never-backed-up server ahead of every aged one.** Having no backup at all
  is a wider insurance gap than having an old one, so a server the backend scanned and found empty
  takes the tile outright and reads **"never"** in the danger tone, naming the server. It carries no
  timestamp, so it is ranked first rather than sorted onto the date axis — treating "never" as
  infinitely old would be inventing an age. Several unprotected servers report the count and drill
  into the server list instead of arbitrarily opening one of them.

- Only a **measured** empty store (`backup_count === 0`) counts as unprotected. A server that has not
  been scanned yet stays `null` and is still reported as "not scanned yet", never as having none.

### Fixed — the backup KPIs are wired to real data

- **"Last backup" (server detail) and "Oldest backup" (dashboard) show real backups.** Both read
  `server.last_backup`, which the adapter had hardcoded to `null` — so both KPIs read "—" / "No backups
  yet" no matter how many backups existed. They now consume the `lastBackup` / `backupCount` fields the
  backend serves, and update live over the `server.patch` stream when a backup is taken or restored,
  including one taken from the CLI.

- **Removed the fabricated "Auto-snapshot" subtitle.** Nothing records how a backup was triggered, so
  the tile no longer characterizes it. It now describes what the snapshot IS, read off the backup's own
  manifest — size, which directories it captured, which build — and shows only the fields that manifest
  actually carried.

- **"No backups yet" is only shown when that is known.** A server the backend has scanned and found
  empty reads "No backups yet"; one it has not scanned yet reads "Not scanned yet" rather than implying
  the server is unprotected. A backup whose manifest carries no timestamp is still described, and is
  excluded from the dashboard's oldest-backup ranking rather than being sorted as infinitely old or
  brand new.

### Added — the server note is wired to the backend

- **The "Server note" card now persists.** It saves through `PUT/DELETE /servers/{id}/note`, so a note
  survives a refresh and every viewer of that server sees the same text. Previously the editor patched
  the in-memory store only and the note vanished on reload.
- **A byline under the note** — "edited by X · 2h ago", from the attribution the backend records. A note
  written by hand into the instance config has no stored author, and renders with no byline rather than
  a guessed one.
- **Clearing the editor removes the note** (routed to `DELETE`), and a failed save keeps the draft in the
  editor with the error beside it instead of losing the text to a toast.
- The note rides the `/servers` list DTO and the `server.patch` stream, so the dashboard tile renders it
  with no extra fetch and an edit made elsewhere appears live.

### Changed — the Join button launches the game instead of trying to connect for you
- **"Play" replaces "Join".** The button now fires `steam://run/<clientSteamAppId>`, which asks Steam to
  start a title the player owns — something every Steam game supports. Handing Steam an address to
  auto-connect only works for the subset of games whose developers wired that up, so on the rest it
  silently did nothing and there was no way to tell which was which from the panel. Launching is honest
  about what it does: it opens the game, and the connect address beside it is how you get in.
- **The connect address works on the servers list.** It comes from the server row's own `connectPort`
  (kgsm-api now carries it on the list and the stream, not just the detail body), so a card resolves
  `host:port` without opening the server first. This fixes a Copy button that silently did nothing on a
  freshly-loaded list — the port only existed after a visit to the detail page merged it in.
- **Steam cards get a copy button too.** They previously offered only the connect action, which was
  correct when it connected you; now that the player joins from the game's own server browser, the
  address has to be reachable from the card. Play + an icon-only copy share the card's action row.
- The launch link no longer depends on an address, so it resolves anywhere a server row does. Both
  actions stay gated on the server being online — there is nothing to join otherwise.

### Added — the leaf configuration page
- **Every setting every leaf declares, on one page.** `#/config/<hostId>/<leaf>` — its own route, not a
  node sub-tab, because it carries its own leaf tab strip and nesting that under the node page's tabs
  would stack two rows. Admin-only (`ROUTE_CAP.leafConfig = host.manage`), matching kgsm-api's
  Admin-policy leaf controller: an operator cannot reach it and could not read it if they did. The
  Services board's Configure button routes here; `LeafConfigModal` is gone.
- **Built from the existing kit.** The leaf strip is `SubTabs` (the server- and node-detail switcher,
  icon + label like every other tab strip); search/filters/count/collapse-all is `Toolbar`; each group
  is a collapsible `BriefCard`; controls are `Select` and `settings-primitives`' `Toggle`; the review
  step is `Modal`; per-leaf logs are `ConsoleView`. Four components took an additive prop —
  `SubTabs` `title`, `BriefCard` `collapsible`/`open`/`onToggle`, `ConsoleView` `initialSourceId` —
  each with an unchanged default.
- **One apply, one restart.** Edits stage into a sticky bar; the review sheet shows every change as
  from → to, names any `pairedApiKey` moving with it, and requires an explicit acknowledgement when
  something staged is `wiring` or `destructive`. Reset and edit are mutually exclusive per key, so a
  payload can never carry both.
- **Provenance on every row.** override → floor → default as one line with the tier in effect lit,
  collapsing `floor = default` when a leaf's config merely restates its own default. `unknown` is its
  own state — the host could not read the leaf's config source — and is never dressed up as the
  default. `unset` and `empty` stay distinct.
- **Honest edge states.** A read-only leaf (the Control Panel API, which cannot restart itself to
  apply a change) renders values as text with a copy-the-env-line button rather than dead inputs, and
  offers no Restart. A leaf that shipped no descriptor says so rather than implying the short list is
  its whole surface. `applied` / `unchanged` / `rolled_back` / `applied_unreachable` each read
  differently.
- Restart-a-leaf-on-its-own is **disabled with its reason** — there is no endpoint for it yet, and an
  empty `PUT` returns `unchanged` and restarts nothing. It turns on with leaf lifecycle actions.

### Fixed — the config adapter dropped most of what the backend sends
- **`adaptLeafConfig` carried only the keys the old modal used.** `groups`, `editable`,
  `editableReason`, `applyMode`, `fromDescriptor` and per-field `floor`, `effective`, `source`,
  `group`, `risk`, `unit`, `min`, `max`, `pairedApiKey`, `dependsOn` were discarded at the honesty
  boundary, so no component could see them. The full shape now passes through, with the secret rule
  extended across `floor` and `effective` as well as `value`.

### Changed — backups show what they are
- **Each backup row carries its age, size and captured version** under the backup id, read from the
  detail `GET /servers/{id}/backups` now returns (`createdAt`, `sizeBytes`, `version`) via the shared
  `fmtRelative` / `formatBytes` helpers. Every field is optional: a backup the engine lists but has
  no manifest for renders as its id alone rather than as a fabricated size or age, and the subtitle
  is omitted entirely when nothing is known. Download and delete remain disabled affordances — there
  is still no endpoint behind them.

### Added — the blueprint editor
- **Edit a game's `.bp.yaml` from its library page.** `BlueprintFileCard` — a Monaco `BriefCard` on
  the game detail page with Save / Reset / Revert-to-original, an "Overridden" badge when a local
  copy is shadowing a shipped blueprint, the engine's validation errors listed beneath the editor, a
  412 "changed on disk" banner with reload, and a full-screen pop-out that keeps the same editor
  instance. Operator+ reads (read-only), Admin writes. The host is auto-selected when one offers the
  game and picked when several do — a blueprint file lives on one host's disk.
- **Create a blueprint: `#/library/new`.** A "Create blueprint" button on the catalog header opens a
  dedicated page whose buffer is seeded from the ENGINE's own `blueprint.tp` skeleton
  (`GET /library/scaffold`) — the SPA carries no template of its own. A name input (lowercase slug),
  Save (`POST /library`) with `409 name_taken` rendered under the input and the engine's `errors[]`
  beneath the editor, and Reset back to the skeleton. On success it lands on the new game's page.
  Admins author manually; Operators get the same editor read-only with the assistant hand-off as
  their primary action, since creation is admin-only server-side.
- **`askCreateBlueprint` on the assistant dock** — opens the inline dock (the page and its
  half-written buffer stay put) and seeds an editable, not-yet-sent "Create a blueprint for `<name>`"
  prompt into the assistant's existing `create_blueprint` flow. Shown only where the chosen host
  actually provisions an assistant; the manual path works fully without one.
- **`BlueprintHostPicker`** — the host picker both blueprint surfaces share, so the choice looks and
  means the same in each.

### Fixed — the live smoke suite
- **`npm run smoke` talked to the wrong backend no matter what `KGSM_API` said.** It seeded the URL
  into `.env.local`, but the vite server it boots runs in "development" mode and Vite ranks a
  mode-specific env file above a plain one — the committed `.env.development` (pointing at `:8090`)
  won every time. Every REST call went to a port with nothing on it, the shell fell to "Can't reach
  Krystal", and ~19 checks failed for one reason. The seed is written to `.env.development.local` now,
  the top of that order.
- **A run against an auth-enabled backend failed 40 times over instead of once.** The preflight now
  probes `/me` and stops with the command to run — this suite sends no bearer, so a real host 401s
  every gated read.
- **Two crashes aborted the run mid-suite**, so the checks after them never ran and no summary ever
  printed: an unhydrated hosts store dereferenced as `seed0.network`, and jsdom's missing
  `Element.scrollTo`/`scrollIntoView` (no layout engine, so components that auto-scroll threw during
  an ordinary render). Both are guarded; a missing seed is one reported failure.
- **Every Monaco surface was invisible to the suite.** The editor is built for a real browser and
  threw from inside its own mount under jsdom, which surfaced as the *page* hitting its error
  boundary — the game page carrying the blueprint editor among them. It is stubbed with a
  `textarea`; its real behaviour is proven in Chromium by the visual harness.
- **Checks pinned to instances and contracts that had moved on.** Probe instances are derived from
  the live roster rather than named (`factorio-test`/`terraria-hardmode` no longer exist); the player
  roster block asserts the shipped DTO (`playerIdentity`-keyed, a permanent record whose rows change
  *status* on leave rather than being evicted) instead of an early draft's; card assertions complete
  the turn, since cards are staged while it streams and promoted on the terminal frame; a card is
  found by verb, not by the wire's per-turn id; the Update chip's gate is derived from the live row;
  and the audit cursor walk runs to the tail instead of assuming two pages reach it.

### Added — blueprint coverage in the smoke
- The blueprint editor and create page had **no automated coverage at all**. The suite now asserts
  the live scaffold read (the engine's `blueprint.tp`, not an SPA constant), a live blueprint file
  read with its sha256 etag and API-answered `canRevert`, the Overridden badge tracking the file's
  real tier, `#/library/new` routing (parsed ahead of the game branch, round-tripping back), the
  catalog's entry button, the create page mounting, and — intercepted, so no blueprint is ever
  written to the host — the wire shapes of create/save/revert plus `409 name_taken` and
  `400 blueprint_invalid` carrying the engine's own `errors[]` through the envelope.

### Fixed
- **The create page's editor rendered as a 5px sliver.** `@monaco-editor/react` wraps the editor in a
  `<section style="height:100%">`, and a percentage height only resolves against a definite
  containing block — a height that comes from `flex: 1` is not one, so the section collapsed to its
  own near-zero content height. Its wrap now states a single grid track, the way the file browser's
  card fills its modal, which sizes definitely at any size.
- **The blueprint pop-out left dead space below its footer and offered no visible way out.** The
  card now fills the modal (the fill rule the file browser's card already had), and its expand
  toggle moved out of the card header into the card body — where the file browser and the console
  keep theirs — so it travels into the pop-out and becomes the exit control. Applies to the
  existing blueprint editor's pop-out as well as the new create page.
- **An API error's `details` reached no caller.** `apiError` built its Error from the envelope's
  `code`/`message` only, so `blueprint_invalid`'s `details.errors` — the ENGINE's own validator
  messages — were dropped and the editor could only say "the engine rejected this blueprint" with
  nothing about what to fix. `details` is now carried through verbatim.

### Changed — headless deploys (`setup.sh` once, `deploy.sh` forever after)
- **The SPA now deploys through `deploy/setup.sh` + `deploy/deploy.sh`**, the ecosystem contract
  (`tks/scripts/deploy-template/README.md`), replacing `scripts/deploy-prod.sh`. `npm run
  deploy:prod` points at the new script.
- `setup.sh` verifies the target `wwwroot` exists and is writable by the deploying user; `deploy.sh`
  builds and `rsync`s the bundle with **no `sudo` and no prompts**, and refuses up-front with "run
  `deploy/setup.sh`" when the host is not provisioned. There are no systemd units and no polkit
  grant for this project — kgsm-api serves the bundle.

### Added (v1.31.0) — update-available icon on server tiles
- **Server tile meta row now shows a "circle-arrow-down" icon (info tone) when an update is
  available for that game server.** The icon sits right-aligned in the metrics row with a native
  tooltip ("Update available") on hover. Follows the existing metric-LED pattern for right-edge
  placement (`margin-left: auto`).

### Fixed (v1.30.4) — full-screen editor no longer loses your edits
- **Editing in the full-screen editor modal and closing it (without saving) no longer discards the
  edits from the inline editor's Save.** The inline and full-screen editors were two separate Monaco
  instances loosely coupled by a string prop: toggling full screen unmounted + remounted the editor at
  a new React tree position, so in-flight model content could drift from the `draft` state and be lost
  on the remount. A new `ReversablePortal` primitive reparents the editor's real DOM node between the
  inline slot and a body-portal modal slot (instead of re-rendering the same JSX at a different tree
  position), keeping one Monaco instance + model alive across the toggle — so the inline and full-screen
  editors are literally the same instance, bi-directionally bound through the existing `value`/`onChange`.
  Applied to all three editor surfaces: the Files tab (`FileBrowser`), the blueprint file editor
  (`BlueprintFileCard`), and the assistant's blueprint-review editor (`ChatBlueprintDraft`).

### Fixed (v1.30.3) — "Checked X ago" now ticks forward live
- **The "Checked X ago" subtitle re-renders every 30s** via a wall-clock tick timer, so the
  relative time advances even when the audit feed is quiet. The previous implementation was
  anchored to the most-recent audit event (by design for the backup KPI, which should not drift
  from its event timestamp), which meant the "Checked" subtitle was frozen until a new audit
  event arrived. The fix adds a `setInterval`-driven re-render; the "Checked X ago" computation
  now uses `Date.now()` (wall-clock) while the backup KPI stays event-anchored — both intents
  served without compromise.

### Fixed (v1.30.2) — "Update available" KPI shows when the check last ran
- **The "Update available" tile's subtitle now shows "Checked X ago" when the cache has a timestamp**
  (`update_checked_at`, already provided by the API), instead of the hardcoded "On the latest build".
  When the first slow probe hasn't landed yet (no `update_checked_at`), the subtitle shows
  "Checking for updates…" — matching the `ServerHero` chip's honest-unknown state.

### Fixed (v1.30.1) — "Update available" now clears immediately after a successful update
- **The SPA reacts to `job.patch` (verb=`update`, state=`done`, no error) by optimistically clearing
  `update_available` and `update_checked_at` in the server store.** This gives instant UX feedback: the
  "Update available" KPI switches to "No update" and the Update chip disables the moment the job success
  event arrives, closing the ~200ms race window before the verify `server.patch` confirms the same state
  (the backend's own `UpdateCheckCache.MarkUpdated` is the authoritative fix; this optimistic patch is
  the frontend's corresponding half).

### Added (v1.30.0) — the update-check pipeline (frontend half)
- **The "Update available" KPI/tile/filter surfaces are now live.** `adaptServer` maps the backend's
  `updateAvailable` (bool?) + `latestVersion` (string?) into the truthy target-version string the existing
  consumers already expected (`server.update_available = updateAvailable ? latestVersion : null`), so the
  dashboard "Updates available" card, the server-detail "Update available" tile, and the Servers-page
  "Update available" filter+count light up the moment the kgsm-api `UpdateCheckCache` reports a newer
  version. `update_checked_at` is threaded for "checked N min ago" freshness. SSE `server.patch` runs
  through the same adapter, so a flip propagates with no extra plumbing.
- **The server-detail "Update" chip is enabled, gated on `update_available`.** It was force-disabled with
  a stale "kgsm doesn't expose an update path" reason; the backend `update` verb has worked end-to-end
  since M3. The chip now lights when `update_available` is truthy and the server is stopped, with the
  two-step confirm (already wired via `confirm: true`) so a lit chip needs two deliberate presses — no
  accidental update. A running/starting server pre-disables it with "Server must be stopped before
  updating" (mirrors kgsm's own rule and the `CommandGate` 409); an unchecked server shows "Checking for
  updates…"; an up-to-date one shows "On the latest build" — all honest, never fabricated.

### Added (v1.29.0) — nine new themes
- **Nine new themes added.** Theme count: 10 → 19 (13 dark + 5 light + auto).
  - Dark: Amber CRT Screen, One Dark Pro, Rosé Pine, Kanagawa, Everforest
  - Light: GitHub Light, Solarized Light, Catppuccin Latte, Nord Light

### Fixed (v1.28.1) — a revised blueprint draft no longer duplicates/revives earlier editor cards
- **Each in-chat blueprint draft now carries a conversation-unique correlation id.** The assistant's
  `command.proposed` id (`cmd_<n>`) is a per-turn counter that resets to `cmd_0` every turn, so a
  `create_blueprint` draft and a later `revise_blueprint` draft collided on the same `cmdId`. Because the
  Save round-trip patches the card by `cmdId`, saving the newest draft matched **both** messages — reviving
  the older (superseded) editor into a duplicate "verifying" card and, on success, producing two identical
  "Added to the catalog" cards. The SPA now mints a local `uid()` for each draft's `cmdId` at insert time
  (the id was only ever a client-side proposed→verified handle — the finalize authorizes with the token,
  never the id), so every draft's state changes stay scoped to its own card. This also fixes a latent
  collision in the open-draft edit buffer (`draftEditsRef`, keyed by `cmdId`), where a revise could carry
  the wrong draft's live content back to the assistant.

### Fixed (v1.28.0) — the blueprint "verifying" card can no longer hang forever
- **"Save" on a blueprint-review card now consumes a STREAMED finalize** instead of a single blocking POST.
  A finalize is minutes of test-install → verify → repair with long silent stretches; the old buffered
  request could sit with zero bytes flowing long enough for an idle-connection reaper (NAT / a middlebox /
  the browser on a remote path) to silently drop the socket — after which the fetch never settled and the
  "verifying" card spun **forever** with no result, even though the finalize had finished on the host.
  `liveConfirm` now reads the assistant's SSE stream (via the api relay):
  - **live progress** — each `progress` step (research / install / verify / repair) is surfaced as a sub-label
    under the spinner, so the card visibly advances instead of dead-waiting;
  - **an idle watchdog** — resets on every received byte (server heartbeats included) and aborts if the
    stream goes quiet for 60s (≫ the 15s heartbeat), converting a genuinely dead socket into a retryable
    failure ("the verification stream went quiet — it may still be running; check the catalog, or try
    saving again") rather than an infinite spinner;
  - **a terminal `result` frame** carries the same `ConfirmResponse` the buffered path returned, so the
    verified / re-edit / failed outcomes are unchanged.

### Changed (v1.27.1) — a superseded blueprint draft is clearly retired
- When a revision (or re-draft) produces a new draft card, the earlier draft card is now retired to a
  read-only **"superseded"** state — dimmed, dashed border, struck-through title ("Replaced by an updated
  draft"), and its editor and Save/Reset/Give-up buttons removed — so the stale token/content can't be
  acted on and it's unmistakable which card is live. Only an editable ("proposed") draft is retired; a
  draft mid-finalize ("verifying") is left alone.

### Added (v1.27.0) — the assistant can revise an open blueprint draft from chat
- When a blueprint draft card is open in the chat, a chat turn now carries the draft's **current editor
  content** (manual edits included) to the assistant, so asking it to change or populate the draft
  ("populate the metadata with RAM and max players") actually updates the draft via its new
  `revise_blueprint` tool — instead of the assistant falsely claiming it did. The open draft's live content
  is tracked per card (`onDraftEdit`/`onDraftActive`) and attached to the turn body as `draftYaml`; a
  successful revision comes back as a fresh editable draft card to review and save. Ordinary turns (no open
  draft) are unaffected.

### Fixed (v1.26.1) — the chat never shows "session expired" during normal use
- The two chat calls that can't lean on the reactive 401-heal — the **SSE assistant turn** and the
  **single-use blueprint finalize (Save)** — now resolve their bearer through a new **expiry-aware**
  path (`sessionStore.authorizeFresh` / `apiClient.freshBearer`). If the host's short-lived access token
  has lapsed (its own JWT `exp` is past, within a 30s skew), it is **proactively rotated via the refresh
  token before the request goes out**, so the call succeeds on the first try and the session never even
  transiently flips to "expired". The frequent trigger was leaving a blueprint draft open in the editor
  longer than the access-token lifetime, then clicking **Save** and getting "session expired — re-authorize"
  with the edits stuck. Only a genuinely dead **refresh** token now surfaces re-auth (the honest case).
  Every other call stays reactive (heals on the API's 401) — this adds proactive refresh **only** for the
  two non-replayable calls, since a turn/finalize can't be safely replayed through the expired-gate.

### Changed (v1.26.0) — blueprint review card matches the file-browser editor + full-screen pop-out
- The in-chat blueprint review card now uses the **same editor chrome as the Files tab**. Its
  action buttons reuse the shared `fb-editor__btn` family (identical Save/Reset styling
  app-wide), laid out **Give up (far left) · Reset · Save & test-install (far right)** — the
  primary teal Save CTA pinned to the right edge, Reset just left of it.
- The review editor is **taller** (a roomier default height), and the card can **pop out into a
  full-screen modal** — the same reused behaviour as the file browser/editor, the console panel,
  and the time-series charts (portaled to `<body>`, quiet inline placeholder + Restore, closes on
  Esc / scrim). The editor fills the overlay height when popped so a long config isn't capped.

### Added (v1.25.0) — in-chat blueprint-review checkpoint (editable Monaco card)
- `create_blueprint` no longer test-installs unattended. When the assistant finishes drafting
  a config for a missing game, the chat now shows an **editable review card**: the drafted
  blueprint YAML in the **same Monaco editor** the file browser uses (yaml mode, theme-aware,
  lazy-loaded so its chunk only downloads when a card mounts). The human edits anything, then
  **Save & test-install** hands the edited YAML back to the assistant, which re-validates it,
  test-installs, boots, and verifies before anything lands in the catalog — **Restore** reverts
  to the drafted config and **Give up** dismisses the draft. Nothing is added without a real
  verified boot; the card never fabricates success from the accept.
- The card is **double duty**: when the assistant's autonomous repair loop exhausts (a draft the
  local model can't fix on its own), the same card comes back **editable again** with the failed
  attempt's **boot log** attached and a fresh token, so a human can close the gap and re-save
  (the re-edit loop). A **verifying** state covers the minutes-long finalize; a verified result
  flips to the catalog outcome with the measured proof line and a **"Make me a server"** button.
- New apiClient seam `api.host(id).confirmBlueprint({ token, editedContent })` — a blocking
  finalize POST to `/assistant/confirm` (relayed by kgsm-api). Like the SSE turn it does not
  replay on 401 (the confirmation token is single-use and finalize isn't idempotent).

### Added (v1.24.0) — assistant `create_blueprint` progress stepper + outcome card
- When the assistant researches, drafts, and empirically test-installs a blueprint for a
  game the catalog is missing (`create_blueprint`), the chat now shows a **live progress
  stepper** in the assistant's bubble — a check-them-off list built from streamed
  `progress` frames ("Looking it up… ✓ Building a config… Booting it up… Cleaning up…").
  The stepper renders inline next to the tool pill and updates live while the tool is
  still running (it is not gated behind the evidence-card promotion that waits for the
  turn to finish streaming).
- The tool's terminal result now renders a **two-outcome evidence card**: on success, a
  plain-language summary plus the one proof line the pipeline measured (e.g. "booted and
  answered on port 8211") and a **"Make me a server"** button; on failure, an honest,
  specific reason — no YAML, no mention of the disposable test host either way. The
  success button hands off into the **existing** chat-driven install path (the same
  `confirmInstall`/`runLiveCommand` flow a proposed `install` command already uses) —
  no new API surface.

### Added (v1.23.0) — assistant `write_file` config-edit preview + confirm
- When the assistant proposes editing a game server's own config file (the new `write_file` verb — e.g.
  populating Palworld's `PalWorldSettings.ini`), the chat's suggested-action card now shows a **preview of
  the exact change**: the file path plus a scrollable, read-only view of the full proposed content, so the
  change is visible before it's accepted. The preview reads the `file` block (`{ path, proposedContent }`)
  the assistant's `command.proposed` frame now carries — nothing is fabricated client-side.
- **Accept** writes the proposed content through the existing jailed, operator-gated file-content endpoint
  (`filesStore.saveFile`), the same path the file editor uses, then reports the result inline ("Updated
  &lt;path&gt; … takes effect on the next restart"); **Cancel** dismisses it. Confirmation is required —
  the content is never written without an explicit accept.

### Added (v1.22.0) — assistant `get_network` evidence card
- The assistant chat now renders a **Network** evidence card when it checks a server's reachability
  (`get_network`), matching the pattern of the performance and recent-activity cards (it wraps the shared
  `EvidenceCardShell` with a confidence badge and an "Open Diagnostics" deep-link). The card shows the two
  independent network layers the tool measures: the **host firewall** (the active backend, whether it's
  enforcing, and the open port ranges KGSM has opened) and the **router's UPnP forwards** (what's
  reachable from the internet, each `external → internalClient:internalPort`).
- Each layer honors its own honest-unknown states rather than fabricating a measured result: an
  unreadable firewall, un-enumerable rules, an unreachable router, and an unreachable watchdog each render
  as their own "couldn't read" note — never as a false "nothing open / nothing forwarded". A firewall
  that's up but not filtering shows a "not enforcing" flag. This closes the last wire-to-card gap: the
  `get_network` tool result was arriving but the chat reducer had no case to project it, so the card
  (whose component and styles already existed) never appeared.

### Changed (v1.21.0) — assistant resource-trend evidence card reuses the Performance tab charts
- The assistant chat's "resource trend" evidence card now renders through the **same**
  `MetricChartCard` grid the server Performance tab uses, so its charts look and behave identically:
  a synced hover crosshair, the full-screen pop-out, per-window avg/peak/min stats, the log-scale
  toggle, and the series-mute legend. It previously drew bare per-axis `TimeSeriesChart`s with no card
  chrome or hover parity.
- Extracted that grid into a reusable `pages/performance/MetricsChartGrid.jsx` (CPU / Memory /
  Disk I/O / Network from the monitor's `{metric: [{ts, value, min?, max?}]}` history shape). The
  Performance tab's Historical view and the evidence card both feed it; `MetricChartCard` gained an
  optional `chartHeight`, and a `.chart-grid--compact` variant stacks the cards one-up (shorter,
  no always-on empty Network card) for the narrow chat column.
- The live snapshot evidence card (single measured frame, no time-series) is unchanged — there is no
  chart to reuse for a one-point reading.

### Fixed (v1.20.4) — assistant evidence cards wait for the streamed answer
- An assistant chat evidence card (from a `tool.result`) no longer pops into view mid-turn while the
  assistant is still streaming its text answer above it — which read as the answer being prepended on
  top of an already-visible card. Cards gathered during a turn are now held on `bubble.pendingCards`
  and promoted to `bubble.cards` only when the turn finishes (`done`), so each bubble renders
  top-to-bottom in natural order: the finished answer, then its evidence below. The `error` frame and
  the connection-drop path also promote any gathered cards, so evidence is never lost when a turn
  fails mid-stream. Server-rebuilt history bubbles already carry final cards and are unaffected.

### Fixed (v1.20.3) — live smoke cleans up its own synthetic audit rows
- `scripts/smoke-live.mjs` now purges the synthetic `__smoke_probe__` `server.start` events it
  emits to exercise the audit/realtime pipeline. The rows must exist in the backend during the run
  (Phase 8 walks them back through the real keyset pager), so a teardown step deletes only those
  probe rows from kgsm-monitor's `events.db` when the run ends — the smoke no longer leaves
  synthetic events accumulating in the operator's audit trail. Best-effort and safe: WAL-mode
  concurrent `DELETE` alongside the running daemon, scoped strictly to the probe instance name, and
  a missing db / no `sqlite3` just no-ops (`KGSM_EVENTS_DB` overrides the path).

### Changed (v1.20.0) — assistant "Recent events" card reuses the shared audit row
- The assistant chat's **"Recent events"** evidence card (`get_audit_log`) now renders the same
  `AuditEventRow` the full Audit page and the dashboard "Recent activity" panel use — actor avatar,
  actor + summary line, severity-toned action pill, host-provenance chip, origin, and time/relative
  columns — instead of a bespoke compact list. One activity design across the whole app.
- Extracted that row into a shared `components/AuditEventRow.jsx`, collapsing the near-duplicate
  copies that lived inside `AuditLogPage` and `RecentActivity`. It takes the standard `ev` audit
  shape plus `avatarSize` / `showMeta` / `onClick` so the full-page (28px avatar + meta chips) and
  compact (24px, no chips, click-through) variants share one implementation.
- The chat card normalizes each raw kgsm engine event (`instance_started`, …) into that `ev` shape,
  mirroring kgsm-api's read-time shaping (`MonitorEventShaping` raw→dotted action + `ParseActor`
  actor kind) so the same underlying event renders identically on both surfaces; an unmapped type
  falls back to `engine.<type>` with the neutral pill, exactly as `/audit` does. The two honest
  non-list states (monitor-unreachable, measured-empty) are preserved.

### Added (v1.19.0) — root-cause card in chat (the capstone aggregator)
- The assistant's `trace_root_cause` tool — a deterministic aggregator that composes one server's
  event timeline, resource-usage window, and health snapshot against a rules table of known KGSM
  failure signatures — renders a **"Root cause"** Evidence card. The card shows the top (best-
  confidence) finding's headline and confidence badge (`Confirmed`/`Likely`/`Possible` — reusing the
  existing `ConfidenceBadge`, unmodified), then its evidence chain: the specific events that matched
  (same icon/tone/actor/relative-time treatment as the audit/timeline cards), the metric-window facts
  that backed it (CPU/memory avg-peak), and the health checks it drew on (disk, updates, liveness) —
  reusing the existing `.ev-chain` rail layout the card shape already had a renderer for
  (`EvidenceRootCause`, previously unwired). When multiple findings matched, the rest are folded into
  one trailing "N other lead(s) considered" line rather than dropped. When nothing matched, the card
  still renders honestly: the deterministic layer's "no known failure signature — most notable recent
  activity" correlation at `Possible` confidence, never a guessed cause; when a source (the event
  timeline, the health snapshot) was unreachable, the affected evidence is simply absent, and an
  entirely empty chain renders "No supporting evidence to show." rather than a blank card. `chatUtils`'
  shared `EVENT_TYPE_META` gained entries for the event types root-cause evidence actually cites
  (`instance_restarted`/`instance_ready`/`instance_failed`/`instance_update_finished`/
  `instance_deploy_failed`/`instance_download_failed`/`instance_uninstall_failed`), which also sharpens
  their display on the existing `get_audit_log`/`get_change_timeline` cards.

### Added (v1.18.0) — event-history cards in chat (recent events + what-changed timeline)
- The assistant's two new engine-event-history tools render chat cards: `get_audit_log` → a
  **"Recent events"** card (every engine event in the window, most-recent-first) and
  `get_change_timeline` → a **"What changed"** card (the same source narrowed to durable state
  changes — install/uninstall/update/version-update/backup/port-open/port-close; routine
  start/stop and player join/leave are excluded). Each row shows a type icon, the actor (an
  unattributed event reads "unknown actor", never a fabricated "system"), a relative timestamp,
  and — on a fleet-wide read (no server specified) — which server the event belongs to. Both
  cards render an HONEST non-list state instead of an empty shell: a real empty window says "no
  events/changes recorded"; an unreachable monitor says so explicitly ("couldn't be read"),
  never narrated as "nothing happened"/"nothing changed". Reuses the existing what-changed row
  layout (`.ev-changes*`) and the shared `EvidenceCardShell`/`ConfidenceBadge` chrome — no new
  card chrome, just two new `adaptResultCard` projections + renderers.

### Added (v1.17.0) — resource-usage card in chat (snapshot + trend chart)
- The assistant's `get_performance` tool renders a **resource-usage card** in the chat in one of two
  shapes, chosen by the tool result:
  - **Snapshot** (a point-in-time question) — a compact readout of one server's CPU (% of one core),
    memory, network (↓ rx / ↑ tx), disk I/O (↓ read / ↑ write), process count, and — when reported —
    disk footprint. Each value is in binary units; an unmeasured field renders a muted "not measured",
    never `0`.
  - **Trend** (a "how has X been doing over the last …?" question) — a **chart** per primary axis
    (CPU, memory) drawn with `TimeSeriesChart` from the windowed history the card carries. Honest now
    that kgsm-monitor owns metrics history: an empty window renders "no trend recorded" rather than a
    fabricated flat line.
  The card deep-links to the server's Performance tab.

### Added (v1.15.0) — search results card in chat
- The assistant's `search` tool now renders a **cited-passages card** in the chat instead of a bare
  "searching" pill. When a search finds something, the reply carries a `search` Evidence card listing
  each passage's source (doc path or clickable URL), title, and snippet, with a provenance icon
  (indexed docs vs web) and a title that reflects where it answered (Indexed docs / Web search /
  Docs & web). A weak-local answer is labelled "closest matches". An empty / "couldn't search"
  result surfaces no card (summary-only — honest, never fabricated).

### Added (v1.14.0) — chat-driven install / uninstall
- The assistant chat now **runs** an `install` or `uninstall` it proposes, instead of rendering a
  disabled "Not available from the panel yet" card. Confirming an install routes to `POST /servers`
  (`confirmInstall`), an uninstall to `DELETE /servers/{id}` (`confirmUninstall`), both stamped
  `origin:"assistant"` and awaited to a terminal outcome — the same confirm-then-verify flow as the
  lifecycle verbs. `install`/`uninstall` join `API_COMMAND_VERBS`.
- A **named install** lands the name the user asked for. `command.proposed`'s `subject.id` is the
  blueprint for an install, so the custom instance name rides its own `instanceName` field (added to
  the assistant SSE contract) and is passed through to `POST /servers { name }`; the proposal card and
  verify block surface it. An unnamed install falls back to kgsm's auto-naming.

### Fixed (v1.13.2) — two more call-site prop mismatches (same class as the install-modal bug)
- **Host re-authorize modal was inert.** `App.jsx` mounted `<HostReauthModal>` with `hostId=` (a
  string) and `onExpired=`, but the component's contract is `host=` (an object) and `onDone=`. So
  `host.id` was `undefined`, the Re-authorize button's handler early-returned (`if (…|| !id …) return`)
  and did nothing, and the dialog showed the generic "this host" instead of the host's name. Now
  resolves the host object from the store and wires `onDone` to reload (the app's session-change
  convention), so a lapsed per-host session can actually be renewed.
- **Docked assistant evidence links were dead.** The docked `<ChatPage>` omitted `onOpenServer`/
  `onOpenView` (the full-screen instance passes them), so clicking "Open server"/"Open" on an
  assistant evidence card in the dock did nothing (silently guarded, no crash). Now threaded through
  to match the full-screen assistant.

### Fixed (v1.13.1) — install modal Confirm did nothing
- **Clicking Install in the game-server install modal silently failed** with a `TypeError` in the
  console and no visible effect. `App.jsx` mounted `<InstallModal>` with `onConfirm=`/`defaultHost=`,
  but the component's contract is `onInstall=`/`defaultHostId=` — so on submit it called an
  `undefined` handler (`onInstall is not a function`) and the install never fired. Renamed the two
  props at the call site to match the component; the requested-host default now threads through too.

### Fixed (v1.13.0) — per-connection REST reachability (no more one-down-host takeover)
- **The global connection banner was a single global flag**: `connectionStore.status` flipped to
  `down` the instant *any* REST call transport-failed, so one unreachable host — a federated peer
  that's offline, a background `/hosts` fan-out probe to a down node — dimmed the whole shell with
  "Can't reach Krystal. Live updates are paused" and forced every host's `HostConnection` indicator
  to "reconnecting", even though the host you were on was perfectly healthy. It also never
  self-healed while that peer stayed down.
- **Reachability is now tracked per connection** (`connectionStore.hosts` = `{ [hostId]: "live" |
  "down" }`) and the global summary is aggregated from it: **`live` when any connection answers,
  `down` only when every one is unreachable** — mirroring `realtimeStore`'s existing per-host model.
  `markSuccess`/`markFailure` take the routed `hostId`; the cold-start takeover (`down && !everLoaded`)
  and the warm banner are unchanged in behaviour for a true full outage. A single down peer now stays
  contained to its own surfaces (its `StatusChip`/`HostConnection`), never the app-wide banner.

### Fixed (v1.12.0) — cluster SSO lazy-vouch loop closed
- **The vouch loop had a dead link: a manually-added auth-enabled peer landed in the host
  registry with `id: null`**, because `connectHost()` returns `needs_auth` from the `/me` 401
  *before* the `/hosts` id-probe runs. With no id, `connOf(nodeId)` can't route to it at N≥2, so
  `sessionStore.vouch(targetId)` (the 401 auto-vouch-via-a-live-sibling engine, `apiClient.js`
  `hostScoped().withRetry`) never had a routable target — dormant even with two federated nodes.
- **`connect.js` now mirrors the converged cluster roster into the host registry**, keyed by each
  node's real `nodeId` (`mirrorRosterToRegistry`). The Cluster page runs it on every roster
  refresh — idempotent, only genuinely new/enabled/`clientUrl`-bearing nodes get written, nothing
  fabricated for a node still missing an id or URL — and reloads once (bounded to the first roster
  change that actually adds an entry) so the new registry rows take effect. Only a node that is
  **both alive (gossip membership) and reachable (status probe)** is mirrored — a down/joining/
  unknown peer stays an honest ghost row rather than adding a dead registry entry that would trip
  the app-wide connection banner and never self-heal.
- **Dropped the stale "multi-host fan-out isn't wired up yet" guard** on the connect screen
  (`HostAccess.jsx`) — it blocked adding a second host at all, which is exactly the case the vouch
  loop now needs to close.

### Added (v1.11.0) — a real "Add node" flow: federate + connect in one step
- **The Cluster page's "Add node" button now does the actual work.** It used to open
  `HostEditorModal` in "add" mode, which just dropped a fake, disconnected client-side host
  skeleton into the list — no URL, no auth, no federation. It now opens `AddNodeModal`
  (`pages/diagnostics/AddNodeModal.jsx`), which brings a node in for real: **federate** the
  backends (`POST /peers` on the local node, so the two kgsm-api nodes join one gossip mesh —
  admin-only, a "Join my cluster" checkbox defaulted on) and **connect** this browser to it
  (the same registry-write + session resolution `AddHostPage` already uses for the first host).
- **Federate and connect are independent and each reports its own honest outcome.** A federation
  failure never blocks the connect attempt that follows; a node that federates but can't be
  reached from this browser right now is shown as exactly that (federated, not yet connected —
  it'll surface as a discovered peer via gossip) rather than silently dropped or faked as
  connected. Non-admins get a connect-only flow — no federate checkbox, an inline note explains
  why.
- **`HostEditorModal`'s edit mode is unchanged** (still how you rename a node or change its
  region) — only the add-a-new-node path moved off it. `makeHostSkeleton`/`slugify`
  (the client-side fake-host generator the old add path used) are removed as dead code.

### Changed (v1.10.1) — Cluster page CTA + topology scale cleanup
- **One "Add node" CTA.** The Nodes card's header "Add peer" affordance is gone; the page-level
  "Add node" button is the single primary call to action. Per-row admin peer actions
  (enable/disable/remove) are unchanged.
- **The topology dial no longer labels each ring inline.** The latency scale is named once in a
  caption beneath the dial (`latency rings · 10ms · 40ms · 150ms · dashed = unmeasured`), so a
  node's own label can never collide with a ring tick near the top — the outer rings are radially
  compressed by the log scale, which crowded per-ring labels stacked at 12 o'clock. Each node
  still shows its own measured latency.

### Added (v1.10.0) — ghost peers, a tighter topology card, and a cluster-wide dashboard
- **The topology card is tighter.** The constellation's SVG box is capped (max 300px, 240px on
  mobile — was 380px/280px) so the card reads as a compact instrument instead of a tall, mostly
  empty radar; the viewBox itself is unchanged, only the on-screen scale shrinks.
- **Single-digit-ms nodes are now visibly distinct from each other.** `latencyRadius` used one
  log1p curve across 0–250ms, which put every same-subnet node within a few px of the local
  marker. It's now two honest segments: a **linear** stretch across 0–10ms (`R_MIN` 56 → `R_LOW`
  110, up from a single `R_MIN` 46) — where most LAN peers actually land — then a log curve from
  10ms out to the 250ms cap (`R_MAX` 140, was 128). The ring gridlines move with it (10/40/150ms,
  was 20/60/150ms). A 4ms and an 8ms node are now ~20px apart in radius instead of ~5px.
- **"Ghost" nodes: a federation peer this browser holds no connected-host session for now
  renders**, on both the constellation and the node list, instead of silently vanishing.
  `buildClusterNodes` (`clusterNodes.js`) appends one ghost entry per federation node that
  matched no connected host (`key: "fed:"+nodeId`, deduped against matched nodes so the same peer
  is never both an enrichment and a ghost) and resolves a single honest `entry.latencyMs` per
  node — the client-measured ping for a connected node, the federation-reported latency for a
  ghost — which the constellation's placement now reads instead of `entry.ping.ms`, so a ghost is
  placed by its own reported latency. A ghost renders as a hollow dashed-outline dot (never a
  fabricated health tone — there's no host to derive one from, so membership color is the only
  honest axis) and, in the node list, a dashed row whose meter slot reads "Discovered · not
  connected" instead of synthesizing capacity. Admins still get enable/disable/remove.
- **The dashboard's capacity card is now "Cluster capacity"**, sourced from the same
  `buildClusterNodes` merge the Cluster page renders from (was raw `hostsStore.list`) — one row
  per cluster node, connected nodes keeping their mini-meters unchanged, ghosts showing the same
  compact "discovered, not connected" treatment. A ghost row drills to the Cluster page (there's
  no host detail to open) instead of a broken per-host route. At N=1 with no federation peers the
  card is visually identical to before — it's just sourced through the merge now.
- `clusterBadges.jsx` gains `membershipRowTone`, mapping the membership badge's tone vocabulary
  onto the `dash-fleet-row`/`-dot` modifier vocabulary, so a ghost row's status dot on either
  surface reads from the same federation-membership axis a connected row's dot reads from host
  health.

### Added (v1.9.0) — Cluster page constellation redesign
- **The Cluster page unifies onto one primitive: the node.** The body is now two stacked
  `BriefCard`s — a latency-topology **constellation** (`ClusterConstellation`) above a
  Fleet-Capacity-style **node list** (`ClusterNodeList`) — replacing the old KPI row +
  search/pagination + `FleetHostCard` grid. Every connected node (`hostsStore`) is enriched
  with federation data (`clusterStore`) by a best-effort hostname/name ↔ nodeId/label/
  clientUrl match; a node with no confident federation match still renders fully (capacity,
  health, deep-dive), just without a membership/status badge — federation data is
  enrichment, never a gate.
- **Constellation placement is two honest axes only.** Radius comes from measured link
  latency (`pingStore`, log-scaled with 20/60/150ms ring gridlines); angle comes from a
  stable hash of the node's id, so a node never reshuffles position when peers join or
  leave. A node with no latency sample yet parks on an outer dashed "unmeasured" ring
  instead of a guessed distance. Dot color follows federation membership where matched,
  else the node's own health tone; edge style follows federation reachability status (or
  reads as honestly "unknown" with no federation match). The local node is pinned at
  center; at N=1 (no peers) it shows a quiet "No peers yet — add a node" state instead of
  an empty radar. Dots/edges ease to new positions on each latency poll rather than snap.
- **The two cards hover-sync.** Hovering a node-list row highlights its constellation dot
  (and vice versa); clicking either opens the existing per-node deep-dive tabs unchanged.
- `MembershipBadge`/`StatusChip` (membership/status tone mapping) move to a shared
  `clusterBadges.jsx` so the constellation, the node list, and `ClusterPanel` read the same
  vocabulary. `ClusterPanel` (and the retired `FleetHostCard` fleet-grid) are no longer
  rendered on the Cluster page but remain in the tree.

### Fixed (v1.8.0)
- **App-level "Sign out" now actually signs out.** It previously revoked nothing server-side and left the
  long-lived refresh token in localStorage (`user.hostId` was never set, so the revoke/forget was dead
  code — and it called a non-existent `sessionStore.forget`). It now revokes this device's session on
  every node the SPA holds one (best-effort, awaited before reload) and clears **all** per-host
  credentials (access + refresh) via `sessionStore.signOut()`, so a reload can't silently rotate back in.

### Added (v1.8.0)
- **Per-peer CORS / reachability warning on the Cluster page (SPA-C0.5).** Each peer is probed from the
  browser (`fetch(clientUrl + "/api/v1", { mode: "cors" })`); a network/CORS failure shows an amber
  warning on the row — *your browser can't reach this peer directly (check its `KGSM_API_CORS_ORIGINS`)* —
  distinct from and shown alongside the backend node-to-node status chip. Honest two-axis rendering:
  browser-reachability ≠ node-to-node reachability.
- **Cross-node "Active sessions" (SPA-C1).** The Settings session list fans across every node the SPA
  holds a live session on; this browser's own sessions collapse into one "This device" row (logging it
  out revokes on each node), other devices show per-node rows tagged with their node, and a per-node fetch
  failure degrades to an honest partial-results note. At N=1 the render and revoke behavior are identical
  to before.

### Added (v1.7.0) — cluster lazy-vouch engine (SPA-C1, foundation)
- **Lazy cluster SSO engine.** On a `401` for a node the SPA holds no session on, `sessionStore.vouch`
  asks a **live sibling** node (same cluster) to vouch the user onto the target
  (`api.vouch` → `POST /auth/cluster-session/request { nodeId }`), adopts the minted
  `{accessToken, refreshToken}`, resolves the tier from the target's `/me`, then the `hostScoped`
  `withRetry` replays once. Loop-safe (mints only on a fresh, non-live target) and storm-bounded (one
  in-flight vouch per target). **Dormant at N=1** — no live sibling → fast `false`, so single-host auth
  is byte-for-byte unchanged (build + N=1 render verified). The roster→registry mirror + N≥2 unblock that
  make this observable ride on a two-node validation (see `docs/cluster-plan.md` SPA-C1).

### Added (v1.6.0) — Cluster page + peer roster (SPA-C0)
- **Fleet → Cluster (canon).** Cluster is now the canonical vocabulary end to end: the nav entry, page
  header, and breadcrumb read **Cluster**; `#/cluster` is the route hash; the internal `route.kind` is
  `"cluster"` and the capability is `nav.cluster`. The pre-cluster `#/diagnostics`/`#/hosts` URL words
  still resolve for old links; the host registry key is unchanged. (The assistant's `fleet` evidence-card
  kind is a separate kgsm-llm wire contract and is untouched.)
- **The Cluster panel** on the Cluster overview lists the local node plus this node's backend peer roster
  with honest **membership** (alive/joining/suspect/dead/left/unknown), **status** (reachable/unreachable/
  unknown, or *disabled*), and **latency** badges — never fabricated; missing values render `—`/`unknown`.
  Admins get add-peer / enable-disable / remove controls wired to the real `POST`/`PATCH`/`DELETE
  /api/v1/peers` surface (replacing the old in-memory host skeleton stub). An unfederated node honestly
  shows *"This node isn't federated with any peers yet."*
- **Data layer:** a host-scoped `api.peers(id)` client (`list`/`roster`/`add`/`remove`/`setEnabled`/
  `latency`, 401-heal like the other scoped surfaces) and a `clusterStore` domain store that reads the
  admin `GET /peers` roster and transparently falls back to the viewer-tier `GET /peers/roster` on a 403.
- **Smoke:** a gated `#/cluster` render case (plus the `#/fleet` legacy-alias case) in `smoke-live.mjs`.

### Changed (v1.5.2)
- **Settings rows stack on mobile.** On narrow screens each account-settings row now wraps: the icon +
  label + description keep the first line to themselves (no more mid-word truncation like "Displ…"), and
  the control (input / theme select / button) drops to a full-width second line indented under the
  label — the same label→input rhythm the game-server install modal's `.k-field` uses.

### Fixed (v1.5.1)
- **Sign-out now revokes server-side.** The app-level "Sign out" (sidebar / top-nav) previously only
  dropped the local tokens, leaving the session alive in the host's registry until it expired; it now
  calls `POST /auth/logout` first (best-effort, via a new root-routed `api.logout(hostId)` seam) so the
  current session is genuinely revoked. The Settings → Danger zone **"Sign out everywhere"** button was
  wired to the same local-only path despite its "End every active session on all devices" copy — it now
  revokes **every** session server-side (`api.sessions(hostId).revoke({ all: true })`) before signing
  out, matching the working "Log out all" control in the Active sessions card.
- **Recent logins hides device-less rows.** The Settings → "Recent logins" list dropped rows that carry
  no device/user-agent (a bare timestamp is not useful), and renders the remaining ones with the
  device string + a per-device glyph rather than an "Unknown device" placeholder.

### Changed (v1.5.1)
- **Settings page spacing & buttons.** The account Settings cards now sit in a flex column with a
  consistent 16px gap (they were cramped at the BriefCard's 4px margin). The ghost/danger action
  buttons adopt the site button family's metrics (r-sm radius, icon flex-alignment, motion, and proper
  disabled states) so they read consistently beside the primary "Save changes" button.

### Added (v1.5.0)
- **Active sessions & revocation in Settings.** The account Settings page gains an "Active sessions"
  section: it lists every active session for the signed-in user across devices (device / user-agent,
  signed-in and last-active times, expiry, and a "This device" badge on the current one), with a
  per-session "Log out" and a section-level "Log out all", each behind a destructive-action confirm.
  Revoking the current session (or all) signs the user out and returns to the login gate. A read-only
  "Recent logins" section shows the login history from `/me`. Admins get a "Manage user sessions"
  section (hidden for everyone else): look up another user's active sessions by id and revoke one or
  all of them — a security control. Wires to the kgsm-api session endpoints via a new root-routed
  `api.sessions(hostId)` seam (`.list`/`.revoke`/`.revokeSid`/`.revokeUser`) that carries the per-host
  bearer and the 401-heal, plus an `adaptSessions` adapter and `recentLogins` on `adaptMe`.

### Fixed (v1.4.26)
- **Adopt the rotated refresh token on session rotation.** kgsm-api now rotates the refresh
  token on every `/auth/session/refresh` (rolling 30-day window + reuse detection, M4·c). The
  SPA was re-persisting the token it *sent*, which is dead after one use — so a returning user's
  second silent rotation would `401` and bounce to Discord re-login. `sessionStore.rotate()` now
  adopts `res.refresh` from the response and writes it to localStorage (falling back to the sent
  token only if an older non-rotating backend omits it). Restores the "stay signed in for weeks"
  behaviour against the rotating backend.

### Changed (v1.4.25)
- **Settings page tabs are now URL-routed.** Replaced the left sidebar nav with `<SubTabs>` (the same horizontal tab bar used by server detail and fleet pages). Each settings section (Account, Connections, Discord, API tokens, Danger zone) has a deep-linkable route (`#/settings/discord`, etc.). Back/Forward navigation, page refresh, and bookmarking all work. The default tab (Account) is omitted from the URL, matching the `overview` convention in other tabbed pages.

### Changed (v1.4.24)
- **Restyle sidebar host picker to Minimal-Flat.** Replaced the heavy card-like trigger (surface-2 background, border, glow-ring dot, two-line column layout) with a borderless, transparent ghost button. The trigger is now a single-line flex row: status dot + host name + thin separator + metadata + caret. Hover reveals a subtle surface fill; open state is a plain surface background with no accent border or ring. Dropdown menu tightened to match (lighter padding, inline option layout). Rail mode updated to hide the flat row and show only the dot + code. Inspired by the assistant dock's minimal host picker language.

### Fixed (v1.4.23)
- **Clean up dead auth/routing code in App.jsx.** Removed the unused `returnTo` ref (`krystal:returnTo` is never written), the dead `forcedOut`/`?auth=out` path (logout already handles its own reload), the `firstRun.current` ref and its mount redirect (overwritten by landing resolution; `krystal:first-run` is never set), and the `setUser` prop (never called after mount). Simplified the landing resolution to always re-parse the URL hash via `KrystalRouter.routeFromHash()` instead of branching on `hasDeepLink`. The auth/routing sequence now reads as three clean gates: no connections → connect screen, no user → login, auth not ready → boot landing, then route.

### Fixed (v1.4.22)
- **Fix deep-link redirect on page refresh.** Navigating to a deep link (e.g. `#/fleet/hotrod/resources`) and refreshing the page would redirect to `#/servers`. The initial route was resolved from `{ kind: "home" }` without parsing the URL hash, so `can()` failed on the empty async hosts list. Deep links also bypassed the deferred-resolution effect by setting `landingResolved = true` immediately, causing `useRouteSync` to overwrite the URL hash before roles loaded. Fixed by parsing the initial hash in `useState`, deferring both deep links and default landings until `hostsLoaded && authzSettled`, and re-parsing the URL hash via `KrystalRouter.routeFromHash()` once capabilities are known (not using the already-rejected route state).

### Fixed (v1.4.21)
- **Restore Disk and Network styles on the Resources tab.** The split-DiagnosticsPage refactor rewrote the JSX with new class names that had no CSS. Reverted `DiagResources.jsx` to the original row-based patterns: disk rows use `disk-row__head / disk-row__bar / disk-row__usage`; network uses `iface-list / iface-row`; open ports use `ports-block + card-table` inside one Network card. Restored the matching CSS in `observability.css`.

### Fixed (v1.4.20)
- **Fix redirect to `#/servers` on page refresh for admin/operator roles.** The initial route was computed before `hostsStore` loaded (async), so `can()` always returned `false` and `homeKind()` fell back to `"servers"`. The `landingResolved` flag was then set prematurely, bypassing the deferred resolution effect that was supposed to correct the route once auth settled. Fixed by determining the default landing from the URL context (not `homeKind()`), and gating the deferred resolution on `hostsLoaded` so `homeKind()` is only called after hosts and roles are known.
- **Fix `authzSettled` checking non-existent session properties.** The `authzSettled` gate checked `s.role || s.denied || s.needReauth`, but session records have `tier` and `status` — not those properties. This meant `authzSettled` was always `false` once hosts loaded, so the deferred landing resolution effect could never fire. Fixed to check `s.status !== "none" && s.status !== "bootstrapping"`.

### Docs
- **Added focused per-directory `CLAUDE.md` files** documenting the architecture-cleanup refactor's structure so future work doesn't re-monolith it: `src/` (source map + module boundaries), `src/pages/` (pages & routing), `src/lib/` (data layer), `src/lib/stores/` (domain-split stores), `src/components/` (shared UI + `<Modal>`), `src/styles/` (CSS tokens + `kit/` barrel). Root `CLAUDE.md` now points to them. Also removed the stray empty `src/pages/__tmp_test__/` directory.

### Fixed (v1.4.19)
- **Fleet page subtabs (Overview, Resources, Services, Logs) now persist in the URL.** The fleet route encodes/decodes a `tab` segment (`#/fleet/<hostId>/<tab>`), matching how server detail tabs already work. Tab state is driven by the route instead of local React state, so back/forward, reload, and deep links land on the correct tab.

### Fixed (v1.4.18)
- **Page scrolls to top on navigation.** When navigating between pages, the main scroll container (`.app__main`) smoothly scrolls to the top so the user doesn't land mid-page.

### Fixed (v1.4.17)
- **Library grid shows two cards side by side on small phones (≤480px).** The `≤480px` breakpoint forced `.game-grid` to a single column; changed to `repeat(2, 1fr)` to match the `≤768px` layout.

### Fixed (v1.4.16)
- **Assistant FAB button now visible on mobile.** The floating action button was gated to `desktop` only, so mobile users had no visible way to open the assistant dock (only an unreliable right-edge swipe). The CSS already had mobile styles ready; removed the JS guard.

### Fixed (v1.4.15)
- **Files tab: file explorer/editor no longer fills to the footer / squishes.**
  Two parts, both traced to the same phase-6 refactor (`989b9cb`) plus a stale floor:
  - The refactor dropped the conditional that put `content--fill` on the shell
    `.content` for the Files tab (`route.kind === "server" && route.tab === "files"`),
    so the vertical fill-chain (`.app__main → .content--fill → .fb-briefcard →
    .fb-card`) never engaged and the browser fell back to its `min-height:460px`.
    Restored the conditional in `App.jsx` (works now that `.app__main` is back — v1.4.14).
  - Moved the "generous minimum" floor from `.content--fill` (the **whole column**,
    which the tall cinematic `ServerHero` + sub-tabs already ate ~480px of, leaving the
    card collapsed to ~158px) down onto `.fb-briefcard` (the file-browser container):
    `min-height: 520px`. Made `.content--fill` `flex: 1 0 auto` (grow, never shrink) so
    it fills to the footer on a tall viewport but keeps its content height on a short
    one — `.app__main` scrolls instead of squashing the card or riding the footer up
    under the hero (the collapse `kit/responsive.css` guards against on mobile).
  - Verified live in Chromium: at 900px the card holds **448px** and the page scrolls
    (footer reachable, flush at the bottom when scrolled); at 1300px it grows to
    **558px** and fills right down to the footer (25px content-padding gap). Lint clean,
    build green.

### Fixed (v1.4.14)
- **Shell layout regression: page scroll + sticky footer.** The refactor's phase-6
  extraction (commit `989b9cb`) silently renamed the shell `<main>` from
  `className="app__main"` to `className="main"` (plus invented `main--push` /
  `main--rail` modifiers), but the CSS was never renamed — the entire `kit/` layer
  still targets `.app__main`. So the live `<main>` matched no rule and lost
  `overflow-y:auto`, `display:flex; flex-direction:column`, and
  `container-type:inline-size` at once:
  - **the Catalog (and any tall page) could not scroll** — `body{overflow:hidden}`
    clipped the content with no scroll container;
  - **the footer was no longer pinned to the bottom** — `.kfoot { margin-top:auto }`
    is inert without a flex-column parent, so it floated right after the content.
  Restored `<main className="app__main">` (the pre-refactor class; the `main--*`
  modifiers had no CSS anywhere — the dock push is handled by `.app`'s
  `padding-right:var(--dock-push)`). Verified live in Chromium: Catalog scrolls
  (`scrollHeight 4141 > clientHeight 900`) and the footer bar sits flush at the
  viewport bottom; lint clean, build green.

### Fixed (v1.4.13)
- **JSX-text `\uXXXX` escapes rendering literally.** A `’`/`—`/`·`/
  `…`/`↑` escape only decodes inside a JavaScript string literal; in a JSX
  **text node or attribute value** the JSX transform emits a doubled backslash, so the
  DOM literally contains `’` and the browser paints it verbatim (confirmed in
  Chromium — the game-not-found fallback showed `That game isn’t in the library.`).
- Classified all 110 source occurrences (strip JS-string spans → a surviving escape is
  JSX text; plus an attribute-value pass) and fixed the **19 that ship as literal-in-DOM**
  across 10 files (AppRouter, ChatPage, EvidenceCards, ChatContextMeter, ChatHistory,
  ChatMessageParts, AssistantHostPicker, DiagServices, LeafConfigModal, DiagResources),
  converting each JSX-text/attribute escape to the literal UTF-8 character. The other ~91
  occurrences are in JS-string context (`{"…"}`, `label:`, concatenation) and decode
  correctly — left untouched. `LeafConfigModal.jsx:110` was surgical: its JSX-text `’`
  was fixed but the same line's ` — ` inside a `{" … "}` string was left as-is.
  Also tidied a lone non-rendering `—` in a `BootLanding.jsx` comment so it won't
  re-trip the classifier.
- These sit on rare/conditional screens (invalid game route, swap >30%, the admin
  leaf-config modal mid-apply, voice-note recording), which is why they went unnoticed.
- Verified: the fresh production bundle contains **0** doubled-backslash escapes (was 19),
  the game-not-found screen now renders a real `’` in Chromium (DOM `innerText` check +
  screenshot), lint clean (0/0), build green.

### Changed (v1.4.12)
- **`exhaustive-deps` backlog — silenced with intent, not "fixed".** A narrow triage
  pass over all 43 `react-hooks/exhaustive-deps` warnings (25 hook sites) found
  **zero genuine staleness bugs** — every one is either a deliberate `[obj.id]`-not-
  `[obj]` choice (the primitive *is* in the deps; listing the whole object would
  resubscribe/refetch on every render), a run-once/edge-detector effect where a
  ref/guard is the real trigger, or a constant false-positive (`tw` is a fresh-per-
  render literal with frozen contents; `SERVER_STATUS_RANK` is a constant map). In
  each case the linter's only available "fix" — adding the missing dep — would
  **introduce** a regression (a refetch storm, a clobbered in-progress edit, a reset
  live buffer), the opposite of the goal.
- Rather than leave the warnings as a trap for a future session to "fix", added a
  scoped `// eslint-disable-next-line react-hooks/exhaustive-deps -- <reason>` at
  each of the 27 anchor lines, each carrying the specific why (e.g. ChatPage's history
  loader excludes `convos` because depping it would refetch on every streamed
  message; AuditLog's `now` keeps `[scoped]` as a deliberate recompute trigger).
- **No behaviour change** — comment-only. `npm run lint` is now fully clean (0 errors,
  0 warnings, down from 43); build green.

### Changed (v1.4.11)
- **#8 Big-file splits — finished the remaining page files.** Same technique as
  v1.4.10 (extract to sibling modules, keep public exports identical → no consumer
  changed):
  - **`ServerSettings.jsx` 469 → 279.** The three gated setting groups → new
    `serverSettings/SettingsSections.jsx` (`StartupSection`, `ScheduleSection`,
    `ResourcesSection`) as presentational components fed their state slice + setters;
    all form state + the load/save/reset/delete handlers stay in the parent (they
    read every field). The tiny Updates group stays inline.
  - **`DashboardPage.jsx` 420 → 366.** `DashFleetStrip` (the all-hosts capacity
    strip) → new `dashboard/DashFleetStrip.jsx`; dropped the two imports it solely
    used. The customizable band render stays inline (entangled with local layout
    state — extracting it would add prop-drilling for no real gain).
  - **`ChatPage.jsx` 528 → 507.** The message-role dispatch → new
    `chat/ChatThread.jsx` (a pure render switch), moving nine message-part imports
    out of ChatPage. The composer/header seams were **left inline** — they'd each
    need ~15-19 props from the shared chat state, so extracting them would add
    drilling, not remove it (ChatPage was already reduced 1944→528 in Phase 5).
- **Left as-is (documented):** `TimeSeriesChart` (single cohesive chart) and
  `apiClient.js`/`adapters.js` (data-layer seams — splitting risks the acyclic-import
  invariant).
- No behaviour change. Verified: lint 0 errors, build green, and the Settings tab
  (all four sections), Dashboard, and the docked Chat render with `errs:[]` in the
  visual harness.

### Changed (v1.4.10)
- **#8 Big-file splits (refactor problem row 4).** Carved the two worst offenders
  into cohesive sibling modules, keeping each original file's **public exports
  identical** so no consumer changed:
  - **`PerformanceTab.jsx` 654 → 432.** Pure constants + formatters → new
    `performance/perfHelpers.js`; the presentational pieces (`StatStrip`,
    `AnomalyBadge`, `MetricChartCard`, `RangeSelector`, `EmptyPerf`) → new
    `performance/PerfCards.jsx`. The tab file keeps only its two stateful views
    (Live / Historical) + the range orchestrator.
  - **`diagComponents.jsx` 393 → 11-line barrel.** The nine-component grab-bag split
    by cohesion into `diagnostics/diagLeafCards.jsx` (leaf/service cards) and
    `diagnostics/diagHostCards.jsx` (host/fleet cards + host modals); `diagComponents.jsx`
    now just re-exports both, so `DiagServices`/`DiagResources`/`DiagOverview`/
    `LeafConfigModal`/`DiagnosticsPage` keep their existing imports.
- **Fixed (incidental, found during #8 verification):** several `\uXXXX` escapes sat
  in **JSX text nodes / attributes** on the Fleet page, where the build does **not**
  process them (the v1.4.6 class), so they rendered literally — the Fleet header
  em-dash, the host-search placeholder ellipsis, the "no hosts match" curly quotes,
  and the host subtitles' `·`/`—`. Replaced with literal characters in
  `DiagnosticsPage.jsx`; the migrated diag cards were converted at the same time.
  (A broader cross-file sweep for the same class is flagged as a follow-up.)
- No behaviour change from the splits. Verified: lint 0 errors, build green, and the
  Performance tab + Fleet page + edit-host modal render with `errs:[]` and no stray
  escapes live in the visual harness.

### Changed (v1.4.9)
- **#7 Shared `<Modal>` primitive (refactor problem-adjacent).** Eight modals each
  hand-rolled the same three things — an Escape `keydown` effect, a fixed scrim, and
  a click-outside check (three of them also duplicated `createPortal`). Extracted one
  `src/components/Modal.jsx` that owns that behaviour (portal-to-`<body>` + Escape +
  scrim mouse-down close, both gated by a `canClose` prop) and migrated every site to
  it. Net −41 lines across the call sites.
  - **Behaviour-only primitive:** the caller keeps its exact scrim *visual* class via
    `scrimClassName` (`.k-backdrop` / `.modal-scrim` / `.console-modal-scrim` / …),
    so there is **no visual change** — all three scrim classes are already
    `position:fixed; inset:0`, so portaling to `<body>` only lifts them out of any
    clipping ancestor.
  - **Migrated (8):** `InstallModal`, `HostReauthModal` (its `!busy` guard → `canClose`),
    `LeafConfigModal`, `HostEditorModal` + `RemoveHostDialog` (diagComponents), and the
    three fullscreen pop-outs `ConsoleView` / `FileBrowser` / `PerformanceTab`.
  - **Small consistency wins:** the `onClick={onClose}` sites now close on a *mouse-down
    outside the box* (target-checked) instead of any bubbled click, and
    `RemoveHostDialog` gained Escape-to-close (it had none).
  - **Deliberately not migrated:** `Toolbar`'s filters/sort dropdown and the chat
    popovers (`usePortalPopover`) are *anchored popovers*, not scrim modals — a
    different pattern, left alone.
  - Verified: lint 0 errors, build green, and in the visual harness `InstallModal`
    (Family A) + `ConsoleView` pop-out (Family B) open portaled-to-`<body>`, close on
    Escape and scrim-click, with `errs:[]` and unchanged appearance.

### Changed (v1.4.8)
- **#3 Prop-drilling cleanup (refactor problem-table row 5).** The Phase-6 App
  extraction *relocated* the god-component prop list onto `AppRouter` (~31 props)
  rather than eliminating it. Thinned `AppRouter` to routing only (~15 props) by
  splitting the props by ownership:
  - **Store-derived data now read in the pages, not threaded.** `DashboardPage`,
    `ServersPage`, `GamePage` read `serversStore`/`hostsStore`/scope directly (via
    `useStore` + `scopeServers` + `useSelectedHostId`), and `ServerGate` reads the
    store's `status`/`everLoaded` — the same pattern `FleetPage`/`ServerDetailPage`
    already used. Dropped `servers`/`scopedServers`/`hosts`/`selectedHostId`/
    `serversStatus`/`serversLoaded` from the router.
  - **Assistant/dock state read from context in the router.** `AppRouter` now calls
    `useAssistantDock()` for `askAboutAlert`/`getServerState`/`assistantHost`/…
    instead of receiving 7 props from the shell (it renders inside
    `AssistantDockProvider`).
  - **Dead props removed:** `activeServer` and `installing` were passed to
    `AppRouter` but never used in its body.
  - Genuinely shell-local props stay threaded (route/setRoute, `serverForRender`
    with merged console `extraLog`, the deny/expired gates, `handleAction`, install
    + reauth + logout, `user`) — and routing callbacks stay on the router (they keep
    pages decoupled from the router). Host-selection in the router's deny/expired
    gates calls `selectedHostStore.set` directly.
  - No behaviour change. Both sides of every contract were updated together (the
    v1.4.7 lesson). Verified: lint 0 errors, build green, and every page renders
    with `errs:[]` live in the visual harness (Servers/ServerDetail/Game confirmed
    populated with real data).

### Fixed (v1.4.7)
- Sidebar nav links (Home / Servers / Catalog / Alerts / Fleet / Audit log /
  Settings) were dead no-ops — a refactor contract mismatch. `App` was passing the
  new `route` + `onNavigate` props, but the `Sidebar` component still expected the
  old individual `on<Page>` / `<page>Active` handlers, so every nav `onClick` was
  `undefined`. Wired `Sidebar` to consume `route` + `onNavigate` (derives active
  state from `route.kind`, emits `onNavigate({ kind })`), completing the intended
  contract instead of reverting it. Also restored the dropped `open={drawerOpen}`
  prop (mobile drawer). Verified live: all 7 items route correctly.

### Fixed (v1.4.6)
- Boot/auth hold screen ("Signing you in…"): fixed two bugs found during the v1.4.5
  browser verification.
  - The ellipsis rendered as a literal `…` — the escape sat in a JSX **text
    node**, where `\u` is not processed. Wrapped it in a JS string expression
    (`{"…"}`) so it renders "…". Fixed the identical case in `AppRouter`'s
    Suspense fallback ("Loading…").
  - The content leaned left on mobile: `BootLanding` reused the `.app` shell class,
    whose `grid-template-columns: var(--sidebar-w) 1fr` pinned the centred content
    into the narrow sidebar column (and the inline `display:grid` even overrode the
    mobile `.app{display:block}`). Replaced with a self-contained `position:fixed;
    inset:0` flex overlay centred on both axes at every breakpoint.

### Fixed (v1.4.5)
- **Four latent crashes** the dead-code sweep + a new lint rule surfaced, all
  used-but-not-imported in JSX-tag position (the same class as v1.4.3 #1, which
  plain `no-undef` misses):
  - `App.jsx` rendered `<ChatPage>` in the assistant dock but no longer imported it
    (the refactor dropped the import; the dock opens by default on desktop, so this
    was a white-screen on load — the dock sits outside the router's ErrorBoundary).
    Now lazy-loaded, matching the existing `<Suspense>` wrapper.
  - `AppRouter.jsx` rendered `<ServerGate>` (the not-yet-loaded/bad-id fallback)
    without importing it → crash on a server route before the list loads. Imported.
  - `ChatPage.jsx` had no default export, but `AppRouter` lazy-loads it via
    `React.lazy(() => import(...))` (which requires a default) → the full-page chat
    route crashed. Added `export default ChatPage` (every other lazy page had one).
  - `ServerSettings.jsx` used `<Select>` but only imported it aliased as an unused
    `KSelect` → `ReferenceError` on the Server Settings tab. Imported `Select`.
- Also fixed a latent `store.patch(...)` reference in `capabilities.js` (leftover
  from a removed alias) that would have thrown at runtime → `hostsStore.patch(...)`.

### Changed (v1.4.5)
- Added `react/jsx-no-undef` (error) to the lint gate — `no-undef` does not catch
  undefined JSX-tag identifiers (`<Foo/>` with no import), which is exactly how the
  four crashes above hid from the build. This closes that blind spot.
- Dead-code / vestigial-guard sweep ("#6") across the whole `src/` tree: removed all
  183 `no-unused-vars` (dead imports, unused `React` imports under the automatic JSX
  runtime, unused locals, `catch (e)` → `catch`) and the vestigial
  `Import ? Import(...) : fallback` / `{Import && <Import/>}` guards left over from the
  prototype's window-globals era (the imported symbol is always defined). Net −107
  lines. Runtime-data guards (`server && …`, `host.online && …`) were deliberately
  left. Remaining lint backlog: 43 `react-hooks/exhaustive-deps` warnings.

### Added (v1.4.4)
- ESLint gate (`npm run lint`, ESLint 9 flat config in `eslint.config.js`).
  Deliberately narrow: `no-undef` and `react-hooks/rules-of-hooks` are **errors**
  (the two static bug classes the build silently passed in v1.4.3);
  `react-hooks/exhaustive-deps` and `no-unused-vars` are **warnings** (a tracked
  backlog). No typecheck or unit-test runner is added.

### Fixed (v1.4.4)
- Fixed 7 `rules-of-hooks` violations the new gate flagged, all the same vestigial
  `useHook ? useHook() : fallback` / `if (useHook) useHook()` guard pattern left over
  from the prototype's window-globals era (the imported hooks are always defined).
  Sites: `NeedsAttention`, `AlertsPage`, `Toolbar` (`useFilters`), `DashboardPage`,
  `DiagnosticsPage`, `ServerDetailPage`. In `ServerCard`, `useIsFavorite` was called
  *after* the phantom-tile early return — hoisted it above the return so hook order
  is stable regardless of `server._phantom`.

### Fixed (v1.4.3)
- Follow-up to the architecture-cleanup refactor: fixed regressions the extraction
  introduced.
  - `ServerDetailPage` referenced `RecentActivity` without importing it — an
    undeclared identifier that threw `ReferenceError` (caught by the ErrorBoundary)
    whenever an operator opened a server's Overview tab. Added the missing import.
  - The assistant dock's "pin" toggle was a no-op: `App` kept a dead local
    `manualPin` state and wired `onTogglePin` to it, while the real pin state
    (driving `effPush`/`pushingPanel`) lived in `AssistantDockContext`. Removed the
    dead state; the toggle now uses the context's `setManualPin`.
  - `App` cleared stored auth and returned `<LoginPage />` mid-render (a render-phase
    side effect) above ~20 hook calls (a Rules-of-Hooks hazard). Moved the `?auth=out`
    handling into the top-level `user` state initializer; the null-user case is now
    handled by the existing post-hooks guard.
  - `AssistantDockContext`'s context-value `useMemo` never actually memoized — two
    derived host-list arrays were rebuilt every render and used as deps, so every
    consumer re-rendered on every provider render. Memoized the lists (and
    `dockResize`) and completed the dependency array; the value is now stable on a
    no-op render.

### Fixed (v1.4.2)
- Auth pipeline hardened across the board: `api.host(null/undefined)` now throws
  immediately rather than silently building a broken unauthenticated client. Every
  `(hostId && api.host) ? api.host(hostId) : api` fallback removed from stores and
  components (11 sites in `stores.js`, plus `BackupsList`, `ConsolePanel`,
  `PlayersTab`, `DiscordPage`). Read functions now bail with `null`/`[]` when
  `hostId` is missing; write functions reject with an explicit error. `_fetchAuditPage`
  switched to `api.fanOut` (consistent with every other multi-host read, closes the
  unauthenticated-audit hole for id-less seed connections). `DiscordPage` host
  derivation made reactive via `useStore(hostsStore)` so the page re-renders
  correctly when `hostsStore` hydrates after a deep-link cold boot.

### Fixed (v1.4.1)
- `GET /servers` always 401s on every page reload: `retryConnection` used the
  unscoped `api.get("/servers")`, which resolves auth via `selectedHostStore.id`.
  On cold load that store initialises to `"all"` (hostsStore is empty until the
  first REST round-trip), triggering the `id === "all"` guard in `authorizedBearer`
  → no token → unauthenticated request. Fix: use `api.fanOut("/servers")` instead,
  which routes per-connection through `hostScoped(conn.id)` with a concrete host ID
  → `authorizedBearer` succeeds on the first call.

### Added (v1.4.0)
- iOS PWA polish: multi-resolution `apple-touch-icon` tags (180×180, 167×167, 152×152 px)
  so the home-screen icon renders at the correct size on every iPhone and iPad variant.
- iOS launch / splash screens: `apple-touch-startup-image` entries with `media` queries
  covering every current iPhone and iPad, eliminating the blank flash on cold-start.
  13 portrait splash sizes generated (640–2048 px wide), all using the app canvas colour
  (#0B0F14) with the icon centred — no white or system-default grey frame.
- `format-detection` meta tag (`telephone=no, date=no, email=no, address=no`) to suppress
  iOS auto-linking of phone numbers, dates, and addresses in rendered text.

### Fixed (v1.4.0)
- **iOS notch / status-bar overlap** — `@media (max-width: 768px)` reset `.topbar`'s
  shorthand padding to `0 16px`, silently overriding the `@supports` block's
  `padding-top: env(safe-area-inset-top)`. The topbar content was running straight
  into the status bar when launched in standalone mode on any iPhone with a notch.
  Fixed by re-applying the safe-area padding inside the mobile block and changing
  `height: 56px` → `min-height: 56px` so the bar grows rather than the content
  shrinking.
- **Assistant FAB hidden behind home indicator** — `.assistant-fab { bottom: 16px }`
  on mobile doesn't respect `env(safe-area-inset-bottom)`, so the FAB overlapped
  the home bar on all edge-to-edge iPhones. Fixed with
  `bottom: max(16px, env(safe-area-inset-bottom, 0px))` (and matching `right:` for
  landscape notch clearance).

### Added (v1.3.0)
- Phantom install card: when a new game server install starts, a dashed card appears in the
  fleet immediately showing install progress. The pill text updates through "Preparing…",
  "Downloading…", and "Deploying…" phases as kgsm emits events. All connected users see the
  phantom — the card is driven by `job.patch` SSE, not just by the user who initiated the install.
- On install failure the card switches to a red "Failed" pill with a Dismiss button.
- The phantom is replaced in-place by the real server card when install completes.

### Added
- Crash-policy rows in the Startup & recovery card: "Restart on crash" toggle and
  "Max consecutive restarts" select (shown only when restart-on-crash is on).
  Wired to `crashRestart` / `crashMaxRestarts` in GET/PATCH /servers/{id}/settings;
  watchdog-gated alongside autostart.
- Auto-backup rows in Scheduled tasks card: "Back up before restart" toggle and
  "Keep N backups" retention input (shown only when a restart cadence is set).
  "Last backup" read-only row shows most-recent backup timestamp and status from
  the scheduler socket.

## [1.0.0] - 2026-07-03

### Added
- **Scheduled restart card** in server Settings. Cadence (off/daily/weekly/6h), time,
  day-of-week (weekly only), optional timezone override, and next-scheduled-restart
  timestamp from the kgsm-scheduler leaf. Scheduler-gated — gracefully absent when
  the leaf is not deployed.

## [0.9.0] - 2026-07-03

### Added
- **Settings Phase 2 — Resources.** CPU priority (Low/Normal/High) and Memory cap (MiB, 0=uncapped)
  rows are now live in the Settings tab, watchdog-gated. CPU priority is live-applied to the running
  cgroup; memory cap persists to config and takes effect at next restart (noted in the sub-label).
  Both show the current values from the API on load.

## [0.8.0] - 2026-07-03

### Added
- **Settings Phase 1 — Autostart.** The Startup & recovery section is now live: shows an Autostart
  toggle when the watchdog capability is healthy (Save/Reset wire through). When watchdog is offline,
  shows an honest "Watchdog offline — autostart unavailable" message instead of the Phase 1 placeholder.
  The "—" sentinel appears when the watchdog is provisioned but the GET couldn't read the value.

## [0.7.0] - 2026-07-03

### Added
- **Settings tab wired (Phase 0).** `ServerSettings.jsx` is now live: loads settings from
  `GET /servers/{id}/settings`, auto-update toggle is wired end-to-end, Save and Reset buttons
  call `PATCH /servers/{id}/settings`, Delete button calls `DELETE /servers/{id}` with a
  two-step confirmation and navigates to the server list on 202 acceptance. Startup & recovery,
  Scheduled tasks, and Resources sections show honest "Available in Phase N" placeholders until
  their primitives land. `fetchSettings`, `patchSettings`, and `deleteServer` added to `stores.js`.

## [0.6.0] - 2026-07-02

### Changed
- **Realtime transport migrated from WebSocket to fetch-based SSE.** `GET /api/v1/stream`
  is now `text/event-stream` (topics chosen via `?topics=`, bearer sent as an `Authorization`
  header instead of `?access_token=`). Fixes the class of WS-401 incidents caused by a
  browser being unable to set headers on a WS handshake and an opaque `1006` close on
  auth failure — SSE surfaces a readable `401` that heals through the same reactive
  rotate-on-401 path as every REST call. One persistent **primary** stream per host
  (global topics, drives `realtimeStore` mode + `rehydrateAll`) plus ref-counted
  **dynamic** per-topic streams for resource-scoped views. Dropped all client-side token
  expiry prediction (`tokenExpMs`/`tokenExpired`/`wsBearer`); the Dashboard Ping KPI is
  now REST-timed (`GET /health` RTT) instead of a WS ping/pong.

## [0.5.1] - 2026-07-01

### Fixed
- **Player roster desktop layout**: Status, First seen, and Last seen columns no longer
  shrink excessively on wider screens. Added minimum column widths (`110px`/`120px`) to
  prevent squishing while preserving the mobile layout.

## [0.5.0] - 2026-07-01

### Added
- **Unified permanent player roster view**: `GET /servers/{id}/players` now returns the
  full history roster (every player who has ever connected, with status, first seen, last seen).
  Status indicator with colored dot + text label. Mobile responsive: time columns hidden on
  small screens, status label visible.

## [0.4.0] - 2026-07-01

### Added
- **Players tab wired to the frozen player-presence contract** (`player-presence-contract.md`
  §5): `GET /servers/{id}/players` hydrates the roster, then the `players` WS topic
  (`players.join`/`players.leave`, keyed by `sessionKey`) follows live joins/leaves —
  tail-then-follow, same ordering guarantee as the Console tab. Replaces the old
  prototype scaffold (ping/playtime/online-banned-allowlist status/kick-ban actions —
  none of which the backend can honestly source) with a thin, honest roster: a row's
  label falls back name → addr → sessionKey (never blank), and `detection:"unknown"`
  renders an explicit "presence not available for this game" — never a fabricated
  "0 players online".
- **`players.reset` handling**: the api clears its own roster on an instance
  stop/start/restart (a killed process emits no `players.leave` lines), so a
  `{type:"players.reset", data:{serverId}}` frame tells an already-open tab to drop
  its stale rows too — no REST refetch needed, a rejoin flows back in as an
  ordinary `players.join`. Prevents phantom "connected" rows surviving a restart.

## [0.3.0] - 2026-07-01

### Changed
- **Session handling rewritten to a reactive model — the API is the authority.**
  The client no longer predicts access-token expiry. It uses whatever token it
  holds and rotates only when told to: an HTTP `401` response rotates the refresh
  token and replays the call once (`hostScoped.withRetry`), and that is the entire
  REST freshness story. Removed the proactive-refresh `setTimeout`, the
  `EXPIRY_SKEW_MS` margin, the separately-tracked shadow `exp`/`capExp` fields, and
  the `visibilitychange` pre-freshen — every WebSocket 401 bug we've had came from
  one of those trying to *predict* expiry and drifting out of sync with the real
  token. `sessionStore` collapses to `token()` / `rotate()` / `authorize()`.
- **WebSocket auth:** because a browser hides a WS-handshake `401` as an opaque
  `1006` close, the socket can't heal reactively like REST. It (and only it) reads
  the access token's own JWT `exp` claim right before dialing (`tokenExpired`) and
  rotates a lapsed token first, so it never opens a connection the API would reject.
  This subsumes the v0.2.1 stop-gap.

## [0.2.1] - 2026-07-01

### Fixed
- Realtime WebSocket 401-loop after a token lapses (e.g. a tab left open overnight,
  then refreshed). The session freshness gate keyed off a client-tracked `exp` field
  that could drift ahead of — or be missing from — the access token's real expiry,
  so a dead token read back as `live`, the funnel handed it to the socket, and it
  401-looped forever without ever attempting a refresh. The token's own JWT `exp`
  claim (exactly what the API validates) is now authoritative in the freshness gate,
  the persisted-session read, and the proactive-refresh timing; the stored `exp` is
  demoted to a faithful cache of that claim (written from the token, never computed
  independently). Auth-disabled hosts and non-JWT bearers are unaffected.

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
