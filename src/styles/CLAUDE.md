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
- Adding a theme: add a `[data-theme="x"]` block here, then one `{ id, label }`
  entry in `../lib/theme.js`'s `THEME_OPTS` (`VALID` derives from it and every
  picker reads it), and the concrete-theme list in the `index.html` /
  `assistant.html` boot scripts, which cannot import.

## The colour-vision pack (`cvd-*`) is checked, not eyeballed

Twelve of the themes here are built for viewers who cannot rely on hue, and they
carry a **measured guarantee**: every pair of status colours stays a stated
ΔE2000 apart, and every contrast floor holds, *under a simulation of the
deficiency the theme names*. The pack's banner comment in `tokens.css` states
the exact floors.

**Touching a `cvd-*` token means re-running the check** —
`node /home/heisen/tks/scripts/cvd-check/verify.mjs` — which parses these blocks
back out of this file and re-measures them. A palette here is a solved artefact,
not a preference: "that green looks nicer" is how a theme silently stops being
the thing it claims. That directory also holds the solver that produced the
palettes and a contact-sheet renderer; its `README.md` covers adding one.

The rest follows the same rules as any other theme: a `cvd-*` block is the FULL
colour set, and `THEME_OPTS` carries the `cvd:` field that puts it in the
picker's own badged section.

## Two kinds of palette live here, and they answer to different rules

**A theme named after an upstream scheme ships that scheme's values, unretouched.**
Nord, Dracula, Gruvbox, One Dark, Solarized, Catppuccin, Ayu, Monokai, GitHub —
all of them. Several are deliberately low-contrast (Solarized most of all: its
accents are tuned to sit at equal weight against *both* of its backgrounds, and
Nord's `#bf616a` red is 2.5:1 on its own card). Raising them would be raising them
off the thing that makes them recognisable, so **don't "fix" one**: measured
against WCAG floors the eighteen upstream palettes here carry well over a hundred
misses between them, and that is the house position, not an oversight.

**A palette this repo invents is measured.** The colour-vision pack and the
tribute pack are both ours, so both hold: text at 4.5:1 on every surface it lands
on, fills at 3:1, each `-fg` at 4.5:1 over its own `-bg` tint. The one relaxation
is `--fg-4` — placeholder and disabled rank, which the default `dark` theme itself
ships at 2.4:1.

## The tribute pack is quoted, not designed

Eight themes — matrix, win95, winamp, lcars, cyberpunk, dos-blue, c64, pico8 —
take their colours from a screen somebody already knows, and the pack's banner
comment says what that costs. A source palette rarely carries five status
families: CGA has no orange, LCARS has no green, the VGA sixteen were drawn for a
black text mode and sit under 3:1 on a silver face, and most of the VIC-II is
unreadable against its own screen blue. Each block resolves that the same way —
the nearest colour from the SAME source, raised along its own hue where the floor
demands it, with the deviation named in the comment.

**Don't tidy a tribute's ramp with a colour the source never had.** That is the
edit that turns a quotation into just another dark theme, and it is invisible in
review because the result looks better. Contrast was measured on the surfaces each
value actually lands on, including each `-fg` on its own `-bg` tint, so a
retune means re-measuring rather than eyeballing.

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
