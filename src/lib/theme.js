import { createStore, useStore } from "./store.js";

// theme.js — the client-only THEME preference.
//
// One user preference, persisted in localStorage, NEVER round-tripped to a host
// (same model as favorites in stores.js). The value is either "auto" — follow the OS via
// prefers-color-scheme, live-updating on change — or the id of one concrete palette from
// THEME_OPTS below. "dark" is the default.
//
// The preference is RESOLVED to a concrete "dark" | "light" and written to
// <html data-theme="…">; tokens.css keys every color token off that attribute.
// CSS never sees "auto" — we resolve it here (and in the index.html boot script,
// kept in sync) so the attribute is set before first paint with no flash.
//
// Switching is LIVE — no page reload (unlike a host connect/disconnect): swapping
// the attribute re-cascades instantly. CodeEditor subscribes to this store to
// re-theme Monaco, which can't read CSS custom properties.
//
// Base-layer module: imports only store.js, so it introduces no import cycle.

const THEME_KEY = "krystal:theme";

// The offered themes, in the order a picker lists them — the id every surface validates against
// and the label it shows, in one place, because both surfaces have a picker and a list that lives
// beside one of them is a list the other cannot reach.
//
// `mode` is the theme's own light/dark character, declared here rather than derived: it is a fact
// about the palette (whether `--canvas` is darker than `--fg-1`), and guessing it from the name
// would be wrong the first time somebody ships a dark theme called "Latte". A picker groups on it.
// `auto` carries none, because it is not a palette — it is whichever of the two the OS is asking
// for, resolved at runtime.
//
// `cvd` marks a palette from the colour-vision pack and names, in words, who it is built for. It is
// both the flag a picker groups and badges on and the sentence it shows, because those must not be
// able to disagree: a theme that is listed as colour-vision friendly but describes itself as
// something else is worse than one that says nothing. Its presence — not the `cvd-` id prefix — is
// what every surface tests, so the grouping survives an id being renamed.
//
// `tribute` works the same way for a palette quoting a screen from somewhere else, and names what
// it is quoting. It carries the source because the label alone does not: "LCARS" and "DOS Blue"
// mean nothing to somebody who has not seen them, and the sentence is what turns the swatch grid
// into something readable. A theme carries at most one of `cvd` and `tribute` — they are the two
// reasons a palette sits outside the plain Dark and Light lists, and a theme in both sections
// would be the same swatch twice.
//
// `shape` marks a theme that also re-values STRUCTURE — corner radius, border weight, elevation,
// the UI font, how fast things move — and says in words what it does, because that is a much
// bigger change than a recolour and a swatch cannot show it. Only tributes carry it: an upstream
// editor scheme is a syntax palette and never had an opinion about a corner, whereas a tribute is
// quoting a whole interface. The set of tokens a theme is permitted to re-value is fixed and
// listed in tokens.css's structural banner; this field is only the human-readable half.
const THEME_OPTS = [
  { id: "auto",             label: "Auto (system)"                            },
  { id: "dark",             label: "Krystal Blue Dark",          mode: "dark"  },
  { id: "amoled",           label: "Krystal Blue Dark (AMOLED)", mode: "dark"  },
  { id: "nord",             label: "Nord",                       mode: "dark"  },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha",           mode: "dark"  },
  { id: "dracula",          label: "Dracula",                    mode: "dark"  },
  { id: "tokyo-night",      label: "Tokyo Night",                mode: "dark"  },
  { id: "synthwave",        label: "Synthwave '84",              mode: "dark"  },
  { id: "gruvbox",          label: "Gruvbox Dark",               mode: "dark"  },
  { id: "amber-crt",        label: "Amber CRT Screen",           mode: "dark"  },
  { id: "one-dark",         label: "One Dark Pro",               mode: "dark"  },
  { id: "rose-pine",        label: "Rosé Pine",                  mode: "dark"  },
  { id: "kanagawa",         label: "Kanagawa",                   mode: "dark"  },
  { id: "everforest",       label: "Everforest",                 mode: "dark"  },
  { id: "solarized-dark",   label: "Solarized Dark",             mode: "dark"  },
  { id: "github-dark",      label: "GitHub Dark",                mode: "dark"  },
  { id: "monokai",          label: "Monokai",                    mode: "dark"  },
  { id: "ayu-mirage",       label: "Ayu Mirage",                 mode: "dark"  },
  { id: "light",            label: "Krystal Blue Light",         mode: "light" },
  { id: "github-light",     label: "GitHub Light",               mode: "light" },
  { id: "solarized-light",  label: "Solarized Light",            mode: "light" },
  { id: "catppuccin-latte", label: "Catppuccin Latte",           mode: "light" },
  { id: "nord-light",       label: "Nord Light",                 mode: "light" },
  { id: "gruvbox-light",    label: "Gruvbox Light",              mode: "light" },
  { id: "everforest-light", label: "Everforest Light",           mode: "light" },
  { id: "rose-pine-dawn",   label: "Rosé Pine Dawn",             mode: "light" },
  { id: "tokyo-night-day",  label: "Tokyo Night Day",            mode: "light" },
  { id: "one-light",        label: "One Light",                  mode: "light" },
  { id: "ayu-light",        label: "Ayu Light",                  mode: "light" },

  // The tribute pack — palettes quoting a screen somebody already knows, rather than an editor
  // colour scheme. Dark first, then the one light member, since that is also the order the
  // picker's other sections run in.
  { id: "matrix",    label: "The Matrix",     mode: "dark",  tribute: "The Matrix (1999) — falling code on vampire black",
    shape: "square corners and a monospace UI — a terminal, not a window" },
  { id: "winamp",    label: "Winamp Classic", mode: "dark",  tribute: "Winamp's base skin — grey chrome and a green LCD",
    shape: "square corners and hard pixel shadows — a skin is a bitmap" },
  { id: "lcars",     label: "LCARS",          mode: "dark",  tribute: "LCARS — the TNG-era Starfleet okudagram",
    shape: "heavy rounded elbows and no elevation — the shape IS the design" },
  { id: "cyberpunk", label: "Cyberpunk 2077", mode: "dark",  tribute: "Cyberpunk 2077 — Night City's yellow-on-black HUD",
    shape: "hard corners and a snapping, unblurred HUD" },
  { id: "dos-blue",  label: "DOS Blue",       mode: "dark",  tribute: "The DOS blue screen — Norton Commander and EDIT.COM",
    shape: "square, monospace and motionless — a text mode repaints, it does not animate" },
  { id: "pico8",     label: "PICO-8",         mode: "dark",  tribute: "PICO-8 — the fantasy console's fixed sixteen colours",
    shape: "square corners and a monospace UI — a rounded corner costs a pixel" },
  { id: "c64",       label: "Commodore 64",   mode: "dark",  tribute: "The Commodore 64 boot screen — the VIC-II's screen blue",
    shape: "square, monospace and motionless, inside a screen border" },
  { id: "win95",     label: "Windows 95",     mode: "light", tribute: "Windows 95 — silver bevels, a navy title bar, the teal desktop",
    shape: "square corners, 2px edges and instant transitions — nothing in 1995 eased" },

  // The colour-vision pack. Ordered most-broadly-useful first: red-green covers by far the most
  // people, then the two single deficiencies it compromises between, then the rarer tritan, then
  // the one palette that clears all three at the cost of hues, then monochrome.
  { id: "cvd-redgreen-dark",   label: "Red–Green Safe Dark",   mode: "dark",  cvd: "protanopia + deuteranopia — red-green, either form" },
  { id: "cvd-redgreen-light",  label: "Red–Green Safe Light",  mode: "light", cvd: "protanopia + deuteranopia — red-green, either form" },
  { id: "cvd-deuteran-dark",   label: "Deuteranopia Dark",     mode: "dark",  cvd: "deuteranopia — green-blind" },
  { id: "cvd-deuteran-light",  label: "Deuteranopia Light",    mode: "light", cvd: "deuteranopia — green-blind" },
  { id: "cvd-protan-dark",     label: "Protanopia Dark",       mode: "dark",  cvd: "protanopia — red-blind" },
  { id: "cvd-protan-light",    label: "Protanopia Light",      mode: "light", cvd: "protanopia — red-blind" },
  { id: "cvd-tritan-dark",     label: "Tritanopia Dark",       mode: "dark",  cvd: "tritanopia — blue-yellow" },
  { id: "cvd-tritan-light",    label: "Tritanopia Light",      mode: "light", cvd: "tritanopia — blue-yellow" },
  { id: "cvd-universal-dark",  label: "Universal CVD Dark",    mode: "dark",  cvd: "all three — protanopia, deuteranopia and tritanopia at once" },
  { id: "cvd-universal-light", label: "Universal CVD Light",   mode: "light", cvd: "all three — protanopia, deuteranopia and tritanopia at once" },
  { id: "cvd-mono-dark",       label: "Monochrome Dark",       mode: "dark",  cvd: "achromatopsia — no colour vision; status reads by lightness" },
  { id: "cvd-mono-light",      label: "Monochrome Light",      mode: "light", cvd: "achromatopsia — no colour vision; status reads by lightness" },
];
const VALID = THEME_OPTS.map(o => o.id);
const DEFAULT = "dark";

