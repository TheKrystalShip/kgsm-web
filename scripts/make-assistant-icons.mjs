// make-assistant-icons.mjs — author the standalone assistant's install artwork.
//
//   node scripts/make-assistant-icons.mjs        (needs rsvg-convert; not part of any build)
//
// An AUTHORING tool, run by hand when the artwork changes. Its output is committed under
// public-assistant/, and nothing in `npm run build:assistant` invokes it — a build must not depend
// on a system package that only this one task needs.
//
// The mark is `.chat-empty__logo`, the badge at the head of an empty conversation, drawn to the
// pixel: lucide `bot` in --krystal-teal on a --krystal-teal-dim fill over --canvas, the glyph
// 26/56 of the frame exactly as the 26px icon sits in the 56px box, its stroke the 1.7 every
// <Icon> renders with. The tile fills the frame square, since a launcher applies its own mask.
// The colours below are copied from src/styles/tokens.css and the geometry from
// src/styles/kit/chat.css — an SVG cannot read a CSS custom property, so when either changes here
// is where it has to be changed again.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public-assistant");

const CANVAS = "#0B0F14";       // --canvas, and the manifest's background_color
const TEAL = "#40A0C0";         // --krystal-teal
const DIM = 0.14;               // --krystal-teal-dim is that colour at 14%, and it is translucent
                                // — so the fill is drawn AS the site draws it: over the canvas.

const GLYPH = 26 / 56;          // <Icon size={26}/> in a 56px .chat-empty__logo box
const STROKE = 1.7;             // <Icon>'s default strokeWidth, in the 24-unit lucide viewBox

// lucide `bot`, verbatim from lucide-react's 24×24 viewBox. Copied rather than imported because
// this script draws SVG, not React — and a glyph that drifted from the one on screen would defeat
// the point of replicating the element at all. It is centred on (12,12).
const BOT = `
    <path d="M12 8V4H8"/>
    <rect width="16" height="12" x="4" y="8" rx="2"/>
    <path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>`;

// The element at any size: the tile edge to edge, the glyph centred at its share of the frame.
const mark = (px) => {
  const s = (px * GLYPH) / 24;  // lucide unit → pixels
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"`
    + ` viewBox="0 0 ${px} ${px}">`
    + `<rect width="${px}" height="${px}" fill="${CANVAS}"/>`
    + `<rect width="${px}" height="${px}" fill="${TEAL}" fill-opacity="${DIM}"/>`
    + `<g transform="translate(${px / 2},${px / 2}) scale(${s}) translate(-12,-12)"`
    + ` fill="none" stroke="${TEAL}" stroke-width="${STROKE}"`
    + ` stroke-linecap="round" stroke-linejoin="round">${BOT}</g></svg>`;
};

const MARK = mark(512);

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

// `any` icons + the Safari home-screen icons.
for (const px of [192, 512]) render(MARK, px, px, icon(px));
for (const px of [152, 167, 180]) {
  render(MARK, px, px, resolve(OUT, `icons/assistant-apple-touch-icon-${px}.png`));
}

// `maskable`: Android crops this to whatever shape the launcher uses. The tile is a flat fill so it
// survives any crop, and the glyph — 46% of the frame — sits well inside the 80% safe circle, so
// the maskable icon is the same drawing.
render(MARK, 512, 512, resolve(OUT, "icons/assistant-icon-maskable-512.png"));

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
