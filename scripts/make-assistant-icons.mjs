// make-assistant-icons.mjs — author the standalone assistant's install artwork.
//
//   node scripts/make-assistant-icons.mjs        (needs rsvg-convert; not part of any build)
//
// An AUTHORING tool, run by hand when the artwork changes. Its output is committed under
// public-assistant/, and nothing in `npm run build:assistant` invokes it — a build must not depend
// on a system package that only this one task needs.
//
// The mark is the assistant's own glyph and nothing else: the lucide `bot` the chat draws its
// replies with, in white on a --krystal-teal disc over the page's --canvas. The two surfaces
// install as two apps and sit on the same home screen, so the assistant is identified by the
// symbol it already means on screen — the same drawing serves the favicon, both PWA icon sets and
// the iOS launch images, at every size from 16px up.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public-assistant");

const CANVAS = "#0B0F14";       // --canvas, and the manifest's background_color
const TEAL = "#40A0C0";         // --krystal-teal — the colour the chat renders the bot glyph in

// lucide `bot`, verbatim from lucide-react's 24×24 viewBox. Copied rather than imported because
// this script draws SVG, not React — and a glyph that drifted from the one on screen would defeat
// the point of using it as the mark at all. It is centred on (12,12) and 20 units wide.
const BOT = `
    <path d="M12 8V4H8"/>
    <rect width="16" height="12" x="4" y="8" rx="2"/>
    <path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>`;

// The disc, and the glyph sized to sit inside it with the same air at every size: half the glyph's
// width is 0.51 of the radius, its stroke a tenth of it. Expressed as ratios so one number — the
// radius — places the whole mark.
const disc = (cx, cy, r) => `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${TEAL}"/>
  <g transform="translate(${cx},${cy}) scale(${(r * 0.51) / 10}) translate(-12,-12)"
     fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${BOT}
  </g>`;

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const plate = (r) => `<rect width="512" height="512" fill="${CANVAS}"/>${disc(256, 256, r)}`;

// The mark at 512: the disc edge to edge but for a hair of canvas, which is what keeps it a disc
// rather than a bleeding circle once a launcher rounds the corners.
const MARK = svg(512, 512, plate(224));

function render(source, w, h, out) {
  const tmp = resolve(OUT, ".mark.svg");
  writeFileSync(tmp, source);
  mkdirSync(dirname(out), { recursive: true });
  execFileSync("rsvg-convert", ["-w", String(w), "-h", String(h), tmp, "-o", out]);
}

const icon = (px) => resolve(OUT, `icons/assistant-icon-${px}.png`);

// The favicon is the vector itself — a browser tab renders it at whatever the OS scale asks for,
// and the 32px PNG is the fallback for the ones that take no SVG.
mkdirSync(resolve(OUT, "icons"), { recursive: true });
writeFileSync(resolve(OUT, "icons/assistant-icon.svg"), MARK + "\n");
render(MARK, 32, 32, icon(32));

// `any` icons + the Safari home-screen icons: the mark, edge to edge.
for (const px of [192, 512]) render(MARK, px, px, icon(px));
for (const px of [152, 167, 180]) {
  render(MARK, px, px, resolve(OUT, `icons/assistant-apple-touch-icon-${px}.png`));
}

// `maskable`: Android crops this to whatever shape the launcher uses, so everything that must
// survive lives inside the safe circle (80% of the width, i.e. r=205). The disc is drawn inside
// that, on full-bleed canvas.
render(svg(512, 512, plate(196)), 512, 512, resolve(OUT, "icons/assistant-icon-maskable-512.png"));

// iOS launch images: canvas with the mark centred at a constant LOGICAL 90pt, so it is the same
// physical size on every device. Each entry is a device's portrait pixel size and its DPR; they
// mirror the <link rel="apple-touch-startup-image"> media queries in assistant.html one for one.
const SPLASH = [
  [640, 1136, 2], [750, 1334, 2], [828, 1792, 2], [1125, 2436, 3], [1242, 2688, 3],
  [1170, 2532, 3], [1284, 2778, 3], [1179, 2556, 3], [1290, 2796, 3], [1320, 2868, 3],
  [1536, 2048, 2], [1668, 2388, 2], [2048, 2732, 2],
];
const markPng = readFileSync(icon(512)).toString("base64");
for (const [w, h, dpr] of SPLASH) {
  const s = 90 * dpr;
  render(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`
    + ` width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect width="${w}" height="${h}" fill="${CANVAS}"/>`
    + `<image x="${(w - s) / 2}" y="${(h - s) / 2}" width="${s}" height="${s}"`
    + ` xlink:href="data:image/png;base64,${markPng}"/></svg>`,
    w, h, resolve(OUT, `splash/assistant-splash-${w}x${h}.png`));
}

execFileSync("rm", ["-f", resolve(OUT, ".mark.svg")]);
console.log(`✓ wrote the assistant's icons and ${SPLASH.length} launch images to public-assistant/`);
