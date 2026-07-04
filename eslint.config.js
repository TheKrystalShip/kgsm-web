// ESLint flat config (ESLint 9). Deliberately NARROW — this repo has no
// test/type runner by design; the point of the lint gate is to catch the
// static bug classes that the build silently passed through (see CHANGELOG
// v1.4.3): undeclared identifiers (`no-undef`) and Rules-of-Hooks violations.
// Everything else is a warning, not a wall.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";

export default [
  { ignores: ["dist/**", "node_modules/**", "public/sw.js", "*.min.js"] },

  js.configs.recommended,

  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2023 },
    },
    plugins: { "react-hooks": reactHooks, react },
    settings: { react: { version: "18.3" } },
    rules: {
      // JSX: mark components referenced in JSX as "used" so no-unused-vars
      // doesn't flag imported components.
      "react/jsx-uses-vars": "error",

      // The rules that would have caught our regressions:
      "no-undef": "error",                       // #1: identifier used but not imported (expression position)
      "react/jsx-no-undef": "error",             // #1 in JSX-tag position: <Foo/> with no import (no-undef misses this)
      "react-hooks/rules-of-hooks": "error",     // #5: conditional / early-return hooks

      // Surfaces stale-closure / dead-memo dep arrays (#4). Warn, not error —
      // there is a real backlog to work through before this can be an error.
      "react-hooks/exhaustive-deps": "warn",

      // Helps the vestigial-guard sweep (#6) by flagging dead imports.
      "no-unused-vars": ["warn", { args: "none", ignoreRestSiblings: true, varsIgnorePattern: "^_" }],

      // Intentional patterns in this codebase — don't fight them:
      "no-empty": ["warn", { allowEmptyCatch: true }],   // `catch (e) {}` around storage access is deliberate
    },
  },

  // Node-side scripts / config run in Node, not the browser.
  {
    files: ["scripts/**", "vite.config.*", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
