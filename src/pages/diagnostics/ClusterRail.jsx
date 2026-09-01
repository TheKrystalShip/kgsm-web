// ClusterRail — the Reach card: every member of the cluster on one axis, measured from HERE.
//
// The panel belongs to no cluster and reaches every member across a network, so the only spatial
// fact it holds is how long each one takes to answer. That is the axis, and it runs left to right
// because a card is wide: a dial spends its width on empty corners and puts each member's label
// wherever a hash happens to send it.
//
// THE SCALE IS BANDED, and that is the load-bearing decision. A continuous axis is ruled by its
// furthest member — one peer over a slow link squeezes every LAN member into the first few pixels
// and the picture stops separating the members it is drawn to separate. So the axis is cut into
// three bands of FIXED width, each with its own scale, and a member is placed inside the band it
// belongs to. A member at 400ms lands in the far band and moves nothing else.
//
// A member nobody has timed is not slow, it is unmeasured, and it parks on the dashed siding past
// the end of the axis rather than being placed at a distance nothing measured.
//
// Below the layout breakpoint the axis stops being an axis — exact position inside a band is
// unreadable at phone width — and the same bands render as sections with the members as rows. Same
// data, same grouping, same order.

import React from "react";
import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { compareNodeNames, formatLatency } from "../../lib/nodeLabel.js";
import { membershipRowTone } from "./clusterBadges.jsx";

// ---- geometry ------------------------------------------------------------
const VB_W = 1120;
const VB_H = 244;
const AXIS_Y = 112;
const ORIGIN_X = 44;

// Band edges in milliseconds, and where each band starts and ends on the axis. The two numbers that
// split the bands are the only figures here anybody chose; everything else is measured.
const NEAR_MS = 5;      // within a subnet, in practice
const LINK_MS = 100;    // across a link, in practice
const BANDS = [
  { from: 0,       to: NEAR_MS, x0: 84,  x1: 500,  label: "SAME SUBNET · UNDER 5ms" },
  { from: NEAR_MS, to: LINK_MS, x0: 500, x1: 860,  label: "ACROSS A LINK · 5–100ms" },
  { from: LINK_MS, to: null,    x0: 860, x1: 1000, label: "FARTHER" },
];
const SIDING_X0 = 1040;
const SIDING_X1 = 1112;
const FAR_CAP_MS = 500;   // past this everything reads as "far"; never extrapolated further

// Ticks inside each band. Denser than the band edges alone, because the edges say which band a
// member is in and these say roughly where in it — which is the whole reason the axis is drawn
// rather than listed.
const TICKS = [1, 2, 3, 4, 10, 25, 50, 75, 250];

// railX(ms) — a millisecond reading to its place on the axis. Linear inside the first two bands,
// log in the last so a member at two seconds does not sit on top of one at two hundred milliseconds.
function railX(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const v = Math.max(0, ms);
  if (v <= NEAR_MS) return BANDS[0].x0 + (v / NEAR_MS) * (BANDS[0].x1 - BANDS[0].x0);
  if (v <= LINK_MS) return BANDS[1].x0 + ((v - NEAR_MS) / (LINK_MS - NEAR_MS)) * (BANDS[1].x1 - BANDS[1].x0);
  const t = Math.min(1, Math.log1p(v - LINK_MS) / Math.log1p(FAR_CAP_MS - LINK_MS));
  return BANDS[2].x0 + t * (BANDS[2].x1 - BANDS[2].x0);
}

// bandOf(ms) — which band a reading falls in, or null for a member nothing has timed.
function bandOf(ms) {
  if (ms == null) return null;
  if (ms <= NEAR_MS) return 0;
  if (ms <= LINK_MS) return 1;
  return 2;
}

// place(entries) — an x for every member, then labels that do not land on each other.
//
// Members a millisecond apart are pixels apart, so the labels alternate above and below the axis
// and lengthen their stem whenever the last pin on the same side was too close to clear. The order
// is by position and then by name, so the arrangement is the same on every render: a picture that
// reshuffles when a reading moves by a tenth of a millisecond reads as members moving.
// The short stem clears the tick labels under the axis rather than merely clearing the axis: a dot
// sitting on "4ms" is a member captioned with a scale mark.
const STEM_SHORT = 46;
const STEM_LONG = 76;
const CLEAR_PX = 128;

