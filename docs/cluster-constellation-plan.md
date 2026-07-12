# Cluster page — constellation redesign (implementation spec)

Authority for the Cluster page unification + latency-topology "constellation" centerpiece.
This is the canon the scheduled 21:15 run implements. Present-tense canon rules apply to any
doc/comment written *into the repo* — but this plan file may describe intent.

## Goal

Unify the Cluster page (`#/cluster`) onto one primitive — the **node** — and give it a
latency-topology **constellation** centerpiece. Retire the deprecated "hosts"/fleet-grid design.

## Two decisions already locked (do not relitigate)

- **Centerpiece = constellation (latency topology), NOT a world map.** Nodes carry zero geo
  data (`nodeId · label · clientUrl · membership · status · latencyMs · lastSeen · enabled ·
  apiVersion · peerId · isAdmin`). Never fabricate location. The constellation uses only fields
  that already exist — `membership` + `latencyMs` + `status` — which is what an operator
  actually watches.
- **Reuse `BriefCard`.** BOTH the node list AND the constellation are wrapped in `BriefCard`,
  matching the proven dashboard "Fleet capacity" card family.

## Component reuse — exact pointers

- **`BriefCard`** — `src/components/BriefCard.jsx` (named export `{ BriefCard }`). Props:
  `icon, title, count, countTone, meta, onViewAll, viewAllLabel, action, className, children`.
  Renders `.chat-brief` shell (header w/ icon+title+optional count pill + right action) then
  `{children}`. Styles: `src/styles/kit/chat.css` (`.chat-brief*`).
- **Node-list pattern to mirror = "Fleet capacity"** — `src/pages/dashboard/DashFleetStrip.jsx`
  (`DashFleetStrip`). It wraps `BriefCard` (`icon="server-cog"`, `countTone="neutral"`,
  `onViewAll`, `className="dash-fleet"`) around `<div className="dash-fleet__rows">` of
  `<button className="dash-fleet-row dash-fleet-row--<tone>">` rows. Row anatomy = grid
  `200px minmax(0,1fr) 52px`: `[dot + name + region-pill] | [meters or offline msg] | [chevron/alert]`.
  Row/meter styles: `src/styles/kit/hosts.css` (`.dash-fleet-row*`, `.fleet-meter*`).
  Build a `ClusterNodeList` component in the same spirit: one BriefCard, one row per node,
  row = `[membership-dot + label + nodeId-pill] | [StatusChip + latency] | [chevron/admin actions]`.

## Data — the node shape (from `src/lib/stores/cluster.js`)

Normalized node (both `fromPeerRow` admin + `fromClusterNodeRow` viewer):
`{ nodeId, label, clientUrl, membership, status, latencyMs, lastSeen, enabled, apiVersion, peerId, isAdmin }`.
Store state: `{ nodes, status: idle|loading|ready|error, error, everLoaded, admin }`. Refresh
tries admin `GET /peers` then falls back to viewer `GET /peers/roster` on 403. `latencyMs`/`lastSeen`
may be null — honor null, never invent a distance.

The local node is `localHost` in ClusterPanel (name + hostname), rendered with a `--local` chip.

## Color/token mapping (already used by MembershipBadge/StatusChip in ClusterPanel.jsx)

Membership → dot color (tokens in `src/styles/tokens.css`, classes in `src/styles/kit/cluster.css`):
- alive → `--success`
- joining → `--warning` (pulsing, `kr-pulse 1.4s`)
- suspect → `--warning`
- dead → `--danger`
- left / unknown → `--fg-4` / `--fg-3`

Reachability (status) → edge:
- reachable → `--success` (solid edge)
- unreachable → `--danger` (dashed, faint)
- disabled (`enabled === false`, wins over status) → `--fg-4` / `--surface-3` (near-invisible)
- unknown → `--fg-3` (dashed)
- local node marker → `--krystal-teal`

All colors MUST come from CSS tokens — no hardcoded hex.

## The constellation component (`ClusterConstellation`)

