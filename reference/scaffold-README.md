# Krystal Control Panel — Production React App

A real Vite + React build of the Krystal control panel, migrated from the
no-build, browser-Babel UI-kit prototype.

> **Where this came from.** The prototype lives at
> `ui_kits/control-panel/` in the design-system project — it renders by loading
> React + Babel from a CDN and transpiling `.jsx` in the browser, with every
> component hung off `window`. This app is the production starting point: a
> proper toolchain, ES modules, a real API seam, and tree-shaken builds.
>
> It was parked under `templates/` only so the design-system compiler ignores
> it. **Move this folder to wherever you want the app to live** (e.g. the repo
> root, or its own repository) — nothing here depends on its current path.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173  (uses bundled fixtures)
npm run build      # → dist/  (minified, hashed, production bundle)
npm run preview    # serve the built dist/ locally
```

No backend required to run: with `VITE_API_BASE` unset the app serves bundled
fixtures (`src/lib/fixtures.js`) so you can build UI before the API is ready.

## Connecting the (in-progress) backend

```bash
cp .env.example .env
# then set VITE_API_BASE=https://your-api/v1
```

Everything network-related goes through **one file**: `src/lib/api.js`. It reads
`VITE_API_BASE` and either returns fixtures (unset) or does real `fetch()`s
(set). Components never call `fetch` directly. The request/response shapes are
the written contract in `src/lib/api-contract.js` — keep that in sync with the
backend team.

## Layout

```
production-react-app/
  index.html              Vite entry → /src/main.jsx
  vite.config.js
  package.json
  .env.example            Copy to .env to point at the backend
  scripts/
    codemod-to-esm.mjs    Helper to port more prototype components (see MIGRATION.md)
  src/
    main.jsx              Mounts <App/> in an ErrorBoundary; imports global CSS
    App.jsx               Nav rail + hash-routed content area
    styles/
      tokens.css          Design tokens + @font-face (copied from the DS)
      kit.css             Component class library (copied from the prototype)
    components/
      Icon.jsx            lucide-react wrapper (keeps kebab-case names)
      ErrorBoundary.jsx   Boundary + AppCrash / ContentError / SurfaceError
      KPI.jsx             The shared glance card
    pages/
      DashboardPage.jsx   Fully working — the pattern to copy for other pages
    lib/
      api.js              The backend seam (fixtures ↔ live)
      api-contract.js     JSDoc typedefs — the frontend/backend agreement
      fixtures.js         Bundled demo data (offline mode)
      store.js            createStore + useStore (reactive external store)
      router.js           Hash routing + useRoute() / navigate()
```

## What's done vs. what's left

**Done (runnable):** toolchain, global styles + self-hosted fonts, the API seam,
the contract, the store + router as hooks, `Icon`/`KPI`/`ErrorBoundary`, and a
complete `DashboardPage`. The other nav routes render a clear "not migrated yet"
placeholder.

**Left:** port the remaining pages/components from the prototype (use the
codemod + `DashboardPage` as the pattern), wire `VITE_API_BASE` when the backend
lands, then add auth, realtime (WebSocket), tests, and a PWA precache.

See **MIGRATION.md** for the full playbook.