function place(entries) {
  const measured = (entries || [])
    .filter(e => e.latencyMs != null)
    .map(e => ({ e, x: railX(e.latencyMs) }))
    .sort((a, b) => a.x - b.x || compareNodeNames(nameOf(a.e), nameOf(b.e)));

  const last = { up: null, down: null };
  const placed = measured.map((p, i) => {
    const side = i % 2 === 0 ? "up" : "down";
    const prev = last[side];
    const long = prev != null && p.x - prev.x < CLEAR_PX ? !prev.long : false;
    const seat = { ...p, side, long, stem: long ? STEM_LONG : STEM_SHORT };
    last[side] = seat;
    return seat;
  });

  const unmeasured = (entries || [])
    .filter(e => e.latencyMs == null)
    .sort((a, b) => compareNodeNames(nameOf(a), nameOf(b)));

  return { placed, unmeasured };
}

const nameOf = (e) => (e.fed && e.fed.label) || (e.host && e.host.name) || e.key;
const isAnchor = (e) => !!(e.fed && e.fed.kind === "anchor");
const capOf = (e, capabilityRows) => {
  const id = (e.fed && e.fed.nodeId) || (e.host && e.host.id);
  if (!id) return null;
  const held = (capabilityRows || []).find(c => c.held && !c.orphaned && c.memberId === id);
  return held ? held.capability : null;
};

// The dot's colour is the member's standing, taken from the same vocabulary the badges use so a pin
// and the row it belongs to can never disagree. A member with no roster row has no standing to
// report and reads as unknown rather than as healthy.
const TONE_FILL = { success: "var(--success)", warn: "var(--warning)", danger: "var(--danger)", off: "var(--fg-4)" };
function toneOf(e) {
  if (e.fed) return membershipRowTone(e.fed.membership);
  if (e.host) return e.host.online ? "success" : "off";
  return "off";
}

// ---- one member, on the axis --------------------------------------------
function Pin({ seat, capability, hovered, onHover, onSelect }) {
  const e = seat.e;
  const key = e.key;
  const isHovered = hovered === key;
  const dim = hovered && !isHovered;
  const x = seat.x;
  const dir = seat.side === "up" ? -1 : 1;
  const dotY = AXIS_Y + dir * seat.stem;
  const tone = toneOf(e);
  const fill = TONE_FILL[tone] || "var(--fg-4)";
  const ms = formatLatency(e.latencyMs);
  // Above the axis the name sits over the dot; below it, under. Either way the reading is the
  // outermost line, so a column of members reads name-then-number in the same direction.
  const nameY = seat.side === "up" ? dotY - 15 : dotY + 17;
  const subY = seat.side === "up" ? dotY - 28 : dotY + 30;
  // SVG hit-testing is per painted shape, so a group of a line, a dot and two labels answers to
  // the pointer only where ink actually is — the gaps between them are holes. One transparent
  // rectangle over the whole pin makes the target the thing a person is aiming at.
  const hitTop = seat.side === "up" ? subY - 12 : AXIS_Y - 8;
  const hitH = Math.abs(dotY - AXIS_Y) + 42;

  return (
    <g
      className={"cluster-rail__pin" + (isHovered ? " is-hovered" : "") + (dim ? " is-dim" : "")}
      tabIndex={0}
      role="button"
      aria-label={nameOf(e) + ", " + ms + (capability ? ", serves " + capability : "")}
      onMouseEnter={() => onHover(key)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(key)}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(key)}
      onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(key); } }}
    >
      <rect x={x - 46} y={hitTop} width="92" height={hitH} className="cluster-rail__hit" />
      <line x1={x} y1={AXIS_Y} x2={x} y2={dotY} className="cluster-rail__stem" />
      {isAnchor(e) ? (
        <rect x={x - 7} y={dotY - 7} width="14" height="14" rx="2"
          transform={"rotate(45 " + x + " " + dotY + ")"}
          fill={e.ghost ? "none" : fill} stroke={fill} strokeWidth={e.ghost ? 1.5 : 0}
          strokeDasharray={e.ghost ? "2.5 2.5" : undefined} />
      ) : (
        <circle cx={x} cy={dotY} r={isHovered ? 8 : 6.5}
          fill={e.ghost ? "none" : fill} stroke={fill} strokeWidth={e.ghost ? 1.5 : 0}
          strokeDasharray={e.ghost ? "2.5 2.5" : undefined} />
      )}
      <text x={x} y={nameY} className="cluster-rail__name" textAnchor="middle">{nameOf(e)}</text>
      <text x={x} y={subY} className={"cluster-rail__sub" + (capability ? " cluster-rail__sub--cap" : "")} textAnchor="middle">
        {capability ? capability.toUpperCase() + " · " + ms : ms}
      </text>
    </g>
  );
}

