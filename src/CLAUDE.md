# src/ — source map & module boundaries

This directory is the whole SPA. This file owns the *structure* — what lives where and the module
boundaries to keep — plus the rules that hold across every area: the shell, a server's two names,
what a component may say, and the notification surfaces. Each area's own rules are in its directory's
`CLAUDE.md`.

## Three surfaces, one source tree

This repo builds **three**. `index.html` → the Control Panel; `assistant.html` → the standalone
assistant served by the kgsm-assistant leaf; `auth-sign-in.html`, `auth-wait.html` and
`auth-account.html` → the auth anchor's own pages (`src/authui/`), built under `base: "/ui/"` and
shipped as `kgsm-web-auth`. Separate Vite configs, separate `dist*/`s, separate deploy scripts — so
each host serves only its own bundle — over one source tree.

**The anchor's pages hold no credential.** They are served by the anchor on its own origin, every
call they make is same-origin and authenticated by the anchor's cookie, and nothing they hold can call
a member — so they may reach none of the panel's session or data layer (`npm run check:auth`, which
also holds each built document to the anchor's content security policy: no inline script, no inline
style). They reuse the panel's sign-in card and settings furniture, which is why
`pages/auth/SignInCard.jsx`, `components/oauth-icons.jsx` and `lib/credentialRules.js` import nothing
from that layer. Each page's document carries its own **floor** — a sign-in form that posts without
script, a wait that refreshes only under `<noscript>` — and the application removes it on mount.

`src/chat/` is the conversation, shared by both. The chat itself — the conversation engine over the
assistant wire contract, the thread, the composer, review mode — is the design system's `Chat`;
`chat/ChatPage.jsx` binds it to a kgsm assistant: the client and its session, the evidence cards a
kgsm tool's result becomes (`EvidenceCards.jsx`), the blueprint review card
(`ChatBlueprintDraft.jsx`), the lifecycle verbs and their verdicts (`chatUtils.jsx`,
`chatConstants.js`), the host picker, and the server-aware opening suggestions. A divergence between
the dock and the standalone page would be a **bug, not a variant**, so there is nowhere for one to
drift from the other: everything that differs between the surfaces is a PROP, with defaults
describing the smaller one. `src/pages/ChatPage.jsx` is the panel's thin wrapper that injects its
cluster wiring (host picker, server roster, per-host roles, review mode, node attribution);
`src/assistant/` is the standalone shell and passes almost nothing.

