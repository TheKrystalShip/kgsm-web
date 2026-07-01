// art.js — image fallback helpers for server/library surfaces.
// When neither hero nor cover is available, surfaces degrade to a themed
// gradient placeholder instead of a blank void.

// CSS gradient placeholder used when no image URL is available. Uses the
// design-token vars so it tracks the active theme automatically.
const GRADIENT_FALLBACK =
  "linear-gradient(135deg, var(--surface-2) 0%, var(--surface-1) 50%, var(--canvas) 100%)";

// Resolve the background-image value for a surface that wants hero > cover > gradient.
// `hero` and `cover` are absolute URLs (or null). Returns a CSS backgroundImage
// value (with or without `url(…)`) that can be assigned inline.
function artBg(hero, cover) {
  const url = hero || cover;
  return url ? `url("${url}")` : GRADIENT_FALLBACK;
}

// Simpler variant for surfaces that only show cover (no hero): cover > gradient.
function coverArtBg(cover) {
  return cover ? `url("${cover}")` : GRADIENT_FALLBACK;
}

export { artBg, coverArtBg, GRADIENT_FALLBACK };
