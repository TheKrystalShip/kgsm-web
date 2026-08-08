// art.js — image fallback helpers for server/library surfaces.
// When neither hero nor cover is available, surfaces degrade to a themed
// gradient placeholder instead of a blank void.

// CSS gradient placeholder used when no image URL is available. Uses the
// design-token vars so it tracks the active theme automatically.
const GRADIENT_FALLBACK =
  "linear-gradient(135deg, var(--surface-2) 0%, var(--surface-1) 50%, var(--canvas) 100%)";

// The cinematic server hero's placeholder. That surface is a fixed dark media
// panel — its scrim and everything sitting on it (title, status pill, tags) hold
// the dark palette in every theme — so it needs a stand-in that is dark in every
// theme too. The themed gradient above resolves to near-white under a light
// theme, which leaves the white title on white.
const HERO_GRADIENT_FALLBACK =
  "linear-gradient(135deg, #1C2733 0%, #111B25 50%, #070B0F 100%)";

// Resolve the background-image value for a surface that wants hero > cover > gradient.
// `hero` and `cover` are absolute URLs (or null). Returns a CSS backgroundImage
// value (with or without `url(…)`) that can be assigned inline.
function artBg(hero, cover) {
  const url = hero || cover;
  return url ? `url("${url}")` : GRADIENT_FALLBACK;
}

// artBg for the cinematic hero: the same image preference, the dark placeholder.
function heroArtBg(hero, cover) {
  const url = hero || cover;
  return url ? `url("${url}")` : HERO_GRADIENT_FALLBACK;
}

// Simpler variant for surfaces that only show cover (no hero): cover > gradient.
function coverArtBg(cover) {
  return cover ? `url("${cover}")` : GRADIENT_FALLBACK;
}

export { artBg, heroArtBg, coverArtBg, GRADIENT_FALLBACK };
