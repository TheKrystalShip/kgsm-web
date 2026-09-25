# scripts/: the smoke and the offline checks

The `check:*` scripts (`check-*.mjs`, `validate-*.mjs`) load the modules they test outside a browser,
which is why the modules they reach may not import JSX or reach up into components.
`check:session` and `check:door` run offline, and have to: the smoke's backend is auth-disabled, which
names no provider and exercises no session or account surface at all.

## `smoke-live.mjs` (`npm run smoke`)

It boots the real Vite module graph in jsdom against a RUNNING kgsm-api and asserts real backend data
renders without crashing. Five things about it are load-bearing:

- **It never mutates the host.** Every assertion is either a READ against the live backend or a WRITE
  INTERCEPTED at the fetch seam (assert the request the SPA builds, answer it synthetically). kgsm's
  event transport is a single host-wide journal (`/var/lib/kgsm/events/*.ndjson`) indexed by ONE
  kgsm-monitor, and **every** kgsm-api on the box — including the operator's `:8097` — merges its
  engine history from that one monitor. There is no such thing as a write scoped to the backend under
  test; anything reaching the engine lands in the operator's real audit log permanently and rides the
  live consumer out to their notification integrations. So: no `kgsm.sh events emit`, no
  engine-touching PUT/DELETE, and nothing requiring this process to sit next to the engine. A run
  leaves nothing behind because it writes nothing — not because it cleans up afterwards. Coverage this
  gives up (the journal→api→stream relay, the note's verbatim round trip through a SOURCED config)
  lives in kgsm-api's `AuditJournalRelayTests` / `ServerNoteRoundTripTests`, which own a disposable
  fixture.
- **It needs an AUTH-DISABLED backend.** It sends no bearer, so a real auth-enabled host 401s every
  gated read. The backend it expects is `/home/heisen/tks/scripts/visual-harness/dev-api.sh` (`:8096`)
  — the harness lives at the workspace root, outside every repo, so it is named absolutely and runs
  from whichever repo is being worked in. The prod unit on `:8097` has auth ON, and the smoke refuses
  it up front with a message rather than degrading into a wall of failures. Run it as
  `KGSM_API=http://127.0.0.1:8096 npm run smoke`.
- **The backend URL is written to `.env.development.local`, not `.env.local`.** The vite server boots
  in "development" mode, and Vite ranks a mode-specific env file above a plain one — the committed
  `.env.development` (seeding `:8090`) beats `.env.local`, so writing there silently does nothing and
  the whole suite runs against the wrong port.
- **Monaco is stubbed with a `textarea`.** It is built for a real browser and throws from inside its
  own mount under jsdom, which surfaces as the *page* hitting its error boundary — every surface
  hosting it (blueprint editor, create page, file editor, chat draft) would be untestable. Its real
  behaviour is proven in Chromium by the visual harness; the smoke asserts the wiring around it.
- **Instances are DERIVED from the live roster, never named.** `PROBE`/`OTHER` come from
  `GET /servers`, because a hardcoded instance name rots the moment someone uninstalls it and then
  fails in a way that reads like an SPA regression.

The smoke also checks rendered components for explanatory prose and fails on it
(`src/CLAUDE.md`, "A component shows its data").
