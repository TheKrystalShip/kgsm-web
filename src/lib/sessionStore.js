import { api } from "./apiClient.js";
import { takePendingTokens } from "./authRedirect.js";
import { REGISTRY_KEY, apiOriginOf } from "./config.js";
import { createStore } from "./store.js";
import { hostsStore, selectedHostStore } from "./stores.js";

// sessionStore.js — per-host identity sessions (Model A: per-host auth-code
// flow + silent SSO). See architecture.html §6·a.
//
// ── Session model: the API is the authority ─────────────────────────────────
// The client does NOT predict token expiry. It uses whatever access token it
// holds and lets the API be the judge. The whole freshness story is two moves:
//   • rotate()   — exchange the long-lived refresh token for a fresh access token
//   • authorize()— ensure a live session exists (rotate, or bootstrap via /me)
// REST heals reactively: a 401 RESPONSE (apiClient's withRetry) → rotate → replay.
// The ONE exception is the WebSocket — a browser hides a WS-handshake 401 as an
// opaque 1006 close, so the socket can't heal on rejection. For it, and only it,
// we read the access token's OWN `exp` claim (tokenExpired) right before dialing
// and rotate a lapsed token first. There is NO proactive timer, NO clock-skew
// margin, and NO separately-tracked expiry field — those shadow mechanisms are
// exactly what kept drifting out of sync with the real token and 401-looping the
// socket. One token, one refresh credential, rotate on rejection.
//
// The Discord LOGIN is GLOBAL — one live session at discord.com, the SSO anchor.
// Each HOST then mints its OWN short-lived, host-scoped bearer after verifying
// that identity once (/users/@me, then the token is discarded) and resolving the
// user's role via the host's own bot. This store holds those per-host sessions.
//
// Storage:
//   • ACCESS token  → sessionStorage, per host. Short-lived; survives an in-tab
//              reload, gone on tab close.
//   • REFRESH token → localStorage, per host. The long-lived (weeks) "stay signed
//              in" credential — it MUST survive a browser close so a user returning
//              days later silently rotates a fresh access token instead of re-doing
//              Discord (user directive 2026-06-23: trusted, role-restricted friends
//              group → convenience > a strict refresh window). Cleared on explicit
//              sign-out (signOut / forgetHosts). The access token still never
//              leaves sessionStorage.
//   • host URL registry → localStorage (URLs only) so a reload re-bootstraps
//              silently against the hosts you already added.
//
// Status per host:
//   none          never bootstrapped on this host
//   bootstrapping the silent (or interactive) authorize is in flight
//   live          we hold a bearer (or the host is auth-disabled) — calls allowed
//   expired       the bearer lapsed and could NOT be silently rotated — the UI
//                 offers Re-authorize (NOT terminal)
//   denied        identity verified but role insufficient on this host (403) —
//                 TERMINAL. Never auto-re-auth (that would loop forever).

  const TOKEN_PREFIX = "krystal:hostsession:";    // sessionStorage (access token + meta)
  const REFRESH_PREFIX = "krystal:hostrefresh:";  // localStorage (long-lived refresh token)
  // REGISTRY_KEY (localStorage, URLs only) is owned by config.js — the base layer
  // reads it to derive the connection set; we write it on connect/forget.

  const store = createStore({ byHost: {} });

  const inflight = {};   // hostId → in-flight authorize/rotate (dedupe concurrent gate/boot calls)
  const getRec = (id) => store.getState().byHost[id] || null;
  const statusOf = (id) => (getRec(id) ? getRec(id).status : "none");
  const isDenied = (id) => statusOf(id) === "denied";
  const isLive = (id) => statusOf(id) === "live";
  const tierOf = (id) => { const r = getRec(id); return r ? r.tier : null; };
  // The live bearer for a host (the seam injects it on every call). Null unless we
  // actually hold one — auth-disabled hosts are "live" with no token.
  const tokenOf = (id) => { const r = getRec(id); return r && r.status === "live" ? (r.token || null) : null; };

  // The access token IS a JWT and its `exp` claim is EXACTLY what the API
  // validates (the 401 quotes it verbatim: `invalid_token, "token expired at ..."`),
  // so the token is its own authority on expiry — we read it rather than track a
  // shadow field that can drift. Used ONLY for the WebSocket pre-dial rotate and the
  // persisted-session read-back; REST never checks it (it heals reactively on a 401).
  // Returns null for a non-JWT / absent token (then the API stays the final judge).
  function tokenExpMs(token) {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;
    try {
      let b = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      b += "=".repeat((4 - (b.length % 4)) % 4);
      // base64url → UTF-8 (JWT claims may carry a unicode display name).
      const json = decodeURIComponent(
        Array.prototype.map.call(atob(b), c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
      );
      const payload = JSON.parse(json);
      return typeof payload.exp === "number" ? payload.exp * 1000 : null;
    } catch (e) { return null; }
  }
  // Does this host hold a live access token whose OWN exp has passed? The WS
  // pre-dial gate. A token we can't decode reads as NOT-expired — we dial and let
  // the API be the final judge rather than refuse to connect.
  function tokenExpired(id) {
    const exp = tokenExpMs(tokenOf(id));
    return !!(exp && Date.now() >= exp);
  }

  function setRec(id, partial, persist) {
    store.setState(s => ({ byHost: { ...s.byHost, [id]: { ...(s.byHost[id] || {}), ...partial } } }));
    if (persist) writeSession(id);
    return getRec(id);
  }

  // ---- sessionStorage (access token) -------------------------------------
  function writeSession(id) {
    const r = getRec(id);
    try {
      if (!r || (r.status !== "live" && r.status !== "denied")) { sessionStorage.removeItem(TOKEN_PREFIX + id); return; }
      // Persist only what a tab-reload needs to resume without a re-bounce. No exp
      // field — the token carries its own; a shadow copy is the drift footgun.
      sessionStorage.setItem(TOKEN_PREFIX + id, JSON.stringify({
        status: r.status, tier: r.tier || null, token: r.token || null,
      }));
    } catch (e) {}
  }
  function readSession(id) {
    try {
      const raw = sessionStorage.getItem(TOKEN_PREFIX + id);
      if (!raw) return null;
      const r = JSON.parse(raw);
      // A persisted-but-lapsed access token reads back as 'expired' — judged by the
      // token's OWN exp — so the next use rotates instead of resuming a dead bearer.
      if (r.status === "live" && r.token) {
        const exp = tokenExpMs(r.token);
        if (exp && Date.now() >= exp) r.status = "expired";
      }
      return r;
    } catch (e) { return null; }
  }
  function forgetSession(id) { try { sessionStorage.removeItem(TOKEN_PREFIX + id); } catch (e) {} forgetRefresh(id); }

  // ---- refresh token (localStorage — survives a browser close) -----------
  // The long-lived credential. Stored ONLY here (never in the sessionStorage
  // record's persisted shape), read by rotate() to exchange for an access token.
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
    // The registry stores the CONNECTION ORIGIN we actually reach this host at — an
    // explicit url if the caller has one, else the origin we're ALREADY talking to it
    // on (apiOriginOf). NEVER the backend's self-reported hostname/id (not a reachable
    // URL). No real origin ⇒ don't write.
    const url = host.url || apiOriginOf(host.id);
    if (!url || !/^https?:\/\//i.test(url)) return;
    const list = readRegistry().filter(h => h.id !== host.id);
    list.push({ id: host.id, url, name: host.name || host.label || host.id });
    writeRegistry(list);
  }

  // ---- bootstrap (resolve identity + tier from GET /me) ------------------
  // Resolves to 'live' | 'expired'. Adopts a token just handed back by the OAuth
  // fragment redirect (if any), then confirms identity + tier via /me. Auth-disabled
  // hosts answer 200 tier=admin with no token; an auth-enabled host with no bearer
  // answers 401 → 'expired'/login_required and the UI bounces to Discord (the OAuth
  // fragment redirect lands the session back through completeOAuthLogin).
  function bootstrap(id) {
    setRec(id, { status: "bootstrapping", error: null });

    // Adopt a token just handed back by the OAuth fragment redirect, if any, BEFORE
    // /me so the bearer rides the tier call (auth-enabled hosts need it; auth-disabled
    // ignores it).
    const pending = takePendingTokens();
    if (pending && pending.access) {
      writeRefresh(id, pending.refresh || null);   // persist for the days-later rotation
      setRec(id, { status: "live", token: pending.access, refresh: pending.refresh || null, tier: "none", error: null });
    }
    // Privileged, UN-FUNNELED identity probe: pass the bearer we hold explicitly
    // (api.meWith) so liveFetch SKIPS the egress funnel. Routing /me through the funnel
    // would re-enter authorize()→bootstrap and recurse.
    const probe = getRec(id);
    return api.meWith(probe && probe.token, id).then(me => {
      const cur = getRec(id);
      setRec(id, {
        status: "live", tier: (me && me.tier) || "none",
        token: (cur && cur.token) || (me && me.token) || null,
        refresh: (cur && cur.refresh) || null, error: null,
      }, true);
      return "live";
    }, err => {
      const unauth = err && (err.code === 401 || err.status === 401);
      setRec(id, { status: "expired", error: unauth ? "login_required" : "unreachable" });
      return "expired";
    });
  }

  // ---- adopt (a session established OUT of band, e.g. the OAuth landing) --
  // completeOAuthLogin (authRedirect) already exchanged the Discord code → it holds
  // the real bearer + the tier from /me. Set the live session DIRECTLY here —
  // deterministically, before the app mounts — so the first host-scoped call finds
  // status:"live" + a token and never races a second bootstrap. Persists so an in-tab
  // reload resumes with no bounce.
  function adoptSession(id, sess) {
    sess = sess || {};
    writeRefresh(id, sess.refresh || null);
    setRec(id, {
      status: "live", token: sess.token || null, refresh: sess.refresh || null,
      tier: sess.tier || "none", error: null,
    }, true);
    return getRec(id);
  }

  // ---- rotate (exchange the refresh token for a fresh access token) ------
  // The ONLY renewal path. Reactive: called when the API rejects the current token
  // (HTTP 401 → withRetry) or when the WS pre-dial gate finds the token's own exp has
  // passed. The refresh token rides as the bearer (api.refreshSession) — no Discord
  // round-trip. Past the refresh token's absolute cap the backend 401s → we surface
  // 'expired' and the UI offers re-auth. Concurrent callers share ONE in-flight
  // rotation so we mint a single access token, not four.
  function rotate(id) {
    const rec = getRec(id);
    if (!rec || rec.status === "denied") return Promise.resolve(statusOf(id));
    if (inflight[id]) return inflight[id];
    const refreshTok = (rec && rec.refresh) || readRefresh(id);
    // No refresh token to exchange (e.g. an auth-disabled host, or a legacy
    // pre-fix session) — fall back to re-confirming identity via GET /me.
    if (!refreshTok) return bootstrap(id);
    const p = api.refreshSession(id, refreshTok).then(
      res => {
        // tier rides the refresh response so the RETURNING-VISITOR path (cold boot: no
        // in-memory tier after a browser close, /me skipped) still resolves the role
        // for UI gating. Keep any prior tier if the backend omits it, never downgrade.
        const cur = getRec(id);
        const tier = (res && res.tier) || (cur && cur.tier) || "none";
        setRec(id, { status: "live", token: (res && res.token) || null, refresh: refreshTok, tier, error: null }, true);
        return "live";
      },
      () => {
        // Refresh token invalid or past the absolute cap → genuinely expired. Drop
        // the dead credential so we don't retry it; the UI offers re-auth.
        forgetRefresh(id);
        setRec(id, { status: "expired", refresh: null, error: "login_required" });
        return "expired";
      }
    );
    inflight[id] = p;
    p.then(() => { if (inflight[id] === p) delete inflight[id]; }, () => { if (inflight[id] === p) delete inflight[id]; });
    return p;
  }

  // ---- authorize (ensure a live session) ---------------------------------
  // The gate's entry point (apiClient's bearer funnel + boot). SILENT recovery only:
  // if the discord.com SSO anchor is gone, silent SSO answers 'login_required' and we
  // return 'expired' so the seam fails the call and the UI offers Re-authorize (we do
  // NOT auto-escalate to an interactive consent — that needs a user gesture). A live
  // session returns immediately WITHOUT touching the network — no proactive refresh;
  // a lapsed live token is rotated only on the API's 401 (REST) or the WS pre-dial gate.
  function authorize(id) {
    const st = statusOf(id);
    if (st === "live") return Promise.resolve("live");
    if (st === "denied") return Promise.resolve("denied");
    // De-dupe concurrent first-use calls (the boot fan-out + the funnel can hit a host
    // several times at once) onto ONE in-flight bootstrap/rotate. rotate() self-registers
    // in inflight; bootstrap() does not, so we guard either way below.
    if (inflight[id]) return inflight[id];
    // Returning visitor: the access session (sessionStorage) is gone after a browser
    // close, but a long-lived refresh token survives in localStorage. Rotate it into a
    // fresh access token SILENTLY — no Discord bounce, no doomed /me 401.
    let p;
    if (readRefresh(id)) {
      if (!getRec(id)) setRec(id, { status: "bootstrapping" });
      p = rotate(id);
    } else {
      p = bootstrap(id);
    }
    if (!inflight[id]) {
      inflight[id] = p;
      p.then(() => { if (inflight[id] === p) delete inflight[id]; }, () => { if (inflight[id] === p) delete inflight[id]; });
    }
    return p;
  }

  // ---- reauthorize (interactive, gesture-bound — from HostReauthModal) ----
  // The user clicked "Re-authorize". Re-run identity resolution; an auth-enabled host
  // that still 401s drives the UI back to the Discord OAuth bounce.
  function reauthorize(id) { return bootstrap(id); }
  // A host whose session lapsed and could NOT be silently renewed → the UI shows the
  // expired surface + Re-authorize. (denied is terminal and handled apart.)
  function needsReauth(id) { return statusOf(id) === "expired"; }

  // Mark a host's session expired (apiClient's withRetry calls this on a mid-flight
  // 401 before its one silent-rotate replay).
  function expire(id) { setRec(id, { status: "expired", error: "expired" }, true); }

  function forgetHosts() {                           // drop every host → app shows the Add-host intermediate
    Object.keys(store.getState().byHost).forEach(forgetSession);
    writeRegistry([]);
    store.setState({ byHost: {} });
    if (hostsStore) hostsStore.setState(s => ({ ...s, list: [] }));
    if (selectedHostStore) selectedHostStore.set("all");
  }
  // Sign out: drop EVERY per-host credential (access in sessionStorage + the long-lived
  // refresh token in localStorage) so a reload can't silently rotate back in — but KEEP
  // the host registry so the user lands on the host's login, not the add-host screen.
  function signOut() {
    const ids = new Set([
      ...Object.keys(store.getState().byHost),
      ...readRegistry().map(h => h.id).filter(Boolean),
    ]);
    ids.forEach(forgetSession);
    store.setState({ byHost: {} });
  }

  // ---- init: resume persisted sessions for the hosts we know about --------
  // A persisted (in-tab) session resumes with no bounce; otherwise the host is left
  // unbootstrapped and the reactive block below authorizes it from GET /me as the host
  // list hydrates. NEVER fabricate a tier/token from host flags.
  function seed() {
    // Resume persisted sessions for every host known at boot — both the (async-hydrating)
    // host list AND the localStorage registry. The registry carries the stable host id
    // BEFORE the GET /hosts round-trip lands, so a same-origin reload restores its access
    // token + tier IMMEDIATELY (no Viewer flash / no doomed unauthenticated call).
    const ids = new Set([
      ...((hostsStore && hostsStore.getState().list) || []).map(h => h && h.id),
      ...readRegistry().map(h => h && h.id),
    ].filter(Boolean));
    const live = {};
    ids.forEach(id => { const p = readSession(id); if (p) live[id] = p; });
    store.setState({ byHost: live });
  }

  // Public surface.
  store.statusOf = statusOf;
  store.isDenied = isDenied;
  store.isLive = isLive;
  store.tierOf = tierOf;
  store.tokenOf = tokenOf;
  store.tokenExpired = tokenExpired;
  store.bootstrap = bootstrap;
  store.adoptSession = adoptSession;
  store.rotate = rotate;
  store.authorize = authorize;
  store.reauthorize = reauthorize;
  store.needsReauth = needsReauth;
  store.register = register;
  store.readRegistry = readRegistry;
  store.expire = expire;
  store.forgetHosts = forgetHosts;
  store.signOut = signOut;

  const sessionStore = store;
  // Human-readable tier labels, shared by the badge + settings.
  const TIER_LABEL = { admin: "Admin", operator: "Operator", viewer: "Viewer", none: "No role" };

  seed();

  // Authorize each host's tier from GET /me as the host list hydrates. hostsStore loads
  // async, so seed() runs before the host exists — without this the gated surfaces would
  // stay at tier `none` and redirect to the viewer home. Idempotent: only hosts with no
  // session are authorized (authorize flips status off `none` synchronously).
  if (hostsStore) {
    const bootstrapNewHosts = () => {
      (hostsStore.getState().list || []).forEach(h => {
        if (statusOf(h.id) === "none") { register(h); authorize(h.id); }
      });
    };
    hostsStore.subscribe(bootstrapNewHosts);
    bootstrapNewHosts();
  }

export { TIER_LABEL, sessionStore };
