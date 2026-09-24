# Krystal Control Panel (`kgsm-web`)

The web Control Panel SPA for the KGSM ecosystem — a **standard Vite + React 18**
single-page app (JSX), built as real, tree-shaken ES modules.

> **Runtime multi-host client.** There is ONE data path: the app always talks to
> real `kgsm-api`(s). With no host connected it opens the **"connect a host"**
> screen — you tell it which `kgsm-api`(s) to talk to; the registry lives in
> localStorage. A `VITE_API_BASE` seed can pre-connect one host for dev. Each
> connected host's `kgsm-api` must allow the SPA origin via `KGSM_API_CORS_ORIGINS`.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 — no host connected → the connect screen
npm run build        # → dist/  (minified, hashed, production bundle)
npm run preview      # serve the built dist/ locally
npm run deploy:prod  # build + sync dist/ into the web root — nothing restarts
```

## Deploying the frontend

The panel is served by **no node**. It is a static artifact that belongs to no cluster — it holds no
cluster state, depends on no node, and reaches whichever cluster it is pointed at over that
cluster's public addresses. `npm run deploy:prod` (`deploy/deploy.sh`) builds and `rsync`s `dist/`
into the directory a web server publishes (`/srv/kgsm-web` by default, yours → no sudo; override
with `KGSM_WEB_ROOT`). The new bundle is live the moment the files land, because nothing is running
to restart. Which server publishes it is a deployment choice this repo does not make.

The build carries **no node address**. Baking one in would make this that node's panel rather than
a panel.

It carries an anchor only when the host configures one — `KGSM_AUTH_ANCHOR` in the untracked
`deploy/deploy.local.env`, or the environment. Blank by default: an unconfigured build points at no
cluster and asks for an address, which is what lets one deployment serve any of them. Configured, it
opens on that cluster's sign-in. A default, never a lock — a door somebody has already chosen wins,
and "Another address" still reaches the address box.

Run `./deploy/setup.sh` once on a new host first. It creates the web root and the auth pages' root and
hands them to you; `deploy.sh` refuses until it has run. With `KGSM_PANEL_HOST` in the untracked
`deploy/deploy.local.env`, it also serves the panel at that name through nginx — the machine's `:80`
ACME webroot and https upgrade, the panel's vhost (`deploy/nginx/`), its Let's Encrypt certificate and
the renewal hook — and, where the auth anchor runs on the machine, points the anchor at the pages and
declares the panel's origin a client of its sign-in. Everything it writes comes from this repo and that
file, and re-running it changes nothing that already matches. It asks for sudo once.

For an **API code change**, use the full `kgsm-api/deploy/deploy.sh` instead — it
publishes the API and re-bundles the SPA, swapping the systemd service.

## Verifying

```bash
npm run build      # the mechanical check — fails on any dangling import
KGSM_API=http://127.0.0.1:8096 npm run smoke   # jsdom mount of the read paths against a RUNNING kgsm-api
```

`npm run smoke` (`scripts/smoke-live.mjs`) boots the real Vite module graph in jsdom
against a running backend and asserts real backend data renders without crashing. It
needs an **auth-disabled** backend (unauthenticated reads + tier=admin from `/me`) — it
sends no bearer, so it refuses an auth-enabled host up front. `scripts/visual-harness/dev-api.sh`
in the workspace root — its own repo, beside the projects — serves one on `:8096`. See `CLAUDE.md` for the rest of
its contract (Monaco is stubbed; probe instances come from the live roster).

## Layout

```
kgsm-web/
  index.html              Vite entry → /src/main.jsx
  vite.config.js  package.json  .env.example
  public/
    fonts/                self-hosted Inter + JetBrains Mono (variable)   } SHARED by both builds
    assets/               brand mark                                      }
  public-panel/           the Control Panel's manifest, service worker, icons, launch images
  public-assistant/       the standalone assistant's — it installs as its own app
  src/
    main.jsx              mounts <App/> in the root ErrorBoundary; imports global CSS
    App.jsx               the shell: auth gate, hash routing, sidebar, assistant dock
    components/           shared components (Sidebar, ServerCard, ConsolePanel, …)
    pages/                routed pages (Dashboard, Servers, Library, Alerts, …)
    lib/                  client data layer (see below) · theme.js (client-only theme pref)
    styles/
      tokens.css          design tokens + @font-face — :root structural + [data-theme] color scopes
      kit.css             BARREL: @imports kit/*.css in cascade order (do not grow a monolith)
      kit/                domain partials (shell, server, catalog, dashboard, chat, hosts, …)
      consumer.css        app-level overrides
  scripts/                smoke-live.mjs (live-wiring smoke)
  deploy/                 setup.sh · deploy.sh (frontend-only deploy) · deploy-common.sh
```

### The data layer (`src/lib/`)

The reactive store layer:

- `store.js` — `createStore` / `useStore` (React 18 `useSyncExternalStore`).
- `apiClient.js` — the backend seam (`api`): `fetch` against `kgsm-api` (REST,
  translated by `adapters.js`) + fetch-based SSE per host (`liveStream.js`). The
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

each connected host's `kgsm-api` must allow the SPA origin via
`KGSM_API_CORS_ORIGINS`. The seams are `src/lib/apiClient.js`
(`get/post/patch` + `fanOut` + the SSE streams, with adapters in
`src/lib/adapters.js`) and `src/lib/connect.js` (the connect probe); call sites
only see `api`. **`WIRING.md` is the authoritative front↔back contract**
(endpoint/realtime/schema diff + the sequenced wiring plan).

## Scope

The SPA is a complete, live multi-host client on a real toolchain: every page
and component runs against real `kgsm-api`(s) through the store/router/data
layer — servers/hosts/audit/library/alerts over `fetch` + adapters plus the
realtime SSE stream, with honest-unknown rendering throughout. Auth is per-host:
a KGSM username/password door and Discord OAuth, with password re-auth for
sensitive writes and refresh-token rotation. The Files, Settings, Performance
and Players server sub-tabs are each backed by a real endpoint. Both surfaces —
the Control Panel and the standalone assistant — install as PWAs, each as its
own app (see "PWA / installability" below).

Deferred: TypeScript, a unit-test runner (Vitest + RTL), a full Workbox
**precache** (`vite-plugin-pwa` — the service workers cache on demand, not the
whole build manifest up front), and parts of multi-host fan-out (see
`WIRING.md §8` and `src/lib/merge.js`).

## PWA / installability

**Both surfaces are Progressive Web Apps.** On Android Chrome each offers **Install app** (Add to
Home Screen) and runs standalone and full-screen; they install as **two separate apps**, since
they are two origins with two manifests. The pieces, per surface:

| | Control Panel | standalone assistant |
|---|---|---|
| entry | `index.html` | `assistant.html` |
| manifest | `public-panel/manifest.webmanifest` | `public-assistant/assistant.webmanifest` |
| worker | `public-panel/sw.js` | `public-assistant/assistant-sw.js` |
| artwork | `public-panel/icons/` + `splash/` | `public-assistant/icons/` + `splash/` |
| served by | kgsm-api | the kgsm-assistant leaf |

`public/` holds only what both share (fonts, brand mark) and Vite copies it into both bundles; each
surface's own half is laid over the top from `public-<surface>/` by `scripts/public-overlay.js`.
Shared-by-default is the point — a new shared asset needs no edit, and only a difference is
declared. `npm run check:assistant` fails the assistant build if its manifest, worker or any icon
it names is missing from `dist-assistant/`.

- **The manifests** carry name/short_name, `start_url`/`scope` `/`, `display: standalone`, the
  `#0B0F14` theme/background and 192/512/maskable icons. Chrome will not offer an install without
  the 192 **and** 512.
- **Neither manifest declares an `orientation`, and neither may.** Chrome hands the member straight
  to the installed app's Android activity, and every value there overrides the phone's own rotation
  setting — `any` pins it to full-sensor rotation, so a device locked to portrait spins anyway, and
  `portrait` would pin it the other way for someone who wants landscape. Omitted, the activity is
  left unspecified and the system's rotation lock decides. Both layouts are fluid to the viewport,
  so there is nothing the app needs to say about which way it is held.
- **The artwork is `.chat-empty__logo`**, the badge at the head of an empty conversation, drawn to
  the pixel: `scripts/make-assistant-icons.mjs` renders the lucide `bot` in `--krystal-teal` on
  `--krystal-teal-dim` over `--canvas`, the glyph 26/56 of the frame and its stroke the `1.7` every
  `<Icon>` uses. One drawing serves the favicon (SVG, plus a 32px PNG fallback), the
  `any`/`maskable`/apple-touch icons and the 13 iOS launch images. The script cannot read a CSS
  custom property, so those colours and that geometry are **copied** from `styles/tokens.css` and
  `kit/chat.css` — change the element and you must change the script. Run it by hand after changing
  the artwork; it needs `rsvg-convert` and no build invokes it.
- **The two service workers differ in what they may cache, and the difference is load-bearing.**
  The panel's DENIES `/api/` and `/auth/`, which is exhaustive for kgsm-api. The assistant's
  **allowlists**, because the leaf's routes are unprefixed at the root (`/turn`, `/conversations`,
  `/tools`, `/health`) — a denylist there caches every route the leaf grows until someone remembers
  to add it, and a stale authenticated `200` both masks token expiry and serves one person's
  conversation from another's cache. Both are network-first for navigations (a deploy lands on the
  next online load) and cache-first for content-hashed assets; neither sits in a live data path.
- **`src/lib/registerSW.js`** registers a surface's own worker **in production builds only**
  (`import.meta.env.PROD`), after `load`. Dev and the jsdom smoke never register one, so HMR and
  tests are unaffected.
- **Each entry HTML** also carries the iOS install hints (`apple-touch-icon`,
  `apple-mobile-web-app-*`, `apple-touch-startup-image`), since iOS Safari ignores the manifest.

Installability requires **HTTPS** (localhost is exempt). To check a deployed surface the way Chrome
does, `scripts/visual-harness/pwa-check.mjs` reads the parsed manifest and the worker's state out
of a real headless Chromium, and `sw-cache-check.mjs` beside it asserts the assistant's worker
leaves the leaf's API uncached. Locally: `npm run build && npm run preview`, then DevTools →
Application → Manifest / Service Workers.

## License

GNU General Public License v3.0 or later. See [LICENSE](LICENSE).
