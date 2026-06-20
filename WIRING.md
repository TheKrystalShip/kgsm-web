# Wiring `kgsm-web` ↔ `kgsm-api`

Audit of the contract between the Control Panel SPA (`kgsm-web`) and the per-host
aggregator API (`kgsm-api`), and the plan to connect them. Neither side is
authoritative today — this is the reconciliation record. Generated 2026-06-20.

> Source of truth for the backend shapes: the live `kgsm-api` controllers + DTOs
> (camelCase JSON, ISO-8601 `Z` timestamps, error envelope `{error:{code,message,details?}}`).
> Source for the frontend's expectations: `src/lib/apiClient.js` (the active mock
> seam) + `src/lib/data.js` fixtures. **Ignore `reference/scaffold-api-seam/`** —
> it's a stale earlier design (uses `/catalog`, path-based actions); the backend
> and the active mock already settle those the other way.

---

## 0. The shape of the problem

The SPA was ported from a no-build prototype whose fixtures model a **richer,
imagined** domain (per-server `players`, `ip`, `uptime`, host per-process tables,
sensors) than the backend **honestly** emits. The backend deliberately omits
anything it can't measure — that "never fabricate a metric or status" rule is *the*
ecosystem invariant (it's why the previous kgsm-api was scrapped for synthesizing
CPU from `Random`).

**So the cardinal rule for this wiring:** the adapter maps backend → frontend, and
where the backend has no value, the UI renders **unknown / —**, *never* `0` or a
fabricated default. `players: x ?? 0` in the adapter would re-introduce exactly the
fabrication the ecosystem bans. (`players` specifically is "unknown now, wired
later" — presence tracking is actively being built — so the player UI degrades to
unknown, it is not deleted.)

## 1. Architecture: per-host, not a mismatch

