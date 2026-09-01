// ClusterMap — where the cluster's members are, on a real map.
//
// The coastlines and the projection come from `euMap.js`, generated from Natural Earth: the shape
// is a survey rather than a drawing, and a member's coordinates land where the survey says they do.
// Nothing here estimates a position — a member is drawn only when it reports latitude and longitude,
// and every member that does not is named under the card as unplaced.
//
// MEMBERS IN ONE PLACE ARE ONE PIN. Three machines in a rack are three dots inside a millimetre and
// three labels on top of each other, which is a picture of nothing; they collapse into a site whose
// callout lists them, and each name in that callout is its own hover target.
//
// NOTHING IS DRAWN BETWEEN SITES. Every latency this panel holds was measured from the browser, and
// the browser is not on the map — a line from one site to another labelled with one of those figures
// would be captioning a link nobody timed.
//
// Hover is the page's, shared with the Nodes and Anchors cards and the reach rail: pointing at a
// member anywhere lights it everywhere.

import React from "react";
import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { compareNodeNames, formatLatency } from "../../lib/nodeLabel.js";
import { membershipRowTone } from "./clusterBadges.jsx";
import { EU_LAND, EU_VIEWBOX, euInFrame, euProject } from "./euMap.js";

// Two members closer together than this share a pin. It is a distance on the PLATE, not on the
// ground: what matters is whether two dots would overlap at the size the card is drawn.
const SITE_PX = 11;

const nameOf = (e) => (e.fed && e.fed.label) || (e.host && e.host.name) || e.key;
const TONE_FILL = { success: "var(--success)", warn: "var(--warning)", danger: "var(--danger)", off: "var(--fg-4)" };
function toneOf(e) {
  if (e.fed) return membershipRowTone(e.fed.membership);
  if (e.host) return e.host.online ? "success" : "off";
  return "off";
}

// sites(entries) — the placed members grouped into pins, plus everything that could not be placed.
//
// `offFrame` is its own answer: a member with real coordinates outside the drawn plate is located
// and simply not on this map, which is a different sentence from "nobody knows where it is".
function sites(entries) {
  const placed = [], unplaced = [], offFrame = [];
  for (const e of entries || []) {
    const loc = e.location;
    if (!loc) { unplaced.push(e); continue; }
    const pt = euProject(loc.lat, loc.lon);
    if (!pt) { unplaced.push(e); continue; }
    if (!euInFrame(pt)) { offFrame.push(e); continue; }
    placed.push({ e, pt });
  }

  // Greedy, in a stable order, so the same members always merge into the same site.
  placed.sort((a, b) => a.pt[0] - b.pt[0] || a.pt[1] - b.pt[1] || compareNodeNames(nameOf(a.e), nameOf(b.e)));
  const grouped = [];
  for (const p of placed) {
    const near = grouped.find(g => Math.hypot(g.x - p.pt[0], g.y - p.pt[1]) <= SITE_PX);
    if (near) { near.members.push(p.e); continue; }
    grouped.push({ x: p.pt[0], y: p.pt[1], members: [p.e] });
  }
  // The pin's name is the place, when the members agree on one. They disagree only when two
  // machines a street apart were located separately, and then the pin is named for neither.
  for (const g of grouped) {
    const cities = [...new Set(g.members.map(m => m.location && m.location.city).filter(Boolean))];
    g.label = cities.length === 1 ? cities[0] : null;
  }
  return { grouped, unplaced, offFrame };
}

