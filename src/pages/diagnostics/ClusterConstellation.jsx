// ClusterConstellation — the Cluster page's latency-topology centerpiece. THIS
// BROWSER is the center, because it is where every radius is measured from —
// the panel is a static artifact belonging to no cluster, so no member is
// nearer than another and none is pinned to the middle. Every member is placed
// on two honest axes only: radius from `entry.latencyMs` (a connected node's client-measured
// round-trip via pingStore, or a "ghost" — a federation peer with no connected
// host — its gossip-reported latency; never a fabricated distance) and angle
// from a stable hash of its node id (so a node always sits in the same
// direction and the layout never reshuffles when peers join or leave). Dot
// color follows federation membership where a match exists, else the node's
// own health tone; edge style follows federation reachability status, or reads
// as honestly "unknown" when there's no federation match at all. A node with
// no latency sample yet parks on the outer dashed "unmeasured" ring rather
// than guessing. A ghost renders as a hollow dashed-outline dot — discovered
// by federation gossip, but this browser holds no host session for it, so
// there's no capacity to show, only the membership/status the gossip carries.

import React from "react";
import { BriefCard } from "../../components/BriefCard.jsx";
import { hostHealth } from "../../components/HostCardBody.jsx";
import { Icon } from "../../components/Icon.jsx";
import { membershipMeta } from "./clusterBadges.jsx";

const VB = 320;
const CENTER = VB / 2;
const R_MIN = 56;      // closest ring — right outside the origin marker
const LOW_MS = 10;     // the LAN band: 0–10ms is stretched linearly for maximum
                       // separation between same-subnet nodes, which otherwise
                       // all land within a few ms of each other
const R_LOW = 110;     // radius at the LOW_MS boundary
const R_MAX = 140;     // farthest MEASURED ring (log-scaled beyond LOW_MS)
const R_UNMEASURED = 152;  // outer dashed ring for null-latency nodes
const LAT_CAP_MS = 250;    // beyond this everything reads as "far" — never extrapolated
const TICK_BANDS_MS = [10, 40, 150];

const HEALTH_TONE_COLOR = { success: "var(--success)", warn: "var(--warning)", danger: "var(--danger)", off: "var(--fg-4)" };
const MEMBERSHIP_TONE_COLOR = { ok: "var(--success)", provisional: "var(--warning)", warn: "var(--warning)", danger: "var(--danger)", muted: "var(--fg-4)" };

// latencyRadius — two honest segments so single-digit-ms LAN nodes stay
// visibly distinct from each other instead of bunching just outside the
// origin marker: a LINEAR stretch across 0–LOW_MS (where most same-subnet peers
// live), then a log scale from LOW_MS out to LAT_CAP_MS so a 250ms+ node still
// doesn't get pushed absurdly far out. The two segments meet at LOW_MS with no
// jump (both evaluate to R_LOW there).
function latencyRadius(ms) {
  const v = Math.max(0, Math.min(LAT_CAP_MS, ms));
  if (v <= LOW_MS) return R_MIN + (v / LOW_MS) * (R_LOW - R_MIN);
  const t = Math.log1p(v - LOW_MS) / Math.log1p(LAT_CAP_MS - LOW_MS);
  return R_LOW + t * (R_MAX - R_LOW);
}

// hashAngle — deterministic direction for a node id (FNV-1a-ish), so the same
// node always lands in the same slice of the circle across refreshes.
function hashAngle(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 360;
}

function angularDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// placeNodes — radius from latency, angle from the hash, with a small
// deterministic nudge when two nodes land in the same band at a near-equal
// angle so their dots don't overlap. The nudge order is a stable sort by key,
// so it never changes shape from one render to the next.
function placeNodes(entries) {
  const withPos = entries.map(e => {
    const ms = e.latencyMs != null ? e.latencyMs : null;
    return {
      ...e,
      _radius: ms != null ? latencyRadius(ms) : R_UNMEASURED,
      _angle: hashAngle(e.key),
      _unmeasured: ms == null,
    };
  });
  const ordered = [...withPos].sort((a, b) => a.key.localeCompare(b.key));
  const MIN_GAP_DEG = 16;
  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < i; j++) {
      if (Math.abs(ordered[i]._radius - ordered[j]._radius) < 22 && angularDiff(ordered[i]._angle, ordered[j]._angle) < MIN_GAP_DEG) {
        ordered[i]._angle = (ordered[j]._angle + MIN_GAP_DEG) % 360;
      }
    }
  }
  return ordered.map(p => {
    const rad = (p._angle * Math.PI) / 180;
    return { ...p, _cx: CENTER + p._radius * Math.cos(rad), _cy: CENTER + p._radius * Math.sin(rad) };
  });
}

// dotColor — membership (federation liveness) wins when a match exists (this
// is the ONLY axis a ghost — no connected host — can render, since it has no
// host to derive a health tone from); a connected host with no federation
// match falls back to its own measured health tone. Never a guess in either
// direction.
function dotColor(entry) {
  if (entry.fed) return MEMBERSHIP_TONE_COLOR[membershipMeta(entry.fed.membership).tone] || "var(--fg-4)";
  if (!entry.host) return "var(--fg-4)";
  return HEALTH_TONE_COLOR[hostHealth(entry.host).tone] || "var(--fg-4)";
}

function isPulsing(entry) {
  return !!entry.fed && entry.fed.membership === "joining";
}

// edgeStyle — status is a federation-reported axis; with no federation match
// at all it honestly reads as "unknown" rather than inferring from host.online
// (host connectivity and federation reachability are different questions).
function edgeStyle(entry) {
  if (entry.fed) {
    if (entry.fed.enabled === false) return { stroke: "var(--fg-4)", dash: "2 4", opacity: 0.3 };
    if (entry.fed.status === "reachable") return { stroke: "var(--success)", dash: null, opacity: 0.5 };
    if (entry.fed.status === "unreachable") return { stroke: "var(--danger)", dash: "3 4", opacity: 0.45 };
    return { stroke: "var(--fg-3)", dash: "3 4", opacity: 0.35 };
  }
  return { stroke: "var(--fg-3)", dash: "3 4", opacity: 0.26 };
}

function fmtLatencyMs(ms) {
  return ms != null ? Math.round(ms) + "ms" : "—";
}

// OriginMarker — where the radii are measured from: this browser. Not a member, so it
// carries no name, answers to no hover and goes nowhere when pressed. Hidden from a screen
// reader, which reads the dial's own label instead — "you are here" is the one thing about
// this picture that a list of members already conveys.
function OriginMarker() {
  return (
    <g className="cluster-constellation__origin" aria-hidden="true">
      <circle cx={CENTER} cy={CENTER} r={19} className="cluster-constellation__origin-ring" />
      <circle cx={CENTER} cy={CENTER} r={13} fill="var(--krystal-teal)" />
    </g>
  );
}

