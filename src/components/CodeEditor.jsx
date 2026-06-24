import React from "react";
import Editor from "@monaco-editor/react";
import { loader } from "@monaco-editor/react";

// Monaco code editor for the FileBrowser — replaces the bare <textarea> with
// line numbers + syntax highlighting, while keeping the SAME contract the file
// browser already speaks: a controlled `value` + `onChange`, plus `readOnly`.
//
// SELF-HOSTED, NO CDN. @monaco-editor/react defaults to pulling Monaco off a
// jsdelivr AMD loader at runtime — wrong for a self-hosted control panel that
// must work offline / on a closed network. We import a LEAN slice of the ESM
// build (editor core + only the languages we open) and `loader.config({ monaco })`
// so the wrapper uses our bundled instance instead of reaching out to a CDN.
//
// This module is meant to be LAZY-imported (React.lazy) by the FileBrowser, so
// the Monaco chunk + workers only download once a user actually opens a file —
// they never weigh on first paint or any other route.

// --- lean language set: editor core + just what config/log files need ---------
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/language/json/monaco.contribution";        // JSON: full service (validate/format) → json.worker
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution";     // ini / cfg / conf / properties
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";     // xml
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";   // yaml / yml
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution"; // .sh (kgsm scripts) — bonus

// Workers (Vite `?worker` → bundled, hashed, no CDN). Only the editor base
// worker and the JSON service worker are ever requested by our language set;
// ini/xml/yaml/shell are pure Monarch tokenizers (highlighting, no worker).
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

if (typeof self !== "undefined") {
  self.MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === "json") return new JsonWorker();
      return new EditorWorker();
    },
  };
}

// Hand the wrapper OUR bundled monaco so it never falls back to the CDN loader.
loader.config({ monaco });

// --- a minimal `log` language (Monaco ships none) -----------------------------
// Colors timestamps and severity words so a tailed server log is readable. Pure
// tokenizer; no validation, no worker.
if (!monaco.languages.getLanguages().some((l) => l.id === "log")) {
  monaco.languages.register({ id: "log" });
  monaco.languages.setMonarchTokensProvider("log", {
    tokenizer: {
      root: [
        [/\b\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2}(\.\d+)?)?/, "log-time"],
        [/\b\d{2}:\d{2}:\d{2}(\.\d+)?\b/, "log-time"],
        [/\b(ERROR|FATAL|CRITICAL|SEVERE|PANIC)\b/, "log-error"],
        [/\b(WARN|WARNING)\b/, "log-warn"],
        [/\b(INFO|NOTICE)\b/, "log-info"],
        [/\b(DEBUG|TRACE|VERBOSE)\b/, "log-debug"],
        [/"[^"]*"/, "string"],
        [/'[^']*'/, "string"],
        [/\b\d+(\.\d+)?\b/, "number"],
      ],
    },
  });
}

// --- map a filename to a registered language id -------------------------------
const EXT_LANG = {
  json: "json", json5: "json",
  ini: "ini", cfg: "ini", conf: "ini", cnf: "ini", properties: "ini", env: "ini", toml: "ini",
  xml: "xml", svg: "xml", xsd: "xml", config: "xml",
  yaml: "yaml", yml: "yaml",
  sh: "shell", bash: "shell",
  log: "log",
};
function languageForPath(path) {
  if (!path) return "plaintext";
  const base = String(path).split("/").pop().toLowerCase();
  const ext = base.includes(".") ? base.split(".").pop() : "";
  return EXT_LANG[ext] || "plaintext";
}

// --- our palette as a Monaco theme (mirrors src/styles/tokens.css) ------------
// Monaco can't read CSS custom properties, so the design tokens are restated
// here. If tokens.css changes, mirror the few colors below.
const T = {
  bg: "#0E141C", surface2: "#161C25",
  fg1: "#F2F5F9", fg3: "#7C8899", fg4: "#515E70",
  teal: "#40A0C0", tealHover: "#5DB5D2",
  green: "#4ADE80", amber: "#FBBF24", rose: "#FB7185", sky: "#7DD3FC",
};
monaco.editor.defineTheme("kgsm-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: T.fg3.slice(1), fontStyle: "italic" },
    { token: "string", foreground: T.green.slice(1) },
    { token: "number", foreground: T.amber.slice(1) },
    { token: "keyword", foreground: T.teal.slice(1) },
    { token: "type", foreground: T.sky.slice(1) },
    { token: "key", foreground: T.tealHover.slice(1) },        // ini / yaml keys
    { token: "delimiter", foreground: T.fg3.slice(1) },
    { token: "tag", foreground: T.teal.slice(1) },             // xml tags
    { token: "attribute.name", foreground: T.sky.slice(1) },
    { token: "attribute.value", foreground: T.green.slice(1) },
    { token: "metatag", foreground: T.fg3.slice(1) },
    { token: "log-time", foreground: T.fg3.slice(1) },
    { token: "log-error", foreground: T.rose.slice(1), fontStyle: "bold" },
    { token: "log-warn", foreground: T.amber.slice(1), fontStyle: "bold" },
    { token: "log-info", foreground: T.teal.slice(1) },
    { token: "log-debug", foreground: T.fg4.slice(1) },
  ],
  colors: {
    "editor.background": T.bg,
    "editor.foreground": T.fg1,
    "editorLineNumber.foreground": T.fg4,
    "editorLineNumber.activeForeground": T.fg3,
    "editorCursor.foreground": T.teal,
    "editor.selectionBackground": "#40A0C033",
    "editor.lineHighlightBackground": "#FFFFFF08",
    "editor.inactiveSelectionBackground": "#40A0C01F",
    "editorIndentGuide.background1": "#FFFFFF0A",
    "editorIndentGuide.activeBackground1": "#FFFFFF1F",
    "editorWhitespace.foreground": "#FFFFFF14",
    "editorWidget.background": T.surface2,
    "editorWidget.border": "#FFFFFF1F",
    "input.background": T.bg,
    "scrollbarSlider.background": "#FFFFFF14",
    "scrollbarSlider.hoverBackground": "#FFFFFF24",
  },
});

const OPTIONS = {
  minimap: { enabled: false },
  fontFamily: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontSize: 13,
  lineHeight: 21,
  tabSize: 4,
  scrollBeyondLastLine: false,
  automaticLayout: true,            // track the flex container's size changes
  fixedOverflowWidgets: true,       // find widget escapes the card's overflow:hidden
  renderWhitespace: "selection",
  smoothScrolling: true,
  cursorBlinking: "smooth",
  stickyScroll: { enabled: false },
  padding: { top: 12, bottom: 12 },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
};

// `value` / `onChange` / `readOnly` mirror the textarea the FileBrowser used, so
// the dirty/etag/save flow upstream is untouched. `path` gives Monaco a stable
// per-file model (separate undo history + scroll position per file).
export default function CodeEditor({ value, onChange, path, readOnly = false }) {
  return (
    <Editor
      className="fb-editor__monaco"
      height="100%"
      theme="kgsm-dark"
      path={path || undefined}
      language={languageForPath(path)}
      value={value}
      onChange={(v) => onChange && onChange(v ?? "")}
      options={{ ...OPTIONS, readOnly }}
      loading={<div className="fb-editor__empty"><span className="oauth-spinner" /> Loading editor…</div>}
    />
  );
}

export { languageForPath };
