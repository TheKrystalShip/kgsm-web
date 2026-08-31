import { anchorNamesTheFleet, refreshSession, rememberDoor, rememberedDoor, signOut as anchorSignOut } from "./anchor.js";
import { CONNECTIONS, REGISTRY_KEY, homeConn, originOfHost } from "./config.js";
import { createStore } from "./store.js";
import { hostsStore } from "./stores.js";

// sessionStore.js — one session, for the whole cluster.
//
// ── What a session is ───────────────────────────────────────────────────────
// An account belongs to the cluster and so does the session it opens. The anchor — the member
// holding the `auth` capability — mints it and is the only thing that renews it; every other member
// accepts it by verifying the anchor's signature against the published key and resolves what the
// person may do from its own replica of the account store. So there is one token, one tier and one
// record here, and no node ever issues this browser a credential or extends one.
//
// That is a rule rather than an implementation detail. A member that could re-mint would be a second
// door to the same session on every machine in the cluster, permanently; the anchor being
// unreachable costs a sign-in and, once the access token lapses, the panel — an outage, and one
// largely shared with the panel's own ingress anyway.
//
// ── The API is the authority ────────────────────────────────────────────────
// The client does not predict expiry. It spends the token it holds and lets a refusal be the answer:
//   • rotate()    — exchange the refresh token at the ANCHOR for a fresh pair
//   • authorize() — ensure a live session exists (rotate, or run open against an auth-disabled host)
//
// ── A member's refusal is not proof the session is bad ──────────────────────
// This does not follow from a per-node model and must not be collapsed back into one, and the two
// refusals a member can give are not the same claim.
//
// A member answers 403 when the token validated perfectly and the person then resolved to a tier
// too low — which, for an account its replica does not carry yet, is `none`. That is always a
// statement about that member's view of this person, and a member that has just joined gives it as
// a matter of course. It says nothing whatever about the session.
//
// A member answers 401 when the token itself did not validate: signature, audience, issuer, expiry,
// or a session it has been told is revoked. That one genuinely could be either — a session that has
// ended, or a member that has not yet heard which key and issuer to check against. Renewing tells
// them apart, because a member still refusing a FRESH session is not describing the session.
//
// Ending the session on either without that test would take the whole panel down over one member
// being new.
//
// So the session's health and a node's acceptance are separate facts. The session is renewed at the
// anchor; a node still refusing after a successful renewal is recorded as refusing, and the surfaces
// that name a node say so about THAT NODE. `nodes` below is that record — not a map of sessions,
// since there is one, but of who is currently honouring it.
//
// Status:
//   none          nothing held; the gate is showing
//   bootstrapping a renewal or an open-host probe is in flight
//   live          a bearer is held (or the host runs open) — calls allowed
//   expired       the refresh token could not be spent, or there was nowhere to spend it
//   denied        the cluster grants this account nothing — terminal, never auto-retried

  const TOKEN_KEY = "krystal:session";     // sessionStorage: access token + meta
  const REFRESH_KEY = "krystal:refresh";   // localStorage: the long-lived credential

  const store = createStore({ session: null, nodes: {} });

  let inflight = null;   // the one in-flight renewal; concurrent callers share it

  const rec = () => store.getState().session;
  const statusOf = () => (rec() ? rec().status : "none");
  const isLive = () => statusOf() === "live";
  const isDenied = () => statusOf() === "denied";
  const tierOf = () => { const r = rec(); return r ? r.tier : null; };
  // The live bearer. Null unless one is actually held — a host running open is `live` with no token.
  const tokenOf = () => { const r = rec(); return r && r.status === "live" ? (r.token || null) : null; };

  // Decode a JWT's `exp` (seconds → ms), library-free; null if it is not a parseable JWT. Used ONLY
  // to rotate BEFORE the two calls that cannot be replayed (the SSE turn, the single-use blueprint
  // finalize). Everything else stays reactive.
  function jwtExpMs(token) {
    try {
      const seg = token.split(".")[1];
      const json = JSON.parse(atob(seg.replace(/-/g, "+").replace(/_/g, "/")));
      return typeof json.exp === "number" ? json.exp * 1000 : null;
    } catch { return null; }
  }
  function accessTokenLapsed() {
    const tok = tokenOf();
    if (!tok) return false;
    const expMs = jwtExpMs(tok);
    return expMs != null && Date.now() >= expMs - 30000;
  }

  function setRec(partial, persist) {
    store.setState(s => ({ ...s, session: { ...(s.session || {}), ...partial } }));
    if (persist) writeSession();
    syncReauthSurfacing();
    return rec();
  }

  // ---- reauthDue: the SURFACING gate for `expired` ------------------------
  // An access token lives fifteen minutes, so an open panel passes through `expired` four times an
  // hour and is back to `live` one rotation later. The status is instantaneous and true, which the
  // seam needs; a surface that ASKS somebody to sign in again must not appear for a round trip. Only
  // a session that stays expired past this window is one the rotation did not heal.
  //
  // `bootstrapping` deliberately does not clear it: an attempt in flight is not a recovery, and
  // every retry passes through that status on its way back to `expired`. What is measured is how
  // long since this session last WORKED.
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

  // ---- storage ------------------------------------------------------------
  function writeSession() {
    const r = rec();
    try {
      if (!r || (r.status !== "live" && r.status !== "denied")) { sessionStorage.removeItem(TOKEN_KEY); return; }
      // Only what a tab reload needs to resume without asking anybody. No expiry copy — the token
      // carries its own, and a shadow copy is the drift footgun.
      //
      // `account` rides along because a `none` tier is two facts and only this separates them:
      // waiting on an admin, or holding nothing at all.
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify({
        status: r.status, tier: r.tier || null, token: r.token || null,
        account: r.account || null, open: !!r.open,
      }));
    } catch { /* private mode */ }
  }
  function readSession() {
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function writeRefresh(token) {
    try { if (token) localStorage.setItem(REFRESH_KEY, token); else localStorage.removeItem(REFRESH_KEY); }
    catch { /* private mode */ }
  }
  function readRefresh() { try { return localStorage.getItem(REFRESH_KEY) || null; } catch { return null; } }
  function forgetRefresh() { writeRefresh(null); }

  // ---- the nodes this browser drives --------------------------------------
  // Addresses, never identity: one session is presented to all of them. WHERE the list comes from is
  // the cluster's answer. Named by an anchor, it is held in memory for the life of the page and
  // nowhere else — asked again on the next load, so a node the cluster no longer names cannot
  // outlive the roster that named it. Held by a standalone deployment, it is the one address
  // somebody typed, and storage is exactly where that belongs.
  function readRegistry() {
    if (anchorNamesTheFleet()) {
      return CONNECTIONS.filter(c => c && c.url).map(c => ({ id: c.id || null, url: c.url, name: c.name || c.id || c.url }));
    }
    try { return JSON.parse(localStorage.getItem(REGISTRY_KEY) || "[]"); } catch { return []; }
  }
  // Not written at all where the anchor names the fleet — see anchorNamesTheFleet. Clearing still
  // works, because forgetting is never the thing that goes stale.
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

  // ---- where this browser signs in ---------------------------------------
  // The door is chosen by a person and kept, never discovered through anything else. A clustered
  // node announces nothing about its cluster — not the anchor's address, not its own membership — so
  // there is nothing to ask a member and no call here asks one.
  //
  // Two kinds, and the difference is load-bearing. An anchor mints for a whole cluster and keeps its
  // accounts under a cluster-scoped path; a standalone node mints for itself and keeps its own. Both
  // renew what they minted, which is why renewal reads the door and not the anchor.
  let door = rememberedDoor();
  const doorOrigin = () => (door ? door.origin : "");
  const anchorOrigin = () => (door && door.kind === "anchor" ? door.origin : "");
  function setDoor(next) {
    door = next && next.origin ? { origin: next.origin, kind: next.kind === "standalone" ? "standalone" : "anchor" } : null;
    rememberDoor(door);
    // A browser that drove this cluster under an older build still holds a node list. Dropping it
    // here is what stops one surviving the roster that no longer names it.
    if (door && door.kind === "anchor") writeRegistry([]);
  }
  // Kept async: every caller already awaits it, and the answer is a stored fact rather than a
  // question anybody is asked.
  async function resolveAnchor() { return anchorOrigin(); }

  // ---- adopt (a session minted out of band) -------------------------------
  // Both doors end here — a password sign-in and a provider's return leg — so a session is in
  // exactly the same state whichever way it was obtained.
  function adoptSession(sess) {
    sess = sess || {};
    writeRefresh(sess.refresh || null);
    setRec({
      status: "live", token: sess.token || null, refresh: sess.refresh || null,
      tier: sess.tier || "none", account: sess.account || "unknown", open: false, error: null,
    }, true);
    store.setState(s => ({ ...s, nodes: {} }));   // a new session; nobody has refused it yet
    return rec();
  }

  // ---- rotate (the anchor's alone) ----------------------------------------
  // The only renewal path there is. Reactive: called when a call is refused, or before one of the
  // two calls that cannot be replayed. Concurrent callers share one rotation, so a fan-out of
  // refusals spends the refresh token once — spending it twice would fail, since the anchor treats a
  // replay of an already-rotated token as a stolen one.
  function rotate() {
    const r = rec();
    if (r && r.status === "denied") return Promise.resolve("denied");
    if (r && r.open) return Promise.resolve("live");          // an open host has nothing to rotate
    if (inflight) return inflight;
    const refreshTok = readRefresh();
    if (!refreshTok) { setRec({ status: "expired", error: "login_required" }); return Promise.resolve("expired"); }

    const p = Promise.resolve(doorOrigin()).then(url => {
      if (!url) {
        // Nothing to renew against. The session is not wrong — there is nowhere to take it — so this
        // is an outage with a cause, and the surfaces can say which.
        setRec({ status: "expired", error: "anchor_unreachable" });
        return "expired";
      }
      return refreshSession(url, refreshTok).then(res => {
        if (!res.ok) {
          // An unreachable anchor and a refused refresh are kept apart: one is a cluster this
          // browser cannot currently reach, the other is a session that has ended.
          if (res.unreachable) { setRec({ status: "expired", error: "anchor_unreachable" }); return "expired"; }
          forgetRefresh();
          setRec({ status: "expired", refresh: null, error: "login_required" });
          return "expired";
        }
        const s = res.session || {};
        // The tier rides the response and is adopted as given: the anchor resolved it now rather than
        // reading it off the token, so a demotion lands exactly like a promotion. A response that
        // omits it leaves what is held — an anchor that said nothing has taken nothing away.
        const tier = s.tier || (rec() && rec().tier) || "none";
        if (s.refresh) writeRefresh(s.refresh);
        setRec({ status: "live", token: s.token || null, refresh: s.refresh || refreshTok, tier, error: null }, true);
        // A renewed session is worth re-offering to every node that was refusing it.
        store.setState(st => ({ ...st, nodes: {} }));
        return "live";
      });
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
            status: "live", token: null, refresh: null, open: true,
            tier: (me && me.tier) || "none", account: (me && me.status) || "unknown", error: null,
          }, true);
          return "live";
        });
      },
      () => { setRec({ status: "expired", error: "unreachable" }); return "expired"; },
    );
  }

  // ---- authorize (ensure a live session) ----------------------------------
  // The seam's entry point. A live session returns without touching the network — no proactive
  // refresh; a lapsed token is rotated only once something is refused.
  function authorize() {
    const st = statusOf();
    if (st === "live") return Promise.resolve("live");
    if (st === "denied") return Promise.resolve("denied");
    if (inflight) return inflight;
    if (readRefresh()) return rotate();
    // Nothing held. Either this is an open host, or nobody has signed in — and the second is the
    // gate's business rather than something to heal here.
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

  // ---- a member stating this session's role, live -------------------------
  // A member pushes `{tier, status}` on the `me` topic when it regrades the account behind this
  // session, and the push is the authority — it is that member re-reading its replica of the one
  // account, so it is written as given and a demotion lands exactly like a promotion.
  //
  // Only a genuine delta is announced: a frame restating the tier already held is not one, and
  // somebody who was granted nothing is not told their access changed.
  const tierListeners = new Set();
  function onTierChange(fn) { tierListeners.add(fn); return () => tierListeners.delete(fn); }

  function applyMePatch(patch) {
    if (!patch) return;
    const before = tierOf();
    setRec({ tier: patch.tier || "none", account: patch.status || "unknown" }, true);
    const after = tierOf();
    if (before == null || before === after) return;
    for (const fn of tierListeners) { try { fn({ from: before, to: after }); } catch { /* one listener must not stop the rest */ } }
  }

  // Mark the session lapsed. The seam calls this on a refusal it is about to heal.
  function expire() { setRec({ status: "expired", error: "expired" }, true); }

  // The cluster grants this account nothing. Terminal — re-signing in changes nothing, and retrying
  // would loop.
  function deny(reason) { setRec({ status: "denied", error: reason || "forbidden" }, true); }

  function drop() {
    clearSurfaceTimer();
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
    forgetRefresh();
    store.setState({ session: null, nodes: {} });
  }

  // Sign out of the cluster. The anchor revokes the row and tells the members, which is what stops
  // the access bearer still in this tab being spent on them for the rest of its life; the local drop
  // happens either way, because somebody pressing sign out is signed out.
  function signOut() {
    const refreshTok = readRefresh();
    // Only an anchor is told from here. A standalone node ends its own session through the logout
    // the shell already calls on every node it drives, and telling it twice would write two
    // sign-outs for one act.
    const url = anchorOrigin();
    drop();
    if (url && refreshTok) { try { anchorSignOut(url, refreshTok); } catch { /* best effort */ } }
  }

  // Every node forgotten as well — the panel drops back to having no cluster to drive.
  function forgetHosts() {
    writeRegistry([]);
    store.setState(s => ({ ...s, nodes: {} }));
    hostsStore.setState(s => ({ ...s, list: [] }));
  }

  // ---- init ---------------------------------------------------------------
  // Restoring a persisted session is a pure storage read that asks nothing of anybody, so it stays
  // at import: the gate needs to know on its first render whether this browser holds a session.
  function seed() {
    const p = readSession();
    if (p) store.setState({ session: p, nodes: {} });
  }

  store.statusOf = statusOf;
  store.isDenied = isDenied;
  store.isLive = isLive;
  store.tierOf = tierOf;
  store.tokenOf = tokenOf;
  store.adoptSession = adoptSession;
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
  store.onTierChange = onTierChange;
  store.signOut = signOut;
  store.forgetHosts = forgetHosts;
  store.nodeAccepts = nodeAccepts;
  store.nodeRefusal = nodeRefusal;
  store.markNode = markNode;
  store.forgetNode = forgetNode;
  store.anchorOrigin = anchorOrigin;
  store.setDoor = setDoor;
  store.doorOrigin = doorOrigin;
  store.resolveAnchor = resolveAnchor;

  const sessionStore = store;
  const TIER_LABEL = { admin: "Admin", operator: "Operator", viewer: "Viewer", none: "No role" };

  seed();

  // The `me` topic is this store's live half: a member's own re-statement of the tier behind this
  // session. A global topic on the primary stream, so subscribing costs a listener and no socket,
  // and a member delivers the frame only to this account's connections — one that arrives is about
  // the reader. Started with the rest of the data layer rather than at import, so a browser sitting
  // on the sign-in screen opens nothing.
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

export { TIER_LABEL, sessionStore };
