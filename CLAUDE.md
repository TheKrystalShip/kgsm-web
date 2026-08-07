# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`kgsm-web` builds the KGSM ecosystem's **web surfaces**: the **Control Panel** and the
**standalone assistant** served by the kgsm-assistant leaf. Two Vite builds over one source tree,
sharing `src/chat/` — the conversation is the same code in both, because a divergence between the
dock and the standalone page would be a bug, not a variant. Everything that differs is a prop.
⚠ The standalone surface must not reach the panel's data layer; `npm run check:assistant` enforces
it (see `src/CLAUDE.md`). The Control Panel is a standard
Vite + React 18 (JSX) single-page app, ported from the no-build `krystal-design`
prototype. It is a **runtime multi-host client**: it reads a localStorage
registry of `kgsm-api` hosts and talks to them over `fetch` + SSE. The
`README.md` covers quick-start and the file layout; this file covers the
architecture and the landmines.

**Per-directory docs (read the one for wherever you're working):** the source
tree carries focused nested `CLAUDE.md` files that lock in the 2026-07
architecture-cleanup refactor's structure — `src/CLAUDE.md` (the source map +
module boundaries), `src/pages/CLAUDE.md` (pages & routing), `src/lib/CLAUDE.md`
(data layer), `src/lib/stores/CLAUDE.md` (the domain-split stores),
`src/components/CLAUDE.md` (shared UI + `<Modal>`), `src/styles/CLAUDE.md` (CSS
tokens + the `kit/` barrel). This file stays the architecture/landmines narrative.

## Commands

```bash
npm install
npm run dev          # http://localhost:5173 — no host configured → the connect screen
npm run build        # → dist/  (minified, hashed, tree-shaken)
npm run dev:assistant     # http://localhost:5174 — the STANDALONE assistant surface
npm run build:assistant   # → dist-assistant/
npm run check:assistant   # the standalone bundle contains no Control Panel, and is fully styled
npm run deploy:assistant  # = deploy/deploy-assistant.sh — publish it into the leaf's wwwroot
npm run preview      # serve the built dist/
./deploy/setup.sh    # ONCE per host — verifies the wwwroot target exists and is yours
npm run deploy:prod  # = deploy/deploy.sh — build + rsync dist/ into the kgsm-api wwwroot, no API restart

KGSM_API=http://127.0.0.1:8096 npm run smoke   # against a RUNNING, AUTH-DISABLED kgsm-api
```

**Frontend-only deploys never restart the API.** kgsm-api serves this SPA
same-origin from its `wwwroot/` via ASP.NET `UseStaticFiles` (PhysicalFileProvider
— read from disk per request, no content cache), so `npm run deploy:prod`
(`deploy/deploy.sh`) just builds `VITE_API_BASE=self` and `rsync`s `dist/`
into the live `wwwroot/` (`/opt/kgsm-api/wwwroot`, owned by the service user → no
sudo); the bundle is live the moment the files land. Reserve the full
`kgsm-api/deploy/deploy.sh` (which bounces the systemd unit) for **API code**
changes — it also re-bundles the SPA.

This repo follows the same `setup.sh`-once / `deploy.sh`-forever pattern every
`kgsm-*` repo uses, and is the simplest case of it — the one project that needs no
privilege even at setup. It owns no systemd unit and runs no process of its own, so
`setup.sh` installs nothing and needs no polkit grant: it only verifies that the
wwwroot target exists and is writable by you, since kgsm-api's deploy is what
creates it. `deploy.sh` then builds and `rsync`s with **no sudo and no prompts**, and
refuses up front with *"run `deploy/setup.sh`"* when the target isn't there. The
three files in `deploy/` are self-contained, so a standalone clone deploys.

**There is an ESLint gate (`npm run lint`) but no typecheck or unit-test runner** —
don't hunt for `npm run test`. The lint config (`eslint.config.js`, ESLint 9 flat)
is deliberately NARROW: `no-undef` and `react-hooks/rules-of-hooks` are **errors**
(these are the static bug classes the build silently passed — see CHANGELOG v1.4.3:
a component used-but-not-imported, and a hook called after an early return);
`react-hooks/exhaustive-deps` and `no-unused-vars` are **warnings** (a real backlog
to work down, not a wall). Keep errors at zero. The other automated check is
`scripts/smoke-live.mjs` (`npm run smoke`): it boots the real Vite module graph in jsdom
against a RUNNING kgsm-api and asserts real backend data renders without crashing. After any
data-layer or route change, run `npm run lint` (0 errors), `npm run build` (no
import dangles), and `npm run smoke` against a live api.