// ---- the phone form ------------------------------------------------------
// The bands become sections and the members become rows. Nothing is dropped and nothing is
// summarised — the axis is what goes, because a position inside a band is not readable here.
function RailRows({ entries, capabilityRows, hovered, onHover, onSelect }) {
  const groups = BANDS.map((b, i) => ({
    band: b,
    rows: (entries || [])
      .filter(e => bandOf(e.latencyMs) === i)
      .sort((a, b2) => a.latencyMs - b2.latencyMs),
  })).filter(g => g.rows.length);
  const unmeasured = (entries || []).filter(e => e.latencyMs == null);

  const Row = ({ e }) => (
    <button
      className={"cluster-rail-row" + (hovered === e.key ? " is-hovered" : "")}
      onMouseEnter={() => onHover(e.key)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(e.key)}
    >
      <span className={"dash-fleet-row__dot dash-fleet-row__dot--" + toneOf(e)}></span>
      <span className="cluster-rail-row__name">{nameOf(e)}</span>
      {capOf(e, capabilityRows) && <span className="cluster-chip cluster-chip--cap">{capOf(e, capabilityRows)}</span>}
      <span className="cluster-rail-row__ms">{formatLatency(e.latencyMs)}</span>
    </button>
  );

  return (
    <div className="cluster-rail-rows">
      {groups.map(g => (
        <div className="cluster-rail-rows__band" key={g.band.label}>
          <div className="cluster-rail-rows__head">{g.band.label}</div>
          {g.rows.map(e => <Row key={e.key} e={e} />)}
        </div>
      ))}
      {unmeasured.length > 0 && (
        <div className="cluster-rail-rows__band cluster-rail-rows__band--none">
          <div className="cluster-rail-rows__head">NOT MEASURED</div>
          {unmeasured.map(e => <Row key={e.key} e={e} />)}
        </div>
      )}
    </div>
  );
}

// The layout swap is a media query read in JS rather than two rendered trees with one hidden: the
// hidden copy would still be in the accessibility tree, and every member would be announced twice.
function useNarrow(query = "(max-width: 720px)") {
  const [narrow, setNarrow] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false);
  React.useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

