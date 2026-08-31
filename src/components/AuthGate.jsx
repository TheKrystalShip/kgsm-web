import React from "react";
import { establishClusterSession } from "../lib/authRedirect.js";
import { writeStoredUser } from "../lib/authStorage.js";
import {
  adoptMember, clearPendingSession, fetchMe, forgetMember, identifyAddress,
  lastMemberOrigin, readPendingSession, rememberMember, stashPendingSession,
} from "../lib/authFlow.js";
import { CONNECTIONS, homeConn } from "../lib/config.js";
import { KrystalRouter } from "../lib/router.js";
import { configuredAnchor } from "../lib/anchor.js";
import { sessionStore } from "../lib/sessionStore.js";
import { ClusterPage } from "../pages/auth/ClusterPage.jsx";
import { ClusterUnavailable } from "../pages/auth/ClusterUnavailable.jsx";
import { PendingPage } from "../pages/auth/PendingPage.jsx";
import { SignInPage } from "../pages/auth/SignInPage.jsx";

// AuthGate — everything in front of the app, and nothing behind it.
//
// It owns its own hooks, touches one store, and starts no data layer. That is the point of it being
// a separate component: the shell's hooks would otherwise run for a visitor who has not signed in,
// fetching and subscribing on behalf of nobody. Here there is nothing to run.
//
//   #/connect ──► #/signin ┄ #/register ──┬──► a session with a tier  → the shell
//                                         └──► a session with none    → #/pending ──► the shell
//
// **The URL is the state.** These screens are addressable like every other page, so Back works
// through them, a refresh stays put, and `#/register` is a link somebody can paste to a friend. The
// gate reads the hash rather than holding a phase beside it — two of those would drift, and the one
// that lost would be the address bar.
//
// An account is the cluster's, so the cluster is the only thing anybody chooses. The address they
// give reaches one of its members; which member is a routing detail and never surfaces.

const hashOf = (kind) => KrystalRouter.routeToHash({ kind });

// Replace rather than push: the gate is a funnel, and every step of it is reached by finishing the
// one before. A history entry per phase would make Back mean "undo the thing that just worked".
function go(kind) {
  const desired = hashOf(kind);
  if (window.location.hash === desired) return;
  try { window.history.replaceState(null, "", desired); } catch { window.location.hash = desired; }
}

