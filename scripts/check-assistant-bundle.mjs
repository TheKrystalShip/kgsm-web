// check-assistant-bundle.mjs — the standalone assistant is a chat, and stays one.
//
//   npm run check:assistant        (runs the build first)
//
// This repo builds two surfaces from one source tree, which is what keeps the dock and the
// standalone page rendering the same conversation. The risk that arrangement creates is the
// opposite one: a shared module quietly growing an import into the Control Panel's data layer, so
// that a page with no cluster ships the connection model, the store barrel and the router anyway.
//
// Tree-shaking does not save you from that — a static import of a module with side effects (a store
// that hydrates on load, a boot block) is retained whether or not its exports are read. So this
// walks the standalone entry's import graph and fails on the modules that must not be reachable.
// It is a structural check, not a size budget: the point is which code is IN it, not how big it is.

import { readFileSync, existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "src");
const ENTRY = resolve(SRC, "assistant/main.jsx");

// The Control Panel's data layer and shell. Each of these reaches the rest of it, so naming the
// roots is enough — and naming roots rather than a size means the failure says WHAT leaked.
const FORBIDDEN = [
  "lib/apiClient.js",     // the kgsm-api seam: connection health, fan-out, the auth funnel
  "lib/stores.js",        // the store barrel (and, through it, every domain store's boot)
  "lib/stores/index.js",
  "lib/config.js",        // CONNECTIONS — the multi-node connection model
  "lib/sessionStore.js",  // per-NODE identity; the leaf issues its own
  "lib/persona.js",       // per-node RBAC policy
  "lib/liveStream.js",    // the node realtime stream
  "components/AppRouter.jsx",
  "components/Sidebar.jsx",
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
    const text = readFileSync(file, "utf8");
    for (const [, spec] of text.matchAll(IMPORT_RE)) {
      if (!spec.startsWith(".")) continue;                 // node_modules: not our concern here
      const target = resolve(dirname(file), spec);
      if (!existsSync(target)) continue;
      if (!via.has(target)) via.set(target, file);
      stack.push(target);
    }
  }
  return { seen, via };
}

const { seen, via } = walk(ENTRY);
const leaked = FORBIDDEN
  .map((rel) => ({ rel, abs: resolve(SRC, rel) }))
  .filter(({ abs }) => seen.has(abs));

const rel = (p) => relative(SRC, p);

if (leaked.length) {
  console.error("\n✗ the standalone assistant reaches the Control Panel:\n");
  for (const { rel: name, abs } of leaked) {
    console.error(`    ${name}`);
    // Name one importer — that is the edge to cut, and the chain is usually one hop deep.
    console.error(`      imported by ${rel(via.get(abs))}`);
  }
  console.error(
    "\n  The standalone surface talks to one leaf on its own origin and has no notion of a node.\n"
    + "  Cut the edge (split the module, or take what it needs as a prop) rather than widening\n"
    + "  this list — the whole point of two builds over one source tree is that only the chat is\n"
    + "  shared.\n");
  process.exit(1);
}

console.log(`✓ standalone assistant: ${seen.size} modules, none of them the Control Panel's`);

// ---- and the aesthetic survives the per-surface style barrel --------------------------------
// styles/assistant.css lists a SUBSET of kit.css's partials, because this surface has none of the
// pages the others style. A subset is the one thing that can silently go wrong: a chat widget whose
// rules happen to live in a partial that was left out renders unstyled, and nothing fails. So every
// class the standalone surface can render is checked against the CSS it actually ships.
//
// Skipped when the bundle has not been built — the module check above needs no build, and this is
// an addition to it rather than a reason to require one.
import { globSync } from "node:fs";

const CSS_DIR = resolve(ROOT, "dist-assistant/assets");
if (existsSync(CSS_DIR)) {
  const CLASS_RE = /className=\{?["'`]([^"'`]+)/g;
  const used = new Set();
  for (const file of seen) {
    if (!/\.jsx$/.test(file)) continue;
    for (const [, group] of readFileSync(file, "utf8").matchAll(CLASS_RE)) {
      for (const c of group.split(/\s+/)) {
        if (c && !c.includes("{") && !c.includes("$")) used.add(c);
      }
    }
  }
  const css = globSync("*.css", { cwd: CSS_DIR })
    .map((f) => readFileSync(resolve(CSS_DIR, f), "utf8")).join("");
  // `chat-id__sub` is styled by no partial at all — dead in the Control Panel too, so its absence
  // here says nothing about the barrel.
  const KNOWN_UNSTYLED = new Set(["chat-id__sub"]);
  const unstyled = [...used].filter((c) => !KNOWN_UNSTYLED.has(c) && !css.includes("." + c)).sort();

  if (unstyled.length) {
    console.error("\n✗ classes the standalone assistant renders with no rule in its stylesheet:\n");
    for (const c of unstyled) console.error(`    .${c}`);
    console.error(
      "\n  Find the kit partial that defines them and add it to src/styles/assistant.css.\n"
      + "  Do NOT copy the rules across — the partials are shared so the two surfaces cannot\n"
      + "  drift, and a copy is exactly that drift.\n");
    process.exit(1);
  }
  console.log(`✓ standalone assistant: ${used.size} classes rendered, all of them styled`);
}

// ---- and it is still installable ------------------------------------------------------------
// The PWA artwork, manifest and service worker live in public-assistant/ and are laid over the
// shared public/ directory by a plugin in vite.assistant.config.js. If that overlay does not run,
// the build still succeeds and the page still works — it just quietly stops being installable, and
// the icons the HTML points at 404. So every artefact the page references is resolved against what
// the build actually wrote.

const DIST = resolve(ROOT, "dist-assistant");
if (existsSync(resolve(DIST, "assistant.html"))) {
  const missing = [];
  const need = (p, why) => { if (!existsSync(resolve(DIST, "." + p))) missing.push(`${p}  (${why})`); };

  const html = readFileSync(resolve(DIST, "assistant.html"), "utf8");
  for (const [, href] of html.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
    if (!href.startsWith("/assets/")) need(href, "referenced by assistant.html");
  }

  need("/assistant-sw.js", "registered by src/assistant/main.jsx");

  const manifestPath = resolve(DIST, "assistant.webmanifest");
  if (!existsSync(manifestPath)) {
    missing.push("/assistant.webmanifest  (the install manifest)");
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const i of manifest.icons || []) need(i.src, `declared by the manifest (${i.purpose})`);
    // Android Chrome will not offer an install without both of these sizes.
    for (const size of ["192x192", "512x512"]) {
      if (!(manifest.icons || []).some((i) => i.sizes === size)) {
        missing.push(`an icon at ${size}  (Chrome requires it to offer "Install app")`);
      }
    }
  }

  if (missing.length) {
    console.error("\n✗ the standalone assistant is not installable — the build is missing:\n");
    for (const m of missing) console.error(`    ${m}`);
    console.error(
      "\n  These come from public-assistant/, copied over the shared public/ by the overlay plugin\n"
      + "  in vite.assistant.config.js. Check that it ran, and that scripts/make-assistant-icons.mjs\n"
      + "  has been run if the artwork is what's absent.\n");
    process.exit(1);
  }
  console.log("✓ standalone assistant: manifest, service worker and every icon it names are in the build");
}
