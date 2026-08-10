#!/usr/bin/env node
// check-tokens.mjs — every var(--…) a stylesheet reads is defined somewhere.
//
// An undefined custom property does not warn and does not fail a build. It goes
// invalid-at-computed-value-time: `border-color: var(--nope)` inherits or falls back to
// currentColor, `border-radius: var(--nope)` computes to 0, and the page renders
// slightly wrong forever. Two whole families of that shipped here — a set of
// `--border-1/2` and a set of `--radius-sm/md/lg` left over from an older naming —
// which is why this check exists.
//
// It matters more now that themes re-value SHAPE: the geometry lever only reaches a
// corner that actually goes through --r-*, so a stray literal or a misspelled token is
// a corner that silently refuses to change with the theme.
//
// Definitions are collected from every stylesheet (any scope — :root, a theme block,
// a component rule), so a token defined locally and read locally is fine. A var() with
// a fallback (`var(--x, 8px)`) is fine by construction and is not reported — which is
// also how a property set from JSX (`style={{ "--fb-tree-w": … }}`) declares itself to
// this check. Comments are stripped first, so prose describing a token is not a read.
//
// Run: node scripts/check-tokens.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["src/styles", "src/styles/kit"];

const files = DIRS.flatMap((d) => {
  const abs = path.join(ROOT, d);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(".css"))
    .map((f) => path.join(abs, f));
});

const defined = new Set();
const read = [];

for (const file of files) {
  // Blank comments out rather than deleting them, so reported line numbers stay true.
  const css = fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  css.split("\n").forEach((line, i) => {
    const def = line.match(/^\s*(--[A-Za-z0-9_-]+)\s*:/);
    if (def) defined.add(def[1]);
    // var(--x) with NO fallback — a comma means the author supplied one.
    for (const m of line.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g)) {
      read.push({ token: m[1], file: path.relative(ROOT, file), line: i + 1 });
    }
  });
}

const missing = read.filter((r) => !defined.has(r.token));

if (!files.length) {
  console.error("check-tokens: no stylesheets found — wrong root?");
  process.exit(1);
}

if (missing.length) {
  console.error(`✗ ${missing.length} reference(s) to custom properties that are never defined:\n`);
  const byToken = new Map();
  for (const m of missing) {
    if (!byToken.has(m.token)) byToken.set(m.token, []);
    byToken.get(m.token).push(`${m.file}:${m.line}`);
  }
  for (const [token, sites] of [...byToken].sort()) {
    console.error(`  ${token}`);
    for (const s of sites) console.error(`      ${s}`);
  }
  console.error(
    "\nDefine the token in tokens.css, or point the reference at the one that exists.",
  );
  process.exit(1);
}

console.log(
  `✓ ${read.length} custom-property reads across ${files.length} stylesheets, ` +
    `all ${defined.size} tokens defined`,
);
