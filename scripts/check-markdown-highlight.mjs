#!/usr/bin/env node
// check-markdown-highlight.mjs — the composer's highlighter emits every character of its input,
// exactly once, and nothing else.
//
// The layer behind the composer textarea styles the raw markdown in place, and the caret is
// placed from the TEXTAREA's metrics. A character the layer drops, duplicates or normalizes
// therefore desyncs the two at that offset — the styled copy drifts off the text the person is
// editing, and every caret position past it lands wrong. The shape that keeps this honest (see
// src/chat/markdownHighlight.jsx): delimiters are hidden by visibility and never removed, so a
// swallowed backtick still occupies its width; blank lines are block boxes held open by
// min-height rather than filler characters; line prefixes are re-emitted, space included.
//
// Each case asserts exact equality: highlightMarkdown(input) rendered back to text and rejoined
// with "\n" must equal the input byte for byte, and the top level must be line/group boxes only.
// The cases are the shapes a person actually types — including the ones that spend most of their
// life mid-edit: an unclosed fence, a lone backtick, a pair emptied out.
//
// Run: node scripts/check-markdown-highlight.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src", "chat", "markdownHighlight.jsx");

// Transpile the JSX with esbuild behind a minimal React shim — createElement is all the
// highlighter calls, and running it here keeps this check off jsdom and off a bundler.
const shim = "const React = { createElement: (type, props, ...children) => "
  + "({ type, props: { ...props, children: children.length === 0 ? undefined "
  + ": children.length === 1 ? children[0] : children } }) };\n";
const tmp = mkdtempSync(path.join(os.tmpdir(), "mdh-"));
const mod = path.join(tmp, "check.cjs");
let highlightMarkdown;
try {
  writeFileSync(mod, shim + transformSync(readFileSync(SRC, "utf8"), { loader: "jsx", format: "cjs" }).code);
  ({ highlightMarkdown } = createRequire(import.meta.url)(mod));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// Render the element tree back to text: strings are characters, everything else is a box whose
// children carry the characters. A top-level group box (a code block) contributes one line per
// line box inside it; every other top level box is one line.
function textOf(node) {
  if (node == null || node === false) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props && node.props.children);
}

function linesOf(node) {
  const cls = (node.props && node.props.className) || "";
  if (cls.includes("md-codeblock")) {
    const kids = node.props.children;
    return (Array.isArray(kids) ? kids : [kids]).map(textOf);
  }
  return [textOf(node)];
}

function render(input) {
  const nodes = highlightMarkdown(input);
  if (!Array.isArray(nodes)) throw new Error("output is not an array");
  for (const n of nodes) {
    const cls = (n.props && n.props.className) || "";
    if (typeof n.type !== "string" || !(cls.includes("md-line") || cls.includes("md-codeblock"))) {
      throw new Error("unexpected top-level node: " + JSON.stringify({ type: n.type, cls }));
    }
  }
  return nodes.flatMap(linesOf).join("\n");
}

const cases = {
  "screenshot text": "- This is unordered list\n1. This is ordered list\n```\nThis is markdown code block\n```\nThis is normal text\n# This is title\n`this is inline code`",
  "empty fence": "```\n```",
  "fence with lang": "```js\nconsole.log(1)\n```",
  "unclosed fence": "text\n```\ncode line\nmore",
  "fence with blank line": "```\na\n\nb\n```",
  "whitespace-only block": "```\n   \n```",
  "lone backtick": "abc`",
  "unclosed with text": "run `npm install now",
  "empty inline pair": "a``b",
  "adjacent pairs": "`a``b`",
  "triple backticks inline": "``code with ` tick``",
  "heading levels": "# h\n###### h6\n####### not",
  "ordered paren": "1) first\n12. twelfth",
  "not a list": "1.no space\n----\na-b",
  "trailing newline": "line\n",
  "double trailing": "line\n\n",
  "empty string": "",
  "only newline": "\n",
  "only newlines": "\n\n\n",
  "crlf": "a\r\nb",
  "indented fence": "  ```\n  x\n  ```",
  "inline in list": "- `code` here",
  "heading with code": "# `title` here",
  "fence then text": "```\nx\n```\nnormal `y`",
  "backtick pair with spaces": "` a ` and `b`",
  "unbalanced in fence": "```\n`not code\n```",
  "fence at eof unclosed": "a\n```",
  "blank line in prose": "a\n\nb",
};

const failures = [];
for (const [name, input] of Object.entries(cases)) {
  let out;
  try {
    out = render(input);
  } catch (err) {
    failures.push(`${name}: threw or produced an invalid tree — ${err.message}`);
    continue;
  }
  if (out !== input) {
    failures.push(`${name}\n    in : ${JSON.stringify(input)}\n    out: ${JSON.stringify(out)}`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(`✗ ${f}`);
  console.error(`\ncheck-markdown-highlight: ${failures.length} of ${Object.keys(cases).length} cases failed`);
  process.exit(1);
}
console.log(`✓ check-markdown-highlight: ${Object.keys(cases).length} cases, every character emitted once`);
