# Active Sessions & Revocation — kgsm-web milestone plan

**Scope:** kgsm-web only. The kgsm-api session backend is live (`kgsm-api/docs/session-management-plan.md`).
This plan adds the Settings-page UI to let a user view and manage their sessions, and an admin
revoke other users' sessions.

> **Cold-resume contract.** A fresh session reads §0 (where we are) → §1 (the backend contract we
> wire against) → §2 (the frontend map) → §3 (the slices) and continues from the first unchecked
> ledger row. Update §0 as each slice lands. Docs/comments here follow the ecosystem rule
> (`tks/CLAUDE.md`): present-tense canon, no change-history narration.

---

## 0 · Progress ledger (update as you go)

| # | Stage | Status | Notes |
|---|---|---|---|
| 0 | Scope the frontend change (map seams, patterns, gotchas) | ☑ **DONE** | Map is §2 below (an Explore agent produced it 2026-07-09). |
| 1 | API client seam: root-routed funneled session calls + `/me` adapter | ☑ **DONE** (uncommitted) | `apiClient.js`: `rootGet`/`rootPost` (funneled, `apiOriginOf` base) + `api.sessions(id)` = `.list(userId?)`/`.revoke({sid?,all?})`/`.revokeSid(sid)`/`.revokeUser(userId)`, each `withRetry` 401-heal. `adapters.js`: `adaptSessions` (hardened rows) + `adaptMe.recentLogins` passthrough. lint 0-err, build clean. |
| 2 | Self-service: list active sessions + revoke-one + revoke-all + confirm dialog + proactive self-logout | ☑ **DONE** (uncommitted) | New `src/pages/SettingsSessions.jsx` (list ⋈ inline `ConfirmRevokeDialog` reusing `.host-remove`/`.host-btn`; proactive `onLogout()` when the revoked set includes `current` or is `all`); wired into `SettingsPage.jsx` between Profile and Danger zone; CSS `.settings-session__device`/`__current`. lint 0-err, build clean. |
| 3 | Recent-login history (read-only) from `/me.recentLogins` | ☑ **DONE** (uncommitted) | Second "Recent logins" `SettingsSection` in `SettingsSessions.jsx` off the same `/me` fetch; honest empty state. |
| 4 | Admin cross-user revoke (revoke a sid / revoke-all a userId), admin-tier-gated | ☑ **DONE** (uncommitted) | Admin-only "Manage user sessions" section in `SettingsSessions.jsx` (gate `sessionStore.tierOf(hostId)==="admin"`, else renders nothing): userId lookup → `.list(userId)`, per-row `.revokeSid`, section `.revokeUser`; `ConfirmRevokeDialog` extended with `admin-one`/`admin-all` modes naming the target; NEVER calls `onLogout` (separate `admin*` state). lint 0-err, build clean. |
| 5 | Verify each call end-to-end against a live kgsm-api (auth-on), lint + build + smoke | ☑ **DONE** | Validated against an **isolated** kgsm-api on `:18097` (own signing key + scratchpad DB, prod untouched). Live matrix all green: `GET /auth/sessions` (empty + seeded rows, expired row excluded), self `revoke {all:true}`→204, admin `revokeSid`→204 (row drops) / unknown→404, `revokeUser`→204, viewer→403 on both admin endpoints, `/me.recentLogins` passthrough. **Caught + fixed a real bug live: the wire envelope is `{data:[...]}` not `{sessions:[...]}` — `adaptSessions` now reads `json.data`** (build/lint/review could not catch this). `#/settings` smoke case added (full suite needs the complete dev env). lint 0-err, build clean, version 1.4.26→1.5.0 + CHANGELOG. |

**Milestone COMPLETE (2026-07-10, unattended run).** All slices built + live-validated; committed on `main` (not pushed). Owed: a real Discord-login soak with sessions ENABLED + a `#/settings` run in the full dev env (the isolated validator ran sessions-DISABLED, the only minter-compatible mode — the populated path was proven by seeding real `SessionEntry` rows).

**Ordering:** 1 → 2 → 3 → 4 → 5. Slice 2 is the smallest coherent end-to-end unit and can ship/verify
before 4. Slice 3 is independent of 2 (different endpoint) and parallel-safe.

---

## 1 · Backend contract (live — wire against this)

All session endpoints are **root-routed, NOT under `/api/v1`** (like `/auth/session`), per host:

