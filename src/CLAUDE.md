# src/ — source map & the module boundaries the refactor established

This directory is the whole SPA. The **root `../CLAUDE.md`** owns the
architecture narrative (connection model, data layer, auth/RBAC, styling,
where-truth-lives) — read it first. **This file owns the *structure*:** what
lives where, and the boundaries the 2026-07 architecture-cleanup refactor put in
place so future work doesn't collapse them back.

## The layering (top → bottom, one direction)

```
main.jsx            boot: styles → theme → OAuth-fragment capture → mount <App/> in <ErrorBoundary>
  └ App.jsx         the SHELL — auth gate, layout chrome, dock, modals, cross-cutting state
      └ components/AppRouter.jsx   ROUTING ONLY — route.kind → lazy page + callbacks
          └ pages/  one file (or folder) per route/tab; pages read stores DIRECTLY
              └ lib/         the data layer + policy (apiClient, adapters, stores, persona, router)
                  └ components/  presentational + shared UI primitives (Modal, KPI, cards…)
```

Dependencies point **downward only**. A page imports from `lib/` and
`components/`; `lib/` never imports a page; `components/` are leaf UI. Don't add
an upward edge (a store importing a page, a component reaching into a page).

## The three boundaries the refactor drew — keep them

1. **`App.jsx` is the shell, not a page host.** It owns the auth gate
   (`!CONNECTIONS.length` → connect screen, `!user` → login), the layout frame
   (sidebar / `<main>` / assistant dock / FAB), the global modals (reauth,
   install, first-run), and cross-cutting handlers (`handleAction`,
   `confirmInstall`, logout). It does **not** contain page bodies — those were
   extracted. Resist re-inlining a page into `App.jsx`.

2. **`AppRouter.jsx` is routing only.** It maps `route.kind` → the right lazy
   page and threads callbacks. It reads assistant/dock state from
   `useAssistantDock()` (context) and lets pages read domain data from the
   singleton stores themselves — it does **not** fetch data or hold page state.
   Every page is `React.lazy(...)` behind one `<Suspense>` (route-level code
   splitting — see commit `e2379bd`). A new page = add a `React.lazy` line + one
   `{route.kind === "x" && <Page .../>}` branch. Don't turn it back into a
   data-threading hub.

3. **Big files were split into focused folders — don't re-monolith.** The
   refactor broke the four grab-bag files apart:
   - `App.jsx` sections → `components/AssistantDockContext.jsx`,
     `components/Breadcrumb.jsx`, `components/BootLanding.jsx`,
     `components/MobileNavToggle.jsx`, `hooks/useRouteSync.js`,
     `hooks/useMobileSwipe.js`, `lib/authStorage.js`.
   - `pages/ChatPage.jsx` (1944→512) → `pages/chat/`
   - `pages/DiagnosticsPage.jsx` (1475→290) → `pages/diagnostics/`
   - `pages/PerformanceTab.jsx` → `pages/performance/`
   - `lib/stores.js` (monolith) → `lib/stores/` (see `lib/stores/CLAUDE.md`)

   The rule going forward: **a page over ~400 lines gets its own `pages/<name>/`
   folder** with the entry file thin and the pieces beside it — not another
   append to a growing file. Each directory has its own `CLAUDE.md` with the
   local conventions.

## Directory guide

| Dir | What it is | Local doc |
|---|---|---|
| `pages/` | Route + tab components; `pages/<name>/` folders for the split ones | `pages/CLAUDE.md` |
| `lib/` | Data layer + policy: apiClient, adapters, stores, persona, router, config | `lib/CLAUDE.md` |
| `lib/stores/` | Domain-split reactive stores (was the `stores.js` monolith) | `lib/stores/CLAUDE.md` |
| `components/` | Shared/presentational UI + the `<Modal>` primitive | `components/CLAUDE.md` |
| `hooks/` | `useRouteSync` (URL↔route sync), `useMobileSwipe` (drawer/dock gestures) | — |
| `styles/` | Plain CSS: `tokens.css` → `kit.css` (barrel over `kit/`) → `consumer.css` | `styles/CLAUDE.md` |

## Guardrails (the ESLint gate — see root `../CLAUDE.md`)

`npm run lint`: `no-undef` and `react-hooks/rules-of-hooks` are **errors**, keep
them at zero. `react-hooks/exhaustive-deps` + `no-unused-vars` are warnings.
Several intentional dep-array exceptions carry an inline
`// eslint-disable-next-line react-hooks/exhaustive-deps -- <reason>` — keep the
reason when you touch them. After any change here: `npm run lint` (0 errors),
`npm run build`, `npm run smoke` against a live api.