Wrapped in a `BriefCard` (e.g. `icon="waypoints"` or `"radar"`, `title="Topology"`,
`count={nodes.length}`, `countTone="neutral"`). Inside, a hand-rolled inline SVG following the
conventions in `src/components/TimeSeriesChart.jsx`:
- Module-scoped `viewBox` constants; a centered coordinate system (local node at center).
- **Placement:** local node pinned center. Each peer: **radius = f(latencyMs)** (latency bands
  with faint concentric ring gridlines + mono 9px `--fg-4` tick labels, e.g. 20/60/150 ms);
  **angle = stable hash of `nodeId`** so a node always sits in the same direction and nothing
  reshuffles when peers join/leave. Add a small *deterministic* collision nudge for nodes that
  land in the same latency band + similar angle.
- `latencyMs == null` (joining / unmeasured) → park on an outer **dashed "unmeasured" ring**,
  labeled "—". Do not assign a fake radius.
- **Dot** color = membership (map above); joining pulses. **Edge** from center = status+latency
  (map above); latency number rides the edge, shown on hover.
- **Disabled** peers still drawn, greyed, visibly outside the trust boundary.
- On each poll, dots **ease** to new radius (CSS transition) rather than snap.
- **N=1** (no peers, only local): do NOT render an empty radar — show a single centered "you"
  marker + quiet "No peers yet — add a node." prompt.
- Interaction handled via an HTML overlay layer (like TimeSeriesChart) OR SVG hit-targets —
  whichever is cleaner; SVG is fine here since the viewBox isn't stretched (use a square/uniform
  `preserveAspectRatio`, unlike the time-series chart which stretches).

## Hover-sync (the headline feature)

One shared `hoveredNodeId` between the constellation and the node list (lift to the page /
DiagnosticsPage `ClusterPage`, or a tiny context — mirror `ChartHoverProvider` if useful):
- hover a **list row** → its dot scales + glows, its edge brightens + reveals latency, other dots dim.
- hover a **dot** → its list row outlines/lifts (+ scrollIntoView if offscreen).
- click either → select node → open the existing per-node deep-dive (overview/resources/services/logs).
- keyboard-focusable dots for a11y.

## Unification / cleanup

- Retire the `FleetHostCard` fleet-grid as the Cluster page body. The **node list is the body**
  now; the constellation sits above it. Both in BriefCards.
- Collapse the two-model split (client-registry "hosts" vs federation "peers") into one node list.
  Provenance (manually-added vs gossiped) becomes a small badge on the row, not a separate UI.
- Keep the per-node deep-dive tabs reachable (they still exist via ClusterPage's focusHostId path).
- `#/hosts` / `#/diagnostics` still resolve to `#/cluster` (router already does this) — leave.

## Files likely touched

- `src/pages/DiagnosticsPage.jsx` (ClusterPage — compose the two BriefCards, own hover state)
- `src/pages/diagnostics/ClusterPanel.jsx` (harvest MembershipBadge/StatusChip; may fold in)
- NEW `src/pages/diagnostics/ClusterConstellation.jsx`
- NEW `src/pages/diagnostics/ClusterNodeList.jsx`
- `src/styles/kit/cluster.css` (constellation + node-list styles; reuse tokens)
- Remove/retire fleet-grid usage on the cluster route (keep FleetHostCard file if still imported
  elsewhere — grep first).

## Verification (must do before declaring done)

1. `cd /home/heisen/tks/kgsm-web && npm run build` — clean.
2. Lint clean (`npm run lint` if present).
3. Visual: run the headless-visual recipe (Playwright chromium + auth-disabled dev kgsm-api, or
   the mock/visual harness) and actually LOAD `#/cluster`. Confirm: constellation renders, dots
   colored by membership, edges by status/latency, hover a row lights its dot and vice-versa,
   N=1 empty state, mobile/narrow collapse. Capture a screenshot into the scratchpad.
4. Do NOT commit or push unless the user asks — leave the working tree for review and summarize.