function AuthGate({ user, onUser }) {
  // Which screen, read from the address bar. Anything that is not one of these screens is somebody
  // who was sent here from a page they could not have — they land on the sign-in, and where they
  // were going is remembered by the shell.
  const [kind, setKind] = React.useState(() => {
    const r = KrystalRouter.parseHash();
    if (KrystalRouter.isAuthRoute(r)) return r.kind;
    // Somewhere to sign in already known — a door chosen before, a node this browser drives, or an
    // anchor this build was configured with — means the address box has nothing to ask.
    return (sessionStore.doorOrigin() || configuredAnchor() || CONNECTIONS.length) ? "signin" : "connect";
  });
  const [cluster, setCluster] = React.useState(null);
  // The session of somebody who holds nothing. It cannot become the app's session — everything
  // behind the gate would render for somebody entitled to none of it — so the gate carries it.
  const [pending, setPending] = React.useState(() => readPendingSession());
  // In-flight and mounted are REFS, not state. As state, an "is discovering" flag would be in the
  // effect's deps, so setting it re-runs the effect, whose cleanup cancels the very request that set
  // it — a deadlock that renders as a blank screen and never resolves.
  //
  // `mounted` is re-armed in the effect BODY rather than only cleared in its cleanup. StrictMode
  // mounts, unmounts and remounts in development: a ref initialised once and only ever set false
  // stays false for the rest of the component's life, and every answer that arrives afterwards is
  // thrown away by a guard that is supposed to be about unmounting.
  const inFlight = React.useRef(false);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Back and Forward through the gate, and a pasted #/register.
  React.useEffect(() => {
    const onHash = () => {
      const r = KrystalRouter.parseHash();
      if (KrystalRouter.isAuthRoute(r)) setKind(r.kind);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Someone holding nothing is on one screen and it is not a choice, so the address says so.
  React.useEffect(() => { if (pending) { setKind("pending"); go("pending"); } }, [pending]);

  // Keep the address honest for the screen actually showing.
  React.useEffect(() => { go(kind); }, [kind]);

  // A door that can be signed in at is kept, and a standalone node is ALSO the node this browser
  // drives — so it joins the connection set. An anchor never does: it is not a node, it serves no
  // servers or metrics, and the nodes come from its own roster once there is a session to ask with.
  const applyDoor = React.useCallback((found) => {
    if (found.kind === "anchor" || found.kind === "standalone") {
      // Through the session layer, which holds the door in memory as well as in storage. Writing
      // storage alone leaves the running page reading the door it booted with — and the fleet is
      // fetched from the door, so a browser choosing one for the first time would sign in and then
      // ask nobody for its nodes.
      sessionStore.setDoor({ origin: found.origin, kind: found.kind });
      if (found.kind === "standalone") adoptMember({ origin: found.origin, label: found.label, reachable: true });
    }
    setCluster(found);
  }, []);

  // Classify the address this browser last used. Only the sign-in screens need it, so `#/connect`
  // costs no round trip.
  React.useEffect(() => {
    if (pending || cluster || inFlight.current) return;
    if (kind !== "signin" && kind !== "register") return;
    // The DOOR first, and it is the only one of these that is a door. The other two are nodes this
    // browser drives, and a node that belongs to a cluster is not somewhere anybody signs in — so
    // preferring one would send a returning person to a refusal instead of to the sign-in they used
    // yesterday. They stay as the fallback for a browser that has a node and has never signed in.
    // The DOOR first — chosen by a person, and the only one of these that is a door. Then the
    // deployment's own anchor, if this build names one: a panel hosted for one cluster should open on
    // its sign-in rather than asking somebody who is already there where they are. The last two are
    // nodes this browser drives, kept as the fallback for a browser that has one and has never
    // signed in; a node inside a cluster is not somewhere anybody signs in, so preferring one would
    // send a returning person to a refusal instead of the sign-in they used yesterday.
    const preferred = sessionStore.doorOrigin() || configuredAnchor()
      || lastMemberOrigin() || (homeConn() && homeConn().url) || "";
    if (!preferred) { setKind("connect"); return; }
    inFlight.current = true;
    identifyAddress(preferred).then((found) => {
      inFlight.current = false;
      if (!mounted.current) return;
      // Nothing answered, so there is nothing to sign in to yet — back to the one question.
      if (found.kind === "unreachable" || found.kind === "invalid") { setKind("connect"); return; }
      rememberMember(preferred);
      applyDoor(found);
    });
  }, [kind, cluster, pending, applyDoor]);

  const pendingOrigin = React.useMemo(
    () => lastMemberOrigin() || (homeConn() && homeConn().url) || "",
    [],
  );

  const pickCluster = React.useCallback((found) => {
    applyDoor(found);
    setKind("signin");
  }, [applyDoor]);

  const changeCluster = React.useCallback(() => {
    forgetMember();
    setCluster(null);
    setKind("connect");
  }, []);

  // Turn a minted session into a live one, whichever door it came through.
  //
  // A session holding `none` is not a failure and is not half a sign-in: a fresh registration and a
  // first provider arrival both land there, and both mean an administrator has not acted yet.
  const adoptSession = React.useCallback(async (session) => {
    if ((session.tier || "none") === "none") {
      stashPendingSession(session);
      setPending(readPendingSession() || { token: session.token, refresh: session.refresh, status: session.status });
      onUser();
      return;
    }
    clearPendingSession();
    setPending(null);
    try { await establishClusterSession({ access: session.token, refresh: session.refresh, tier: session.tier, status: session.status }); }
    catch { /* signed in; the data layer heals what did not load */ }
    onUser();
  }, [onUser]);

  // The same read that decided they hold nothing, which is why it is the one that notices they no
  // longer do.
  const recheck = React.useCallback(async () => {
    const held = pending || readPendingSession();
    if (!held || !pendingOrigin) { onUser(); return; }
    const me = await fetchMe(pendingOrigin, held.token);
    if (!me.ok) {
      // A token that no longer authenticates is not a pending account — it is a session that ended.
      if (me.status === 401) {
        clearPendingSession();
        setPending(null);
        writeStoredUser(null);
        setKind("signin");
        onUser();
      }
      return;
    }
    if ((me.tier || "none") !== "none") {
      clearPendingSession();
      try { await establishClusterSession({ access: held.token, refresh: held.refresh, tier: me.tier, status: me.status }); }
      catch { /* approved; the data layer heals what did not load */ }
      setPending(null);
      onUser();
      return;
    }
    // `pending` and `unknown` are different sentences and an account can move between them.
    if (me.status !== held.status) {
      const next = { ...held, status: me.status };
      stashPendingSession(next);
      setPending(next);
    }
  }, [pending, pendingOrigin, onUser]);

  const logout = React.useCallback(() => {
    clearPendingSession();
    setPending(null);
    writeStoredUser(null);
    sessionStore.signOut();
    setKind("signin");
    onUser();
  }, [onUser]);

  if (pending) {
    return <PendingPage account={pending.status} user={user} onCheck={recheck} onLogout={logout} />;
  }

  if (kind === "connect") return <ClusterPage onPick={pickCluster} />;

  // The cluster answered and cannot sign anybody in. Four different facts, and a person acts on each
  // differently.
  if (cluster && cluster.kind !== "anchor" && cluster.kind !== "standalone") {
    return <ClusterUnavailable cluster={cluster} onChangeCluster={changeCluster} onRetry={() => setCluster(null)} />;
  }

  if (cluster) {
    return (
      <SignInPage
        cluster={cluster}
        tab={kind === "register" ? "register" : "login"}
        onTab={(t) => setKind(t === "register" ? "register" : "signin")}
        onSession={adoptSession}
        onChangeCluster={changeCluster} />
    );
  }

  // Asking where the cluster signs in. Deliberately bare — one request long.
  return <div className="login-shell" />;
}

export { AuthGate };
