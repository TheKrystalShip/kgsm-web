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
  // The two service workers run in a worker global scope (`self`, `caches`, `clients`), which this
  // browser/React config does not describe.
  { ignores: [
    "dist/**", "dist-assistant/**", "node_modules/**",
    "public/sw.js", "public-assistant/assistant-sw.js", "*.min.js",
  ] },

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

      // ---- the egress rules: a call cannot authorize itself ----------------
      // Two absences, and together they are the whole of it. To make an authenticated request a
      // module has to attach a bearer AND get hold of one; both are refused here, so the only way
      // to reach a KGSM surface with a session is through a module that renews and retries.
      //
      // This is a lint rule because the failure it prevents is silent: a hand-rolled call with a
      // bearer works perfectly for as long as something ELSE keeps the token fresh, and fails only
      // where nothing does — a first load, an idle tab, a screen nobody visits often. Nothing about
      // it looks wrong in review, and no test that runs against a warm session can see it.
      //
      // Every file on the allowlist below is there because it OWNS a credential. Adding another is
      // the decision this rule exists to make deliberate; the answer is nearly always to take a
      // credential instead — `{ get, rotate }`, never a token.
      "no-restricted-syntax": ["error",
        {
          selector: "Property[key.name='Authorization'], Property[key.value='Authorization']",
          message: "Don't attach a bearer here. Authorize the call through authorizedFetch.js, which takes a CREDENTIAL and renews it — a token attached by hand cannot be renewed when it lapses.",
        },
        {
          selector: "MemberExpression[property.name='Authorization'], MemberExpression[property.value='Authorization']",
          message: "Don't attach a bearer here. Authorize the call through authorizedFetch.js, which takes a CREDENTIAL and renews it — a token attached by hand cannot be renewed when it lapses.",
        },
        {
          selector: "MemberExpression[property.name='tokenOf']",
          message: "Don't read a raw bearer. Pass the credential (clusterCredential, or the leaf's) to authorizedFetch.js — a function handed a token can only spend it and report the refusal.",
        },
      ],

      // Intentional patterns in this codebase — don't fight them:
      "no-empty": ["warn", { allowEmptyCatch: true }],   // `catch (e) {}` around storage access is deliberate
    },
  },

  // The modules that OWN a credential, and the only ones that may attach a bearer or read one.
  // `authorizedFetch` is the seam every other module reaches a KGSM surface through; the session
  // stores hold the pairs it spends; `apiClient`, `assistantClient` and `liveStream` are the three
  // funnels that renew and replay for their own transport. Everything else in `src/` is a caller.
  {
    files: [
      "src/lib/authorizedFetch.js",
      "src/lib/sessionStore.js",
      "src/lib/assistantSession.js",
      "src/lib/apiClient.js",
      "src/lib/assistantClient.js",
      "src/lib/liveStream.js",
    ],
    rules: { "no-restricted-syntax": "off" },
  },

  // Node-side scripts / config run in Node, not the browser.
  {
    files: ["scripts/**", "vite.config.*", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
