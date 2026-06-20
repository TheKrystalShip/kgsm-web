import { api } from "./apiClient.js";
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
// Storage budget (the lock from the frontend review):
//   • tokens → sessionStorage, keyed per host. Survive an in-tab reload, gone
//              on tab close. Never localStorage, never disk.
//   • host URL registry → localStorage (URLs only, NEVER tokens) so a reload
//              re-bootstraps silently against the hosts you already added.
//
// Status machine per host:
//   none          never bootstrapped on this host
//   bootstrapping the silent (or interactive) authorize bounce is in flight
//   live          valid bearer; calls allowed
//   expired       bearer lapsed (401) — refresh or re-bounce, NOT a dead end
//   denied        identity verified but role insufficient on this host (403) —
//                 TERMINAL. Never auto-re-auth (that would loop forever).

  const TOKEN_PREFIX = "krystal:hostsession:";    // sessionStorage (token + meta)
  const REGISTRY_KEY = "krystal:hosts:registry";   // localStorage (URLs only)

  // TTLs — the real shape from §6·a. `?authdemo=fast` compresses them so the
  // proactive refresh + the 8h cap re-bounce are watchable in seconds.
  const fast = (() => { try { return new URLSearchParams(location.search).get("authdemo") === "fast"; } catch (e) { return false; } })();
  const ACCESS_TTL_MS  = fast ? 8000  : 15 * 60 * 1000;       // access-token life
  const PROACTIVE_AT   = 0.75;                                // refresh at 75% of life
  const SESSION_CAP_MS = fast ? 40000 : 8 * 60 * 60 * 1000;   // absolute cap → silent re-bounce

  // The global SSO anchor. In production this is the implicit discord.com
  // cookie; here it's a flag the login sets and the dev panel can drop to demo
  // the login_required → interactive-fallback path.
  let discordSessionLive = true;

  const store = createStore({ byHost: {} });

  const timers = {};                               // hostId → proactive-refresh timer
  const getRec = (id) => store.getState().byHost[id] || null;
  const statusOf = (id) => (getRec(id) ? getRec(id).status : "none");
  const isDenied = (id) => statusOf(id) === "denied";
  const isLive = (id) => statusOf(id) === "live";
  const tierOf = (id) => { const r = getRec(id); return r ? r.tier : null; };

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
  function forgetSession(id) { try { sessionStorage.removeItem(TOKEN_PREFIX + id); } catch (e) {} clearTimer(id); }

  // ---- host URL registry (localStorage, URLs only) -----------------------
  function readRegistry() {
    try { return JSON.parse(localStorage.getItem(REGISTRY_KEY) || "[]"); } catch (e) { return []; }
  }
  function writeRegistry(list) { try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(list)); } catch (e) {} }
  function register(host) {
    const list = readRegistry().filter(h => h.id !== host.id);
    list.push({ id: host.id, url: host.url || host.hostname || host.id, name: host.name || host.id });
    writeRegistry(list);
  }

  // ---- timers ------------------------------------------------------------
  function clearTimer(id) { if (timers[id]) { clearTimeout(timers[id]); delete timers[id]; } }
  function scheduleRefresh(id) {
    clearTimer(id);
    timers[id] = setTimeout(() => refresh(id), Math.round(ACCESS_TTL_MS * PROACTIVE_AT));
  }

  // ---- bootstrap (the silent / interactive authorize bounce) -------------
  // Resolves to: 'live' | 'denied' | 'login_required' | 'error'. Callers that
  // get 'login_required' fall back to bootstrap({interactive:true}).
  function bootstrap(id, opts) {
    opts = opts || {};
    const interactive = !!opts.interactive;
    setRec(id, { status: "bootstrapping", error: null });

    // Silent SSO needs a live discord.com session. Without one — and without an
    // interactive prompt — the IdP answers login_required.
    if (!discordSessionLive && !interactive) {
      setRec(id, { status: "expired", error: "login_required" });
      return Promise.resolve("login_required");
    }

    // The popup lands on the host's /auth/discord/callback. The host verifies
    // identity once and answers with its bot-resolved verdict + a host token.
    return api.get("/auth/discord/callback?host=" + encodeURIComponent(id) + "&prompt=" + (interactive ? "consent" : "none"))
      .then(res => {
        if (res && res.verdict === "denied") {
          clearTimer(id);
          setRec(id, { status: "denied", tier: "none", token: null, error: "forbidden" }, true);
          return "denied";
        }
        const prev = getRec(id);
        const now = Date.now();
        setRec(id, {
          status: "live", tier: res.tier, token: res.token,
          exp: now + ACCESS_TTL_MS,
          capExp: (prev && prev.capExp) || (now + SESSION_CAP_MS),
          error: null,
        }, true);
        scheduleRefresh(id);
        return "live";
      }, () => { setRec(id, { status: "expired", error: "unreachable" }); return "error"; });
  }

  // ---- refresh (proactive, before the 401) -------------------------------
  // Rotates the host token via POST /auth/session/refresh — no Discord round
  // trip. Past the 8h absolute cap it re-bounces silently instead.
  function refresh(id) {
    const rec = getRec(id);
    if (!rec || rec.status === "denied") return Promise.resolve(statusOf(id));
    if (rec.capExp && Date.now() >= rec.capExp) return bootstrap(id, { interactive: false });
    return api.post("/auth/session/refresh", { host: id })
      .then(res => {
        setRec(id, { status: "live", token: res.token, exp: Date.now() + ACCESS_TTL_MS, error: null }, true);
        scheduleRefresh(id);
        return "live";
      }, () => { setRec(id, { status: "expired", error: "refresh_failed" }); return "expired"; });
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
    return bootstrap(id, { interactive: false });
  }

  // ---- reauthorize (interactive, gesture-bound — from HostReauthModal) ----
  // THIS is the only place an interactive Discord consent is allowed: the user
  // clicked "Re-authorize". The consent popup re-establishes the discord.com SSO
  // anchor, so on success we mark it live again (production: the IdP cookie;
  // here: our flag) — which lets every OTHER lapsed host heal silently on its
  // next call, no second prompt.
  function reauthorize(id) {
    return bootstrap(id, { interactive: true }).then(r => {
      if (r === "live") discordSessionLive = true;
      return r;
    });
  }
  // A host whose session lapsed and could NOT be silently renewed → the UI shows
  // the expired surface + Re-authorize. (denied is terminal and handled apart.)
  function needsReauth(id) { return statusOf(id) === "expired"; }

  // ---- dev / demo levers (driven from the Resilience panel) --------------
  function revoke(id) {                              // simulate role removed on this host → 403
    const h = hostsStore && hostsStore.find(id);
    if (h) hostsStore.update(id, { authDenied: true });
    clearTimer(id);
    setRec(id, { status: "denied", tier: "none", token: null }, true);
  }
  function grant(id) {                               // re-grant the role and re-bootstrap
    const h = hostsStore && hostsStore.find(id);
    if (h) hostsStore.update(id, { authDenied: false });
    return bootstrap(id, { interactive: false });
  }
  function expire(id) { clearTimer(id); setRec(id, { status: "expired", exp: 0, error: "expired" }, true); }
  function dropDiscord() {                           // log out of discord.com → next bounce needs consent
    discordSessionLive = false;
    Object.keys(store.getState().byHost).forEach(id => { if (statusOf(id) === "live") expire(id); });
  }
  function restoreDiscord() { discordSessionLive = true; }
  function discordLive() { return discordSessionLive; }
  function forgetHosts() {                           // drop every host → app shows the Add-host intermediate
    Object.keys(timers).forEach(clearTimer);
    Object.keys(store.getState().byHost).forEach(forgetSession);
    writeRegistry([]);
    store.setState({ byHost: {} });
    if (hostsStore) hostsStore.setState(s => ({ ...s, list: [] }));
    if (selectedHostStore) selectedHostStore.set("all");
  }

  // ---- init: seed sessions for the hosts we know about -------------------
  // A persisted (in-tab) session resumes with no bounce. Otherwise we seed the
  // already-bootstrapped state from the host's flags so the app is usable on
  // first paint (equivalent to "this tab already silently authorized"). A
  // fresh tab with no persisted session would instead lazily bootstrap on first
  // use via ensure().
  function seed() {
    const hosts = (hostsStore && hostsStore.getState().list) || [];
    const byHost = {};
    hosts.forEach(h => {
      const persisted = readSession(h.id);
      if (persisted) { byHost[h.id] = persisted; if (persisted.status === "live") scheduleRefresh(h.id); return; }
      if (h.authDenied) { byHost[h.id] = { status: "denied", tier: "none", token: null }; }
      else {
        const now = Date.now();
        byHost[h.id] = { status: "live", tier: h.tier || "operator", token: "tok_seed_" + h.id, exp: now + ACCESS_TTL_MS, capExp: now + SESSION_CAP_MS };
        scheduleRefresh(h.id);
      }
      register(h);
    });
    store.setState({ byHost });
    Object.keys(byHost).forEach(writeSession);
  }

  // Public surface.
  store.statusOf = statusOf;
  store.isDenied = isDenied;
  store.isLive = isLive;
  store.tierOf = tierOf;
  store.bootstrap = bootstrap;
  store.refresh = refresh;
  store.ensure = ensure;
  store.reauthorize = reauthorize;
  store.needsReauth = needsReauth;
  store.register = register;
  store.readRegistry = readRegistry;
  store.revoke = revoke;
  store.grant = grant;
  store.expire = expire;
  store.dropDiscord = dropDiscord;
  store.restoreDiscord = restoreDiscord;
  store.discordLive = discordLive;
  store.forgetHosts = forgetHosts;
  store.config = { ACCESS_TTL_MS, PROACTIVE_AT, SESSION_CAP_MS, fast };

  const sessionStore = store;
  // Human-readable tier labels, shared by the badge + settings.
  const TIER_LABEL = { admin: "Admin", operator: "Operator", viewer: "Viewer", none: "No role" };

  seed();

export { TIER_LABEL, sessionStore };
