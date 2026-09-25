# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`kgsm-web` builds the KGSM ecosystem's **web surfaces**: the **Control Panel**, the **standalone
assistant** served by the kgsm-assistant leaf, and the **auth anchor's own pages** — sign-in,
registration, the wait for approval and the account page — shipped as `kgsm-web-auth`. Three Vite
builds over one source tree. The panel and the assistant share `src/chat/`, and the anchor's pages
share the panel's sign-in card; everything that differs is a prop. Neither of the other two surfaces
may reach the panel's data layer (`npm run check:assistant`, `npm run check:auth`). The Control Panel
is a Vite + React 18 (JSX) single-page app and a **runtime multi-host client**: it reads a
localStorage registry of `kgsm-api` hosts, grows it from the cluster's roster, and talks to them over
`fetch` + SSE. The workspace root `../CLAUDE.md` carries the ecosystem rules, including the
documentation canon.

**Every area's rules live in a `CLAUDE.md` beside its code** — read the one for wherever you're
working: `src/` (the source map, module boundaries, the shell, a server's two names, what a component
may say, the push surfaces), `src/lib/` (the data layer, connection model, session and RBAC policy),
`src/lib/stores/`, `src/pages/`, `src/components/`, `src/styles/` (tokens, themes, cross-engine
layout checks), `scripts/` (the smoke), `deploy/` and `packaging/`.

## Commands

```bash
npm install
npm run dev          # http://localhost:5173 — no host configured → the connect screen
npm run build        # → dist/  (minified, hashed, tree-shaken)
npm run dev:assistant     # http://localhost:5174 — the STANDALONE assistant surface
npm run build:assistant   # → dist-assistant/
npm run check:assistant   # the standalone bundle contains no Control Panel, and is fully styled
npm run deploy:assistant  # = deploy/deploy-assistant.sh — publish it into the leaf's wwwroot
npm run build:auth        # → dist-auth/ — the auth anchor's pages, under base /ui/
npm run check:auth        # they reach no data layer, and every document is within the anchor's CSP
npm run deploy:auth       # = deploy/deploy-auth.sh — publish them where the anchor's Anchor__UiPath points
npm run preview      # serve the built dist/
./deploy/setup.sh    # ONCE per host — the web roots; with KGSM_PANEL_HOST, nginx + certificate + anchor drop-in (sudo once)
npm run deploy:prod  # = deploy/deploy.sh — build + rsync dist/ into the web root, nothing restarts

npm run check:entry  # where an address says its cluster signs in, and the client id an origin is
npm run check:session # one session for the cluster: restored, renewed at the provider, ended there
npm run check:door   # where an account call goes: the provider, or nowhere when none is known
npm run check:origin # a roster address this page cannot fetch never becomes a connection
npm run check:reset  # clearing local data clears all of it, and nothing else on the origin
npm run check:assistants # which assistants exist: a node's leaf, the cluster's anchor, or both
npm run check:egress # the one seam a bearer is attached at: renewal, replay, and what it refuses
npm run check:tokens # every var(--…) names a defined custom property

KGSM_API=http://127.0.0.1:8096 npm run smoke   # against a RUNNING, AUTH-DISABLED kgsm-api
```

## The gates

**There is an ESLint gate (`npm run lint`) but no typecheck or unit-test runner** — don't hunt for
`npm run test`. The lint config (`eslint.config.js`, ESLint 9 flat) is deliberately NARROW:
`no-undef` and `react-hooks/rules-of-hooks` are **errors** (static bug classes the build itself cannot
catch — a component used-but-not-imported, a hook called after an early return), and so are the
**egress rules** (`no-restricted-syntax`): a module outside the credential owners may neither attach
an `Authorization` header nor read a bearer with `tokenOf`, so every authenticated call reaches a KGSM
surface through `lib/authorizedFetch.js` and renews itself. That one is a lint rule because the
failure it prevents is invisible in review and in any test with a warm session — a hand-rolled call
works for as long as something else keeps the token fresh, and fails only where nothing does.
`react-hooks/exhaustive-deps` and `no-unused-vars` are **warnings** (a backlog to work down, not a
wall). Keep errors at zero.

After any data-layer or route change, run `npm run lint` (0 errors), `npm run build` (no import
dangles), and `npm run smoke` against a live, auth-disabled api — `/home/heisen/tks/scripts/visual-harness/dev-api.sh`
serves one on `:8096`. What the smoke may and may not do: `scripts/CLAUDE.md`.

**Every visual change is checked in the harness before it ships.** The offline suites cannot see any
of it: `smoke` runs in jsdom, which lays out no CSS, has no origin policy and mounts past every gate —
a preflight the browser refuses, a sign-in card that never renders, a credential posted to a path that
does not exist and a shell that never resolves have all shipped green. If a change alters what a
person sees or what the browser does on their behalf, a run in the harness is the only thing that can
tell you it works.

**The harness is `/home/heisen/tks/scripts/visual-harness/`** — its own git repository, beside the
`kgsm-*` checkouts rather than inside one, because it tests this panel but stands up kgsm-api and
kgsm-auth to test it against. Commit a script you add there, in that repo. Its `.state*/` never is:
those hold a session signing key, account stores with password hashes and the bootstrap passwords a
test signs in with. There is a script per thing worth seeing, and adding one (copying the nearest
neighbour, since they share `_panel.mjs`) is the normal way to check a change; its `README.md` has the
recipe. Playwright drives Chromium and Firefox against a real auth-disabled dev kgsm-api — and
Chromium alone is not proof (`src/styles/CLAUDE.md`).

## The connection model, in one paragraph

The app always talks to real `kgsm-api`(s); there are no fixtures and no mode switch. The only
distinction is whether any host is connected: `CONNECTIONS.length` is 0 → the connect screen, ≥2 →
fan-out, and it is a topology check, **never a `LIVE`/`MOCK` mode flag — don't reintroduce that
duality**. Routing to a node is exact: an id no connection holds fails rather than landing on another
node. Detail: `src/lib/CLAUDE.md` (`config.js`, `connect.js`).

## Where truth lives

- **`WIRING.md` is the authoritative front↔back contract** — endpoint/realtime/schema diffs + the
  sequenced wiring plan. `§8` is the slice ledger; consult it for what's wired vs. pending rather than
  trusting prose elsewhere. The realtime SSE protocol's authority is
  `kgsm-api/src/Api/Realtime/CLAUDE.md`.
- `README.md` covers quick-start and the file layout.

## Version tracking

- **Version source:** the `"version"` field in `package.json`.
- **Packaging reads it via `deploy/version.sh`** — `./deploy/version.sh` prints the declared version,
  `--pkgver` prints the pacman-safe form. A package never restates a version number; it asks for one.
- Bump the version whenever you make a user-facing change (patch for fixes, minor for features, major
  for breaking changes), with a `CHANGELOG.md` entry under `## [Unreleased]`.