- `GET /auth/sessions` → `{ sessions: SessionRecord[] }` (self). Admin may pass `?userId=<id>` for
  another user. `SessionRecord = { sid, userId, created, lastSeen, expires, userAgent, current }` —
  ISO-8601 `Z` timestamps; `current:true` marks the caller's own session.
- `POST /auth/session/revoke` body `{ sid?, all? }` — self-revoke one (`sid`), all (`all:true`), or the
  calling session (omit both). → `204`.
- `POST /auth/sessions/{sid}/revoke` — admin, revoke any session cross-user. → `204`.
- `POST /auth/users/{userId}/sessions/revoke-all` — admin, "log out user everywhere". → `204`.
- `GET /api/v1/me` → now also returns `recentLogins: { ts, device }[]` (device = user-agent, may be
  null) alongside `{ user, tier, scopes }`. `/me` is `/api/v1/me` (funneled), NOT root-routed.

Revocation is effective ≤5s server-side (cached validator TTL); a token with no `sid` claim `401`s.

---

## 2 · Frontend map (the seams, patterns, gotchas)

**Settings page.** `src/pages/SettingsPage.jsx` — a flat page (no sub-tabs), routed as
`route.kind === "settings"` in `AppRouter.jsx`. Receives `user` + `onLogout` props only; NO
`hostId`/`hosts` threaded in. Two `<SettingsSection>` blocks today (Profile, Danger zone). The new
"Active sessions" section slots between them. It must resolve its own host — read
`useSelectedHostId()` / `hostsStore` directly (the `pages/CLAUDE.md` idiom, as `AuditLogPage.jsx`
does), not via a new prop.

**API client seam.** `src/lib/apiClient.js` is the single seam; `src/lib/config.js` resolves bases:
`apiV1Of(hostId)` → `<origin>/api/v1` (the default for `api.get/post/...` and `api.host(id).*`);
`apiOriginOf(hostId)` → bare `<origin>` (for root-routed `/auth/*`). `liveFetch(method, path, body,
hostId, bearerOverride, baseOverride)` is the low-level fetch — `baseOverride` is the root-routing
escape hatch. **Gap to close:** there is no *funneled* (auth + `withRetry` 401-heal) way to call a
root-routed path today — `refreshSession`/`meWith` use `baseOverride` but deliberately bypass the
funnel (bootstrap-only). Add root-routed helpers that DO go through `authorizedBearer`/`withRetry`
(mirror `get`/`post` at `apiClient.js:271-282` but pass `apiOriginOf(hostId)` as `baseOverride`), and
expose a small surface — `api.sessions(hostId)` with `.list()/.revoke({sid?,all?})/.revokeSid(sid)/
.revokeUser(userId)` — wrapped in the same `withRetry` as `api.host(id)` (`apiClient.js:491-495`).
Keep `refreshSession`/`meWith` untouched.

- `/me` needs NO new plumbing — `api.host(hostId).get("/me")` already funnels to `/api/v1/me`.
- GET response adapting is path-keyed via `adaptResponse` (`apiClient.js:172-187`); the new root GET
  won't pass through it unless the new root-GET helper calls it or the call site invokes a dedicated
  `adaptSessions` manually. POST is raw passthrough — fine (revokes return 204, short-circuited).

**sessionStore.** `src/lib/sessionStore.js` — per-host identity (Model A). Access token in
`sessionStorage`, refresh token in `localStorage`, keyed by hostId. **No `sid` is decoded from the
JWT anywhere** (verified) — the client never needs to; `SessionRecord.current` from the API is the
only "which row is me" signal. `signOut()` drops per-host tokens (keeps the host registry);
`tierOf(hostId)` gives the tier for gating.
- ⚠ **Latent gap:** `App.jsx:69-73` `handleLogout` calls `sessionStore.forget(user.hostId)` but
  `forget` is not a method (public surface has `forgetHosts`/`signOut`) and `user.hostId` is never
  set, so it's dead code — today's "Sign out" only clears the app-level marker + reloads, it does
  NOT call `sessionStore.signOut()`. For slice 2's self-full-revoke, proactively call `onLogout()`
  (the prop `SettingsPage` already has, wired to "Sign out everywhere") after a 204 — the backend has
  already revoked, and `onLogout` clears + reloads back to the login gate.

