# src/styles/ — CSS, tokens, and the kit barrel

Plain CSS — **no Tailwind, no CSS-modules.** Three files load in order (from
`../main.jsx`): `tokens.css` → `kit.css` → `consumer.css`. Everything is driven
by ~40 CSS custom properties. The root `../CLAUDE.md` ("Styling & themes") has
the full theming narrative; this is the local map + the one rule that matters.

## The one rule

**A component must never hardcode a color — add or extend a token.** Colors live
in theme scopes in `tokens.css`; a rule references them via `var(--…)`. This is
what makes theme switching (and adding a theme) a data change, not a code hunt.

## `tokens.css` — the design-token source of truth

- Plain `:root` holds **structural** tokens (type, spacing, radius, shadow,
  motion, layout) — theme-invariant.
- **Color** tokens live in theme scopes: `:root, [data-theme="dark"]` (default —
  applies with no attribute) and `[data-theme="light"]`. Plus overlay tokens
  (`--veil-1/2/3`, `--scrim-base`, `--scrollbar-*`). **A theme = the FULL color
  set re-valued.**
- Adding a theme: add a `[data-theme="x"]` block here, then list `x` in
  `../lib/theme.js`'s `VALID`, the `index.html` boot script, and `THEME_OPTS` in
  `../pages/SettingsPage.jsx`.

## `kit.css` is a BARREL — do not edit it, edit the partial

The old ~6,300-line monolith was split into focused partials under `kit/`.
`kit.css` **only `@import`s them** — adding rules to `kit.css` itself defeats the
split. Add a rule to the partial that owns the domain:

`base` · `shell` · `server` · `catalog` · `modal` · `onboarding` · `dashboard`
· `observability` · `controls` · `responsive` · `chat` · `settings` · `dock`
· `hosts` · `states` · `extras`

- **Import order is load-bearing** (later wins on equal specificity) — keep the
  `@import` sequence. A new domain gets a **new partial appended to the barrel**,
  never a re-grown monolith.
- `@import` must precede other rules; the imports-only barrel satisfies that.

`consumer.css` — a few consumer surfaces (connect / MOTD / login persona).

## Two barrels over ONE set of partials

`kit.css` is the Control Panel's list; `assistant.css` is the standalone assistant's, and lists only
the partials a chat uses (it has none of the pages the others style). **The partial files are shared
and unedited** — only the lists differ — so the two surfaces are identical by construction and a
change to `chat.css` or a token lands in both. Never copy a rule between them; a copy is the drift
this arrangement exists to prevent.

A subset is the one thing that can silently go wrong: a widget whose rules live in a partial that was
left out renders unstyled and nothing fails. `npm run check:assistant` checks every class the
standalone surface can render against the CSS it ships, so add the missing **partial** when it
complains.

## Theme landmines (see root `../CLAUDE.md` for detail)

- **No-flash:** an inline boot script in `index.html` sets `data-theme` before the
  stylesheet applies — it mirrors `../lib/theme.js`; keep the two in sync.
- **Always-dark media surfaces** (cinematic hero over key-art) pin dark tokens
  **locally** (see `.hero--cinematic` in `kit/server.css`) rather than
  per-theme special-casing.
- jsdom smoke does **not** lay out CSS — test theme/layout with the visual harness
  (`/home/heisen/tks/scripts/visual-harness/`, `--theme dark|light`).
