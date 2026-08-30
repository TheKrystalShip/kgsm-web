import React from "react";
import { establishClusterSession } from "../lib/authRedirect.js";
import { writeStoredUser } from "../lib/authStorage.js";
import {
  adoptMember, clearPendingSession, discoverCluster, fetchMe, forgetMember, knownMembers,
  lastMemberOrigin, readPendingSession, rememberMember, stashPendingSession,
} from "../lib/authFlow.js";
import { CONNECTIONS, homeConn } from "../lib/config.js";
import { sessionStore } from "../lib/sessionStore.js";
import { ClusterUnavailable } from "../pages/auth/ClusterUnavailable.jsx";
import { NodePage } from "../pages/auth/NodePage.jsx";
import { PendingPage } from "../pages/auth/PendingPage.jsx";
import { SignInPage } from "../pages/auth/SignInPage.jsx";

// AuthGate — everything in front of the app, and nothing behind it.
//
// It owns its own hooks, touches one store, and starts no data layer. That is the point of it being
// a separate component: the shell's hooks would otherwise run for a visitor who has not signed in,
// fetching and subscribing on behalf of nobody. Here there is nothing to run.
//
//   member ──► discover ──► sign in / register ──┬──► a session with a tier  → the shell
//                                                └──► a session with none    → pending ──► the shell
//
// The member is a ROUTE and the only thing it decides is who gets asked where the cluster signs
// people in. The session that comes back is the cluster's and every member accepts it, so there is
// nothing to choose and nothing to repeat for a second member.
//
// A returning visitor skips the member screen entirely: the anchor's address is remembered, so the
// sign-in draws before anything has answered. The list is for a cold browser, for a member that has
// stopped answering, and for anybody who asks.

function AuthGate({ user, onUser }) {
  const [phase, setPhase] = React.useState(() => (CONNECTIONS.length ? "resolving" : "member"));
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

  // Ask a member where this cluster signs people in. Any member will do — the answer is the
  // cluster's — so this asks the one this browser is already pointed at and only falls back to the
  // list when it cannot be asked.
  React.useEffect(() => {
    if (phase !== "resolving") return undefined;
    let live = true;
    const known = knownMembers();
    const preferred = lastMemberOrigin()
      || (homeConn() && homeConn().url)
      || (known.length === 1 ? known[0].origin : "");
    if (!preferred) { setPhase("member"); return undefined; }
    discoverCluster(preferred).then((found) => {
      if (!live) return;
      if (found.state === "unreachable") { setPhase("member"); return; }
      rememberMember(preferred);
      setCluster(found);
      setPhase(found.state === "ready" ? "auth" : "unavailable");
    });
    return () => { live = false; };
  }, [phase]);

  // A pending browser reloading has a stashed session but no discovery yet — it needs the member's
  // origin for the poll, which is the same one it signed in through.
  const pendingOrigin = React.useMemo(
    () => lastMemberOrigin() || (homeConn() && homeConn().url) || "",
    [],
  );

  const pickMember = React.useCallback((probe) => {
    adoptMember(probe);
    setPhase("resolving");
  }, []);

  const changeMember = React.useCallback(() => {
    forgetMember();
    setCluster(null);
    setPhase("member");
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

  // Ask a member what it says about this caller now. The same read that decided they hold nothing,
  // which is why it is the one that notices they no longer do.
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
  // differently, so they are not collapsed into one apology.
  if (phase === "unavailable" && cluster) {
    return <ClusterUnavailable cluster={cluster} onChangeMember={changeMember} onRetry={() => setPhase("resolving")} />;
  }

  if (phase === "auth" && cluster) {
    return (
      <SignInPage
        cluster={cluster}
        tab={tab}
        onTab={setTab}
        onSession={adoptSession}
        onChangeMember={changeMember} />
    );
  }

  // Asking a member where the cluster signs in. Deliberately bare — anything here would be on screen
  // for the length of one request and then replaced.
  if (phase === "resolving") return <div className="login-shell" />;

  return <NodePage onPick={pickMember} lastOrigin={lastMemberOrigin()} />;
}

export { AuthGate };