**`/me` consumption + tier gating.** `/me` is only called in `sessionStore.bootstrap()` today (for
tier). `adapters.js` `adaptMe` (`:498-501`) currently DROPS `recentLogins` — extend it to
`recentLogins: Array.isArray(be.recentLogins) ? be.recentLogins : []` (honest `[]`, never fabricate).
For the Settings section, fetch `api.host(hostId).get("/me")` in a component-local `useEffect` (no new
store). **Admin gate idiom:** `const canManageOthers = sessionStore.tierOf(hostId) === "admin"` —
mirror `DiscordPage.jsx:42` (`DiscordLiveConfig`), an in-page settings-surface gate; no new
`persona.js` CAP needed.

**Data-fetch + confirm patterns to copy.**
- Fetch/mutate template: `DiscordPage.jsx` → `DiscordLiveConfig` — component-local `useEffect` +
  `client().get/patch`, `useState` for view/error/saving, optimistic toggle + revert-on-failure.
- Destructive-confirm modal: `src/pages/diagnostics/diagHostCards.jsx:143-172` `RemoveHostDialog` —
  wraps the shared `<Modal>` (`src/components/Modal.jsx`, portal/scrim/Esc), danger icon header,
  plain-language consequence, footer `Cancel` (ghost) + danger confirm button. Three variants needed
  (revoke-one / revoke-all / admin-revoke-user) → consider a small shared `ConfirmDialog.jsx` to
  avoid 3 copies.
- Do NOT reach for the `auditStore` reactive-domain-store pattern (`AuditLogPage.jsx`) — overkill.

**Styling.** Plain CSS, tokens-driven, no CSS modules. Settings rules live in
`src/styles/kit/settings.css` (append here, not `kit.css`). Reuse: `SettingsRow`/`SettingsSection`/
`Toggle` (`components/settings-primitives.jsx`), `BriefCard` (`components/BriefCard.jsx` — has a
`count` chip good for "3 active sessions" + a header-right `action` slot for "Log out all"),
`.settings-btn-ghost`/`.settings-btn-danger` (`kit/settings.css:41-70`).

**Timestamp formatting.** `src/lib/formatting.js` — `parseTs`, `fmtRelative`, `fmtTime`, `fmtTimeFull`.
Use `fmtTime(date)` + `fmtRelative(date, now)` for `created`/`lastSeen` (as `AuditLogPage.jsx:111-114`).
⚠ `fmtRelative` mishandles **future** timestamps (a future `expires` reads "0s ago") — render `expires`
as absolute (`fmtTime`/`toLocaleString()`) or add an "expires in Xh" variant; don't feed a future ISO
string into `fmtRelative`. No UA→device-name parser exists — render the raw `userAgent` (truncated/mono,
honest) or add a tiny pure helper; don't invent fragile UA-sniffing.

**Auth egress.** `hostScoped()` `withRetry` (`apiClient.js:491-495`) is the only reactive 401-heal
(→ `sessionStore.expire` → `rotate`). A **self-revoke succeeds with 204** — there's no 401 to heal
from, so if the revoked session is the caller's **current** one, proactively `onLogout()` (see the
sessionStore gotcha). Revoking a non-current session, or an admin revoking another user, just refetch.

**Build/verify.** `npm run lint` (0-error gate), `npm run build` (dangling-import gate), `npm run
smoke` (`scripts/smoke-live.mjs`, jsdom-mounts the real graph against a **running auth-disabled**
kgsm-api — **there is no `?mock=1`/fixture mode in this repo**). Smoke extends via a `CASES` entry
(`smoke-live.mjs:~197`): `{ hash: "#/settings", must: [...], label: "Settings — sessions" }`. ⚠ An
auth-DISABLED backend may not mint real sids — confirm `/auth/sessions` returns something sane (empty
or one row) under `KGSM_API_AUTH_DISABLED` before asserting; may need to tolerate an empty list. No
unit-test runner. Visual check: `tks/scripts/visual-harness/` (Playwright) — see the memory
"kgsm-web headless visual testing".

---

## 3 · The slices

### Slice 1 — API client seam + adapters
- `apiClient.js`: add funneled root-routed helpers + `api.sessions(hostId)` surface
  (`.list()` → `GET /auth/sessions`; `.list(userId)` → `?userId=`; `.revoke({sid?,all?})` →
  `POST /auth/session/revoke`; `.revokeSid(sid)` → `POST /auth/sessions/{sid}/revoke`;
  `.revokeUser(userId)` → `POST /auth/users/{userId}/sessions/revoke-all`). Reuse `withRetry`.
- `adapters.js`: `adaptSessions(json)` (validate/map `sessions[]`, honest defaults); extend `adaptMe`
  to pass `recentLogins`.
