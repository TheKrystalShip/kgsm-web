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
| — (FE doesn't call) | `GET /api/v1/alerts?status=&since=` → `{data:[Alert]}` | ➕ | FE seeds alerts from fixtures + stream only; needs an initial GET for the firing set |
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
- **`GET /api/v1/audit` → HTTP 500** (`internal_error`) on every variant (no params,
  `?limit`, `?severity`, `?serverId`). The query code (`AuditQueries.PageAsync`) is
  correct, so this is a **runtime** failure on the running instance — most likely the
  documented `EnsureCreated` stale-DB drift (kgsm-api CLAUDE.md gotcha: a schema change
  no-ops on an existing DB → the `AuditEntry` table/columns are out of date → queries 500).
  Fix = recreate the dev DB on the backend (not a kgsm-web change). Confirm from the
  kgsm-api journal. Blocks the audit read slice (the FE already degrades: error→empty, no crash).
- **`GET /api/v1/integrations` → HTTP 500** (`internal_error`). Same shape (admin-gated;
  reached here under auth-disabled). Likely the same DB-state cause; confirm from the
  journal. Blocks the integrations slice.
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

1. **Transport + adapter scaffold** — real `fetch` client behind the `api` seam,
   reads `VITE_API_BASE`+`/api/v1`, unwraps the error envelope; mock stays the
   no-base fallback. An `adapters/` module: BE DTO → FE shape, one mapper per resource.
2. **Slice 1 (read-only): hosts + servers** — wire `hostsStore`/`serversStore` GETs
   through the adapter; status-vocab remap; honest-unknown rendering. Verify against
   a live single host with auth disabled.
3. **Slice 2: audit + library + alerts (GET)** — unwrap `{data}`, wire filters,
   tolerate unknown enums.
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