`kgsm-api` is **per-host / single-tenant**: `GET /hosts` returns an array of *one*
(this host), there is no fleet endpoint, auth + WebSocket are per-host. The SPA is
a **multi-host fleet client** that fans out and aggregates client-side. This is the
documented design (`system-architecture.md` O5, kgsm-api CLAUDE.md "per-host
aggregator"), and the FE is already built for it: `api.host(id)`, per-host
`tier`/`authDenied`, per-host sockets, the 401/403/`login_required` state machine
in `sessionStore.js`. **Do not "reconcile" this — it's correct on both sides.**

**The one genuinely open piece — host discovery.** The mock pre-knows the fleet via
a single `GET /hosts`. In production there is no registry endpoint; each host is its
own kgsm-api at its own base URL. The FE `AddHostPage` drives the Discord bounce but
**never captures a base URL** today. So the SPA needs a **local host registry**
(base URL + label per host, in `localStorage`), seeded by the add-host flow; `GET
/hosts` becomes "call each registered host and concatenate." This blocks the
multi-host fan-out, *not* the first single-host slice (point `VITE_API_BASE` at one
host). **Decision owed** (see §7).

## 2. Transport & config gaps

| Concern | Frontend today | Backend | Action |
|---|---|---|---|
| Base URL | `VITE_API_BASE` exists in `.env.example` but is **read nowhere in `src/`**; mock always serves fixtures | listens at `/api/v1` | Build a real transport that reads `VITE_API_BASE` (+ `/api/v1`); keep mock as the no-base fallback |
| Realtime URL | `VITE_WS_BASE` unread; mock is in-memory | `GET /api/v1/stream` (RFC 6455 WS), bearer via `?access_token=` | Real WS client behind the existing `api.stream` interface |
| JSON casing | fixtures mix **snake_case** (`update_available`, `last_backup`, `user_id`, `per_core`, `boot_time`, `sample_age_s`, `open_ports`, `usage_pct`…) | **camelCase** everywhere (`PropertyNamingPolicy=CamelCase`) | Adapter normalizes; do **not** rename fixtures piecemeal — map at the seam |
| Errors | mock rejects with `{code:'ECONNREFUSED'}` ad-hoc | `{error:{code,message,details?}}`, stable `code` strings | Transport unwraps the envelope into the FE's error shape |
| Auth transport | per-host bearer injected by `api.host(id)` | `Authorization: Bearer <jwt>`; secure-by-default (everything needs a bearer) | Inject real bearer; use `KGSM_API_AUTH_DISABLED` on the backend to prove the data path *before* wiring OAuth |
| Timestamps | fixtures use bare local ISO (`2026-05-22T10:28:01`) | ISO-8601 **UTC `Z`** | Adapter parses `Z`; FE formatting already tolerant |

## 2b. Surfaces that bypass the adapter seam (must be wired individually)

The "swap the transport at the seam" strategy only fixes data that flows through a
store. A `grep` for `KRYSTAL_DATA`/`data.js` in `src/pages` + `src/components`
(2026-06-20) found **six surfaces that import fixtures directly** — these will *not*
be fixed by the adapter and each needs its own wiring (or honest-unavailable
treatment):

| File | Direct fixture read | Backend source | Bucket (see §9) |
|---|---|---|---|
| `pages/PerformanceTab.jsx:42` | `KRYSTAL_DATA.metricsByServer[id]` (48-pt time series) | none — BE emits point-in-time only | **C** (history) |
| `pages/PlayersTab.jsx:80` | `KRYSTAL_DATA.playersByServer[id]` (roster) | none — only `player.join/leave` audit | **C** (presence WIP) |
| `pages/BackupsList.jsx:14` | `KRYSTAL_DATA.backups` | none — only `backup.*` audit | **C** |
| `pages/FileBrowser.jsx:35` | `KRYSTAL_DATA.files`/`fileContent` | none — no file API | **C/deferred** |
| `pages/DashboardPage.jsx:230` | `KRYSTAL_DATA.session.ping_ms`/`region` | ping = client-measurable RTT; region none | **B**(ping)/**D**(region) |
| `pages/LibraryPage.jsx`, `components/Sidebar.jsx` | `KRYSTAL_LABELS.catalog` | static UI label, not domain data | n/a (keep) |

(`DiagnosticsPage.jsx:31` only *mentions* `KRYSTAL_DATA` in a comment — it reads
`hostsStore`, so it **is** behind the seam.) Note: a prior agent claim that
`ServerCard` reads `metricsByServer` directly was wrong — it does not import
`data.js`; it gets metrics via props/store.

## 3. Endpoint matrix (FE call → BE endpoint)

All BE routes are under `/api/v1`. ✅ aligned · ⚠️ remap needed · ❌ gap.

| FE call (`apiClient.js`) | Backend endpoint | Status | Notes |
|---|---|---|---|
| `GET /servers` | `GET /api/v1/servers` (Viewer) | ⚠️ | path prefix + **schema differs heavily** (§5) |
| `POST /servers/{id}/commands {verb}` | `POST /api/v1/servers/{id}/commands {verb,origin?}` (Operator) | ✅ | **both body-based with `verb`** — the contract agrees. Add `origin:"ui"`. BE returns `{job}` (202); FE expects `{job:{...}}` ✅ |
| `GET /hosts` | `GET /api/v1/hosts` (Viewer) | ⚠️ | returns array-of-one per host; schema differs (§5); fan-out is FE-side |
| `GET /library` | `GET /api/v1/library?q=&category=` (Viewer) | ⚠️ | **path agrees** (not `/catalog`); schema differs (§5) |
| `GET /audit` | `GET /api/v1/audit?cursor=&limit=&severity=&serverId=&actor=` (Viewer) | ⚠️ | BE returns `{data,nextCursor}`; **FE expects a bare array** + ignores paging → wrap/unwrap in adapter; wire filters |
| `GET /auth/discord/callback?host=&prompt=` | `GET /auth/discord/callback?code=&state=` (anon) | ⚠️ | **different flow** — FE has a simplified per-host callback; BE is real OAuth code/state. Also `GET /auth/discord/start`. Returns `{verdict,tier,token,refresh,userId}` (FE expects `user_id`, has no `refresh` handling) |
| `POST /auth/session/refresh {host}` | `POST /auth/session/refresh` + `Bearer <refresh-jwt>` → `{token}` (anon) | ⚠️ | FE sends `{host}` body; BE wants the refresh token as bearer |
| `GET /servers/{id}` (defined, unused) | `GET /api/v1/servers/{id}` (Viewer) | ✅ | both exist; detail adds `network` block |
| `PATCH /alerts/{id}` (defined, **unused**) | — (alerts read-only) | ✅ | FE never calls it; fine |
| `POST /api/v1/hosts/{id}/assistant/chat` (raw fetch, **outside seam**, Ollama-shaped) | `POST /api/v1/assistant/turn {prompt,think?,tools?}` (SSE, Viewer) | ❌ | **rewrite** — wrong route *and* wrong shape; route through the seam |
| — (FE doesn't call) | `GET /api/v1/me` → `{user,tier,scopes}` | ➕ | FE currently derives tier from the callback; could/should use `/me` |
| `GET /alerts` (slice 3) | `GET /api/v1/alerts?status=&since=` → `{data:[Alert]}` | ✅ | `alertsStore.refresh()` hydrates firing + 24h resolved on LIVE boot (was fixtures+stream only) |
| — (FE: `DiscordPage`/settings) | `GET/PATCH /api/v1/integrations[/{provider}]`, `POST …/test` (Admin) | ➕ | backend built (Discord+Slack); FE settings UI not wired to it — verify FE call sites |

## 4. Realtime matrix (topic → message type)

FE subscribes via `api.stream.subscribe([topics], cb)` → must emit `{type:"subscribe",
topics:[…]}`. BE outbound envelope: `{topic, type, data}` (FE handler reads `type`+`data`,
tolerant of extra `topic`).

| FE topic → type | BE topic → type | Status |
|---|---|---|
| `servers` → `server.patch` | `servers` → `server.patch` | ⚠️ same name, `data` is the full Server DTO (schema §5) |
| — | `servers` → `server.removed {id}` | ➕ handle roster tombstone |
| `jobs` → `job` | `jobs` → **`job.patch`** | ⚠️ **type-name differs** — remap `job`↔`job.patch` |
| `console` → `console.line` | **(none)** | ❌ **true backend gap** — no console topic exists; `ConsolePanel` degrades to "unavailable" |
| `alerts` → `alert.raise`/`alert.resolve`/`alert.retract` | same three | ✅ schema mostly aligned (§5) |
| `hosts/{id}/metrics` (planned) | `hosts/{id}/metrics` → `host.metrics` | ➕ wire it |
| — | `servers/{id}/metrics` → `metrics.tick` | ➕ per-instance metrics |
| — | `hosts/{id}/capabilities` → `capabilities.patch` | ➕ drives capability badges |
| — | `servers/{id}/network` → `network.patch` | ➕ ports flow |
| — | `audit` → `audit.append` | ➕ FE could live-prepend audit |

## 5. Schema diffs (the bulk of the work)

Field-level. **A = adapter remap; F = frontend change (drop/relabel/honest-unknown);
B = backend could add.** Honest-unknown is the default for every missing value.

### Server — large divergence
| FE fixture field | BE field | Resolution |
|---|---|---|
| `status: online/offline/updating/installing/error/crashed` | `status: running/stopped/unknown` | **A**: map `running→online`, `stopped→offline`, `unknown→unknown`. `installing/updating` synthesize from the in-flight **job** verb; `crashed` from a firing **alert**; `error` from job `failed` |
| `players:{current,max}` | — | **F**: honest-unknown (presence tracking WIP). Render "—", not 0 |
| `ip` ("host:port") | — | **F**: not exposed by kgsm; derive from host + `ports` if needed, else hide |
| `uptime` (string) | — | **F**: not exposed; FE already has "—" fallback |
| `cpu` (0–100) | `metrics.cpuPctCore` (can exceed 100) | **A**: different unit — relabel UI to per-core %, or divide by host cores. `null` → "—" |
| `ram:{used,max}` GB | `metrics.memBytes` (no per-instance max) | **A**: bytes→GB; **max is host-level** not per-instance — drop per-server max bar or source from host |
| `game` (display) | `blueprint` (id) | **A**: resolve display name from `/library` by blueprint id |
| `version`, `update_available` | `version` (nullable), no update check | **A**/**F**: `update_available` has no source → hide |
| `last_backup`, `notice`, `config`, `log` | — | **F**: no source today → hide/defer |
| — | `runtime`, `steamAppId`, `clientSteamAppId`, `isSteamAccountRequired`, `metrics.{ioReadBps,ioWriteBps,pids}`, `network` | **B→F**: surface where useful (runtime badge, IO, port card) |

### Host — large divergence
| FE | BE | Resolution |
|---|---|---|
| `name` | `label` | **A** |
| `online: boolean` | `status: "online"` (reaching the row = up) | **A** |
| `tier`, `authDenied` | (from auth layer, not `/hosts`) | **A**: keep FE's per-host session source |
| `cpu:{…}`, `ram:{…detailed}`, `per_core`, `load_avg`, `temp_c` | `cpuPct`, `mem:{used,total}`, `disks:[{mount,used,total}]` | **A**+**F**: BE is coarser — render what exists, honest-unknown the rest (no per-core/temp today) |
| `processes`, `sensors`, `network.interfaces` | — | **F**: no source → hide those diagnostics panels |
| `capabilities:{metrics,assistant,watchdog}` | same (richer: `provisioned/status/since/message/info`) | ✅ **A**: align field names (`sample_age_s` etc. → BE `info.intervalMs`) |
| `network.open_ports` | host detail `network.openPorts:[{port,proto,app,server}]` | **A** |

### Audit — moderate
| FE | BE | Resolution |
|---|---|---|
| response = bare array | `{data:[…], nextCursor}` | **A**: unwrap `.data`; wire `nextCursor` for paging |
| `actor:{name,provider}` | `actor:{kind,name,provider}` | **A**: pass `kind` through |
| `action` enum (incl. `file.*`, `settings.*`, `discord.*`, `host.*`, `player.allow.*`) | closed vocab (`server.*`, `backup.*`, `network.ports.*`, `network.upnp.*`, `player.join/leave`, `auth.*`) | **A**/**F**: FE must tolerate unknown actions (generic icon); some FE actions have no BE source yet |
| `severity`, `target`, `summary`, `meta`, `serverId`, `hostId` | same | ✅ |

### Alert — close (prototype-proven)
| FE | BE | Resolution |
|---|---|---|
| `icon` | — | **A**: derive icon from `severity`/`source` |
| `severity: danger/warn` | `severity: info/warn/danger` | **A**: handle `info` |
| `anchor:{surface,hostId,serverId,tab,ref}` | `anchor:{surface,hostId,tab,ref}` (no `serverId`) | **A**: use top-level `serverId` |
| `source`, `status`, `raisedAt`, `escalated`, `attempts`, `resolution{by,source,reason,actionId}`, `resolvedAt` | same | ✅ |
| `prompt`, `autoResolves` (mock-only) | — | **F**: mock-only, drop |

### Library — moderate
| FE `CatalogGame` | BE `LibraryEntry` | Resolution |
|---|---|---|
| `category`, `players` (display string), `addedAt`, `hosts[]` | — | **F**: honest-unknown / drop (no source); `players` ≈ `specs.maxPlayers` (null today) |
| `art`, `cover` | `cover` (reserved null), `rawgSlug` (reserved null) | **A**/**F**: FE keeps `art` gradient fallback; cover art deferred BE-side |
| `id`, `name` | `id`, `name` | ✅ |
| — | `type`, `steamAppId`, `clientSteamAppId`, `isSteamAccountRequired`, `ports:[{start,end,proto}]`, `specs` | **B→F**: surface type badge, ports, specs |

### Auth callback — flow + field
- FE expects `{verdict, tier, token, user_id}`; BE returns `{verdict, tier, token, refresh, userId}`.
- **A**: `userId` (not `user_id`); **handle `refresh`** (FE has no refresh-token store today — refresh sends `{host}` body, BE wants the refresh JWT as bearer).
- **Flow**: replace the FE's `?host=&prompt=` single-call callback with `GET /auth/discord/start` → Discord → `GET /auth/discord/callback?code=&state=`. The `prompt=none` silent-SSO intent maps onto `start?prompt=none`.

## 6. True gaps & rewrites (not simple remaps)
1. **Console** — no backend topic at all (deferred). `ConsolePanel` must degrade to "unavailable," not be wired.
2. **Assistant chat** — FE `ChatPage` does a raw Ollama-shaped `fetch` to the wrong route. Rewrite onto `POST /api/v1/assistant/turn` (SSE, `{prompt,think,tools}`), routed through the `api` seam.
3. **Host discovery / registry** — no base-URL capture in the FE (see §1, §7).
3b. **OAuth token handoff — BUILT (slice 4b; one manual browser login owed).** The
    callback now 302s to `KGSM_API_AUTH_FRONTEND_URL` with the session in the URL
    **fragment** (`#access=…&refresh=…` | `#error=…`), and the SPA captures+strips it
    at boot (`authRedirect.js`). Mechanically verified; the real Discord consent
    round-trip is owed-to-human. Refresh-token *rotation* (>15-min sessions) and
    multi-host token routing remain deferred.
4. **Honest-unknown UI** — players/ip/uptime/per-process/sensors have no source: render "unknown" (preferred) or hide; never fabricate.

## 7. Open decisions
- **D1 — Host registry**: where the SPA stores each host's base URL. Recommend a
  `localStorage` host list (`{id,label,baseUrl}`), seeded by `AddHostPage`, with
  `GET /hosts` fanned out across it. (Doesn't block the single-host slice.)
- **D2 — Honest-gap rendering**: render "unknown/—" vs hide the element. Recommend
  **render unknown** (keeps layout, communicates honesty) except where it'd be noise.
- **D3 — Per-server CPU%**: show raw per-core `cpuPctCore` (BE-honest) vs normalize
  to host cores. Recommend show per-core, labeled.

## 7b. Live findings (probed against a running kgsm-api, 2026-06-20)
Backend was live at `http://127.0.0.1:8097` with `KGSM_API_AUTH_DISABLED` (so `/me`
→ `dev (auth disabled)`, admin). Real responses **confirmed the schemas in §5**.
Surprises found by probing:
- ~~**`GET /api/v1/audit` → HTTP 500**~~ **RESOLVED (slice 3, 2026-06-21).** Root cause
  confirmed: the running `:8097` instance (a manually-launched dev backend, env replicated
  from `/proc`) was pointed at `KGSM_API_DB=/tmp/upnp-e2e.db`, a leftover UPnP-e2e DB that
  had been **truncated to 0 bytes** → its schema was gone → `AuditQueries.PageAsync` 500'd
  (same family as the documented `EnsureCreated` stale-DB drift). Fix = **recreate the dev
  DB**: stop the stale process, delete the 0-byte file, relaunch the (rebuilt) binary with
  the *same* env. On the empty file `EnsureCreated` rebuilds the full schema (`AuditEntry`
  **+** `IntegrationEntity`, both in `AppDbContext`) → `/audit` returns `{data:[],nextCursor}`
  and a real emitted `instance-started` event flowed through to a `server.start` row (render
  path live-verified). New PID + exact command surfaced to the user.
- ~~**`GET /api/v1/integrations` → HTTP 500**~~ **RESOLVED (same DB recreate, side-effect).**
  `IntegrationEntity` lives in the same `AppDbContext`, so the fresh schema fixed it too;
  now `200` (`[{provider:"discord",…},{provider:"slack",…}]`). Integrations *wiring* is a
  later slice (not in scope here) — only the 500 is cleared.
- `GET /servers/{id}` detail correctly carries the `network` block
  (`firewall:"absent"`, `required:[{port,proto,open:null}]`). Host detail omits
  `network` honestly when the firewall is absent.
- **Frontend persona is tier `none` until auth lands** — with no per-host session,
  `resolveRoute` sends admin/operator surfaces (dashboard, fleet) to the viewer home
  (servers). So pre-auth, only the viewer-reachable read path (servers list + server
  detail) renders through the UI; the fleet/host read path is built + crash-safe but
  gated until the auth slice. (Backend auth being disabled doesn't change this — the
  FE must learn its tier, e.g. from `GET /me`.)

## 8. Sequenced plan
Prove the pipe on a read-only slice first (backend `KGSM_API_AUTH_DISABLED=1`), then auth, then realtime.

> **Slice 1 — DONE (2026-06-20).** Transport + adapter + live boot + honest-unknown
> rendering for the servers/hosts read path. Files: `src/lib/config.js` (new),
> `src/lib/adapters.js` (new), `apiClient.js` (live `get/post/patch` behind `LIVE`,
> envelope unwrap, reachability signal), `stores.js` (cold-boot when live), and
> honest-unknown guards in `ServerCard`/`StatTiles`/`DiagnosticsPage`/`HostCardBody`.
> Verified: `npm run build` green, mock smokes green (no regression), and
> `npm run smoke:live` against the live backend (adapters produce honest nulls — never
> 0; no fabricated meters; servers roster + detail render real data with `—`).
> Mock stays the default (no `VITE_API_BASE` → fixtures). **To run live:**
> `cp .env.example .env.local`, set `VITE_API_BASE=http://<host>:<port>`, `npm run dev`.

> **Slice 2a — Server/Dashboard A-remaps — DONE (2026-06-20).** Pure read-path
> adapter/derive work, no backend change. Files: `stores.js` (cross-store
> `resolveGameNames` — joins `server.blueprint` → `/library` name; subscribes
> `libraryStore` only and writes only on change, since `setState` always emits;
> re-runs after every `serversStore.refresh`), `GamePage.jsx` + `LibraryPage.jsx`
> (one shared `instancesOfBlueprint(game, servers)` helper, matched by blueprint id
> — **fixes a live data-corruption bug in BOTH surfaces**: two `rawgSlug:null`
> servers matched *every* blueprint via `null === null`, so every detail page and
> library card showed all servers / "2 servers"; extracting one helper also stops
> the two surfaces drifting), `ServerHero.jsx` + `kit.css`
> (className-based `native`/`container` runtime chip — honest API metadata; absent
> in mock so it renders nothing there). Verified: build + mock smoke green; live
> smoke adds three assertions (game-name join consistent — *2 servers / 29 catalog*;
> runtime chip on detail; GamePage shows `factorio-test` not `terraria-hardmode`).
> **Honest framing:** the live catalog returns `name === id` for every entry today
> (curation deferred upstream), so the game-name resolve is correct *wiring* with
> **no visible change yet** — it self-heals the moment curated titles land.
> **Deferred (named in the slice, deferred with cause):**
> • *Job-derived status* (`installing`/`updating`/`crashed`/`error`) — no honest
>   source on a cold read (no `GET /jobs`; transient states exist only mid-command).
>   Needs the jobs WS (slice 5) + alerts GET (slice 3). Don't fabricate.
> • *Server ports* — **not** a backend gap: `GET /servers/{id}` carries
>   `network.required[]`, but the FE never calls the detail endpoint (list omits
>   `network`; the detail GET is defined-but-unused, §3). Needs the detail-GET wired
>   first → its own slice (6, with `network.patch`).

> **Slice 4 — Auth/Me (FE half) — DONE (2026-06-21).** Wires the per-host tier from
> `GET /me` so the persona/route gate works against the live backend (no more forced
> "Preview as admin" lens). Files: `adapters.js` (`adaptMe` — honest passthrough,
> tier→`none` secure-by-default), `apiClient.js` (live transport now injects the
> selected host's bearer when held — `liveBearer()`; null under
> `KGSM_API_AUTH_DISABLED`, so calls go out unauthenticated and that mode accepts
> them; adapt `/me`), `sessionStore.js` (LIVE `bootstrap` resolves tier from `/me`
> instead of the fake callback; **reactive bootstrap as hosts hydrate** — seed runs
> before the live host exists, the mirror of the game-name timing fix; `seed` never
> fabricates a tier/token in LIVE; `scheduleRefresh` guarded to token-only so an
> auth-disabled host doesn't fire a spurious refresh; `refresh` re-confirms via
> `/me`; new `tokenOf`). Verified: build + mock smoke green; live smoke drops the
> persona force and proves `GET /me` → `hotrod: admin` ungates fleet/host-deep-dive
> on its own (and the admin tier now renders the operator lifecycle controls).
> **THE BACKEND GAP (decision owed — see §6).** A real Discord login can't complete
> from the SPA: `/auth/discord/start` 302s to Discord, but the callback
> (`AuthController.cs:120`) returns `CallbackResult` **as JSON** with no handoff back
> to the SPA — the browser lands on the API origin showing raw JSON, and the minted
> access+refresh tokens never reach the SPA. So today the live FE only works against
> an **auth-disabled** backend. Closing this is a **kgsm-api change** (sign-off
> required, security-sensitive): the callback should `302` to an allowlisted SPA URL
> with tokens in the **fragment** (`#access=…&refresh=…` — fragments never hit server
> logs / Referer), or a popup + `postMessage`. The FE session layer above is already
> shaped for it (`bootstrap`/`tokenOf`/refresh) — only token *acquisition* is missing.

> **Slice 4b — OAuth fragment handoff — BUILT (2026-06-21; one manual browser
> login owed).** Closes the gap above (chosen mechanism: fragment redirect).
> **kgsm-api** (`feat/oauth-frontend-redirect` `56e5aa8`): `KGSM_API_AUTH_FRONTEND_URL`
> + the callback 302s to it with the session in the URL **fragment**
> (`#access=…&refresh=…` | `#error=…`), never the query; single fixed target (no
> open-redirect); CSRF gate unchanged; blank → unchanged JSON (215/215 tests green,
> +2 redirect tests). **kgsm-web**: `authRedirect.js` (capture+strip the fragment
> before the hash router reads it; `completeOAuthLogin` resolves the app-shell
> identity from `/me` before mount → no LoginPage flash), `main.jsx` (async boot),
> `sessionStore` (adopts the handed-back token for the lone host before its `/me`
> tier call — single-host; multi-host token routing still deferred), `LoginPage`
> (LIVE Discord button → full-page `…/auth/discord/start`; surfaces a captured
> `#error`). Verified MECHANICALLY: build + mock smoke green; live smoke parses/
> strips/one-shot-stashes the fragment + the error. **OWED — one human browser
> login** (real Discord consent can't be driven headlessly). **Still deferred:**
> refresh-token *rotation* — sessions are valid for the 15-min access TTL, then a
> re-login (the FE stores the refresh token but doesn't yet call the rotation
> endpoint; that's the fast-follow). Multi-host token routing (which host issued a
> token) — single-host only today.

1. **Transport + adapter scaffold** — real `fetch` client behind the `api` seam,
   reads `VITE_API_BASE`+`/api/v1`, unwraps the error envelope; mock stays the
   no-base fallback. An `adapters/` module: BE DTO → FE shape, one mapper per resource.
2. **Slice 1 (read-only): hosts + servers** — wire `hostsStore`/`serversStore` GETs
   through the adapter; status-vocab remap; honest-unknown rendering. Verify against
   a live single host with auth disabled.
3. **Slice 2: audit + library + alerts (GET)** — **DONE (2026-06-21).** Audit + library
   already hydrated live (cold boot + passthrough adapters); the DB recreate (§7b) cleared
   the `/audit` 500 → both live-verified (audit render-path proven with a real emitted row).
   Alerts (deliberately empty in LIVE before) now hydrates from `GET /alerts?status=firing`
   **+** `?status=resolved&since=24h` via a new `alertsStore.refresh()` (self-hydrates on LIVE
   load; `rehydrateAll` re-pulls it on reconnect). `adaptAlerts` derives a display `icon`
   from the honest `source`/`severity` (API carries none — presentation, not a measured
   fact) and passes every sourced field through; `prompt`/`autoResolves` stay absent (demo-
   only). `adaptResponse` now matches on the base path (`split("?")[0]`) so filtered/paged
   reads still hit their adapter. Verified: build green, mock smoke green, `smoke:live` green
   (+icon-derive, +alerts-hydrate, +audit/alerts live render).
4. **Auth** — real OAuth (`start`/`callback`/`refresh` + bearer + refresh store),
   tier from `/me`, the 401/403/`login_required` machine on real responses.
5. **Realtime** — WS client on `/api/v1/stream`, subscribe protocol, topic/type
   remap (`job`↔`job.patch`), coalesce-aware; poll-fallback on drop.
6. **Commands + ports + install/uninstall** — `commands {verb,origin}`, `open_ports`,
   `POST/DELETE /servers`; reconcile job/`network.patch` streams.
7. **Assistant** — rewrite `ChatPage` onto `/assistant/turn` SSE through the seam.
8. **Multi-host fan-out** — host registry (D1), per-host sessions/sockets, fleet rollup.
9. **Integrations + settings** — wire `DiscordPage`/settings to `/integrations`.
10. **Degrade** — console unavailable; capability-driven panel hiding; honest-unknown everywhere.

---

## 9. Field-level supply map (the working checklist)

Built from three inventories (2026-06-20): the FE per-surface field consumption, the
FE mock layer (`data.js`/`stores.js`/`apiClient.js`), and the **authoritative** live
kgsm-api DTOs (`src/Api/Contracts/*.cs`) + the monitor contract
(`kgsm-monitor/src/Monitor.Contracts/Snapshot.cs`).

**The discriminating axis is where an honest source exists** — *not* "mock vs real":

- **A — API supplies today** → adapter remap only. Just wire it.
- **B — measured upstream, API doesn't expose yet** → additive API work, **no upstream
  change** (the value already exists in a monitor `Snapshot`, a kgsm event, or kgsm-lib).
- **C — no honest source anywhere yet** → needs kgsm / kgsm-lib / watchdog / monitor to
  *produce* it first (then becomes B). Render honest-unknown until then.
- **D — not measurable / N/A** → honest-unknown forever. Render `—`; never fabricate.

> **The big discovery:** the monitor `Snapshot` already measures `PerCore[]`,
> `LoadAvg`, swap (`SwapTotal/UsedKb`), disk `Fs`, disk IO, per-interface
> `Rx/Tx/RxPps/TxPps`, `Hostname`, `UptimeSec` — but the API surfaces only a coarse
> subset (`cpuPct`, `mem{used,total}`, `disks{mount,used,total}`). So most of
> DiagnosticsPage is **B (additive API mapping)**, not "needs upstream." That's the
> single biggest lever in this plan.

### Server (`ServerCard`, `ServersPage`, `StatTiles`, `DashboardPage`, detail)
| FE field | BE today | Bucket | Action |
|---|---|---|---|
| `id`, `name` | `id`, `name` | **A** | passthrough |
| `game` (display) | `blueprint` (id) | **A** | resolve display via `/library` lookup |
| `status` online/offline | `running/stopped/unknown` | **A** | remap (done) |
| `status` installing/updating | in-flight `job.verb` | **A** | synthesize from job stream |
| `status` crashed/error | firing alert / `job.failed` | **A** | synthesize from alerts + jobs |
| `cpu` | `metrics.cpuPctCore` | **A** | per-core unit; `null`→`—` (done) |
| `ram.used` | `metrics.memBytes` | **A** | bytes→GB (done) |
| `ram.max` | — (no per-instance limit) | **D** | drop per-server max bar |
| `version` | `version` (nullable) | **A** | passthrough |
| `runtime`, `steamAppId*`, `network` | same | **A** | surface (runtime badge, port card) |
| `job{verb,state}` | `jobs` WS `job.patch` | **A** | remap `job`↔`job.patch` |
| `last_backup` | `backup.create` audit rows | **B** | derive latest from audit (weak; or hide) |
| `players{current,max}` | — (presence WIP) | **C** | honest-unknown now (done); wired when presence lands |
| `uptime` | — (no per-instance uptime) | **C** | derive from `server.start` ts later; `—` now |
| `ip` | — (kgsm doesn't resolve) | **C** | host addr+port later; `—`/hide now |
| `update_available` | — (no update check) | **C** | hide until an update-probe exists |
| `notice` | — (no notice field) | **C** | needs an API field (settings); hide now |
| `config{...}`, `log[]` | — (no config/console API) | **C** | see surface rows below |
| `art` (gradient) | — | n/a | FE-local fallback, keep |
| `rawg_slug`/cover | `rawgSlug`/`cover` reserved null | **D** | FE gradient fallback |

### Host (`DiagnosticsPage`, `HostCardBody`, dashboard capacity)
| FE field | BE today | Bucket | Action |
|---|---|---|---|
| `id`, `name`, `online` | `id`, `label`, `status` | **A** | remap (done) |
| `tier`, `authDenied` | (auth layer) | **A** | keep FE per-host session source |
| `capabilities.*` | same (richer) | **A** | align `info` field names |
| `network.open_ports` | detail `network.openPorts[]` | **A** | remap |
| `cpu.usage_pct` | `cpuPct` | **A** | passthrough |
| `ram.total_gb/used_gb` | `mem{used,total}` | **A** | passthrough |
| `disks[].mount/total/used` | `disks[{mount,used,total}]` | **A** | passthrough |
| `cpu.per_core[]` | monitor `Cpu.PerCore` | **B** | **expose on Host DTO** |
| `cpu.load_avg[]` | monitor `Cpu.Load` | **B** | **expose** |
| `ram.swap_total/used_gb` | monitor `Mem.Swap*Kb` | **B** | **expose** |
| `ram.free_gb` | monitor `Mem.AvailableKb` | **B** | expose/derive |
| `disks[].fs` | monitor `MountUsage.Fs` | **B** | expose |
| disk IO, `network.interfaces[].{name,rx,tx,rx_pps,tx_pps}` | monitor `Disk.Io`, `Net.Ifaces` | **B** | **expose** (new Host fields) |
| `hostname` | monitor `Hostname` | **B** | expose |
| `boot_time` | monitor `UptimeSec` | **B** | expose/derive |
| `panel_version` | `ApiInfo.version` | **B** | expose on host |
| `cpu.model/cores/threads/freq_ghz` | — (static cpuinfo, not sampled) | **C** | small monitor+api add |
| `ram.cached_gb/buffers_gb` | — (not measured) | **C** | monitor add or `—` |
| `network.interfaces[].{ip,mac,errors}` | — (not measured) | **C** | monitor add or `—` |
| `disks[].device` | — (not measured) | **C** | monitor add or `—` |
| `disks[].smart` | — (needs smartctl) | **C/D** | likely `—` |
| `cpu.temp_c`, `sensors[]` | — (no sensors sampler) | **C** | monitor sensors slice or `—` |
| `processes[]` (pid/ppid/cpu/ram/threads/fds/state) | monitor sums per-server only, no list | **C** | new monitor contract field (significant) |
| `region` | — | **D** | FE registry concept; `—` |

### Audit (`AuditLogPage`, `StatTiles`, dashboard activity)
| FE | BE | Bucket | Action |
|---|---|---|---|
| bare array | `{data,nextCursor}` | **A** | unwrap (done); wire paging |
| `actor{name,provider}` | `actor{kind,name,provider}` | **A** | pass `kind` |
| `action` (broad enum) | closed vocab | **A** | tolerate unknown → generic icon |
| `severity/target/summary/meta/serverId/hostId` | same | **A** | passthrough |
| ✅ **live-verified (slice 3)**: dev DB recreated (§7b) → `/audit` 200; a real emitted `server.start` row flows through `adaptAudit` and renders | — | — | DONE |

### Alert (`AlertsPage`, `NeedsAttention`, `ContextualAlerts`) — **DONE (slice 3)**
| FE | BE | Bucket | Action |
|---|---|---|---|
| read from store only (no GET) | `GET /alerts?status=&since=` `{data}` | **A** | ✅ `alertsStore.refresh()` hydrates firing + 24h resolved |
| `icon` | — | **A** | ✅ derive from `source` (then `severity`) in `adaptAlerts` |
| `severity` danger/warn | `info/warn/danger` | **A** | handle `info` |
| `anchor.serverId` | top-level `serverId` | **A** | read top-level |
| `source/status/raisedAt/escalated/attempts/resolution/resolvedAt` | same | **A** | passthrough |
| `prompt`, `autoResolves` | — (mock-only) | **D** | drop |

### Library (`LibraryPage`, `GamePage`, `InstallModal`)
| FE | BE | Bucket | Action |
|---|---|---|---|
| `id`, `name` | `id`, `name` | **A** | passthrough |
| `category` | `type` (native/container) | **A** | relabel (type badge) |
| `ports`, `steamAppId*` | same | **A** | surface |
| `players` (string) | `specs.maxPlayers` (null) | **C** | metadata curation upstream; `—` now |
| `addedAt`, `hosts[]` | — | **D** | drop / FE registry |
| `cover`/`art` | `cover` reserved null | **D** | FE gradient fallback |

### Me / Auth (`LoginPage`, persona/tier)
| FE | BE | Bucket | Action |
|---|---|---|---|
| tier from callback | `GET /me {user,tier,scopes}` | **A** | wire `/me` for tier |
| callback `user_id` | `userId` | **A** | rename |
| no refresh store | `refresh` JWT + `POST /auth/session/refresh` (bearer) | **A** | add refresh-token store |
| `?host=&prompt=` callback | real `start`→`callback?code=&state=` | **A** | replace flow |

### Whole-surface gaps (no current backend source — call out, don't bury)
| Surface | Needs | Bucket | Note |
|---|---|---|---|
| `PerformanceTab` / `TimeSeriesChart` | metrics **history** | **C** (big) | BE emits point-in-time (`metrics.tick`, `Server.metrics`) only. Options: FE accumulates the live stream into a session-local ring (B-ish, no cold history), or BE/monitor add a history store (C). |
| `PlayersTab` | player roster + per-player ping/playtime | **C** | presence mid-build (`player.join/leave` audit exist; no roster/count). |
| `ConsolePanel`/`LogConsole` | console stream topic | **C** | no WS topic; degrade to "unavailable." |
| `BackupsList` | backup list + restore command | **C** | only `backup.*` audit; no list/command API. |
| `FileBrowser`, `ServerSettings`/`SettingsPage` | config/file read+write API | **C** | no `/settings`, no config endpoint. |
| `ChatPage` (assistant) | `POST /assistant/turn` SSE | **A** | endpoint exists; FE calls wrong route/shape — rewrite through seam. |
| `DiscordPage`/integrations | `/integrations` (built) | **A** | ⚠ live `GET /integrations` → **500** (§7b) — fix DB first. |

## 10. Per-surface rollup (what unblocks each screen)

Cheap-wins-first falls out of the buckets above:

- **Servers list + Server detail** — read path + game-name resolve + runtime chip **DONE** (slice 2a). Remaining A: job-derived status (→ slice 5/3), server-ports card (→ slice 6, needs detail-GET wired).
- **Dashboard** — **wire-able now** (A: servers/hosts/library/audit rollups). `ping_ms` = B (client RTT); `region` = D.
- **Audit / Alerts / Library** — **DONE (slice 3, 2026-06-21).** Dev DB recreated → the audit/integrations 500s are cleared; audit + library live-verified; alerts now hydrate from `GET /alerts` (firing + 24h resolved) with a derived display icon. Remaining (later slices): audit keyset paging + `audit.append` live-prepend; the live `alerts` WS push (realtime, slice 5).
- **Auth / Me** — **DONE** (slices 4 + 4b): `/me`-driven per-host tier ungates fleet/dashboard; bearer injected when held; OAuth **fragment handoff** built across kgsm-api + kgsm-web (mechanically verified). **Owed:** one manual browser login; refresh-token *rotation* (15-min sessions until then); multi-host token routing.
- **Diagnostics (host)** — **half A (done), half B**: the per-core/load/swap/disk-fs/IO/iface/hostname/uptime block is **additive kgsm-api work against the existing monitor Snapshot** — the highest-value enrichment. The rest (sensors, processes, cpu model, device/smart, iface ip/mac) is **C** (monitor slices) → honest-unknown until then.
- **Performance** — **C (big)**: needs metrics history. Decide FE-accumulate vs BE-store before building.
- **Players** — **C**: gated on presence tracking (actively being built upstream).
- **Console / Backups / Files / Settings** — **C/deferred**: no API; degrade to honest-unavailable.
- **Assistant chat** — **A** rewrite onto `/assistant/turn` SSE.
- **Integrations** — **A**, 500-blocked.

**Suggested order** (each is a clean component-by-component slice): finish the
Server/Dashboard **A** remaps → **Auth/Me** (unblocks gated surfaces) → recreate the
backend DB to clear the two 500s → **Audit/Alerts/Library** reads → **Diagnostics
B-enrichment** (the monitor-Snapshot exposure, biggest payoff) → realtime WS →
commands/ports → assistant → presence/performance/console as their sources land.
