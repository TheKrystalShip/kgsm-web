import { anchorNamesTheFleet } from "./anchor.js";
import { CONNECTIONS, REGISTRY_KEY, homeConn, originOfHost } from "./config.js";
import { claimsOf, createClient, originOf, renew } from "./oidc.js";
import { readProvider, writeProvider } from "./provider.js";
import { createStore } from "@thekrystalship/krystal-ui/lib/store";
import { hostsStore } from "./stores.js";

// sessionStore.js — one session, for the whole cluster.
//
// ── What a session is ───────────────────────────────────────────────────────
// An account belongs to the cluster and so does the session it opens. The cluster's sign-in provider
// — the auth anchor, on its own origin — mints it, and this panel is a public OpenID Connect client
// of it (`oidc.js`): a round trip to the provider's pages signs somebody in, and the refresh grant
// renews the session without a page. Every member accepts the session by verifying the provider's
// signature against the key it publishes and resolves what the person may do from its own replica of
// the account store. So there is one token and one record here, and no member ever issues this
// browser a credential or extends one. The token proves who somebody is and nothing more: what they
// may do is each member's `/me/access` answer (`stores/access.js`).
//
// ── The API is the authority ────────────────────────────────────────────────
// The client does not predict expiry. It spends the token it holds and lets a refusal be the answer:
//   • rotate()    — renew at the provider through the refresh grant
//   • authorize() — ensure a live session exists (renew, or run open against an auth-disabled host)
//
// ── A member's refusal is not proof the session is bad ──────────────────────
// The two refusals a member can give are not the same claim.
//
// A member answers 403 when the token validated perfectly and the person then was not allowed what
// they asked — which, for an account its replica does not carry yet, is everything. That is always a
// statement about that member's view of this person, and a member that has just joined gives it as
// a matter of course. It says nothing whatever about the session.
//
// A member answers 401 when the token itself did not validate: signature, audience, issuer, expiry,
// or a session it has been told is ended. That one genuinely could be either — a session that has
// ended, or a member that has not yet heard which key and issuer to check against. Renewing tells
// them apart, because a member still refusing a FRESH session is not describing the session.
//
// So the session's health and a node's acceptance are separate facts. The session is renewed at the
// provider; a node still refusing after a successful renewal is recorded as refusing, and the
// surfaces that name a node say so about THAT NODE. `nodes` below is that record — not a map of
// sessions, since there is one, but of who is currently honouring it.
//
// Status:
//   none          nothing held; the gate is showing
//   bootstrapping an open-host probe is in flight
//   live          a bearer is held (or the host runs open) — calls allowed
//   expired       the session could not be renewed, or there was nowhere to renew it
//   denied        the cluster grants this account nothing — terminal, never auto-retried

  // Where the provider sends a browser back to with its code. A path of its own rather than a hash
  // route, because the provider matches the address exactly and the router's hash is the panel's.
  const LANDING_PATH = "/signed-in";

  const store = createStore({ session: null, nodes: {} });

  let inflight = null;   // the one in-flight renewal; concurrent callers share it
  let held = false;      // a stored session exists that the refresh grant can renew

  const rec = () => store.getState().session;
  const statusOf = () => (rec() ? rec().status : "none");
  const isLive = () => statusOf() === "live";
  const isDenied = () => statusOf() === "denied";
  // Where the account stands: active, pending (awaiting approval), or unknown (nothing here has an
  // account for this session). Null with no session.
  const accountOf = () => { const r = rec(); return r ? (r.account || "unknown") : null; };
  // The live bearer. Null unless one is actually held — a host running open is `live` with no token.
  const tokenOf = () => { const r = rec(); return r && r.status === "live" ? (r.token || null) : null; };

  // Renew BEFORE the two calls that cannot be replayed (the SSE turn, the single-use blueprint
  // finalize). Everything else stays reactive.
  function accessTokenLapsed() {
    const tok = tokenOf();
    if (!tok) return false;
    const claims = claimsOf(tok);
    const expMs = claims && typeof claims.exp === "number" ? claims.exp * 1000 : null;
    return expMs != null && Date.now() >= expMs - 30000;
  }

  function setRec(partial) {
    store.setState(s => ({ ...s, session: { ...(s.session || {}), ...partial } }));
    syncReauthSurfacing();
    return rec();
  }

  // ---- reauthDue: the SURFACING gate for `expired` ------------------------
  // An access token lives fifteen minutes, so an open panel passes through `expired` four times an
  // hour and is back to `live` one renewal later. The status is instantaneous and true, which the
  // seam needs; a surface that ASKS somebody to sign in again must not appear for a round trip. Only
  // a session that stays expired past this window is one the renewal did not heal.
  const REAUTH_SURFACE_MS = 30000;
  let surfaceTimer = null;

  function clearSurfaceTimer() { if (surfaceTimer) { clearTimeout(surfaceTimer); surfaceTimer = null; } }
  function setReauthDue(due) {
    const r = rec();
    if (!r || !!r.reauthDue === due) return;
    store.setState(s => (s.session ? { ...s, session: { ...s.session, reauthDue: due } } : s));
  }
  function syncReauthSurfacing() {
    const status = statusOf();
    if (status === "bootstrapping") return;
    if (status !== "expired") { clearSurfaceTimer(); setReauthDue(false); return; }
    const r = rec();
    if ((r && r.reauthDue) || surfaceTimer) return;
    surfaceTimer = setTimeout(() => {
      surfaceTimer = null;
      if (statusOf() === "live" || statusOf() === "denied") return;
      setReauthDue(true);
    }, REAUTH_SURFACE_MS);
  }

  // ---- the provider -------------------------------------------------------
  // One client per issuer, built when first needed. The issuer is the stored fact provider.js holds;
  // a different one is a different cluster, and the client is rebuilt for it.
  let client = null;
  let clientIssuer = "";
  function clientFor() {
    const p = readProvider();
    if (!p) return null;
    if (!client || clientIssuer !== p.issuer) {
      client = createClient({ issuer: p.issuer, redirectPath: LANDING_PATH, postLogoutPath: "/", prefix: "krystal:oidc:" });
      clientIssuer = p.issuer;
    }
    return client;
  }

  // Where the cluster's accounts are administered: the provider's own origin, which serves the account
  // API beside the pages. Empty with no provider known.
  const anchorOrigin = () => { const p = readProvider(); return p ? originOf(p.issuer) : ""; };
  async function resolveAnchor() { return anchorOrigin(); }

  // Record which provider this panel signs in at, as `discoverProvider` found it. A browser that
  // drove a cluster under an older build still holds a node list, and dropping it here is what stops
  // one surviving the roster that no longer names it.
  function setProvider(found) {
    writeProvider(found && found.issuer ? { issuer: found.issuer, via: found.via || null } : null);
    client = null;
    clientIssuer = "";
    writeRegistry([]);
  }

  // The account page, where everything about a person's own credentials is changed.
  const accountPage = () => { const o = anchorOrigin(); return o ? o + "/account" : ""; };

  // ---- the nodes this browser drives --------------------------------------
  // Addresses, never identity: one session is presented to all of them. WHERE the list comes from is
  // the cluster's answer. Named by the provider, it is held in memory for the life of the page and
  // nowhere else — asked again on the next load, so a node the cluster no longer names cannot
  // outlive the roster that named it. A host run open is the one address somebody typed, and storage
  // is exactly where that belongs.
  function readRegistry() {
    if (anchorNamesTheFleet()) {
      return CONNECTIONS.filter(c => c && c.url).map(c => ({ id: c.id || null, url: c.url, name: c.name || c.id || c.url }));
    }
    try { return JSON.parse(localStorage.getItem(REGISTRY_KEY) || "[]"); } catch { return []; }
  }
  function writeRegistry(list) {
    try {
      if (list.length && anchorNamesTheFleet()) return;
      localStorage.setItem(REGISTRY_KEY, JSON.stringify(list));
    } catch { /* private mode */ }
  }
  function register(host) {
    const url = host.url || originOfHost(host.id);
    if (!url || !/^https?:\/\//i.test(url)) return;
    const list = readRegistry().filter(h => h.id !== host.id);
    list.push({ id: host.id, url, name: host.name || host.label || host.id });
    writeRegistry(list);
  }

  // ---- per-node acceptance ------------------------------------------------
  // Who is currently honouring the one session. Written by the seam, read by the surfaces that name
  // a node. `refusing` is a fact about that member and carries WHICH refusal it gave:
  // `unknown_here` for a 403 (it knows the token, not the person) and `unverified_here` for a 401
  // that survived a renewal (it could not check the token at all). Both clear the moment the member
  // answers, and a renewed session clears every one of them, since none of them were about it.
  function nodeAccepts(id) { const n = store.getState().nodes[id]; return !n || n.accepts === "ok"; }
  function nodeRefusal(id) { const n = store.getState().nodes[id]; return n && n.accepts === "refusing" ? n : null; }
  function markNode(id, accepts, reason) {
    if (!id) return;
    store.setState(s => {
      const cur = s.nodes[id];
      if (cur && cur.accepts === accepts && cur.reason === reason) return s;
      return { ...s, nodes: { ...s.nodes, [id]: { accepts, reason: reason || null } } };
    });
  }
  function forgetNode(id) {
    if (!id) return;
    store.setState(s => {
      if (!(id in s.nodes)) return s;
      const nodes = { ...s.nodes };
      delete nodes[id];
      return { ...s, nodes };
    });
  }

  // ---- adopting what the provider issued ----------------------------------
  // An account that reaches here is active — the provider hands no code to one awaiting approval.
  function adoptUser(user) {
    held = !!user.refresh_token;
    setRec({
      status: "live", token: user.access_token,
      account: "active", open: false, error: null,
    });
    store.setState(s => ({ ...s, nodes: {} }));   // a new session; nobody has refused it yet
    return rec();
  }

  // Send the browser to the provider to sign in, carrying where it should come back to. Resolves
  // false when there is no provider to send it to; otherwise the page is leaving.
  async function signIn(back) {
    const c = clientFor();
    if (!c) return false;
    await c.signinRedirect({ state: { back: back || "" } });
    return true;
  }

  // Whether this page is the provider sending a browser back with its code.
  const isLanding = () => typeof window !== "undefined" && window.location.pathname === LANDING_PATH;

  // Exchange the code the provider sent back for a session. `{ok, back}` names the route the browser
  // left from; a refusal names the provider's own error code, so the gate can say which it was.
  async function completeSignIn() {
    const c = clientFor();
    if (!c) return { ok: false, error: "no_provider" };
    try {
      const user = await c.signinRedirectCallback();
      adoptUser(user);
      return { ok: true, back: (user.state && user.state.back) || "" };
    } catch (err) {
      return { ok: false, error: (err && err.error) || "sign_in_failed" };
    }
  }

  // ---- rotate (the provider's alone) --------------------------------------
  // The only renewal path there is. Reactive: called when a call is refused, or before one of the
  // two calls that cannot be replayed. Concurrent callers share one renewal, so a fan-out of refusals
  // spends the refresh token once — spending it twice is a replay, which the provider refuses for the
  // same reason it refuses a stolen token.
  function rotate() {
    const r = rec();
    if (r && r.status === "denied") return Promise.resolve("denied");
    if (r && r.open) return Promise.resolve("live");          // an open host has nothing to renew
    if (inflight) return inflight;
    const c = clientFor();
    if (!c || !held) { setRec({ status: "expired", token: null, error: "login_required" }); return Promise.resolve("expired"); }

    const p = renew(c).then((res) => {
      if (res.ok) { adoptUser(res.user); return "live"; }
      // An unreachable provider and a refused refresh are kept apart: one is a cluster this browser
      // cannot currently reach, the other is a session that has ended.
      if (res.ended) { held = false; setRec({ status: "expired", token: null, error: "login_required" }); return "expired"; }
      setRec({ status: "expired", error: "anchor_unreachable" });
      return "expired";
    });

    inflight = p;
    const done = () => { if (inflight === p) inflight = null; };
    p.then(done, done);
    return p;
  }

  // ---- open hosts (auth disabled) -----------------------------------------
  // A host running with auth switched off answers `/me` to an anonymous caller. That is a whole
  // deployment's posture rather than a per-node one, so it is resolved once against the node serving
  // the panel and the session runs tokenless.
  function bootstrapOpen() {
    const conn = homeConn();
    if (!conn) { setRec({ status: "expired", error: "login_required" }); return Promise.resolve("expired"); }
    setRec({ status: "bootstrapping", error: null });
    return fetch(conn.url + "/api/v1/me", { headers: { Accept: "application/json" } }).then(
      res => {
        if (!res.ok) { setRec({ status: "expired", error: "login_required" }); return "expired"; }
        return res.json().then(me => {
          setRec({
            status: "live", token: null, open: true,
            account: (me && me.status) || "unknown", error: null,
          });
          return "live";
        });
      },
      () => { setRec({ status: "expired", error: "unreachable" }); return "expired"; },
    );
  }

  // ---- authorize (ensure a live session) ----------------------------------
  // The seam's entry point. A live session returns without touching the network — no proactive
  // renewal; a lapsed token is renewed only once something is refused.
  function authorize() {
    const st = statusOf();
    if (st === "live") return Promise.resolve("live");
    if (st === "denied") return Promise.resolve("denied");
    if (inflight) return inflight;
    if (held) return rotate();
    // Nothing held. Either this is an open host, or nobody has signed in — and the second is the
    // gate's business rather than something to heal here.
    if (readProvider()) { setRec({ status: "expired", error: "login_required" }); return Promise.resolve("expired"); }
    return bootstrapOpen();
  }

  // Expiry-AWARE, for the two calls that cannot be replayed through the refusal path.
  function authorizeFresh() {
    const st = statusOf();
    if (st === "live") return accessTokenLapsed() ? rotate() : Promise.resolve("live");
    if (st === "denied") return Promise.resolve("denied");
    return authorize();
  }

  function reauthorize() { return rotate(); }
  function needsReauth() { const r = rec(); return !!(r && r.reauthDue); }

  // ---- a member stating where this account stands, live -------------------
  // A member pushes the account's status on the `me` topic when it changes — approved, switched off —
  // and the push is that member re-reading its replica of the one account, so it is written as given.
  // A member with no account for this person has said nothing about the account: its replica may not
  // have caught up, and that is its refusal to record, not the account's standing.
  function applyMePatch(patch) {
    if (!patch || !patch.status || patch.status === "unknown") return;
    setRec({ account: patch.status });
  }

  // Mark the session lapsed. The seam calls this on a refusal it is about to heal.
  function expire() { setRec({ status: "expired", error: "expired" }); }

  // The cluster grants this account nothing. Terminal — signing in again changes nothing, and
  // retrying would loop.
  function deny(reason) { setRec({ status: "denied", error: reason || "forbidden" }); }

  function drop() {
    clearSurfaceTimer();
    held = false;
    if (client) client.removeUser().catch(() => {});
    store.setState({ session: null, nodes: {} });
  }

  // Sign out of the cluster, at the provider. Its end-session endpoint ends the provider's own
  // session and every session minted under it, announces that to every member — which is what stops
  // the access bearer still in this tab being spent on them for the rest of its life — and sends the
  // browser back here. Resolves true while the page is leaving for it; false when there was no
  // session to end there, and the local drop was all there was to do.
  async function signOut() {
    const c = clientFor();
    const user = c ? await c.getUser().catch(() => null) : null;
    drop();
    if (!c || !user || !user.id_token) return false;
    try { await c.signoutRedirect({ id_token_hint: user.id_token }); return true; }
    catch { return false; }
  }

  // Every node forgotten as well — the panel drops back to having no cluster to drive.
  function forgetHosts() {
    writeRegistry([]);
    store.setState(s => ({ ...s, nodes: {} }));
    hostsStore.setState(s => ({ ...s, list: [] }));
  }

  // ---- init ---------------------------------------------------------------
  // Restore the stored session before the app mounts, so the gate knows on its first render whether
  // this browser holds one. A session whose access token has lapsed is held rather than live: the
  // first call renews it, and nobody is asked anything.
  async function restore() {
    const c = clientFor();
    if (!c) return statusOf();
    const user = await c.getUser().catch(() => null);
    if (!user) return statusOf();
    if (!user.expired) { adoptUser(user); return "live"; }
    held = !!user.refresh_token;
    if (held) setRec({ status: "expired", token: null, account: "active", error: "expired" });
    return statusOf();
  }

  store.statusOf = statusOf;
  store.isDenied = isDenied;
  store.isLive = isLive;
  store.accountOf = accountOf;
  store.tokenOf = tokenOf;
  store.rotate = rotate;
  store.authorize = authorize;
  store.authorizeFresh = authorizeFresh;
  store.reauthorize = reauthorize;
  store.needsReauth = needsReauth;
  store.register = register;
  store.readRegistry = readRegistry;
  store.expire = expire;
  store.deny = deny;
  store.drop = drop;
  store.applyMePatch = applyMePatch;
  store.signIn = signIn;
  store.isLanding = isLanding;
  store.completeSignIn = completeSignIn;
  store.signOut = signOut;
  store.restore = restore;
  store.forgetHosts = forgetHosts;
  store.nodeAccepts = nodeAccepts;
  store.nodeRefusal = nodeRefusal;
  store.markNode = markNode;
  store.forgetNode = forgetNode;
  store.anchorOrigin = anchorOrigin;
  store.accountPage = accountPage;
  store.setProvider = setProvider;
  store.provider = readProvider;
  store.resolveAnchor = resolveAnchor;

  const sessionStore = store;

  // The `me` topic is this store's live half: a member's own re-statement of where the account behind
  // this session stands. A global topic on the primary stream, so subscribing costs a listener and no socket,
  // and a member delivers the frame only to this account's connections — one that arrives is about
  // the reader. Started with the rest of the data layer rather than at import, so a browser on its
  // way to the provider opens nothing.
  let unsubscribeMe = null;
  store.startBootstrap = () => {
    if (unsubscribeMe) return;
    import("./apiClient.js").then(({ api }) => {
      if (unsubscribeMe) return;
      unsubscribeMe = api.stream.subscribe(["me"], (m) => {
        if (m && m.type === "me.patch" && m.data) applyMePatch(m.data);
      });
    }).catch(() => { /* the stream is an enhancement; gating reads the record */ });
  };
  store.stopBootstrap = () => {
    if (!unsubscribeMe) return;
    unsubscribeMe();
    unsubscribeMe = null;
  };

// ---- the cluster session, as something a call can be authorized BY ---------
// The pair `authorizedFetch` spends. It is exported instead of the token because a token cannot be
// replaced by whoever holds it: a function handed one can only spend it and report the refusal,
// which is how a call comes to be made with a bearer that died while a tab sat idle. Handed this,
// the same function renews and asks again without knowing anything about sessions.
//
// `rotate` collapses onto the one in-flight renewal, which is what lets a fan-out of refused calls
// share a single spend of the refresh token.
const clusterCredential = {
  get: () => sessionStore.tokenOf(),
  rotate: async () => ((await sessionStore.rotate()) === "live" ? sessionStore.tokenOf() : null),
};

export { clusterCredential, sessionStore };
