# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
