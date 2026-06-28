import { api } from "./apiClient.js";
import { takePendingTokens } from "./authRedirect.js";
import { REGISTRY_KEY, apiOriginOf } from "./config.js";
import { createStore } from "./store.js";
import { hostsStore, selectedHostStore } from "./stores.js";

// sessionStore.js — per-host identity sessions (Model A: per-host auth-code
// flow + silent SSO). See architecture.html §6·a.
//
// The Discord LOGIN is GLOBAL — one live session at discord.com, which is the
// SSO anchor (not a shared token). Each HOST then mints its OWN short-lived,
// host-scoped bearer after verifying that identity once (/users/@me, then the
// token is discarded) and resolving the user's role via the host's own bot.
// This store holds those per-host sessions and runs their lifecycle.
//
// Storage budget:
//   • ACCESS token → sessionStorage, keyed per host. Short-lived (~15 min),
//              survives an in-tab reload, gone on tab close.
//   • REFRESH token → localStorage, keyed per host. The long-lived (weeks)
//              "stay signed in" credential — it MUST survive a browser close so a
//              user returning days later silently rotates a fresh access token
//              instead of re-doing Discord (user directive 2026-06-23: trusted,
//              role-restricted friends group → convenience > a strict refresh
//              window). This is a deliberate exception to the original
//              "tokens never touch localStorage" lock, scoped to the refresh
//              token only; the access token still never leaves sessionStorage.
//              Cleared on explicit sign-out (signOut / forgetHosts).
//   • host URL registry → localStorage (URLs only) so a reload re-bootstraps
//              silently against the hosts you already added.
//
// Status machine per host:
//   none          never bootstrapped on this host
//   bootstrapping the silent (or interactive) authorize bounce is in flight
//   live          valid bearer; calls allowed
//   expired       bearer lapsed (401) — refresh or re-bounce, NOT a dead end
//   denied        identity verified but role insufficient on this host (403) —
//                 TERMINAL. Never auto-re-auth (that would loop forever).

  const TOKEN_PREFIX = "krystal:hostsession:";    // sessionStorage (access token + meta)
  const REFRESH_PREFIX = "krystal:hostrefresh:";  // localStorage (long-lived refresh token)
  // REGISTRY_KEY (localStorage, URLs only) is owned by config.js — the base layer
  // reads it to derive the connection set; we write it on connect/forget.

  // TTLs — must mirror the backend (SessionTokenService). SESSION_CAP_MS = the
  // absolute refresh-token life (kept in sync with the backend's RefreshTtl, now
  // 30 days — see the storage-budget note above).
  const ACCESS_TTL_MS  = 15 * 60 * 1000;            // access-token life
  const PROACTIVE_AT   = 0.75;                       // refresh at 75% of life
  const SESSION_CAP_MS = 30 * 24 * 60 * 60 * 1000;  // absolute cap → silent re-bounce
  // Rotate this long BEFORE the hard expiry so the funnel never hands out a token the backend will
  // reject for skew (mirrors SessionTokenService's 30s ClockSkew). Also covers a slow refresh round-trip.
  const EXPIRY_SKEW_MS = 30 * 1000;

  const store = createStore({ byHost: {} });

  const timers = {};                               // hostId → proactive-refresh timer
  const inflight = {};                              // hostId → in-flight refresh promise (dedupe concurrent gate/boot calls)
  const getRec = (id) => store.getState().byHost[id] || null;
  const statusOf = (id) => (getRec(id) ? getRec(id).status : "none");
  const isDenied = (id) => statusOf(id) === "denied";
  const isLive = (id) => statusOf(id) === "live";
  const tierOf = (id) => { const r = getRec(id); return r ? r.tier : null; };
  // The live bearer for a host (the seam injects it on every call). Null unless
  // we actually hold one — auth-disabled hosts are "live" with no token.
  const tokenOf = (id) => { const r = getRec(id); return r && r.status === "live" ? (r.token || null) : null; };

  function setRec(id, partial, persist) {
    store.setState(s => ({ byHost: { ...s.byHost, [id]: { ...(s.byHost[id] || {}), ...partial } } }));
    if (persist) writeSession(id);
    return getRec(id);
  }

  // ---- sessionStorage (tokens) -------------------------------------------
  function writeSession(id) {
    const r = getRec(id);
    try {
      if (!r || (r.status !== "live" && r.status !== "denied")) { sessionStorage.removeItem(TOKEN_PREFIX + id); return; }
      // Persist only what a tab-reload needs to resume without a re-bounce.
      sessionStorage.setItem(TOKEN_PREFIX + id, JSON.stringify({
        status: r.status, tier: r.tier || null, token: r.token || null, exp: r.exp || 0, capExp: r.capExp || 0,
      }));
    } catch (e) {}
  }
  function readSession(id) {
    try {
      const raw = sessionStorage.getItem(TOKEN_PREFIX + id);
      if (!raw) return null;
      const r = JSON.parse(raw);
      // A persisted-but-lapsed access token reads back as 'expired' so the next
      // call refreshes rather than trusting a dead bearer.
      if (r.status === "live" && r.exp && Date.now() >= r.exp) r.status = "expired";
      return r;
    } catch (e) { return null; }
  }
  function forgetSession(id) { try { sessionStorage.removeItem(TOKEN_PREFIX + id); } catch (e) {} forgetRefresh(id); clearTimer(id); }

  // ---- refresh token (localStorage — survives a browser close) -----------
  // The long-lived credential. Stored ONLY here (never in the sessionStorage
  // record's persisted shape), read by refresh() to rotate the access token.
  function writeRefresh(id, token) {
    try { if (token) localStorage.setItem(REFRESH_PREFIX + id, token); else localStorage.removeItem(REFRESH_PREFIX + id); } catch (e) {}
  }
  function readRefresh(id) { try { return localStorage.getItem(REFRESH_PREFIX + id) || null; } catch (e) { return null; } }
  function forgetRefresh(id) { try { localStorage.removeItem(REFRESH_PREFIX + id); } catch (e) {} }

  // ---- host URL registry (localStorage, URLs only) -----------------------
  function readRegistry() {
    try { return JSON.parse(localStorage.getItem(REGISTRY_KEY) || "[]"); } catch (e) { return []; }
  }
  function writeRegistry(list) { try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(list)); } catch (e) {} }
  function register(host) {
    // The registry stores the CONNECTION ORIGIN we actually reach this host at — an explicit url if
    // the caller has one, else the origin we're ALREADY talking to it on (apiOriginOf, from the seed
    // or a prior registry entry). NEVER the backend's self-reported hostname/id: those aren't
    // reachable URLs (a bare "hotrod" → https://hotrod via originOf), and falling back to them here
    // would clobber a good origin every time GET /hosts reloads. No real origin ⇒ don't write.
    const url = host.url || apiOriginOf(host.id);
    if (!url || !/^https?:\/\//i.test(url)) return;
    const list = readRegistry().filter(h => h.id !== host.id);
    list.push({ id: host.id, url, name: host.name || host.label || host.id });
    writeRegistry(list);
  }

  // ---- timers ------------------------------------------------------------
  function clearTimer(id) { if (timers[id]) { clearTimeout(timers[id]); delete timers[id]; } }
  function scheduleRefresh(id) {
    clearTimer(id);
    const r = getRec(id);
    if (!r || !r.token) return;   // no token (e.g. auth-disabled) → nothing to rotate
    timers[id] = setTimeout(() => refresh(id), Math.round(ACCESS_TTL_MS * PROACTIVE_AT));
  }

  // ---- bootstrap (resolve identity + tier from GET /me) ------------------
  // Resolves to: 'live' | 'denied' | 'login_required' | 'error'. On
  // 'login_required' the UI bounces to the Discord OAuth login (LoginPage /
  // HostReauth) and the session lands back via completeOAuthLogin.
  function bootstrap(id) {
    setRec(id, { status: "bootstrapping", error: null });

    // Identity + tier come from GET /me (the seam injects the bearer when we hold
    // one). Auth-disabled hosts answer 200 tier=admin with no token; an auth-
    // enabled host with no bearer answers 401 → login_required, and the UI bounces
    // to Discord via LoginPage / HostReauth (the OAuth fragment redirect lands the
    // session back through completeOAuthLogin / takePendingTokens).
    //
    // Adopt a token just handed back by the OAuth fragment redirect, if any
    // (single-host: the lone host owns it). Set it BEFORE /me so the bearer rides
    // the tier call (auth-enabled hosts need it; auth-disabled ignores it).
    const pending = takePendingTokens();
    if (pending && pending.access) {
      const t = Date.now();
      writeRefresh(id, pending.refresh || null);   // persist for the days-later rotation
      setRec(id, {
        status: "live", token: pending.access, refresh: pending.refresh || null,
        tier: "none", exp: t + ACCESS_TTL_MS, capExp: t + SESSION_CAP_MS, error: null,
      });
    }
    // Route /me to THIS host (api.get(path, hostId)) — NOT the default connection
    // — so at N≥2 each host's tier resolves from its OWN /me + bearer. Use the
    // low-level get (with the host id), never api.host(id) here: that runs the
    // auth gate, which calls bootstrap → infinite recursion (bootstrap IS the gate).
    // Privileged, UN-FUNNELED identity probe: pass the bearer we hold explicitly (api.meWith) so
    // liveFetch SKIPS the egress funnel. Routing /me through the funnel would re-enter
    // ensureFresh()→ensure()→bootstrap and recurse — exactly why refreshSession is privileged too.
    const probe = getRec(id);
    return api.meWith(probe && probe.token, id).then(me => {
      const now = Date.now();
      const cur = getRec(id);
      setRec(id, {
        status: "live", tier: (me && me.tier) || "none",
        token: (cur && cur.token) || (me && me.token) || null,
        refresh: (cur && cur.refresh) || null,
        exp: now + ACCESS_TTL_MS, capExp: now + SESSION_CAP_MS, error: null,
      }, true);
      scheduleRefresh(id);
      return "live";
    }, err => {
      const unauth = err && (err.code === 401 || err.status === 401);
      setRec(id, { status: "expired", error: unauth ? "login_required" : "unreachable" });
      return unauth ? "login_required" : "error";
    });
  }

  // ---- adopt (a session established OUT of band, e.g. the OAuth landing) --
  // completeOAuthLogin (authRedirect) already exchanged the Discord code → it
  // holds the real bearer + the tier from /me. Set the live session DIRECTLY here
  // — deterministically, before the app mounts — so the first host-scoped call
  // finds status:"live" + a token and never races a second bootstrap onto the
  // one-shot OAuth-token stash. Persists so an in-tab reload resumes with no bounce.
  function adoptSession(id, sess) {
    sess = sess || {};
    const t = Date.now();
    // Persist the refresh token (localStorage) so a return visit days/weeks later
    // rotates a fresh access token with no Discord bounce. capExp is anchored HERE,
    // at login, and never reset by a rotation — the absolute cap is from first login.
    writeRefresh(id, sess.refresh || null);
    setRec(id, {
      status: "live", token: sess.token || null, refresh: sess.refresh || null,
      tier: sess.tier || "none", exp: t + ACCESS_TTL_MS, capExp: t + SESSION_CAP_MS, error: null,
    }, true);
    scheduleRefresh(id);
    return getRec(id);
  }

  // ---- refresh (proactive, before the 401) -------------------------------
  // Rotates the host's ACCESS token via POST /auth/session/refresh (the refresh
  // token rides as the bearer) — no Discord round-trip. Past the refresh token's
  // absolute cap the backend 401s → we surface 'expired' and the UI offers
  // re-auth. Concurrent callers (the boot fan-out hits the gate 4× at once) share
  // ONE in-flight rotation so we mint a single access token, not four.
  function refresh(id) {
    const rec = getRec(id);
    if (!rec || rec.status === "denied") return Promise.resolve(statusOf(id));
    if (inflight[id]) return inflight[id];
    const refreshTok = (rec && rec.refresh) || readRefresh(id);
    // No refresh token to rotate (e.g. an auth-disabled host, or a legacy
    // pre-fix session) — fall back to re-confirming identity via GET /me.
    if (!refreshTok) return bootstrap(id);
    const p = api.refreshSession(id, refreshTok).then(
      res => {
        const now = Date.now();
        // tier rides the refresh response so the RETURNING-VISITOR path (cold boot:
        // no in-memory tier after a browser close, and we skip the /me round-trip)
        // still resolves the role for UI gating. Keep any prior tier if the backend
        // omits it (older api), never silently downgrade to none.
        const cur = getRec(id);
        const tier = (res && res.tier) || (cur && cur.tier) || "none";
        setRec(id, { status: "live", token: (res && res.token) || null, refresh: refreshTok, tier, exp: now + ACCESS_TTL_MS, error: null }, true);
        scheduleRefresh(id);
        return "live";
      },
      () => {
        // Refresh token invalid or past the absolute cap → genuinely expired.
        // Drop the dead credential so we don't retry it; the UI offers re-auth.
        forgetRefresh(id);
        setRec(id, { status: "expired", refresh: null, error: "login_required" });
        return "expired";
      }
    );
    inflight[id] = p;
    p.then(() => { if (inflight[id] === p) delete inflight[id]; }, () => { if (inflight[id] === p) delete inflight[id]; });
    return p;
  }

  // ---- ensure (lazy bootstrap, used by the api seam on first use / 401) ---
  // SILENT recovery only. If the discord.com SSO anchor is gone, silent SSO
  // answers 'login_required' — we do NOT auto-escalate to an interactive consent
  // here (a consent popup needs a user gesture). We return it as-is so the seam
  // fails the call with 401 and the UI offers Re-authorize (HostReauthModal).
  function ensure(id) {
    const st = statusOf(id);
    if (st === "live") return Promise.resolve("live");
    if (st === "denied") return Promise.resolve("denied");
    // De-dupe concurrent first-use calls (the boot fan-out + the funnel can hit a host several times
    // at once) onto ONE in-flight bootstrap/refresh — so the one-shot OAuth-token stash and the /me
    // probe run once, not N times. refresh() self-registers in inflight; bootstrap() does not, so we
    // guard either way below.
    if (inflight[id]) return inflight[id];
    // Returning visitor: the access session (sessionStorage) is gone after a
    // browser close, but a long-lived refresh token survives in localStorage.
    // Rotate it into a fresh access token SILENTLY — no Discord bounce, no doomed
    // /me 401. (A rec must exist for refresh() to run; refresh() reads the token
    // from localStorage via readRefresh when the in-memory rec doesn't carry it.)
    let p;
    if (readRefresh(id)) {
      if (!getRec(id)) setRec(id, { status: "bootstrapping" });
      p = refresh(id);
    } else {
      p = bootstrap(id);
    }
    if (!inflight[id]) {
      inflight[id] = p;
      p.then(() => { if (inflight[id] === p) delete inflight[id]; }, () => { if (inflight[id] === p) delete inflight[id]; });
    }
    return p;
  }

  // ---- ensureFresh (the egress funnel's freshness check) ------------------
  // ensure(), but PROACTIVE about access-token expiry. A host that is nominally "live" can be holding
  // a token that already lapsed: the proactive-refresh setTimeout is throttled/suspended in a
  // backgrounded tab (e.g. while in-game), so it may not have fired — and tokenOf() can't see that (it
  // returns the token without checking exp). So before any request hands out a bearer, rotate it here
  // when it's expired or within the skew margin of expiring. This is what makes ONE funnel enough:
  // every REST call (liveFetch) and every WS (re)connect (liveStream) resolves its bearer through here,
  // so no call site needs its own renewal. Resolves to the same status vocabulary as ensure().
  function ensureFresh(id) {
    const rec = getRec(id);
    if (rec && rec.status === "live" && rec.token && rec.exp && Date.now() >= rec.exp - EXPIRY_SKEW_MS)
      return refresh(id);
    return ensure(id);
  }

  // ---- reauthorize (interactive, gesture-bound — from HostReauthModal) ----
  // The user clicked "Re-authorize". Re-run identity resolution; an auth-enabled
  // host that still 401s drives the UI back to the Discord OAuth bounce.
  function reauthorize(id) {
    return bootstrap(id);
  }
  // A host whose session lapsed and could NOT be silently renewed → the UI shows
  // the expired surface + Re-authorize. (denied is terminal and handled apart.)
  function needsReauth(id) { return statusOf(id) === "expired"; }

  // Mark a host's session expired (the api seam calls this on a mid-flight 401
  // before its one silent-heal retry).
  function expire(id) { clearTimer(id); setRec(id, { status: "expired", exp: 0, error: "expired" }, true); }
  function forgetHosts() {                           // drop every host → app shows the Add-host intermediate
    Object.keys(timers).forEach(clearTimer);
    Object.keys(store.getState().byHost).forEach(forgetSession);
    writeRegistry([]);
    store.setState({ byHost: {} });
    if (hostsStore) hostsStore.setState(s => ({ ...s, list: [] }));
    if (selectedHostStore) selectedHostStore.set("all");
  }
  // Sign out: drop EVERY per-host credential (access in sessionStorage + the
  // long-lived refresh token in localStorage) so a reload can't silently rotate
  // back in — but KEEP the host registry so the user lands on the host's login,
  // not the add-host screen. (forgetSession clears both stores + the timer.)
  function signOut() {
    Object.keys(timers).forEach(clearTimer);
    const ids = new Set([
      ...Object.keys(store.getState().byHost),
      ...readRegistry().map(h => h.id).filter(Boolean),
    ]);
    ids.forEach(forgetSession);
    store.setState({ byHost: {} });
  }

  // ---- init: resume persisted sessions for the hosts we know about --------
  // A persisted (in-tab) session resumes with no bounce; otherwise the host is
  // left unbootstrapped and the reactive block below bootstraps it from GET /me as
  // the host list hydrates. NEVER fabricate a tier/token from host flags.
  function seed() {
    // Resume persisted sessions for every host known at boot — both the (async-hydrating) host
    // list AND the localStorage registry. The registry carries the stable host id BEFORE the
    // GET /hosts round-trip lands, so a same-origin reload restores its access token + tier
    // IMMEDIATELY (no Viewer flash / no doomed unauthenticated call while a refresh round-trips).
    const ids = new Set([
      ...((hostsStore && hostsStore.getState().list) || []).map(h => h && h.id),
      ...readRegistry().map(h => h && h.id),
    ].filter(Boolean));
    const live = {};
    ids.forEach(id => { const p = readSession(id); if (p) { live[id] = p; if (p.status === "live") scheduleRefresh(id); } });
    store.setState({ byHost: live });
  }

  // Public surface.
  store.statusOf = statusOf;
  store.isDenied = isDenied;
  store.isLive = isLive;
  store.tierOf = tierOf;
  store.tokenOf = tokenOf;
  store.bootstrap = bootstrap;
  store.adoptSession = adoptSession;
  store.refresh = refresh;
  store.ensure = ensure;
  store.ensureFresh = ensureFresh;
  store.reauthorize = reauthorize;
  store.needsReauth = needsReauth;
  store.register = register;
  store.readRegistry = readRegistry;
  store.expire = expire;
  store.forgetHosts = forgetHosts;
  store.signOut = signOut;
  store.config = { ACCESS_TTL_MS, PROACTIVE_AT, SESSION_CAP_MS };

  const sessionStore = store;
  // Human-readable tier labels, shared by the badge + settings.
  const TIER_LABEL = { admin: "Admin", operator: "Operator", viewer: "Viewer", none: "No role" };

  seed();

  // Bootstrap each host's tier from GET /me as the host list hydrates. hostsStore
  // loads async, so seed() runs before the host exists — without this the gated
  // surfaces would stay at tier `none` and redirect to the viewer home. Idempotent:
  // only hosts with no session are bootstrapped (bootstrap flips status off `none`
  // synchronously, so none is bootstrapped twice).
  if (hostsStore) {
    const bootstrapNewHosts = () => {
      (hostsStore.getState().list || []).forEach(h => {
        if (statusOf(h.id) === "none") { register(h); ensure(h.id); }
      });
    };
    hostsStore.subscribe(bootstrapNewHosts);
    bootstrapNewHosts();
  }

export { TIER_LABEL, sessionStore };