Five things about the smoke are load-bearing enough to state outright:

- **It never mutates the host.** Every assertion is either a READ against the live backend or a
  WRITE INTERCEPTED at the fetch seam (assert the request the SPA builds, answer it synthetically).
  This is not fastidiousness: kgsm's event transport is a single host-wide journal
  (`/var/lib/kgsm/events/*.ndjson`) indexed by ONE kgsm-monitor, and **every** kgsm-api on the box —
  including the operator's `:8097` — merges its engine history from that one monitor. There is no
  such thing as a write scoped to the backend under test; anything reaching the engine lands in the
  operator's real audit log permanently and rides the live consumer out to their notification
  integrations. So: no `kgsm.sh events emit`, no engine-touching PUT/DELETE, and nothing requiring
  this process to sit next to the engine. A run leaves nothing behind because it writes nothing —
  not because it cleans up afterwards. Coverage this gives up (the journal→api→stream relay, the
  note's verbatim round trip through a SOURCED config) lives in kgsm-api's `AuditJournalRelayTests`
  / `ServerNoteRoundTripTests`, which own a disposable fixture.
- **It needs an AUTH-DISABLED backend.** It sends no bearer, so a real auth-enabled host
  401s every gated read. The backend it expects is `scripts/visual-harness/dev-api.sh`
  (`:8096`); the prod unit on `:8097` has auth ON, and the smoke refuses it up front with a
  message rather than degrading into a wall of failures. Run it as
  `KGSM_API=http://127.0.0.1:8096 npm run smoke`.
- **The backend URL is written to `.env.development.local`, not `.env.local`.** The vite
  server boots in "development" mode, and Vite ranks a mode-specific env file above a plain
  one — the committed `.env.development` (seeding `:8090`) beats `.env.local`, so writing
  there silently does nothing and the whole suite runs against the wrong port.
- **Monaco is stubbed with a `textarea`.** It is built for a real browser and throws from
  inside its own mount under jsdom, which surfaces as the *page* hitting its error boundary
  — every surface hosting it (blueprint editor, create page, file editor, chat draft) would
  be untestable. Its real behaviour is proven in Chromium by the visual harness; the smoke
  asserts the wiring around it.
- **Instances are DERIVED from the live roster, never named.** `PROBE`/`OTHER` come from
  `GET /servers`, because a hardcoded instance name rots the moment someone uninstalls it
  and then fails in a way that reads like an SPA regression.

**For VISUAL / layout testing (smoke is jsdom — it does NOT lay out CSS), use the
permanent headless-browser harness at `/home/heisen/tks/scripts/visual-harness/`**
(outside the repos on purpose, so it doesn't violate the no-test-runner rule).
Playwright + Chromium (no sudo on this host) drive the real SPA against a real
**auth-disabled** dev kgsm-api with real data — this is the only way to actually
*see* a mobile/responsive/overflow bug rather than reason about the CSS. Flow:
background `dev-api.sh` (auth-off api on :8096, state sandboxed) + `dev-web.sh`
(Vite on :5190, seeded — leaves your `:5173` alone), then `node shoot.mjs
'#/servers/factorio-test/files' --device both --click 'manage.sh'` → PNGs in
`shots/` + overflow/footer-overlap diagnostics. See that dir's `README.md` for the
full recipe and gotchas (port waits, teardown, the `pkill -f` self-match trap).

## The connection model (`src/lib/config.js`)

There is exactly ONE data path: the app always talks to real `kgsm-api`(s). There
are no fixtures and no mode switch. The only state distinction is **whether any
host is connected**, derived at module-load from `CONNECTIONS`:

- **≥1 connection** (a non-empty localStorage registry, or a `VITE_API_BASE`
  *seed*) → normal operation against the real backend(s).
- **0 connections** → the "connect a host" screen (`AddHostPage`), the entry point
  where you point the SPA at a kgsm-api.

`VITE_API_BASE` is an OPTIONAL single-host **seed** (a dev shortcut and how
`smoke` points the app at a backend), not a gate. `CONNECTIONS` is seeded once at
module load and then **grows in place**: cluster discovery (`clusterStore.discover`,
started from `stores/boot.js`) asks any reachable node for the converged peer
roster and registers the nodes it names, so the SPA drives the **cluster's** node
set rather than the addresses this browser was pointed at by hand. The array
identity never changes, so every consumer that holds the import sees a new node at
once; `subscribeConnections()` notifies the pieces that hold per-connection
resources (the SSE registry opens a stream per new node and re-hydrates). Connect
and disconnect still do a **full page reload** — they change identity and auth, the
same way login/logout/session-loss do. An appended peer needs no reload.

Each host carries its own base URL + bearer, and **routing is exact**: `apiV1Of(hostId)`
resolves the connection with that backend id or fails — throwing in dev, returning
null in prod so the call is rejected — because answering from another node is worse
than not answering. The single exemption is **cold boot**: a lone connection whose id
`GET /hosts` hasn't reconciled yet answers to any id. The fan-out and the SSE registry
already hold the connection, so they address it directly (`apiV1ForConn` /
`streamUrlForConn`) instead of round-tripping through an id. Multi-host (N≥2) fan-out
+ merge are real but some paths are still partly stubbed (see `merge.js`, `WIRING.md`).
`CONNECTIONS.length` (0 → connect screen, \>1 → fan-out) is a topology check, NOT a
mode flag — don't reintroduce a `LIVE`/`MOCK` duality.

## The data layer (`src/lib/`)

Components never touch the API directly. The flow is:

```
component → useStore(domainStore)            (store.js / stores.js — reactive cache, React 18 useSyncExternalStore)
domainStore.refresh() → api.get/post/patch   (apiClient.js — the ONE backend seam)
   fetch → adapters.js → store
realtime: liveStream.js (fetch-based SSE — one primary stream per host + per-view dynamic streams) → adaptStreamMessage → same stores
```

- **`apiClient.js` is the single seam.** Every store stays empty until it fetches;
  **call sites only ever see `api`**. It also owns connection health
  (`connectionStore` = REST reachability → cold-start/banner; `realtimeStore` =
  per-host SSE stream state, driven by `liveStream` `onMode`), the per-host auth gate
  (`api.host(id)` with 401-retry/silent-renew), `fanOut` (multi-host roll-up),
  `reconnectHost`/`reconnectAll` (drive the per-host sockets). **The assistant is not on
  this seam** — see below.
- **`adapters.js` — the honesty boundary.** kgsm-api emits a narrow, HONEST
  model. A value the backend doesn't provide maps to
  `null`/`"unknown"`/`[]` — **NEVER to `0` or an invented default** (the
  ecosystem-wide "never fabricate a metric" invariant; the UI renders "—").
  Don't hardcode game/domain data the backend can serve — plumb it through.
- **`merge.js`** — pure per-host → aggregated roll-up (every row carries its
  owning host id; merge only unions/de-dups, never invents attribution).
- **`assistantClient.js` + `assistantSession.js` — the SECOND seam, onto the assistant
  LEAF.** The assistant is a standalone service, so the chat talks to it **directly**, on
  the public origin the host's assistant capability reports (`info.url`), with a session
  the **leaf** issued — `kgsm-api` is not in the path of a turn, a confirmation, or a
  conversation read. `assistant.host(id)` mirrors `api.host(id)`'s shape (`conversations`,
  `turn`, `confirm`, …) against the leaf's own unprefixed routes. **A host that reports no
  public origin has no chat** (`ENOROUTE`, and the capability reads down) — it never falls
  back to kgsm-api's `/assistant/*` relay, which exists to reach a *peer* node's assistant
  and logs a warning when it serves the local one.

### Init-order: the lazy-import edges are deliberate

A few base-layer modules `import("...")`-lazily import upper ones (e.g.
`apiClient.js` defers `stores.js`/`sessionStore.js`/`alertsApi.js`). This keeps
the ESM graph **acyclic** — a carryover from the prototype's fixed global script
order. Converting one of these to a static `import` can reintroduce a cycle and
break boot. Read the comments before "tidying" an import.

## Auth, RBAC, capabilities

- **`sessionStore.js` — per-host identity (Model A).** Discord login is the
  global SSO anchor; each host mints its OWN short-lived access token
  (sessionStorage) + long-lived refresh token (localStorage, weeks) and resolves
  the user's role via that host's bot. `authRedirect.js` captures the OAuth
  fragment handoff at boot.
- **`persona.js` — the authorization POLICY (single source of truth).** Roles are
  `admin｜operator｜viewer｜none`, resolved **per host** (you can be admin on one
  box, viewer on another). The rule: **`can(cap)` = aggregate (held on ANY host) for
  nav/reach; `canOn(cap, host)` = scoped for actions** — never substitute one for
  the other. `resolveRoute()` is the **routing chokepoint**: a forbidden route is
  mapped to the persona's home synchronously, so it never enters state or mounts.
- **`assistantSession.js` — the session with the LEAF, separate from the node's, and obtained
  silently.** The assistant issues and revokes its own tokens, but every surface on a host is the
  **same Discord application** (one `KgsmAuth__ClientId`, differing only in redirect URI), so a
  browser signed into the panel has already authorized the assistant: its round trip completes with
  `prompt=none`, rendering nothing. It is chained onto a panel login (already mid-redirect, so it
  costs nothing visible) and otherwise fires as soon as there is a targeted assistant host — which
  is what bounds it, since no assistant means nothing targeted and several means nothing targeted
  until the user picks. The return leg lands here carrying an **`assistant_login=<hostId>` marker
  in the query**; that marker is load-bearing, because both logins come back to this origin with
  the same `access`/`refresh`/`error` fragment keys and without it the panel hands a leaf token to
  kgsm-api and gets a 401. ⚠ **One redirect per host per tab**, so a refusing leaf cannot loop the
  browser.
- **`capabilities.js` — per-host services** (metrics / assistant / watchdog), each
  with `provisioned` (offered?) × `status` (live health). **The assistant is
  per-host with no central fallback** — if a host doesn't expose it, that host has
  no assistant. An assistant whose capability names no public origin reads **down**,
  because the browser has nowhere to send a turn however healthy the leaf is.

## The shell (`App.jsx`)

Hash routing (`router.js`) — the URL is the source of truth (Back/Forward,
deep links, refresh all work). **Login/logout/session-loss do a full
`window.location.reload()` rather than swapping components in place** — this is
deliberate: several hooks live below the `!user` gate, so flipping `user` in
place would trip React's Rules of Hooks. Keep that pattern. Server sub-tabs with
no backend source yet (Files, Settings, Performance, Players) keep their full UI
but render an honest "Work in progress — not available yet" state behind a
`…_WIRED = false` flag — never fabricated data; flip the flag + hydrate when the
endpoint lands.

## Styling & themes (`src/styles/`)

Plain CSS, no Tailwind/CSS-modules. Three files load in order (`main.jsx`):
`tokens.css` → `kit.css` → `consumer.css`. Everything is driven by ~40 CSS custom
properties — **a component must never hardcode a color; add or extend a token.**

- **`tokens.css` — the design-token source of truth, split by concern:**
  - A plain `:root` holds **structural** tokens (type, spacing, radius, shadow,
    motion, layout) — theme-invariant. Shadow/ring tokens may reference color vars;
    `var()` is late-bound, so they pick up the active theme automatically.
  - **Color** tokens live in theme scopes: `:root, [data-theme="dark"]` (the
    default — applies with no attribute too) and `[data-theme="light"]`. Plus the
    overlay tokens that used to be hardcoded everywhere: `--veil-1/2/3` (white-alpha
    surface fills that flip to black-alpha on light), `--scrim-base` (modal/drawer
    backdrop, consumed via `color-mix` so each site keeps its own alpha), and
    `--scrollbar-*`. **The contract: a theme = the FULL color set re-valued.**
    Canvas-fade gradients use `color-mix(in srgb, var(--canvas) X%, transparent)`
    so they track the theme with no extra token.
- **`kit.css` is a BARREL, not a file to edit.** The old ~6,300-line monolith is
  split into **focused partials under `src/styles/kit/`** (`base`, `shell`,
  `server`, `catalog`, `modal`, `onboarding`, `dashboard`, `observability`,
  `controls`, `responsive`, `chat`, `settings`, `dock`, `hosts`, `states`,
  `extras`). `kit.css` only `@import`s them. **Add a rule to the partial that owns
  the domain — do NOT grow a monolith again.** Import **order is load-bearing**
  (later wins on equal specificity): keep the `@import` sequence; a new domain gets
  a new partial appended to the barrel. `@import` must precede other rules, which
  the imports-only barrel satisfies.
- **`consumer.css`** — a few consumer surfaces (connect/MOTD/login persona).

**Themes (`src/lib/theme.js`).** A client-only preference (`localStorage
krystal:theme` = `auto｜dark｜light`, default `dark`) that NEVER round-trips to a
host — same model as favorites. `auto` resolves via `matchMedia` and live-updates
on OS change. Switching is **LIVE — no page reload** (swaps `<html data-theme>`,
which re-cascades instantly). Each surface offers it where it has room for it: the
panel in Settings → Account, the standalone assistant at the foot of the
conversation rail (and of the history popover at phone width, where that popover
replaces the rail). Landmines:
- **No-flash:** an inline boot script in `index.html` **and `assistant.html`** sets
  `data-theme` *before* the stylesheet applies. Both mirror `theme.js` — keep the
  three in sync.
- **Monaco can't read CSS vars** → `CodeEditor.jsx` samples the resolved tokens at
  runtime and re-themes (`vs`/`vs-dark`) whenever the theme store flips.
- **Always-dark media surfaces** (e.g. the cinematic server hero over key-art) pin
  the dark `--fg-*`/`--border-*`/`--*-fg` tokens **locally** so they stay
  light-on-dark in every theme — see `.hero--cinematic` in `kit/server.css`. Do
  that instead of per-theme special-casing.
- **Adding a theme:** add a `[data-theme="x"]` block (full color set) to
  `tokens.css`, then one entry in `theme.js`'s `THEME_OPTS` (id + label — `VALID`
  is derived from it, and every picker reads it), and the concrete-theme list in
  the `index.html` / `assistant.html` boot scripts, which cannot import.
