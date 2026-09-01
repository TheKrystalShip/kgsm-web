// gen-eu-map.mjs — writes src/pages/diagnostics/euMap.js from Natural Earth.
//
// The Cluster page's map draws real coastlines, so the shape has to come from a survey rather than
// from somebody's hand. This fetches Natural Earth's 1:50m country polygons (public domain), clips
// them to Europe, projects them the way the EU projects its own statistics, simplifies to the size
// the card is actually drawn at, and emits a module carrying the paths and the same projection the
// pins are placed with.
//
// The source file is ~3 MB and is NOT committed; the generated module is, because the map has to
// build on a machine with no network. Re-run only to change the frame or the detail:
//
//   node scripts/gen-eu-map.mjs
//
// PROJECTION: Lambert azimuthal equal-area on 10°E 52°N — EPSG:3035, the standard for European
// statistical mapping. Equal-area matters here for the same reason it matters there: a member in
// Finland and a member in Portugal must not be drawn at different scales.

import fs from "node:fs/promises";
import path from "node:path";

const SRC = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson";
const OUT = path.join(process.cwd(), "src/pages/diagnostics/euMap.js");

const LON0 = 10.0, LAT0 = 52.0;
const BOX = [-11.0, 35.2, 28.5, 62.5];   // lon min, lat min, lon max, lat max
const W = 640, H = 470;
const TOLERANCE = 0.7;                    // simplification, in projected pixels
const MIN_AREA = 6;                       // drop specks that read as dirt on the plate
const D = Math.PI / 180;

function laea(lon, lat) {
  const p = lat * D, l = (lon - LON0) * D, p1 = LAT0 * D;
  const den = 1 + Math.sin(p1) * Math.sin(p) + Math.cos(p1) * Math.cos(p) * Math.cos(l);
  if (den <= 1e-9) return null;
  const k = Math.sqrt(2 / den);
  return [k * Math.cos(p) * Math.sin(l),
          k * (Math.cos(p1) * Math.sin(p) - Math.sin(p1) * Math.cos(p) * Math.cos(l))];
}

// Sutherland-Hodgman against the lon/lat rectangle.
function clip(ring, [x0, y0, x1, y1]) {
  const half = (pts, inside, inter) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i === 0 ? pts.length - 1 : i - 1], b = pts[i];
      const ia = inside(a), ib = inside(b);
      if (ib) { if (!ia) out.push(inter(a, b)); out.push(b); }
      else if (ia) out.push(inter(a, b));
    }
    return out;
  };
  const ix = (a, b, x) => [x, a[1] + (x - a[0]) / (b[0] - a[0]) * (b[1] - a[1])];
  const iy = (a, b, y) => [a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]), y];
  let r = ring;
  for (const f of [
    (p) => half(p, (q) => q[0] >= x0, (a, b) => ix(a, b, x0)),
    (p) => half(p, (q) => q[0] <= x1, (a, b) => ix(a, b, x1)),
    (p) => half(p, (q) => q[1] >= y0, (a, b) => iy(a, b, y0)),
    (p) => half(p, (q) => q[1] <= y1, (a, b) => iy(a, b, y1)),
  ]) { r = f(r); if (!r.length) return []; }
  return r;
}

// Douglas-Peucker over an OPEN polyline.
function dp(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const rec = (a, b) => {
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, n = Math.hypot(dx, dy);
    let worst = -1, wi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const d = n > 1e-9 ? Math.abs((px - ax) * dy - (py - ay) * dx) / n : Math.hypot(px - ax, py - ay);
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst <= tol || wi < 0) return [pts[a]];
    return rec(a, wi).concat(rec(wi, b));
  };
  return rec(0, pts.length - 1).concat([pts[pts.length - 1]]);
}

// A ring collapses under a plain DP because its endpoints coincide, so it is cut in half and each
// half simplified as an open line.
function simplifyRing(pts, tol) {
  let r = pts;
  if (r.length > 1 && Math.abs(r[0][0] - r[r.length - 1][0]) < 1e-9 && Math.abs(r[0][1] - r[r.length - 1][1]) < 1e-9) {
    r = r.slice(0, -1);
  }
  if (r.length < 6) return r;
  const m = Math.floor(r.length / 2);
  return dp(r.slice(0, m + 1), tol).slice(0, -1).concat(dp(r.slice(m).concat([r[0]]), tol).slice(0, -1));
}

