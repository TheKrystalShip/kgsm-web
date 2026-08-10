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
  { id: "light",            label: "Krystal Blue Light",         mode: "light" },
  { id: "github-light",     label: "GitHub Light",               mode: "light" },
  { id: "solarized-light",  label: "Solarized Light",            mode: "light" },
  { id: "catppuccin-latte", label: "Catppuccin Latte",           mode: "light" },
  { id: "nord-light",       label: "Nord Light",                 mode: "light" },

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