- **Test themes with the visual harness's `--theme dark|light` flag** (jsdom smoke
  does NOT lay out CSS, so it can't catch a theme regression).

## Where truth lives, and stale-doc warnings

- **`WIRING.md` is the authoritative front↔back contract** — endpoint/realtime/
  schema diffs + the sequenced wiring plan. `§8` is the slice ledger; consult it
  for what's wired vs. pending rather than trusting prose elsewhere.
- **The README's "What's done vs. left" section is STALE.** Auth (Discord OAuth +
  per-host re-auth + refresh-token rotation) and the realtime SSE stream
  (fetch-based; migrated off WebSocket 2026-07-02, `sse-migration-plan.md`) are
  **built and committed** (see `authRedirect.js`, `sessionStore.js`,
  `liveStream.js`, and the git log) — they are NOT "left". **PWA installability is
  also built, for BOTH surfaces** — each installs as its own app, with its own manifest,
  production-only service worker and icons under `public-<surface>/` (see the
  "PWA / installability" section in `README.md`, `scripts/public-overlay.js`, and
  `src/lib/registerSW.js`). Genuinely still deferred: TypeScript, a
  unit-test runner, a full Workbox **precache** (`vite-plugin-pwa`; the current SW
  caches on demand, not the whole build manifest), the Files/Settings/Performance/
  Players backends (their tabs render a "work in progress" state), and parts of
  multi-host fan-out. Describe current state from code + git, not from that list.
- **`MIGRATION.md` is a historical playbook and partly stale** — it references
  `src/lib/api.js` / `api-contract.js`, which no longer exist (the seam is
  `apiClient.js` + `adapters.js` + `config.js`).

## Version tracking

- **Version source:** `"version"` field in `package.json`
- Bump the version whenever you make a user-facing change (new feature, bug fix, behaviour change). Patch for fixes, minor for new features, major for breaking changes.
- Update `CHANGELOG.md` under `## [Unreleased]` with a brief entry for every meaningful change.
- A git tag matching the new version should be created on release: `git tag v<version>`.
