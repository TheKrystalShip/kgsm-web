// Clearing this browser's data clears ALL of it, and nothing else on the origin.
//
// The failure worth pinning is quiet: removing keys while walking a live storage index shifts it
// under the loop, so roughly half survive and the app comes back still holding whatever was wrong.
// A reset that half-works is worse than none, because the person who pressed it now believes the
// state is clean.
//
//   node scripts/validate-local-reset.mjs
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://kgsm.test/" });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;

const { clearLocalState } = await import("../src/lib/localState.js");

// Enough keys that an index shifting under the loop leaves survivors rather than getting lucky.
const OURS = [
  "krystal:hosts:registry", "krystal:refresh", "krystal:anchor", "krystal:theme",
  "krystal:dash:widgets", "krystal:dash:order", "krystal:device", "krystal:favorites",
  "krystal:sidebar:collapsed", "krystal:notifications", "krystal:pref:density",
  "krystal:member:last", "krystal:welcome:v1",
];
OURS.forEach((k) => localStorage.setItem(k, "x"));
sessionStorage.setItem("krystal:session", "x");
sessionStorage.setItem("krystal:pending:session", "x");

// Something else served from the same origin. Not ours, and not ours to delete.
localStorage.setItem("theme-preference", "dark");
localStorage.setItem("otherapp:token", "keep-me");

let fail = 0;
const check = (c, label, extra = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};

// installed:false — jsdom has neither caches nor a service worker, and their absence is not the
// thing under test.
const result = await clearLocalState({ installed: false });

const left = Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => k.startsWith("krystal:"));
check(left.length === 0, "every one of the app's keys is gone", left.join(",") || "(none left)");
check(result.total === OURS.length + 2, "and the count reported is the count removed",
  `${result.total} of ${OURS.length + 2}`);
check(localStorage.getItem("otherapp:token") === "keep-me" && localStorage.getItem("theme-preference") === "dark",
  "while anything else on this origin is left alone");

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);
