#!/usr/bin/env node
// codemod5 — port the Krystal browser-global prototype to ES modules.
// Usage detection ignores comments+strings (comments stripped FIRST so a `//`
// comment apostrophe like "server's" can't open a fake multi-line string and
// wipe real code from the scan).
import { promises as fs } from "node:fs";
import path from "node:path";

const [, , INPUT, OUTPUT] = process.argv;
if (!INPUT || !OUTPUT) { console.error("usage: codemod5.mjs <in> <out>"); process.exit(2); }

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(jsx?|tsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

const BROWSER = new Set([
  "location", "history", "innerWidth", "innerHeight", "addEventListener",
  "removeEventListener", "matchMedia", "lucide", "MediaRecorder", "AudioContext",
  "webkitAudioContext", "SpeechRecognition", "webkitSpeechRecognition", "scrollTo",
  "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "setInterval",
  "clearTimeout", "clearInterval", "localStorage", "sessionStorage", "navigator",
  "document", "console", "fetch", "getComputedStyle", "devicePixelRatio",
  "performance", "crypto", "URL", "open", "close", "alert", "confirm", "prompt",
]);

const reAssign = /Object\.assign\(\s*window\s*,\s*\{([^}]*)\}\s*\)\s*;?/g;
const reExportLine = /^(\s*)window\.([A-Za-z_$][\w$]*)\s*=(?!=)\s*([\s\S]*)$/;

function exportsOf(src) {
  const names = new Set();
  let m;
  reAssign.lastIndex = 0;
  while ((m = reAssign.exec(src))) {
    for (const part of m[1].split(",")) {
      const n = part.split(":")[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
    }
  }
  for (const line of src.split("\n")) {
    const lm = line.match(/^\s*window\.([A-Za-z_$][\w$]*)\s*=(?!=)/);
    if (lm && !BROWSER.has(lm[1])) names.add(lm[1]);
  }
  return [...names];
}

function stripForScan(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/"(?:\\.|[^"\\])*"/g, " ")
    .replace(/'(?:\\.|[^'\\])*'/g, " ");
}

function unwrapIIFE(src) {
  const om = src.match(/\(function\s*\(\s*\)\s*\{/);
  if (!om) return src;
  const before = src.slice(0, om.index);
  const beforeStripped = before.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").trim();
  if (beforeStripped !== "") return src;
  if (!/\}\s*\)\s*\(\s*\)\s*;?\s*$/.test(src.trimEnd())) return src;
  let body = src.slice(om.index + om[0].length);
  body = body.replace(/\}\s*\)\s*\(\s*\)\s*;?\s*$/, "");
  return before + body;
}

function convertExportStatements(src) {
  src = src.replace(reAssign, "");
  const out = [];
  for (const line of src.split("\n")) {
    const m = line.match(reExportLine);
    if (!m) { out.push(line); continue; }
    const [, indent, name, rhsRaw] = m;
    if (BROWSER.has(name)) { out.push(line); continue; }
    const rhs = rhsRaw.replace(/\s+$/, "");
    const rhsTrim = rhs.trim();
    if (rhsTrim === name + ";" || rhsTrim === name) continue;
    if (/^function\s+[A-Za-z_$][\w$]*\s*\(/.test(rhs)) out.push(indent + rhs);
    else out.push(indent + "const " + name + " = " + rhs);
  }
  return out.join("\n");
}

function relImport(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

const main = async () => {
  const files = await walk(INPUT);
  const owner = new Map();
  const cache = new Map();
  for (const f of files) {
    const src = await fs.readFile(f, "utf8");
    cache.set(f, src);
    for (const name of exportsOf(src)) {
      if (owner.has(name) && owner.get(name) !== f)
        console.warn(`  ⚠ dup "${name}": ${path.relative(INPUT, owner.get(name))} vs ${path.relative(INPUT, f)}`);
      owner.set(name, f);
    }
  }

  for (const f of files) {
    let src = cache.get(f);
    const localExports = new Set(exportsOf(src));
    const scan = stripForScan(src);

    const needed = new Map();
    for (const [name, ownerFile] of owner) {
      if (localExports.has(name) || ownerFile === f) continue;
      const used = new RegExp("(?<![\\w$.])" + name + "(?![\\w$])").test(scan) ||
        new RegExp("window\\." + name + "(?![\\w$])").test(scan);
      if (used) {
        if (!needed.has(ownerFile)) needed.set(ownerFile, new Set());
        needed.get(ownerFile).add(name);
      }
    }

    src = unwrapIIFE(src);
    src = convertExportStatements(src);
    const known = new Set([...localExports, ...[...needed.values()].flatMap((s) => [...s])]);
    if (known.size) src = src.replace(new RegExp("window\\.(" + [...known].join("|") + ")(?![\\w$])", "g"), "$1");
    src = src.replace(/\n{3,}/g, "\n\n").trim() + "\n";

    const imports = [];
    if (/\bReact\b/.test(src) || /<[A-Za-z]/.test(src)) imports.push('import React from "react";');
    for (const [ownerFile, names] of needed)
      imports.push(`import { ${[...names].sort().join(", ")} } from "${relImport(f, ownerFile)}";`);
    const exportLine = localExports.size ? `\nexport { ${[...localExports].sort().join(", ")} };\n` : "";

    const dest = path.join(OUTPUT, path.relative(INPUT, f));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, (imports.length ? imports.join("\n") + "\n\n" : "") + src + exportLine, "utf8");
  }
  console.log(`✔ Converted ${files.length} file(s) → ${OUTPUT}; learned ${owner.size} symbols.`);
};
main().catch((e) => { console.error(e); process.exit(1); });