const res = await fetch(SRC);
if (!res.ok) throw new Error("Natural Earth fetch failed: " + res.status);
const gj = await res.json();

const shapes = [];
for (const f of gj.features) {
  const g = f.geometry;
  if (!g) continue;
  const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
  const rings = [];
  for (const poly of polys) {
    const r = clip(poly[0].map(c => [c[0], c[1]]), BOX);
    if (r.length >= 4) rings.push(r);
  }
  if (rings.length) shapes.push({ name: f.properties.NAME || "", rings });
}

const all = shapes.flatMap(s => s.rings.flat().map(([lo, la]) => laea(lo, la))).filter(Boolean);
const minx = Math.min(...all.map(p => p[0])), maxx = Math.max(...all.map(p => p[0]));
const miny = Math.min(...all.map(p => p[1])), maxy = Math.max(...all.map(p => p[1]));
const scale = Math.min(W / (maxx - minx), H / (maxy - miny)) * 0.99;
const offX = (W - (maxx - minx) * scale) / 2 - minx * scale;
const offY = (H - (maxy - miny) * scale) / 2 + maxy * scale;

const toPx = (lon, lat) => {
  const p = laea(lon, lat);
  return p ? [p[0] * scale + offX, offY - p[1] * scale] : null;
};

const paths = [];
for (const s of shapes) {
  const segs = [];
  for (const ring of s.rings) {
    let px = ring.map(([lo, la]) => toPx(lo, la)).filter(Boolean);
    px = simplifyRing(px, TOLERANCE);
    if (px.length < 3) continue;
    let area = 0;
    for (let i = 0; i < px.length; i++) {
      const a = px[i], b = px[i === 0 ? px.length - 1 : i - 1];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (Math.abs(area) / 2 < MIN_AREA) continue;
    segs.push("M" + px.map(([x, y]) => x.toFixed(1) + "," + y.toFixed(1)).join(" L") + "Z");
  }
  if (segs.length) paths.push(segs.join(""));
}

const out = `// euMap.js — GENERATED, do not edit. Run \`node scripts/gen-eu-map.mjs\` to rebuild.
//
// Europe's coastlines and the projection they were drawn with, so a member's coordinates land where
// the survey says they do. Lambert azimuthal equal-area on ${LON0}°E ${LAT0}°N — EPSG:3035, the
// projection European statistics are mapped in — clipped to lon ${BOX[0]}…${BOX[2]}, lat ${BOX[1]}…${BOX[3]}.
//
// Source: Natural Earth 1:50m admin-0 countries (public domain).

const LON0 = ${LON0};
const LAT0 = ${LAT0};
const SCALE = ${scale};
const OFF_X = ${offX};
const OFF_Y = ${offY};
const D = Math.PI / 180;

const EU_VIEWBOX = { w: ${W}, h: ${H} };

// euProject(lat, lon) → [x, y] in viewBox units, or null when the point does not project (the
// antipode of the projection centre). The caller decides what is off-frame: a point outside the
// box still returns a position, because clipping is a rendering decision and this is the survey.
function euProject(lat, lon) {
  const p = lat * D, l = (lon - LON0) * D, p1 = LAT0 * D;
  const den = 1 + Math.sin(p1) * Math.sin(p) + Math.cos(p1) * Math.cos(p) * Math.cos(l);
  if (den <= 1e-9) return null;
  const k = Math.sqrt(2 / den);
  const x = k * Math.cos(p) * Math.sin(l);
  const y = k * (Math.cos(p1) * Math.sin(p) - Math.sin(p1) * Math.cos(p) * Math.cos(l));
  return [x * SCALE + OFF_X, OFF_Y - y * SCALE];
}

// euInFrame([x, y]) — whether a projected point falls on the drawn plate. A member outside it is
// real and is listed as off-frame rather than dragged to an edge it is not on.
function euInFrame(pt) {
  return !!pt && pt[0] >= 0 && pt[0] <= EU_VIEWBOX.w && pt[1] >= 0 && pt[1] <= EU_VIEWBOX.h;
}

const EU_LAND = ${JSON.stringify(paths, null, 0).replace(/","/g, '",\n  "').replace(/^\["/, '[\n  "').replace(/"\]$/, '",\n]')};

export { EU_LAND, EU_VIEWBOX, euInFrame, euProject };
`;

await fs.writeFile(OUT, out);
console.log("wrote " + OUT + " — " + paths.length + " countries, " + Math.round(out.length / 1024) + " KB");
