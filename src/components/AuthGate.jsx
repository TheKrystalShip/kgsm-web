import React from "react";
import { establishClusterSession } from "../lib/authRedirect.js";
import { writeStoredUser } from "../lib/authStorage.js";
import {
  adoptMember, clearPendingSession, discoverCluster, fetchMe, forgetMember,
  lastMemberOrigin, readPendingSession, rememberMember, stashPendingSession,
} from "../lib/authFlow.js";
import { CONNECTIONS, homeConn } from "../lib/config.js";
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
//   cluster ──► sign in / register ──┬──► a session with a tier  → the shell
//                                    └──► a session with none    → pending ──► the shell
//
// An account is the cluster's, so the cluster is the only thing anybody chooses. The address they
// give reaches one of its members; which member is a routing detail and never surfaces.
//
// A returning visitor skips the first screen: the address is remembered, so the sign-in draws
// before anything has answered.

function AuthGate({ user, onUser }) {
  const [phase, setPhase] = React.useState(() => (CONNECTIONS.length ? "resolving" : "cluster"));
  const [cluster, setCluster] = React.useState(null);
  // The session of somebody who holds nothing. It cannot become the app's session — everything
  // behind the gate would render for somebody entitled to none of it — so the gate carries it for
  // as long as they are waiting.
  const [pending, setPending] = React.useState(() => readPendingSession());
  const [tab, setTab] = React.useState(() => {
    // The register tab has no route of its own, but `#/register` is worth honouring: an invite is a
    // URL somebody pastes to a friend.
    try { return window.location.hash.replace(/^#\/?/, "") === "register" ? "register" : "login"; }
    catch { return "login"; }
  });

  // Ask where this cluster signs people in. Any member will do, since the answer is the cluster's.
  React.useEffect(() => {
    if (phase !== "resolving") return undefined;
    let live = true;
    const preferred = lastMemberOrigin() || (homeConn() && homeConn().url) || "";
    if (!preferred) { setPhase("cluster"); return undefined; }
    discoverCluster(preferred).then((found) => {
      if (!live) return;
      if (found.state === "unreachable") { setPhase("cluster"); return; }
      rememberMember(preferred);
      setCluster(found);
      setPhase(found.state === "ready" ? "auth" : "unavailable");
    });
    return () => { live = false; };
  }, [phase]);

  // A pending browser reloading has a stashed session but no discovery yet, and the poll needs an
  // address to run against.
  const pendingOrigin = React.useMemo(
    () => lastMemberOrigin() || (homeConn() && homeConn().url) || "",
    [],
  );

  const pickCluster = React.useCallback((probe) => {
    adoptMember(probe);
    setPhase("resolving");
  }, []);

  const changeCluster = React.useCallback(() => {
    forgetMember();
    setCluster(null);
    setPhase("cluster");
  }, []);

  // Turn a minted session into a live one, whichever door it came through.
  //
  // A session holding `none` is not a failure and is not half a sign-in: a fresh registration and a
  // first provider arrival both land there, and both mean the same thing — an administrator has not
  // acted yet. So they get the same screen, and the gate keeps their session until one does.
  const adoptSession = React.useCallback(async (session) => {
    const holdsNothing = (session.tier || "none") === "none";

    if (holdsNothing) {
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
    // Still waiting, but `pending` and `unknown` are different sentences and an account can move
    // between them — an admin deleting it is exactly that.
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
    onUser();
  }, [onUser]);

  if (pending) {
    return (
      <PendingPage
        account={pending.status}
        user={user}
        onCheck={recheck}
        onLogout={logout} />
    );
  }

  // The cluster answered and cannot sign anybody in. Four different facts, and a person acts on each
  // differently.
  if (phase === "unavailable" && cluster) {
    return <ClusterUnavailable cluster={cluster} onChangeCluster={changeCluster} onRetry={() => setPhase("resolving")} />;
  }

  if (phase === "auth" && cluster) {
    return (
      <SignInPage
        cluster={cluster}
        tab={tab}
        onTab={setTab}
        onSession={adoptSession}
        onChangeCluster={changeCluster} />
    );
  }

  // Deliberately bare — anything here would be on screen for the length of one request.
  if (phase === "resolving") return <div className="login-shell" />;

  return <ClusterPage onPick={pickCluster} />;
}

export { AuthGate };