**`src/assistant/` is a two-screen app**, not just a chat mount: `App.jsx` (auth gate + shell),
`SettingsPage.jsx` (Appearance / Notifications, built from the panel's own settings furniture) and
`route.js` — its own hash bridge, because the panel's `lib/router.js` is a cluster vocabulary
resolved through a per-node policy and importing it would drag both in. Routes are **hash**-shaped
(`#/settings`): the leaf serves this bundle with no SPA fallback, so a path-shaped `/settings` would
404 on a refresh. Its chat gets the settings entry points through one prop (`onOpenSettings`); the
panel passes none, since its shell already leads there.

Static assets divide the same way: `public/` is the shared floor (the brand mark; the fonts come in
with the design system's stylesheet and are emitted beside each bundle's assets) and each
surface's own half — the manifest, service worker and icons that make it an **installable app in
its own right** — is laid over the top from `public-panel/` / `public-assistant/` by
`scripts/public-overlay.js`. Neither app's artwork ever ships in the other's bundle.

**The standalone surface must not reach the Control Panel's data layer** — no `apiClient`, no
store barrel, no `config.js`/`CONNECTIONS`, no `persona`, no router. It talks to one leaf on its own
origin and has no notion of a node. `npm run check:assistant` walks the import graph and fails on
those roots, because tree-shaking will NOT save you: a static import of a module with side effects
is retained whether or not its exports are read. When a shared component needs something from that
layer, **cut the edge** — split the module or take the value as a prop — rather than widening the
list. `components/HostConnection.jsx` and `lib/oidc.js` both exist because of exactly this: the
standalone assistant holds its session through the same client of the cluster's sign-in provider as
the panel, and that client imports nothing but the library.

## The design system is a package

The components, stores and stylesheets every Krystal site is drawn from — the application frame
(`AppShell`, the sidebar and its rail and drawer, the dock and its launcher, the cinematic hero,
the edge-swipe gesture, the footer), the assistant chat and its voice notes, the briefing card, rail,
toolbar, paginator, select, modal, sub-tabs, settings furniture, theme picker, toasts and their tray,
icons, avatar, the assistant's mark, `createStore`/`useStore`, the theme preference, `copyText`, the
Web Push browser mechanics, and every token — are `@thekrystalship/krystal-ui` (`krystal-ui/` in the
workspace), a versioned package from GitHub Packages pinned in `package.json`. A change to one of
them is made there, published, and reaches this repo by bumping the pin; nothing here edits a copy.

Two rules about importing it. **Views import the barrel** (`"@thekrystalship/krystal-ui"`). **`lib/`,
`hooks/` and the standalone surface's plain modules import its import-free subpaths**
(`"@thekrystalship/krystal-ui/lib/store"`, `…/lib/toasts`, `…/lib/pushBrowser`, `…/lib/time`): the
`check:*` scripts load the data layer in Node, outside any browser, and the barrel brings React DOM
with it, which cannot load there. Both spellings reach the same module file, so a store has one
instance whichever way it was imported.

## The layering (top → bottom, one direction)

```
main.jsx            boot: styles → theme → OAuth-fragment capture → mount <App/> in <ErrorBoundary>
  └ App.jsx         the SHELL — auth gate, layout chrome, dock, modals, cross-cutting state
      └ components/AppRouter.jsx   ROUTING ONLY — route.kind → lazy page + callbacks
          └ pages/  one file (or folder) per route/tab; pages read stores DIRECTLY
              └ lib/         the data layer + policy (apiClient, adapters, stores, persona, router)
                  └ components/  presentational + shared UI (KPI, cards…) over the design system's primitives
```

Dependencies point **downward only**. A page imports from `lib/` and
`components/`; `lib/` never imports a page; `components/` are leaf UI. Don't add
an upward edge (a store importing a page, a component reaching into a page).

## Three boundaries — keep them

1. **`App.jsx` is the chooser and the shell, not a page host.** It picks between
   `AuthGate` (no identity, or one holding nothing) and `AppInner`, and owns the layout frame
   (sidebar / `<main>` / assistant dock / FAB), the global modals (install,
   first-run), and cross-cutting handlers (`handleAction`,
   `confirmInstall`, logout). It holds **no page bodies** — don't inline one
   into `App.jsx`.

2. **`AppRouter.jsx` is routing only.** It maps `route.kind` → the right lazy
   page and threads callbacks. It reads assistant/dock state from
   `useAssistantDock()` (context) and lets pages read domain data from the
   singleton stores themselves — it does **not** fetch data or hold page state.
   Every page is `React.lazy(...)` behind one `<Suspense>` (route-level code
   splitting). A new page = add a `React.lazy` line + one
   `{route.kind === "x" && <Page .../>}` branch. It is not a data-threading hub.

3. **Big screens live in focused folders and modules — don't monolith.** The
   shell's satellite pieces are their own modules
   (`components/AssistantDockContext.jsx`, `components/Breadcrumb.jsx`,
   `components/BootLanding.jsx`, `hooks/useRouteSync.js`, `lib/authStorage.js`);
   the chat lives in `chat/` (shared by both surfaces; see above);
   `pages/DiagnosticsPage.jsx` and `pages/PerformanceTab.jsx` are thin entries
   over `pages/diagnostics/` and `pages/performance/`; the stores are domain
   modules under `lib/stores/` (see `lib/stores/CLAUDE.md`).

   The rule: **a page over ~400 lines gets its own `pages/<name>/`
   folder** with the entry file thin and the pieces beside it — not another
   append to a growing file. Each directory has its own `CLAUDE.md` with the
   local conventions.

## The shell (`App.jsx`)

Hash routing (`lib/router.js`) — the URL is the source of truth (Back/Forward, deep links, refresh all
work). **Connect, disconnect, login, logout and session loss do a full `window.location.reload()`
rather than swapping components in place** — they change identity and auth, and several hooks live
below the `!user` gate, so flipping `user` in place would trip React's Rules of Hooks. Keep that
pattern. A peer appended by cluster discovery needs no reload: `CONNECTIONS` grows in place
(`lib/CLAUDE.md`, `config.js`).

**First paint ends on the shell or on `BootFailed`, never on the cover.** The boot cover
(`BootLanding`) is held only while a question is being answered: an answer the shell cannot be drawn
from — every node refusing `GET /hosts`, a roster naming no node this page can address — ends the boot
on `pages/auth/BootFailed.jsx`, which always offers Try again and Sign out, and a deadline
(`BOOT_DEADLINE_MS`) catches a question that never returns. `main.jsx` drops a stored identity with no
session record behind it before mount, so the shell never mounts for a session nothing will
authorize; a session the provider refuses while the boot is still settling goes to the gate at once,
which leaves for the provider as it does for any cold load holding nothing; and every request to the
provider is bounded (`lib/oidc.js`). A new gate on the cover must name the work it waits on and the
answer that ends it; one that waits for a fact to appear is a cover that can hang.
`visual-harness/boot-terminates.mjs` drives each way a boot can fail.

Every server sub-tab (Files, Settings, Performance, Players) is backed by a real endpoint; a value the
backend can't supply renders as "—" or its own honest not-measurable state, never as a fabricated
number.

## A server has TWO names, and they are not interchangeable

`id` is the engine's — immutable, unique, path-safe — and is the key for every route, keyed store, SSE
join, fetch path, widget param and React key. `name` is the mutable display label, free text, **not
unique**, and never blank (an unlabelled instance reads as its id, which `adaptServer` guarantees with
`be.name ?? be.id`). Render `name` wherever a person reads which server this is; pass `id` wherever
something has to find it again. Where two servers could collide or identity is the point — the hero,
the Identity card, the palette's rows — show BOTH, the id as secondary monospace. A rename arrives as
an ordinary `server.patch` carrying a new `name`, so nothing needs invalidating: the row is patched in
place and every surface re-renders. **Searching reads both**, because a person who knows an instance
as `factorio-42` from a shell must still find it after somebody has labelled it "Sunday Server".

## A component shows its data; it does not explain the system

**Never caption a reusable component with prose about how the system behind it works.** No footnote
saying where a node's queue is held, what a restart empties, that a run outlives the tab, or where
history lives instead. No empty-state subtitle restating the empty-state title in a sentence. No sheet
paragraph describing how work is paced. The site is not a tutorial on its own internals, and a surface
that has to caption itself to be understood has not been designed — the fix is the layout, the label,
or the data shown, never a paragraph underneath.

What a component *may* say in words is what it measured or was told: a count, a name, a verdict it
holds evidence for, a node that could not be read. The distinction is whether the sentence would
change if the data changed. *"1 node couldn't be read (DevTest)"* is data. *"A run keeps going
whether or not this tab is open"* is documentation, and belongs in `CLAUDE.md` or the CHANGELOG.

Assert the **absence**, not the presence. A no-prose rule is invisible to lint and to a build, and the
next edit that adds a helpful sentence will pass every gate. `scripts/smoke-live.mjs` and the browser
harnesses check the rendered component for explanatory phrasing and fail on it. The dashboard **pin**
is not prose and survives any such removal (`components/CLAUDE.md`, the `pin` slot).

## Telling a person something: toasts, and two push surfaces

`<Toasts>` + the sidebar tray (the design system's toast store) report the outcome of something the **user just did**,
in an open browser (`components/CLAUDE.md`). **Web Push** reports what happened to the **fleet** while
nothing was open, per device, opt-in, and gated by both the host's rule and the person's own
preference. The ecosystem-wide map, including how both relate to kgsm-bot's Discord announcements, is
the workspace's `notifying-a-person` skill.

**There are TWO push surfaces, on two origins, and they are not interchangeable.** The panel's
(`lib/push.js`, `pages/SettingsNotifications.jsx`, `public-panel/sw.js`) is kgsm-api's. The
standalone assistant's (`assistant/push.js`, `assistant/SettingsPage.jsx`,
`public-assistant/assistant-sw.js`) announces one thing — an action the leaf staged and is waiting on
you to approve — and comes from the **leaf**, with the leaf's own VAPID key. A subscription carries
exactly one application server key and belongs to one origin, so these can never share one. The
browser mechanics they share are the design system's `lib/pushBrowser`, which takes its transport as
a parameter and **imports nothing** — a shared module reaching `apiClient` would fail
`npm run check:assistant`.

## Directory guide

| Dir | What it is | Local doc |
|---|---|---|
| `pages/` | Route + tab components; `pages/<name>/` folders for the split ones | `pages/CLAUDE.md` |
| `lib/` | Data layer + policy: apiClient, adapters, stores, persona, router, config | `lib/CLAUDE.md` |
| `lib/stores/` | Domain-split reactive stores; `lib/stores.js` re-exports them | `lib/stores/CLAUDE.md` |
| `components/` | The panel's shared UI over the design system's primitives | `components/CLAUDE.md` |
| `hooks/` | `useRouteSync` (URL↔route sync), `useAccountHolder` (whether an anchor holds this cluster's accounts, and where this browser can reach them — read live from the cluster's capability assignment, so the account screens move when an anchor joins or leaves) | — |
| `styles/` | Plain CSS: `kit.css` (barrel over the design system's sheets and `kit/`) → `consumer.css` | `styles/CLAUDE.md` |

## Guardrails (the ESLint gate)

`npm run lint`: `no-undef`, `react-hooks/rules-of-hooks` and the **egress rules**
(`no-restricted-syntax` — no `Authorization` header and no `tokenOf` outside the modules that own a
credential) are **errors**, keep them at zero. The egress pair is what makes an authenticated call
that cannot renew itself unwritable: reach a KGSM surface through `lib/authorizedFetch.js`, handing
it a credential rather than a token. `react-hooks/exhaustive-deps` + `no-unused-vars` are warnings.
Several intentional dep-array exceptions carry an inline
`// eslint-disable-next-line react-hooks/exhaustive-deps -- <reason>` — keep the
reason when you touch them. After any change here: `npm run lint` (0 errors),
`npm run build`, `npm run smoke` against a live api.
