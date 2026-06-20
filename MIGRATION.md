# Migration playbook — prototype → production

This app is the scaffold. Here's how to finish the move from the
`ui_kits/control-panel/` prototype, in dependency order. The toolchain, styles,
API seam, store, router, and a working `DashboardPage` are already in place — so
most of what's left is **porting components** and **wiring the backend**.

---

## 1. Port the remaining components (the bulk of the work)

The prototype's ~43 component files share one global scope: each ends with
`window.Foo = Foo` (or `Object.assign(window, {…})`) and reads its dependencies
as globals. Production needs ES modules: `import` what you use, `export` what
you define.

### Use the codemod for the mechanical 80%

```bash
# 1. copy the prototype source somewhere local
cp -R ../ui_kits/control-panel/src ./_legacy

# 2. run the codemod
node scripts/codemod-to-esm.mjs ./_legacy ./src/_converted

# 3. review every diff, move files into src/components or src/pages, delete _legacy
```

It adds `import React`, generates `import { … }` lines from the project's
symbol map, converts the `window.*` exports into one `export { … }`, and strips
`window.` prefixes. **It is not a compiler** — read each diff and fix:

- **Named hooks** — `React.useState` is left as-is (works, since React is
  imported). Convert to `import { useState }` if you prefer.
- **CSS / asset imports** — add by hand (e.g. a component that needs a sprite).
- **Circular imports** — if A imports B and B imports A, lift the shared bit
  into `src/lib/`.
- **`window.*` that isn't a project symbol** — `window.location`,
  `window.matchMedia`, etc. stay; only project symbols get rewritten.

### Then, for each file by hand

- Components that read data off `window.someStore` / `window.api` should import
  the real `store`/`api` modules instead.
- Swap the global Lucide usage for the `Icon` wrapper here (already done) — no
  call-site changes needed since it keeps kebab-case names.
- Follow `src/pages/DashboardPage.jsx` as the canonical pattern: load through
  `api`, handle `loading`/`error`, render shared components.

### Suggested order (leaves matter least → most depended-on)

1. Presentational: `BriefCard`, `CardTable`, `Pagination`, `Toolbar`,
   `Skeletons`, `StatTiles`, `LogConsole`, `ConsolePanel`, `TimeSeriesChart`.
2. Stores: port `stores.js`, `apiClient.js`, `sessionStore.js`,
   `capabilities.js`, `alertsApi.js` into `src/lib/` as ES modules that build on
   the `store.js` / `api.js` already here.
3. Pages: `ServersPage`, `LibraryPage`, `GamePage`, server sub-tabs
   (`PlayersTab`, `PerformanceTab`, `FileBrowser`, `BackupsList`,
   `ServerSettings`), `AlertsPage`, `AuditLogPage`, `DiagnosticsPage`,
   `DiscordPage`, `ChatPage`, `SettingsPage`.
4. Wire each into `App.jsx`'s `renderRoute()` — replace its `Placeholder`.

---

## 2. Wire the backend (in progress)

- Set `VITE_API_BASE` in `.env`.
- Fill in real endpoints in `src/lib/api.js` — the method bodies already branch
  on live vs. fixtures; just confirm paths/shapes against `api-contract.js`.
- Keep `api-contract.js` synced with the backend's OpenAPI/JSON-schema as the
  single source of truth for shapes.

## 3. Auth

The prototype's login / Discord OAuth / per-host re-auth are simulated. Build
the real flow: OAuth redirect, session or token storage, an auth guard around
the app, and `401/403` handling in `api.js` (the `ApiError` class is already
there to branch on `.status`).

## 4. Realtime

Add a WebSocket client (`VITE_WS_BASE`) that pushes updates into the stores so
lists stay live — replacing the prototype's fake heartbeat/metrics timers.

## 5. Production hardening

- **TypeScript** (optional): rename `.jsx`→`.tsx`, `api-contract.js`→`.ts` with
  `export interface`, add `tsconfig.json` + `typescript` and
  `@types/react`/`@types/react-dom`. The contract is already JSDoc-typed, so the
  conversion is mostly mechanical.
- **Testing**: Vitest + React Testing Library.
- **PWA**: add `vite-plugin-pwa` for a real precache of the built bundle
  (replaces the prototype's hand-rolled runtime-cache service worker).
- **A11y + CSP + error monitoring** before shipping.

## 6. Deploy

It's a static SPA → Netlify / Vercel / Cloudflare Pages. `npm run build`, serve
`dist/`. Add a rewrite so deep links fall back to `index.html` (hash routing
already handles this, but a fallback is good hygiene if you later move to the
History API).