function ClusterRail({ entries, capabilityRows, hovered, onHover, onSelect }) {
  const narrow = useNarrow();
  const { placed, unmeasured } = React.useMemo(() => place(entries), [entries]);
  const list = entries || [];

  if (!list.length) {
    return (
      <BriefCard icon="waypoints" title="Reach" count={0} countTone="neutral" className="cluster-rail-card">
        <div className="cluster-rail__empty">
          <Icon name="waypoints" size={15} />
          <span>No members yet — add a node.</span>
        </div>
      </BriefCard>
    );
  }

  return (
    <BriefCard icon="waypoints" title="Reach" count={list.length} countTone="neutral" className="cluster-rail-card">
      {narrow ? (
        <RailRows entries={list} capabilityRows={capabilityRows} hovered={hovered} onHover={onHover} onSelect={onSelect} />
      ) : (
        <div className="cluster-rail">
          <svg viewBox={"0 0 " + VB_W + " " + VB_H} className="cluster-rail__svg"
            role="img" aria-label="Cluster members by round trip from this browser">
            {BANDS.map((b, i) => (
              <rect key={b.label} x={b.x0} y={AXIS_Y - 18} width={b.x1 - b.x0} height="36"
                className={"cluster-rail__band cluster-rail__band--" + i} />
            ))}

            <line x1={ORIGIN_X} y1={AXIS_Y} x2={BANDS[2].x1} y2={AXIS_Y} className="cluster-rail__axis" />
            <line x1={SIDING_X0} y1={AXIS_Y} x2={SIDING_X1} y2={AXIS_Y} className="cluster-rail__axis cluster-rail__axis--siding" />

            {[NEAR_MS, LINK_MS].map(ms => (
              <line key={"edge" + ms} x1={railX(ms)} y1={AXIS_Y - 16} x2={railX(ms)} y2={AXIS_Y + 16}
                className="cluster-rail__edge" />
            ))}

            <g className="cluster-rail__ticks">
              {TICKS.map(ms => (
                <React.Fragment key={ms}>
                  <line x1={railX(ms)} y1={AXIS_Y - 5} x2={railX(ms)} y2={AXIS_Y + 5} />
                  <text x={railX(ms)} y={AXIS_Y + 20} textAnchor="middle">{ms}ms</text>
                </React.Fragment>
              ))}
            </g>

            <g className="cluster-rail__bandnames">
              {BANDS.map(b => <text key={b.label} x={b.x0 + 6} y={VB_H - 8}>{b.label}</text>)}
              {unmeasured.length > 0 && <text x={SIDING_X1} y={VB_H - 8} textAnchor="end">NOT MEASURED</text>}
            </g>

            {/* Where every reading was taken from. Not a member, so it carries no name and answers
                to nothing — the axis label says what it is. */}
            <g aria-hidden="true">
              <circle cx={ORIGIN_X} cy={AXIS_Y} r="15" className="cluster-rail__origin-ring" />
              <circle cx={ORIGIN_X} cy={AXIS_Y} r="9" fill="var(--krystal-teal)" />
              <text x={ORIGIN_X} y={AXIS_Y - 26} className="cluster-rail__origin-label" textAnchor="middle">YOU</text>
            </g>

            {placed.map(seat => (
              <Pin key={seat.e.key} seat={seat} capability={capOf(seat.e, capabilityRows)}
                hovered={hovered} onHover={onHover} onSelect={onSelect} />
            ))}

            {unmeasured.map((e, i) => {
              const x = SIDING_X0 + 18 + i * 30;
              const isHovered = hovered === e.key;
              return (
                <g key={e.key}
                  className={"cluster-rail__pin cluster-rail__pin--none" + (isHovered ? " is-hovered" : "")
                    + (hovered && !isHovered ? " is-dim" : "")}
                  tabIndex={0} role="button"
                  aria-label={nameOf(e) + ", round trip not measured"}
                  onMouseEnter={() => onHover(e.key)} onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(e.key)} onBlur={() => onHover(null)}
                  onClick={() => onSelect(e.key)}
                  onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(e.key); } }}
                >
                  <rect x={x - 34} y={AXIS_Y - 56} width="68" height="64" className="cluster-rail__hit" />
                  <line x1={x} y1={AXIS_Y} x2={x} y2={AXIS_Y - 30} className="cluster-rail__stem cluster-rail__stem--none" />
                  <circle cx={x} cy={AXIS_Y - 30} r="6.5" fill="none"
                    stroke={TONE_FILL[toneOf(e)] || "var(--fg-4)"} strokeWidth="1.5" strokeDasharray="2.5 2.5" />
                  <text x={x} y={AXIS_Y - 45} className="cluster-rail__name" textAnchor="middle">{nameOf(e)}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </BriefCard>
  );
}

export { ClusterRail, bandOf, railX };