function ClusterConstellation({ nodes, hovered, onHover, onSelect }) {
  const placed = React.useMemo(() => placeNodes(nodes), [nodes]);

  const focus = (key) => { if (onHover) onHover(key); };
  const blur = () => { if (onHover) onHover(null); };
  const select = (key) => { if (onSelect) onSelect(key); };
  const keySelect = (key) => (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(key); } };

  return (
    <BriefCard icon="waypoints" title="Topology" count={nodes.length} countTone="neutral" className="cluster-constellation-card">
      {placed.length === 0 ? (
        <div className="cluster-constellation cluster-constellation--empty">
          <svg viewBox={`0 0 ${VB} ${VB}`} className="cluster-constellation__svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="No members yet">
            <OriginMarker />
          </svg>
          <div className="cluster-constellation__empty-copy">
            <Icon name="waypoints" size={15} />
            <span>No members yet — add a node.</span>
          </div>
        </div>
      ) : (
        <div className="cluster-constellation">
          <svg viewBox={`0 0 ${VB} ${VB}`} className="cluster-constellation__svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Node latency topology">
            {/* Latency ring gridlines — the scale is named once in the caption
                below the dial rather than labelled per-ring, so a node's own
                label never collides with a ring tick near the top (the outer
                rings are radially compressed by the log scale, which crowds any
                per-ring labels stacked there). */}
            {TICK_BANDS_MS.map(ms => (
              <circle key={"ring" + ms} cx={CENTER} cy={CENTER} r={latencyRadius(ms)} className="cluster-constellation__ring" />
            ))}
            <circle cx={CENTER} cy={CENTER} r={R_UNMEASURED} className="cluster-constellation__ring cluster-constellation__ring--unmeasured" />

            {/* Edges — drawn under the dots */}
            {placed.map(p => {
              const es = edgeStyle(p);
              const isHovered = hovered === p.key;
              const dim = hovered && !isHovered;
              return (
                <line key={"edge-" + p.key}
                  x1={CENTER} y1={CENTER} x2={p._cx} y2={p._cy}
                  className="cluster-constellation__edge"
                  stroke={es.stroke}
                  strokeDasharray={es.dash || undefined}
                  opacity={dim ? es.opacity * 0.35 : (isHovered ? Math.min(1, es.opacity + 0.4) : es.opacity)}
                />
              );
            })}

            {/* Peer nodes — a "ghost" (fed match, no connected host) renders
                as a hollow dashed-outline dot: discovered by federation gossip,
                but this browser holds no host session for it, so there's no
                capacity/health to show — never invented. */}
            {placed.map(p => {
              const isHovered = hovered === p.key;
              const dim = hovered && !isHovered;
              const label = p.fed ? p.fed.label : (p.host ? p.host.name : "unknown node");
              const color = dotColor(p);
              const nodeClass = "cluster-constellation__node"
                + (isHovered ? " cluster-constellation__node--hovered" : "")
                + (dim ? " cluster-constellation__node--dimmed" : "")
                + (p.ghost ? " cluster-constellation__node--ghost" : "");
              return (
                <g key={"dot-" + p.key}
                  className={nodeClass}
                  tabIndex={0}
                  role="button"
                  aria-label={label + (p.ghost ? ", discovered, not connected, " : ", ") + (p._unmeasured ? "latency unmeasured" : fmtLatencyMs(p.latencyMs))}
                  onMouseEnter={() => focus(p.key)}
                  onMouseLeave={blur}
                  onFocus={() => focus(p.key)}
                  onBlur={blur}
                  onClick={() => select(p.key)}
                  onKeyDown={keySelect(p.key)}
                >
                  <circle cx={p._cx} cy={p._cy} r={isHovered ? 9 : 7}
                    fill={p.ghost ? "none" : color}
                    style={p.ghost ? { stroke: color, strokeDasharray: "2 2" } : undefined}
                    className={"cluster-constellation__dot" + (isPulsing(p) ? " cluster-constellation__dot--pulse" : "") + (p.ghost ? " cluster-constellation__dot--ghost" : "")} />
                  <text x={p._cx} y={p._cy - 13} className="cluster-constellation__label" textAnchor="middle">{label}</text>
                  <text x={p._cx} y={p._cy + 19} className={"cluster-constellation__latency" + (isHovered ? " cluster-constellation__latency--emphasis" : "")} textAnchor="middle">
                    {p._unmeasured ? "—" : fmtLatencyMs(p.latencyMs)}
                  </text>
                </g>
              );
            })}

            {/* Drawn last so the members' edges pass under it rather than over. */}
            <OriginMarker />
          </svg>
          <div className="cluster-constellation__scale" aria-hidden="true">
            latency rings · {TICK_BANDS_MS.map(ms => ms + "ms").join(" · ")} · <span className="cluster-constellation__scale-muted">dashed = unmeasured</span>
          </div>
        </div>
      )}
    </BriefCard>
  );
}

export { ClusterConstellation };