// A site's callout. It sits to the right of the pin, flipping left near the frame's edge, and
// alternates up and down by index so two sites in the same country do not stack their labels.
function Callout({ site, index, hovered, onHover, onSelect }) {
  const flip = site.x > EU_VIEWBOX.w * 0.62;
  const dir = flip ? -1 : 1;
  const dy = (index % 2 === 0 ? -1 : 1) * 26;
  const lx = site.x + dir * 34;
  const ly = site.y + dy;
  const rowH = 15;
  const boxH = 16 + site.members.length * rowH;
  const boxW = 152;
  const boxX = flip ? lx - boxW : lx;
  const boxY = ly - boxH / 2;
  const anyHovered = site.members.some(m => m.key === hovered);

  return (
    <g className={"cluster-map__callout" + (anyHovered ? " is-hovered" : "")}>
      <path d={"M" + (site.x + dir * 7) + "," + site.y + " L" + (lx - dir * 6) + "," + ly + " L" + lx + "," + ly}
        className="cluster-map__leader" fill="none" />
      <rect x={boxX} y={boxY} width={boxW} height={boxH} rx="4" className="cluster-map__box" />
      {site.label && (
        <text x={boxX + 9} y={boxY + 13} className="cluster-map__site">{site.label}</text>
      )}
      {site.members.map((m, i) => {
        const y = boxY + (site.label ? 27 : 14) + i * rowH;
        const isHovered = hovered === m.key;
        return (
          <g key={m.key}
            className={"cluster-map__member" + (isHovered ? " is-hovered" : "")}
            tabIndex={0} role="button"
            aria-label={nameOf(m) + (site.label ? ", " + site.label : "")}
            onMouseEnter={() => onHover(m.key)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(m.key)}
            onBlur={() => onHover(null)}
            onClick={() => onSelect(m.key)}
            onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(m.key); } }}
          >
            <rect x={boxX + 2} y={y - 11} width={boxW - 4} height={rowH} rx="2" className="cluster-map__memberhit" />
            <circle cx={boxX + 12} cy={y - 3.5} r="3.5" fill={TONE_FILL[toneOf(m)] || "var(--fg-4)"} />
            <text x={boxX + 22} y={y} className="cluster-map__name">{nameOf(m)}</text>
            <text x={boxX + boxW - 9} y={y} className="cluster-map__ms" textAnchor="end">
              {formatLatency(m.latencyMs)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function ClusterMap({ entries, hovered, onHover, onSelect }) {
  const { grouped, unplaced, offFrame } = React.useMemo(() => sites(entries), [entries]);
  const total = (entries || []).length;
  const placedCount = grouped.reduce((n, g) => n + g.members.length, 0);

  // What the card could not draw, said once under the header. A member with no position is the
  // normal state until something reports one, so this is the map's honest-unknown and not an error.
  const meta = [];
  if (unplaced.length) meta.push(unplaced.map(nameOf).join(", ") + (unplaced.length === 1 ? " has no location" : " have no location"));
  if (offFrame.length) meta.push(offFrame.map(nameOf).join(", ") + " outside this frame");

  return (
    <BriefCard icon="map" title="Where the cluster is"
      count={total ? placedCount + " of " + total : 0}
      countTone={placedCount ? "neutral" : undefined}
      countTitle="Members reporting a position"
      meta={meta.length ? meta.join(" · ") : undefined}
      className="cluster-map-card">
      <div className={"cluster-map" + (placedCount ? "" : " cluster-map--empty")}>
        <svg viewBox={"0 0 " + EU_VIEWBOX.w + " " + EU_VIEWBOX.h} className="cluster-map__svg"
          role="img" aria-label="Cluster members on a map of Europe">
          <g className="cluster-map__land">
            {EU_LAND.map((d, i) => <path key={i} d={d} />)}
          </g>
          {grouped.map((g, i) => {
            const anyHovered = g.members.some(m => m.key === hovered);
            return (
              <g key={"pin" + i} className={"cluster-map__pin" + (anyHovered ? " is-hovered" : "")}>
                <circle cx={g.x} cy={g.y} r={anyHovered ? 17 : 14} className="cluster-map__halo" />
                <circle cx={g.x} cy={g.y} r="6" className="cluster-map__dot" />
                {g.members.length > 1 && (
                  <text x={g.x} y={g.y + 3.5} className="cluster-map__count" textAnchor="middle">{g.members.length}</text>
                )}
              </g>
            );
          })}
          {grouped.map((g, i) => (
            <Callout key={"call" + i} site={g} index={i} hovered={hovered} onHover={onHover} onSelect={onSelect} />
          ))}
        </svg>
        {!placedCount && (
          <div className="cluster-map__empty">
            <Icon name="map-pin" size={15} />
            <span>{total ? "No member is reporting a position yet." : "No members yet — add a node."}</span>
          </div>
        )}
      </div>
    </BriefCard>
  );
}

export { ClusterMap };
export default ClusterMap;
