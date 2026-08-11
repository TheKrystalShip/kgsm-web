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

## `<Rail>` — the horizontal shelf

`Rail.jsx` renders a brief card whose body is a scroll-snapped row of `items`: the
dashboard's Servers and Catalog cards use it to reach their whole collection. It is
a **real scroll container, not a transform carousel** — that is what makes a touch
swipe native scrolling (no swipe-vs-tap ambiguity against cards that are themselves
click targets), keeps trackpad/shift-wheel working, and scrolls a tab-focused
off-screen card into view. There is no slide index, so nothing can desync from what
is on screen; the arrows only call `scrollBy`.

Card width comes from `--rail-per-view` in **container query units** (`kit/rail.css`),
so the rail follows the sidebar and the assistant dock, which resize it without
resizing the viewport. It is deliberately fractional — the cut-off next card is the
primary "there is more" affordance, with an edge fade behind it and the arrows third.

Two things a caller has to respect:

- **The track carries `data-hswipe`**, which is how `hooks/useMobileSwipe.js` knows
  to leave the gesture alone. That hook arms the nav drawer anywhere within 28px of
  the viewport edge, and a rail's leftmost card sits inside that zone — drop the
  attribute and a swipe meant for the rail also opens the drawer.
- **Pass `disabled` while the dashboard is in Customize mode.** Sideways scrolling
  otherwise fights `DashLayout`'s band drag.

## `<Toasts>` / `<NotificationsPanel>` — outcome reporting

`lib/toasts.js` holds one store; `Toasts.jsx` renders the live cards (portalled to
body, mounted once per surface) and `NotificationsPanel.jsx` renders the history
from the sidebar's foot.

**The rule: a toast reports the outcome of something the user DID — never something
that merely happened.** Fleet events already have the Alerts feed, the tiles and
Recent activity; routing those here would bury the panel during a mass restart.

It exists for the **shell-level** handlers only. Every write path that owns a
component already renders its error beside the control that failed
(`ConsolePanel`, `ServerNotice`, `PlayersTab`, `ServerSettings`) and that is the
better place for it — `App.jsx`'s lifecycle and install handlers own no control,
which is why they are the ones that route through `toast.fromError`. Don't convert
a working inline error into a toast.

The **history is client-side** (`localStorage krystal:notifications`, newest 50,
7-day cap) and is **not** a duplicate of the audit log. kgsm-api writes its audit
row from the *engine echo*, so every command it refuses up front — unknown verb,
unknown server, an inadmissible no-op, a command already in flight — is answered
before the engine is touched and **never produces an audit row**. Those refusals
exist nowhere else. The audit log stays the authority for what happened to the
fleet; this records what was asked for and how it went, which is why the panel
links to the audit log rather than trying to be it.

⚠ Keep **Notifications** distinct from **Alerts**: Alerts are AlertEngine
conditions about the fleet, server-side and the same for everyone; Notifications
are yours and this browser's. The foot placement and the `bell` vs `triangle-alert`
icons are what hold them apart.

## The rest, by rough category

- **Cards / lists:** `ServerCard`, `LeafCard`, `GameCard`, `AlertCard`, `BriefCard`,
  `CardTable`, `HostCardBody`, `RecentActivity`, `NeedsAttention`,
  `ContextualAlerts`, `Skeletons`, `Pagination`, `Rail`.
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
