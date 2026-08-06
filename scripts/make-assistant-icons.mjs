// make-assistant-icons.mjs — author the standalone assistant's install artwork.
//
//   node scripts/make-assistant-icons.mjs        (needs rsvg-convert; not part of any build)
//
// An AUTHORING tool, run by hand when the artwork changes. Its output is committed under
// public-assistant/, and nothing in `npm run build:assistant` invokes it — a build must not depend
// on a system package that only this one task needs.
//
// The two surfaces install as two apps and sit on the same home screen, so the assistant's icon has
// to be told apart from the Control Panel's at a glance while still reading as the same product.
// It is therefore DERIVED from the panel's icon rather than drawn beside it: the KGSM mark with the
// assistant's own badge on it — the lucide `bot` glyph the chat already uses for its replies, in
// --krystal-teal on the page's --canvas. Deriving it is what keeps the family resemblance true
// automatically; re-run this after changing public-panel/icons/icon-512.png and the badge follows.

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
// the point of deriving the icon at all.
const BOT = `
    <path d="M12 8V4H8"/>
    <rect width="16" height="12" x="4" y="8" rx="2"/>
    <path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>`;

const base = readFileSync(resolve(ROOT, "public-panel/icons/icon-512.png")).toString("base64");
const plate = `<image x="0" y="0" width="512" height="512" xlink:href="data:image/png;base64,${base}"/>`;

// The badge sits bottom-right on a ring of canvas colour, which is what separates it from the
// mark's own light plate at small sizes.
const badge = `
  <circle cx="372" cy="372" r="122" fill="${CANVAS}"/>
  <circle cx="372" cy="372" r="110" fill="${TEAL}"/>
  <g transform="translate(372,372) scale(5.6) translate(-12,-12)"
     fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${BOT}
  </g>`;

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`
  + ` width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

// The full-bleed mark, at 512 — every other artefact is this image placed on a canvas.
const MARK = svg(512, 512, plate + badge);

function render(source, w, h, out) {
  const tmp = resolve(OUT, ".mark.svg");
  writeFileSync(tmp, source);
  mkdirSync(dirname(out), { recursive: true });
  execFileSync("rsvg-convert", ["-w", String(w), "-h", String(h), tmp, "-o", out]);
}

const icon = (px) => resolve(OUT, `icons/assistant-icon-${px}.png`);

// `any` icons + the Safari home-screen icons: the mark, edge to edge.
for (const px of [192, 512]) render(MARK, px, px, icon(px));
for (const px of [152, 167, 180]) {
  render(MARK, px, px, resolve(OUT, `icons/assistant-apple-touch-icon-${px}.png`));
}

// `maskable`: Android crops this to whatever shape the launcher uses, so everything that must
// survive lives inside the safe circle (80% of the width). The mark is inset to 76% on canvas —
// the same construction as the Control Panel's maskable icon.
const inset = Math.round(512 * 0.76);
const off = Math.round((512 - inset) / 2);
render(
  svg(512, 512,
    `<rect width="512" height="512" fill="${CANVAS}"/>`
    + `<g transform="translate(${off},${off}) scale(${inset / 512})">${plate}${badge}</g>`),
  512, 512, resolve(OUT, "icons/assistant-icon-maskable-512.png"));

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
    svg(w, h,
      `<rect width="${w}" height="${h}" fill="${CANVAS}"/>`
      + `<image x="${(w - s) / 2}" y="${(h - s) / 2}" width="${s}" height="${s}"`
      + ` xlink:href="data:image/png;base64,${markPng}"/>`),
    w, h, resolve(OUT, `splash/assistant-splash-${w}x${h}.png`));
}

execFileSync("rm", ["-f", resolve(OUT, ".mark.svg")]);
console.log(`✓ wrote the assistant's icons and ${SPLASH.length} launch images to public-assistant/`);
