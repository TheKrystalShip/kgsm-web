# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`kgsm-web` is the **Control Panel SPA** for the KGSM ecosystem — a standard
Vite + React 18 (JSX) single-page app, ported from the no-build `krystal-design`
prototype. It is a **runtime multi-host client**: it reads a localStorage
registry of `kgsm-api` hosts and talks to them over `fetch` + WebSocket. The
`README.md` covers quick-start and the file layout; this file covers the
architecture and the landmines.

## Commands

```bash
npm install
npm run dev          # http://localhost:5173 — no host configured → the connect screen
npm run build        # → dist/  (minified, hashed, tree-shaken)
npm run preview      # serve the built dist/
npm run deploy:prod  # build + rsync dist/ into the kgsm-api wwwroot — NO API restart, no sudo

KGSM_API=http://127.0.0.1:8080 npm run smoke   # against a RUNNING kgsm-api
```

**Frontend-only deploys never restart the API.** kgsm-api serves this SPA
same-origin from its `wwwroot/` via ASP.NET `UseStaticFiles` (PhysicalFileProvider
— read from disk per request, no content cache), so `npm run deploy:prod`
(`scripts/deploy-prod.sh`) just builds `VITE_API_BASE=self` and `rsync`s `dist/`
into the live `wwwroot/` (`/opt/kgsm-api/wwwroot`, owned by the service user → no
sudo); the bundle is live the moment the files land. Reserve the full
`kgsm-api/deploy/deploy.sh` (which bounces the systemd unit) for **API code**
changes — it also re-bundles the SPA.

**There is no lint, typecheck, or unit-test runner** — don't hunt for `npm run
lint`/`test`. The only automated check is `scripts/smoke-live.mjs` (`npm run
smoke`): it writes a temporary `.env.local` with `VITE_API_BASE`, boots the real
Vite module graph in jsdom against a RUNNING kgsm-api, and asserts real backend
data renders without crashing. It expects an **auth-disabled** backend
(unauthenticated reads + tier=admin from `/me`). After any data-layer or route
change, run `npm run build` (the only mechanical check that no import dangles) and
`npm run smoke` against a live api.

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
`smoke` points the app at a backend), not a gate. `CONNECTIONS` is read once at
module load; the app does a **full page reload** on any registry change
(connect/disconnect) so every module-load read re-evaluates — the same way it
reloads on login/logout/session-loss.

Each host carries its own base URL + bearer; `apiV1Of(hostId)` / `wsUrlOf(hostId)`
route per host, with a **sole-connection fallback** that makes N=1 the simple
case. Multi-host (N≥2) fan-out + merge are real but some paths are still partly
stubbed (see `merge.js`, `WIRING.md`). `CONNECTIONS.length` (0 → connect screen,
\>1 → fan-out) is a topology check, NOT a mode flag — don't reintroduce a
`LIVE`/`MOCK` duality.

## The data layer (`src/lib/`)

Components never touch the API directly. The flow is:

```
component → useStore(domainStore)            (store.js / stores.js — reactive cache, React 18 useSyncExternalStore)
domainStore.refresh() → api.get/post/patch   (apiClient.js — the ONE backend seam)
   fetch → adapters.js → store
realtime: liveStream.js (one WS per host) → adaptStreamMessage → same stores
```

- **`apiClient.js` is the single seam.** Every store stays empty until it fetches;
  **call sites only ever see `api`**. It also owns connection health
  (`connectionStore` = REST reachability → cold-start/banner; `realtimeStore` =
  per-host WS state, driven by `liveStream` `onMode`), the per-host auth gate
  (`api.host(id)` with 401-retry/silent-renew), `fanOut` (multi-host roll-up),
  `reconnectHost`/`reconnectAll` (drive the per-host sockets), and the SSE
  assistant turn (`api.host(id).turn`).
- **`adapters.js` — the honesty boundary.** kgsm-api emits a narrow, HONEST
  model. A value the backend doesn't provide maps to
  `null`/`"unknown"`/`[]` — **NEVER to `0` or an invented default** (the
  ecosystem-wide "never fabricate a metric" invariant; the UI renders "—").
  Don't hardcode game/domain data the backend can serve — plumb it through.
- **`merge.js`** — pure per-host → aggregated roll-up (every row carries its
  owning host id; merge only unions/de-dups, never invents attribution).

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
- **`capabilities.js` — per-host services** (metrics / assistant / watchdog), each
  with `provisioned` (offered?) × `status` (live health). **The assistant is
  per-host with no central fallback** — if a host doesn't expose it, that host has
  no assistant.

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
which re-cascades instantly; the picker is in Settings → Account). Landmines:
- **No-flash:** an inline boot script in `index.html` sets `data-theme` *before*
  the stylesheet applies. It mirrors `theme.js` — keep the two in sync.
- **Monaco can't read CSS vars** → `CodeEditor.jsx` samples the resolved tokens at
  runtime and re-themes (`vs`/`vs-dark`) whenever the theme store flips.
- **Always-dark media surfaces** (e.g. the cinematic server hero over key-art) pin
  the dark `--fg-*`/`--border-*`/`--*-fg` tokens **locally** so they stay
  light-on-dark in every theme — see `.hero--cinematic` in `kit/server.css`. Do
  that instead of per-theme special-casing.
- **Adding a theme:** add a `[data-theme="x"]` block (full color set) to
  `tokens.css`, then list `x` in `theme.js`'s `VALID`, the `index.html` boot
  script, and `THEME_OPTS` in `SettingsPage.jsx`.
- **Test themes with the visual harness's `--theme dark|light` flag** (jsdom smoke
  does NOT lay out CSS, so it can't catch a theme regression).

## Where truth lives, and stale-doc warnings

- **`WIRING.md` is the authoritative front↔back contract** — endpoint/realtime/
  schema diffs + the sequenced wiring plan. `§8` is the slice ledger; consult it
  for what's wired vs. pending rather than trusting prose elsewhere.
- **The README's "What's done vs. left" section is STALE.** Auth (Discord OAuth +
  per-host re-auth + refresh-token rotation) and the realtime WebSocket are
  **built and committed** (see `authRedirect.js`, `sessionStore.js`,
  `liveStream.js`, and the git log) — they are NOT "left". **PWA installability is
  also built** (manifest + a production-only same-origin service worker — see the
  "PWA / installability" section in `README.md`; `public/manifest.webmanifest`,
  `public/sw.js`, `src/lib/registerSW.js`). Genuinely still deferred: TypeScript, a
  unit-test runner, a full Workbox **precache** (`vite-plugin-pwa`; the current SW
  caches on demand, not the whole build manifest), the Files/Settings/Performance/
  Players backends (their tabs render a "work in progress" state), and parts of
  multi-host fan-out. Describe current state from code + git, not from that list.
- **`MIGRATION.md` is a historical playbook and partly stale** — it references
  `src/lib/api.js` / `api-contract.js`, which no longer exist (the seam is
  `apiClient.js` + `adapters.js` + `config.js`).
