// check-auth-bundle.mjs — the auth anchor's pages hold no credential and reach no node.
//
//   npm run check:auth        (runs the build first)
//
// These pages are served by the auth anchor on its own origin and reuse the panel's sign-in card and
// settings furniture. Two things can go wrong with that arrangement, and neither shows up anywhere but
// here:
//
//   1. A shared module grows an import into the Control Panel's data layer, and a page that must hold
//      no bearer ships the session machinery anyway — tree-shaking does not remove a static import of
//      a module with side effects.
//   2. A document picks up something the anchor's content security policy refuses — an inline script,
//      a `style` attribute — and the page renders broken in every browser with nothing but a console
//      line to say why. The same goes for the providers marker, which the anchor writes the provider
//      links at: lose it and the floor offers no provider at all.

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "src");
const ENTRY = resolve(SRC, "authui/main.jsx");
const DIST = resolve(ROOT, "dist-auth");

const FORBIDDEN = [
  "lib/apiClient.js",        // the kgsm-api seam
  "lib/stores.js",           // the store barrel, and every domain store's boot
  "lib/stores/index.js",
  "lib/config.js",           // the connection model
  "lib/sessionStore.js",     // the cluster session — these pages hold none
  "lib/authorizedFetch.js",  // the one place a bearer is attached
  "lib/anchor.js",           // the panel's calls to an anchor, with a credential
  "lib/authFlow.js",         // the panel's way in
  "lib/persona.js",
  "lib/liveStream.js",
  "components/AppRouter.jsx",
  "components/host-helpers.jsx",
  "App.jsx",
];

const IMPORT_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function walk(entry) {
  const seen = new Set();
  const via = new Map();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    if (!/\.jsx?$/.test(file)) continue;
    for (const [, spec] of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(file), spec);
      if (!existsSync(target)) continue;
      if (!via.has(target)) via.set(target, file);
      stack.push(target);
    }
  }
  return { seen, via };
}

let failed = false;
const fail = (line) => { console.error(line); failed = true; };

const { seen, via } = walk(ENTRY);
for (const name of FORBIDDEN) {
  const abs = resolve(SRC, name);
  if (seen.has(abs)) {
    fail(`✗ the auth pages reach ${name}`);
    fail(`    imported by ${relative(SRC, via.get(abs))} — cut the edge rather than widening this list`);
  }
}
if (!failed) console.log(`✓ auth pages: ${seen.size} modules, none of them the panel's data layer`);

if (!existsSync(DIST)) {
  fail("✗ no dist-auth/ — run `npm run build:auth` first");
} else {
  for (const page of ["auth-sign-in.html", "auth-wait.html", "auth-account.html"]) {
    const path = resolve(DIST, page);
    if (!existsSync(path)) { fail(`✗ ${page} is not in the build`); continue; }
    const html = readFileSync(path, "utf8");

    // Every script has a src: the policy is script-src 'self'.
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter(([, attrs, body]) => !/\bsrc=/.test(attrs) || body.trim().length > 0);
    if (inline.length) fail(`✗ ${page} carries an inline script, which the anchor's policy refuses`);

    // No style attribute or <style> element: the policy is style-src 'self'.
    if (/\sstyle\s*=/.test(html) || /<style\b/.test(html))
      fail(`✗ ${page} carries inline style, which the anchor's policy refuses`);

    // Everything it loads is under the bundle's own base.
    for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (/^(\/ui\/|\/authorize\/)/.test(url) || url === "/authorize/wait") continue;
      fail(`✗ ${page} references ${url}, outside /ui/ — the anchor serves nothing else of this bundle`);
    }
  }

  const signIn = existsSync(resolve(DIST, "auth-sign-in.html")) ? readFileSync(resolve(DIST, "auth-sign-in.html"), "utf8") : "";
  if (!signIn.includes("<!--kgsm-floor-providers-->"))
    fail("✗ auth-sign-in.html lost the providers marker — the floor would offer no provider");
  if (!/<form[^>]*method="post"[^>]*action="\/authorize\/credentials"/.test(signIn))
    fail("✗ auth-sign-in.html has no floor form posting to /authorize/credentials");

  if (!failed) console.log("✓ auth pages: every document within the anchor's policy, the floor intact");
}

process.exit(failed ? 1 : 0);
