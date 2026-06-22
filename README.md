# Krystal Control Panel (`kgsm-web`)

The web Control Panel SPA for the KGSM ecosystem — a **standard Vite + React 18**
single-page app (JSX). It was ported from the no-build `krystal-design`
prototype (React + Babel from a CDN, every symbol on `window`) into a real,
tree-shaken ES-module build.

> **Runtime multi-host client.** With no API configured the app opens the
> **"connect a host"** screen (it's a multi-host client — you tell it which
> `kgsm-api`(s) to talk to; the registry lives in localStorage). Three modes:
> **LIVE** (a connected host, or a `VITE_API_BASE` seed), **MOCK** (`?mock=1` /
> `VITE_MOCK` — the bundled fixtures, now **tests/demo only**), **OFFLINE**
> (neither → the connect screen). Each connected host's `kgsm-api` must allow the
> SPA origin via `KGSM_API_CORS_ORIGINS`.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 — no API configured → the connect screen
                   #   connect a kgsm-api, or open ?mock=1 for the fixtures demo
npm run build      # → dist/  (minified, hashed, production bundle)
npm run preview    # serve the built dist/ locally
```

## Verifying

No-browser smoke harnesses (jsdom + the real Vite module graph):

```bash
npm run smoke                   # full mock suite: routes + mount + auth + offline + multihost
node scripts/smoke-routes.mjs   # SSR-render every route, catch render throws (fixtures)
node scripts/smoke-mount.mjs    # client-mount effect-heavy routes, run effects (fixtures)
node scripts/smoke-offline.mjs  # OFFLINE boot → connect screen + connect-helper unit tests
node scripts/smoke-multihost.mjs# N≥2 fan-out: per-host routing + merge roll-up (stubbed 2 hosts)

# Live wiring (needs a running kgsm-api):
KGSM_API=http://127.0.0.1:8097 npm run smoke:live
```

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
  scripts/                codemod (migration record) + smoke harnesses
  reference/              the scaffold's live-backend API seam (not wired; see below)
  MIGRATION.md            prototype → production playbook (auth, realtime, TS, PWA)
```

### The data layer (`src/lib/`)

The prototype's reactive store layer, ported verbatim to ESM:

- `store.js` — `createStore` / `useStore` (React 18 `useSyncExternalStore`).
- `apiClient.js` — the backend seam (`api`). A mock that resolves from
  `data.js` with simulated latency + a streaming channel. **This is the one file
  to replace to go live** (swap `get`/`post`/`stream` for `fetch`/WebSocket
  against `kgsm-api`); call sites never change.
- `data.js` — bundled demo fixtures (`KRYSTAL_DATA`).
- `stores.js` — domain stores (`serversStore`, `hostsStore`, `auditStore`, …).
- `sessionStore.js`, `capabilities.js`, `alertsApi.js`, `chatTools.js`,
  `persona.js`, `router.js` — sessions/auth, per-host capabilities, alerts,
  the assistant tool layer, RBAC persona, and hash↔route translation.

> **Init order note.** Because the prototype relied on a fixed global script
> load order, a few base-layer modules import upper ones only for deferred,
> call-time use; those edges are `import(...)`-lazy to keep the ESM graph
> acyclic. See the comments in `apiClient.js` / `data.js`.

## Connecting the backend

The normal path is **in-app**: run `npm run dev`, and on the connect screen enter a
`kgsm-api` address (e.g. `http://127.0.0.1:8097`). The app probes its public
`/api/v1` handshake, registers it (URL only, in localStorage), and boots against it.
Connect more hosts later from the Fleet page — the SPA fans reads out across all of
them and rolls them up (`src/lib/merge.js`).

For dev you can pre-seed one host without the connect screen:

```bash
cp .env.example .env.local
# VITE_API_BASE=http://your-host:8097   (a SEED host — kgsm-api ORIGIN, no /api/v1; the client appends it)
# VITE_WS_BASE is optional (derived from VITE_API_BASE if unset)
```

With a connected host (or the `VITE_API_BASE` seed) the SPA is **LIVE** and talks to
real `kgsm-api`(s) over `fetch`; `?mock=1` / `VITE_MOCK` runs the bundled **fixtures**
(now tests/demo only); with neither it's **OFFLINE** → the connect screen. ⚠ each
connected host's `kgsm-api` must allow the SPA origin via `KGSM_API_CORS_ORIGINS`. The
seams are `src/lib/apiClient.js` (live `get/post/patch` + `fanOut` + adapters in
`src/lib/adapters.js`) and `src/lib/connect.js` (the connect probe);
call sites never change. **`WIRING.md` is the authoritative front↔back contract**
(endpoint/realtime/schema diff + the sequenced wiring plan). The read path
(servers/hosts) is wired and live-verified; auth, realtime, and the rest are the
remaining slices in `WIRING.md §8`.

## What's done vs. what's left

**Done:** the full UI ported to a real toolchain — all 25 components + 18 pages,
the store/router/data layer, self-hosted fonts, lucide-react icons, the complete
CSS, a green production build, and the read-path backend wiring (servers/hosts via
the live transport + adapters, honest-unknown rendering) verified by the smoke
harnesses.

**Left** (see `WIRING.md §8`): the rest of the read path (audit/library/alerts),
real auth
(Discord OAuth + per-host re-auth), a realtime WebSocket client, optional
TypeScript, tests (Vitest + RTL), and a PWA precache (`vite-plugin-pwa`).
