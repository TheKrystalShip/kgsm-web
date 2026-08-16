import React from "react";
import { establishNodeSession } from "../lib/authRedirect.js";
import { writeStoredUser } from "../lib/authStorage.js";
import {
  adoptNode, clearPendingSession, fetchMe, forgetNode, knownNodes, lastNodeOrigin,
  probeNode, readPendingSession, rememberNode, stashPendingSession,
} from "../lib/authFlow.js";
import { CONNECTIONS } from "../lib/config.js";
import { sessionStore } from "../lib/sessionStore.js";
import { NodePage } from "../pages/auth/NodePage.jsx";
import { PendingPage } from "../pages/auth/PendingPage.jsx";
import { SignInPage } from "../pages/auth/SignInPage.jsx";

// AuthGate — everything in front of the app, and nothing behind it.
//
// It owns its own hooks, touches one store, and starts no data layer. That is the point
// of it being a separate component: the shell's ~15 hooks used to sit above an
// early-return chain, so they ran for a visitor who had not signed in — fetching and
// subscribing on behalf of nobody. Here there is nothing to run.
//
//   node ──► sign in / register ──┬──► a session with a tier  → the shell
//                                 └──► a session with none    → pending ──► the shell
//
// A returning visitor skips the node screen: the last node they used is probed, and if it
// answers they land on its sign-in. The list is for a cold browser, for a node that
// stopped answering, and for anybody who asks — which the doorway chip under the card
// does.

function AuthGate({ user, onUser }) {
  const [phase, setPhase] = React.useState(() => (CONNECTIONS.length ? "resolving" : "node"));
  const [node, setNode] = React.useState(null);
  // The session of somebody who holds nothing. It cannot live in sessionStore — see
  // authFlow.js — so the gate carries it for as long as they are waiting.
  const [pending, setPending] = React.useState(() => readPendingSession());
  const [tab, setTab] = React.useState(() => {
    // The register tab has no route of its own, but `#/register` is worth honouring: an
    // invite is a URL somebody pastes to a friend.
    try { return window.location.hash.replace(/^#\/?/, "") === "register" ? "register" : "login"; }
    catch { return "login"; }
  });

  // Resolve the landing node once: the one this browser last signed in through, else the
  // only one it knows. Anything else — several nodes and no history, or a remembered node
  // that has stopped answering — is a question, and the list is how it gets asked.
  React.useEffect(() => {
    if (phase !== "resolving") return undefined;
    let live = true;
    const known = knownNodes();
    const preferred = lastNodeOrigin() || (known.length === 1 ? known[0].origin : "");
    if (!preferred) { setPhase("node"); return undefined; }
    probeNode(preferred).then((probe) => {
      if (!live) return;
      if (probe.reachable) { setNode(probe); setPhase("auth"); }
      else setPhase("node");
    });
    return () => { live = false; };
  }, [phase]);

  // A pending browser reloading has a stashed session but no probed node — it needs one
  // for the host's name, and for the origin the poll runs against.
  React.useEffect(() => {
    if (!pending || node) return undefined;
    let live = true;
    probeNode(pending.origin).then((probe) => { if (live && probe.reachable) setNode(probe); });
    return () => { live = false; };
  }, [pending, node]);

  const pickNode = React.useCallback((probe) => {
    adoptNode(probe);
    setNode(probe);
    setPhase("auth");
  }, []);

  const changeNode = React.useCallback(() => {
    forgetNode();
    setPhase("node");
  }, []);

  // Turn a minted session into a live one, whichever door it came through.
  //
  // `establishNodeSession` is the OAuth return leg's own path, so a password sign-in ends
  // in exactly the same state as a provider bounce. It resolves the node's backend id
  // from GET /hosts — which a pending caller is refused, so for them it writes the
  // identity and stops there. That is not a failure: the tier on the response already
  // says they hold nothing, and the gate carries their session until an admin acts.
  const adoptSession = React.useCallback(async (origin, session) => {
    rememberNode(origin);
    const holdsNothing = (session.tier || "none") === "none";

    if (holdsNothing) {
      stashPendingSession(origin, session);
      // Still worth running: it writes the app-shell identity from /me, which is what
      // names the person on the waiting screen.
      try { await establishNodeSession(origin, { access: session.token, refresh: session.refresh }); } catch {}
      setPending(readPendingSession() || { origin, token: session.token, refresh: session.refresh, status: session.status });
      onUser();
      return;
    }

    clearPendingSession();
    setPending(null);
    try { await establishNodeSession(origin, { access: session.token, refresh: session.refresh }); } catch {}
    onUser();
  }, [onUser]);

  // Ask the node what it says about this caller now. The same read that decided they hold
  // nothing, which is why it is the one that notices they no longer do.
  const recheck = React.useCallback(async () => {
    const held = pending || readPendingSession();
    if (!held) { onUser(); return; }
    const me = await fetchMe(held.origin, held.token);
    if (!me.ok) {
      // A token that no longer authenticates is not a pending account — it is a session
      // that ended. Drop back to the sign-in for that node rather than waiting forever.
      if (me.status === 401) {
        clearPendingSession();
        setPending(null);
        writeStoredUser(null);
        onUser();
      }
      return;
    }
    if ((me.tier || "none") !== "none") {
      // Approved. GET /hosts answers now, so the ordinary per-host session can be
      // established in full and the gate stands down.
      clearPendingSession();
      try { await establishNodeSession(held.origin, { access: held.token, refresh: held.refresh }); } catch {}
      setPending(null);
      onUser();
      return;
    }
    // Still waiting, but `pending` and `unknown` are different sentences and it can move
    // between them — an admin deleting the account is exactly that.
    if (me.status !== held.status) {
      const next = { ...held, status: me.status };
      stashPendingSession(held.origin, { token: next.token, refresh: next.refresh, status: next.status });
      setPending(next);
    }
  }, [pending, onUser]);

  const logout = React.useCallback(() => {
    clearPendingSession();
    setPending(null);
    writeStoredUser(null);
    sessionStore.signOut();
    onUser();
  }, [onUser]);

  if (pending) {
    const hostName = (node && node.label)
      || (pending.origin || "").replace(/^https?:\/\//, "")
      || "this host";
    return (
      <PendingPage
        account={pending.status}
        user={user}
        hostName={hostName}
        onCheck={recheck}
        onLogout={logout} />
    );
  }

  if (phase === "auth" && node) {
    return (
      <SignInPage
        node={node}
        tab={tab}
        onTab={setTab}
        onSession={adoptSession}
        onChangeNode={changeNode} />
    );
  }

  // Probing the remembered node. Deliberately bare — anything here would be on screen for
  // the length of one local request and then replaced.
  if (phase === "resolving") return <div className="login-shell" />;

  return <NodePage onPick={pickNode} lastOrigin={lastNodeOrigin()} />;
}

export { AuthGate };
