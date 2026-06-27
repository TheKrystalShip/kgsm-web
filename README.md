# Krystal Control Panel (`kgsm-web`)

The web Control Panel SPA for the KGSM ecosystem — a **standard Vite + React 18**
single-page app (JSX). It was ported from the no-build `krystal-design`
prototype (React + Babel from a CDN, every symbol on `window`) into a real,
tree-shaken ES-module build.

> **Runtime multi-host client.** There is ONE data path: the app always talks to
> real `kgsm-api`(s). With no host connected it opens the **"connect a host"**
> screen — you tell it which `kgsm-api`(s) to talk to; the registry lives in
> localStorage. A `VITE_API_BASE` seed can pre-connect one host for dev. Each
> connected host's `kgsm-api` must allow the SPA origin via `KGSM_API_CORS_ORIGINS`.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 — no host connected → the connect screen
npm run build      # → dist/  (minified, hashed, production bundle)
npm run preview    # serve the built dist/ locally
```

## Verifying

```bash
npm run build      # the mechanical check — fails on any dangling import
KGSM_API=http://127.0.0.1:8080 npm run smoke   # jsdom mount of the read paths against a RUNNING kgsm-api
```

`npm run smoke` (`scripts/smoke-live.mjs`) writes a temporary `.env.local` with
`VITE_API_BASE`, boots the real Vite module graph in jsdom against a running
backend, and asserts real backend data renders without crashing. It expects an
**auth-disabled** backend (unauthenticated reads + tier=admin from `/me`).

## Layout

```
kgsm-web/
  index.html              Vite entry → /src/main.jsx
  vite.config.js  package.json  .env.example
  public/
    fonts/                self-hosted Inter + JetBrains Mono (variable)
    assets/  icons/       brand mark + PWA icons
  src/
    main.jsx              mounts <App/> in the root ErrorBoundary; imports global CSS
    App.jsx               the shell: auth gate, hash routing, sidebar, assistant dock
    components/           25 shared components (Sidebar, ServerCard, ConsolePanel, …)
    pages/                18 routed pages (Dashboard, Servers, Library, Alerts, …)
    lib/                  client data layer (see below)
    styles/
      tokens.css          design tokens + @font-face (the brand DS)
      kit.css             component class library
      consumer.css        app-level overrides
  scripts/                smoke-live.mjs (the live-wiring smoke harness)
  MIGRATION.md            prototype → production playbook (partly historical)
```

### The data layer (`src/lib/`)

The prototype's reactive store layer, ported verbatim to ESM:

- `store.js` — `createStore` / `useStore` (React 18 `useSyncExternalStore`).
- `apiClient.js` — the backend seam (`api`): `fetch` against `kgsm-api` (REST,
  translated by `adapters.js`) + one WebSocket per host (`liveStream.js`). The
  ONE place that talks to the backend; call sites only see `api`.
- `adapters.js` — the honesty boundary (kgsm-api DTOs → component shapes;
  unsourced values → `null`/`"unknown"`/`[]`, never a fabricated default).
- `config.js` — the connection registry (which `kgsm-api`(s) the app talks to).
- `stores.js` — domain stores (`serversStore`, `hostsStore`, `auditStore`, …),
  each empty until it hydrates from the API.
- `sessionStore.js`, `capabilities.js`, `alertsApi.js`, `merge.js`,
  `persona.js`, `router.js` — sessions/auth, per-host capabilities, alerts,
  multi-host merge, RBAC persona, and hash↔route translation.

> **Init order note.** A few base-layer modules import upper ones only for
> deferred, call-time use; those edges are `import(...)`-lazy to keep the ESM
> graph acyclic. See the comments in `apiClient.js`.

## Connecting the backend

The normal path is **in-app**: run `npm run dev`, and on the connect screen enter a
`kgsm-api` address (e.g. `http://127.0.0.1:8080`). The app probes its public
`/api/v1` handshake, registers it (URL only, in localStorage), and boots against it.
Connect more hosts later from the Fleet page — the SPA fans reads out across all of
them and rolls them up (`src/lib/merge.js`).

For dev you can pre-connect one host without the connect screen:

```bash
cp .env.example .env.local
# VITE_API_BASE=http://your-host:8080   (a SEED host — kgsm-api ORIGIN, no /api/v1; the client appends it)
# VITE_WS_BASE is optional (derived from VITE_API_BASE if unset)
```

⚠ each connected host's `kgsm-api` must allow the SPA origin via
`KGSM_API_CORS_ORIGINS`. The seams are `src/lib/apiClient.js`
(`get/post/patch` + `fanOut` + the WebSocket, with adapters in
`src/lib/adapters.js`) and `src/lib/connect.js` (the connect probe); call sites
only see `api`. **`WIRING.md` is the authoritative front↔back contract**
(endpoint/realtime/schema diff + the sequenced wiring plan).

## What's done vs. what's left

**Done:** the full UI on a real toolchain — all components + pages, the
store/router/data layer, self-hosted fonts, lucide-react icons, the complete CSS,
a green production build, and the live backend wiring (servers/hosts/audit/library/
alerts via `fetch` + adapters + the realtime WebSocket, with honest-unknown
rendering and the per-host Discord auth gate).

**Done (PWA):** the app is **installable** on Android/desktop Chrome and iOS
Safari — a web app manifest (`public/manifest.webmanifest`) + a minimal
same-origin service worker (`public/sw.js`, registered production-only via
`src/lib/registerSW.js`) that serves an offline app shell while leaving all
live `kgsm-api` traffic untouched. See "PWA / installability" below.

**Left** (see `WIRING.md §8`): backends for the Files / Settings / Performance /
Players sub-tabs (their UI renders a "work in progress" state today), optional
TypeScript, a unit-test runner (Vitest + RTL), and a full Workbox **precache**
(`vite-plugin-pwa`) — the current SW caches the shell on demand, not the whole
build manifest up front.

## PWA / installability

The Control Panel is a Progressive Web App: on Android Chrome it offers
**Install app** (Add to Home Screen) and runs standalone, full-screen, with the
brand icon. The pieces:

- **`public/manifest.webmanifest`** — name/short_name, `start_url`/`scope` `/`,
  `display: standalone`, the `#0B0F14` theme/background, and the 192/512/maskable
  icons in `public/icons/`. Linked from `index.html`.
- **`public/sw.js`** — a deliberately small service worker. It only intercepts
  **same-origin GETs** (the app shell): navigations are network-first with an
  offline fallback to the cached shell; Vite's content-hashed assets are
  cache-first (stale-while-revalidate). Every cross-origin `kgsm-api` call and
  WebSocket passes straight through — the SW never sits in the live data path.
- **`src/lib/registerSW.js`** — registers the SW **in production builds only**
  (`import.meta.env.PROD`), after `load`. Dev (`npm run dev`) and the jsdom smoke
  run never register it, so HMR and tests are unaffected.
- **`index.html`** — also carries the iOS install hints (`apple-touch-icon`,
  `apple-mobile-web-app-*`), since iOS Safari ignores the manifest.

Installability requires the app be served over **HTTPS** (localhost is exempt) —
serve `dist/` from an HTTPS origin and Chrome shows the install prompt. To check
locally: `npm run build && npm run preview`, then open DevTools → Application →
Manifest / Service Workers.