function readPref() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return VALID.includes(v) ? v : DEFAULT;
  } catch { return DEFAULT; }
}

const prefersLight = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches;

// A preference → the concrete theme actually painted.
// Concrete themes (anything except "auto") pass through unchanged.
function resolveTheme(pref) {
  if (pref !== "auto") return pref;
  return prefersLight() ? "light" : "dark";
}

// Push the resolved theme onto <html> and keep the browser-chrome color honest.
// We read --canvas back out of the cascade rather than hardcode it, so the meta
// tag tracks whatever the active theme defines (no second source of truth).
function applyResolved(resolved) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  try {
    const canvas = getComputedStyle(root).getPropertyValue("--canvas").trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && canvas) meta.setAttribute("content", canvas);
  } catch {}
}

const initialPref = readPref();
const themeStore = createStore({ pref: initialPref, resolved: resolveTheme(initialPref) });

// Set + persist the preference, then apply it live. `pref` ∈ VALID.
themeStore.set = (pref) => {
  if (!VALID.includes(pref) || pref === themeStore.getState().pref) return;
  try { localStorage.setItem(THEME_KEY, pref); } catch {}
  const resolved = resolveTheme(pref);
  applyResolved(resolved);
  themeStore.setState({ pref, resolved });
};

// Live-track the OS scheme so "auto" flips when the system does.
if (typeof matchMedia !== "undefined") {
  const mq = matchMedia("(prefers-color-scheme: light)");
  const onChange = () => {
    if (themeStore.getState().pref !== "auto") return;
    const resolved = resolveTheme("auto");
    applyResolved(resolved);
    themeStore.setState({ resolved });
  };
  if (mq.addEventListener) mq.addEventListener("change", onChange);
  else if (mq.addListener) mq.addListener(onChange);   // older Safari
}

// Sync the DOM at module load. Idempotent with the index.html boot script (that
// one beats first paint); this pass also wires up the meta tag and the store.
applyResolved(themeStore.getState().resolved);

const useThemePref = () => useStore(themeStore, s => s.pref);
const useResolvedTheme = () => useStore(themeStore, s => s.resolved);

export { themeStore, useThemePref, useResolvedTheme, resolveTheme, THEME_KEY, THEME_OPTS };
