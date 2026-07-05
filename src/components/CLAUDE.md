# src/components/ — shared UI & the pieces extracted from the shell

Reusable, mostly-presentational components. Two kinds live here: **UI primitives**
shared across pages, and **shell pieces** the refactor pulled out of `App.jsx`.
A component here should be view logic — it may read a store via `useStore`, but
it doesn't own routing or fetch from the API directly.

## The `<Modal>` primitive — use it, don't hand-roll

`Modal.jsx` is the shared dialog primitive (commit `aa5d1f5` — 8 ad-hoc modals
were migrated onto it). It owns the portal-to-body, scrim, Esc-to-close, and
focus/scroll handling. **New dialogs compose `<Modal>`; don't re-implement a
backdrop + portal by hand** (that's exactly the duplication the refactor removed).
`Select.jsx` is the shared portal-popover dropdown — reach for it over a raw
`<select>` when you need the styled menu.

## Shell pieces extracted from App.jsx (refactor §3) — leave them out here

These were `App.jsx` sections; keeping them as their own modules is what keeps
the shell thin. Don't re-inline them.

- `AssistantDockContext.jsx` — the assistant dock's state, derived layout, and
  interaction fns. `AssistantDockProvider` wraps the app; consumers read via
  `useAssistantDock()` instead of threading dock props through the shell.
- `AppRouter.jsx` — routing-only switch (see `../pages/CLAUDE.md`). It lives here
  but is the routing layer, not a presentational component.
- `Breadcrumb.jsx`, `BootLanding.jsx`, `MobileNavToggle.jsx`, `Sidebar.jsx`,
  `Footer.jsx`, `ErrorBoundary.jsx` (+ `ColdStartDown`/`ConnectivityBanner`/
  `ContentError`/`AppCrash`) — the layout chrome.

## The rest, by rough category

- **Cards / lists:** `ServerCard`, `GameCard`, `AlertCard`, `BriefCard`,
  `CardTable`, `HostCardBody`, `RecentActivity`, `NeedsAttention`,
  `ContextualAlerts`, `Skeletons`, `Pagination`.
- **Server surfaces:** `ServerHero`, `ServerActions`, `ServerConnect`,
  `ServerNotice`, `ConsolePanel`, `ConsoleView`, `InstallModal`, `SubTabs`,
  `Toolbar`.
- **Metrics / charts:** `KPI`, `StatTiles`, `TimeSeriesChart`, `DashLayout`.
- **Editor / logs:** `CodeEditor` (Monaco), `LogConsole`, `VoiceNote`.
- **Primitives / helpers:** `Modal`, `Select`, `Icon`, `settings-primitives.jsx`,
  `host-helpers.jsx`.

## Conventions

- **Never hardcode a color** — every color comes from a CSS custom property
  (`var(--…)`); add/extend a token in `../styles/tokens.css` instead. See
  `../styles/CLAUDE.md`.
- Monaco can't read CSS vars → `CodeEditor.jsx` samples resolved tokens at runtime
  and re-themes on theme flip. Follow that pattern for any canvas/3rd-party
  surface that can't inherit the cascade.
- Presentational only: take data + callbacks as props (or read a store); don't
  call `setRoute` or `api.*` from a leaf component — hand that to the page/shell.
