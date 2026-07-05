# src/pages/ — pages & routing

One component per route (and per server/host sub-tab). Pages are the **only**
place that composes `lib/` stores + `components/` into a screen. They are all
**lazy-loaded** by `components/AppRouter.jsx` behind a single `<Suspense>`.

## How routing works (the contract)

The URL hash is the source of truth. The pipeline (see `../lib/router.js` for the
full scheme, and `../hooks/useRouteSync.js` for the sync):

```
location.hash  ──parseHash──▶  route {kind, id?, tab?, hostId?, status?, filter?, serverId?, severity?}
route          ──routeToHash──▶ location.hash        (Back/Forward, deep links, refresh all work)
AppRouter: route.kind ──▶ the matching lazy <Page/>
```

- **`route.kind` is the internal vocabulary; the URL word can differ on purpose**
  — `kind:"attention"` ↔ `#/alerts`, `kind:"chat"` ↔ `#/assistant`,
  `kind:"fleet"` ↔ `#/fleet` (legacy `#/diagnostics` still resolves). Keep both
  sides in sync in `router.js` when you add a route.
- **`persona.resolveRoute()` is the routing chokepoint** (`../lib/persona.js`): a
  forbidden route is remapped to the persona's home *before* it enters state or
  mounts. `App.setRoute` runs every route through it. Don't bypass it.
- Pages receive **navigation callbacks** from `AppRouter` (`onOpenServer`,
  `onAction`, `onTabChange`, `onAsk`, …) — they don't call `setRoute`
  themselves. They read **domain data straight from the singleton stores** via
  `useStore(...)`, not from props threaded down the shell.

### Adding a page/route

1. Add the `route.kind` ↔ hash mapping to `../lib/router.js` (both `routeToHash`
   and `parseHash`).
2. `const NewPage = React.lazy(() => import("../pages/NewPage.jsx"))` +
   `{route.kind === "new" && <NewPage .../>}` in `AppRouter.jsx`.
3. If it's gated, wire the capability in `../lib/persona.js` so `resolveRoute`
   protects it.

## The split-page folders — keep the entry thin

Four screens were too big and were broken into folders (root-`CLAUDE.md` refactor
§3). The entry file stays thin (state + layout); the pieces live beside it.
**Don't fold these back into their entry file — grow the folder instead.**

| Entry | Folder | Holds |
|---|---|---|
| `ChatPage.jsx` (512) | `chat/` | thread/message/parts, evidence cards, context meter, host picker, `chatUtils`/`chatConstants`, `usePortalPopover` |
| `DiagnosticsPage.jsx` (290) | `diagnostics/` | `DiagOverview/Resources/Services/Logs`, host/leaf cards, `LeafConfigModal`, `diagHelpers` |
| `PerformanceTab.jsx` | `performance/` | `PerfCards`, `perfHelpers` |
| `ServerSettings.jsx` | `serverSettings/` | `SettingsSections` |
| `DashboardPage.jsx` | `dashboard/` | `DashFleetStrip` |

New rule of thumb: **a page pushing ~400 lines gets its own `pages/<name>/`
folder** rather than another append.

## Server & host detail = tabbed pages

`ServerDetailPage.jsx` and `DiagnosticsPage.jsx` (host detail) render sub-tabs
via `route.tab` (`overview` is the default and is omitted from the URL). Server
tabs with **no backend source yet** (Files, Settings, Performance, Players) keep
their full UI but render an honest "work in progress" state behind a
`…_WIRED = false` flag — **never fabricated data**. Flip the flag + hydrate when
the endpoint lands; don't invent numbers to fill the tab. (Ecosystem-wide
"never fabricate a metric" invariant — see root `CLAUDE.md` and `../lib/adapters.js`.)
