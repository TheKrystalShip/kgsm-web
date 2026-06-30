import { createStore, useStore } from "./store.js";

// theme.js — the client-only THEME preference.
//
// One user preference, persisted in localStorage, NEVER round-tripped to a host
// (same model as favorites in stores.js). The value is one of:
//   • "auto"  → follow the OS via prefers-color-scheme (live-updates on change)
//   • "dark"  → the original palette (the default)
//   • "light" → the light palette
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
const VALID = ["auto", "dark", "amoled", "light", "nord", "catppuccin-mocha", "dracula", "tokyo-night", "synthwave", "gruvbox"];
const DEFAULT = "dark";

function readPref() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return VALID.includes(v) ? v : DEFAULT;
  } catch (e) { return DEFAULT; }
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
  } catch (e) {}
}

const initialPref = readPref();
const themeStore = createStore({ pref: initialPref, resolved: resolveTheme(initialPref) });

// Set + persist the preference, then apply it live. `pref` ∈ VALID.
themeStore.set = (pref) => {
  if (!VALID.includes(pref) || pref === themeStore.getState().pref) return;
  try { localStorage.setItem(THEME_KEY, pref); } catch (e) {}
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

export { themeStore, useThemePref, useResolvedTheme, resolveTheme, THEME_KEY };