- **Done when:** the calls resolve against a live host and return adapted shapes; no console errors.

### Slice 2 — Self-service sessions (the core)
- New `src/pages/SettingsSessions.jsx` (or inline if small): fetch `api.sessions(hostId).list()` in a
  `useEffect`; render one `SettingsRow` per session (device from `userAgent`; sub = "created … · last
  seen … · expires …"; a "This device" badge when `current`); a per-row "Log out" (danger) →
  confirm → `revoke({sid})` → refetch (or optimistic remove); a section-level "Log out all" →
  confirm → `revoke({all:true})`.
- Proactive self-logout: if the revoked set includes `current` (revoke-all always does), call
  `onLogout()` after the 204.
- Wire into `SettingsPage.jsx` as an `<SettingsSection icon="monitor-smartphone" title="Active
  sessions">`; append CSS to `kit/settings.css`.
- **Done when:** list renders live; revoke-one drops that row; revoke-all logs the user out.

### Slice 3 — Recent login history
- Under the sessions section (or its own small `<SettingsSection title="Recent logins">`): read
  `recentLogins` from the same `/me` (or the fetch already in scope), render a flat list (device +
  `fmtTime`/`fmtRelative` on `ts`), honest empty state.
- **Done when:** recent logins render (or an honest "no recent logins" when empty).

### Slice 4 — Admin cross-user revoke
- Admin-tier-gated (`sessionStore.tierOf(hostId) === "admin"`): a control to enter/select a `userId`
  and revoke all their sessions (`revokeUser(userId)`), and/or revoke a specific `sid`
  (`revokeSid(sid)`) — reuse the slice-2 list component with an admin `userId` param + an extra
  confirm variant ("Revoke user X's sessions everywhere?").
- **Done when:** an admin can list + revoke another user's sessions; a viewer/operator never sees the
  control.

---

## 4 · Verification

**Do NOT test against the production API (`:8097`) or the live website.** Stand up an isolated
instance instead: start a **second kgsm-api on a non-prod port** with its own DB and a dev signing
key — either a **clone** of `/var/lib/kgsm-api/kgsm-api.db` (copy to a temp path so real audit rows
aren't touched) or a fresh empty DB. Run it **auth-ON** so the JwtBearer pipeline (and thus the
session check) actually fires — `KGSM_API_AUTH_DISABLED` must be unset/false; set a stable
`KGSM_API_AUTH_SIGNING_KEY` on the instance so a minted token validates. Point a dev Vite
(`VITE_API_BASE`-seeded) at that instance for the UI. See [[kgsm-web-headless-visual-testing]].

Mint an **admin dev token** with `kgsm-api/scripts/mint-dev-token.py` (it reads the signing key at
runtime — point it at the isolated instance's key/aud) to exercise both self and admin paths; confirm
the instance's audit log lands `auth.session.revoke` / `.revoke.all` / `.revoke.admin` rows. Then
`npm run lint` + `npm run build` clean, and add a `#/settings` smoke case (⚠ an auth-DISABLED smoke
backend may mint no real sids — tolerate an empty list, per §2). Bump kgsm-web `package.json` version
(patch/minor) + CHANGELOG if one exists. Commit per-repo on `main`, don't push, unless asked.

**Execution model (for an unattended run):** each slice in §3 is independently delegable — hand each
one to a **Sonnet subagent** to implement against the mapped patterns (§2) and the pinned contract
(§1), then the orchestrator **validates every slice at the end** (build + lint + the live-instance
call checks above) before committing. Keep slices ordered (1 → 2 → 3 → 4); slice 1 is a hard
prerequisite for the rest.

**Sudo:** this is a trusted dev host and `deploy.sh`/DB-clone steps may need root. The unattended
session has the password available from its own (session-only) context — **never write it into this
doc, the repo, or any on-disk file.** Don't deploy to prod as part of validation (the user asked to
leave prod untouched); sudo here is only for standing up / cloning the isolated test instance.

---

## 5 · Files touched (target)

- **Edit:** `src/lib/apiClient.js`, `src/lib/adapters.js`, `src/pages/SettingsPage.jsx`,
  `src/styles/kit/settings.css`, `scripts/smoke-live.mjs`, `package.json`.
- **New:** `src/pages/SettingsSessions.jsx` (+ maybe `src/components/ConfirmDialog.jsx`).
- **No change needed:** `src/lib/config.js` (already exposes `apiOriginOf`), `AppRouter.jsx` (no new
  prop threading — the section self-resolves its host).
