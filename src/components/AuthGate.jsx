import React from "react";
import { takeSessionEnded, takeSignInRefusal, writeStoredUser } from "../lib/authStorage.js";
import { configuredAnchor } from "../lib/anchor.js";
import { establishClusterSession } from "../lib/clusterSignIn.js";
import { discoverProvider, originOf } from "../lib/oidc.js";
import { KrystalRouter } from "../lib/router.js";
import { sessionStore } from "../lib/sessionStore.js";
import { ClusterPage } from "../pages/auth/ClusterPage.jsx";
import { ClusterUnavailable } from "../pages/auth/ClusterUnavailable.jsx";

// AuthGate — everything in front of the app, and nothing behind it.
//
// It owns its own hooks, touches one store, and starts no data layer. That is the point of it being
// a separate component: the shell's hooks would otherwise run for a visitor who has not signed in,
// fetching and subscribing on behalf of nobody.
//
// **Nobody signs in here.** The cluster's sign-in provider does that on its own pages, and this panel
// is a client of it. What the gate decides is only where the provider is and when to go there:
//
//   a session held            → renewed if it has lapsed, and the shell mounts
//   the page's own origin     → it names the provider; go there at once
//   the build's own address   → a static build configured for one cluster; the same
//   neither                   → #/connect asks for any member's address, and then the same
//
// A cold load with nothing held leaves for the provider immediately, because nothing is on screen to
// lose. A session that ended while the panel was open does NOT: that is shown, with the way back
// offered, because leaving unasked would discard whatever somebody was in the middle of.

const hashOf = (kind) => KrystalRouter.routeToHash({ kind });

// Replace rather than push: the gate is a funnel, and a history entry per step would make Back mean
// "undo the thing that just worked".
function go(kind) {
  const desired = kind ? hashOf(kind) : "";
  if (!desired || window.location.hash === desired) return;
  try { window.history.replaceState(null, "", desired); } catch { window.location.hash = desired; }
}

function AuthGate({ onUser }) {
  const [state, setState] = React.useState({ kind: "working" });
  // `mounted` is re-armed in the effect BODY rather than only cleared in its cleanup. StrictMode
  // mounts, unmounts and remounts in development: a ref initialised once and only ever set false
  // stays false for the rest of the component's life, and every answer arriving afterwards is thrown
  // away by a guard that is supposed to be about unmounting.
  const mounted = React.useRef(true);
  const running = React.useRef(false);

  const show = React.useCallback((next) => { if (mounted.current) setState(next); }, []);

  // To the provider, carrying where this browser was — never this gate's own screen, which is not a
  // place anybody signed in is going. Resolves true once the page is leaving; a provider that cannot
  // even be asked for its own configuration is an outage, said as one.
  const leave = React.useCallback(async () => {
    show({ kind: "working" });
    const here = KrystalRouter.parseHash();
    const back = here && KrystalRouter.isAuthRoute(here) ? "" : window.location.hash;
    let went = false;
    try { went = await sessionStore.signIn(back); } catch { went = false; }
    if (!went) show({ kind: "unreachable", origin: sessionStore.anchorOrigin() });
    return went;
  }, [show]);

  const adopt = React.useCallback(async (found) => {
    sessionStore.setProvider(found);
    return leave();
  }, [leave]);

  const run = React.useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      // The provider sent this browser back without a session, and said why.
      const refused = takeSignInRefusal();
      if (refused) { show({ kind: "refused", error: refused }); return; }
      // A session that ended while the panel was open. The way back is offered, never taken.
      if (takeSessionEnded()) { show({ kind: "ended" }); return; }

      // A session held — restored at boot, or just handed back by the provider — or a host run with
      // auth switched off, which answers anybody.
      const status = await sessionStore.authorize();
      if (status === "live") {
        await establishClusterSession();
        const r = sessionStore.getState().session;
        if (!(r && r.open) && (sessionStore.tierOf() || "none") === "none") { show({ kind: "no_access" }); return; }
        onUser();
        return;
      }

      // Nothing held: find the provider. A stored one is where this browser signed in before, and is
      // asked first; one that no longer answers is dropped and looked for again, because a cluster's
      // provider can move and the address it moved to is what the next two answer. The page's own
      // origin is a member that serves this panel; the build's own address is a static deployment
      // made for one cluster.
      if (sessionStore.provider()) {
        if (await leave()) return;
        sessionStore.setProvider(null);
      }
      const here = await discoverProvider(window.location.origin);
      if (here.ok) { await adopt(here); return; }
      const configured = configuredAnchor();
      if (configured) {
        const found = await discoverProvider(configured);
        if (found.ok) { await adopt(found); return; }
        show({ kind: found.reason === "no_provider" ? "no_provider" : "unreachable", origin: configured });
        return;
      }
      if (here.reason === "no_provider") { show({ kind: "no_provider" }); return; }
      show({ kind: "connect" });
    } finally {
      running.current = false;
    }
  }, [adopt, leave, onUser, show]);

  React.useEffect(() => {
    mounted.current = true;
    run();
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mount; `run` is stable
  }, []);

  // Keep the address honest for the screen actually showing.
  React.useEffect(() => { go(state.kind === "connect" ? "connect" : null); }, [state.kind]);

  // Another address is offered only where one was given: a panel served by a member signs in where
  // that member says, and offering to change it would offer a door that does not exist.
  const provider = sessionStore.provider();
  const typedAddress = !!(provider && provider.via && provider.via !== originOf(window.location.origin));
  const changeCluster = typedAddress ? () => { sessionStore.setProvider(null); show({ kind: "connect" }); } : null;

  const signOut = async () => {
    writeStoredUser(null);
    const leaving = await sessionStore.signOut();
    if (!leaving) window.location.reload();
  };

  if (state.kind === "working") return <div className="login-shell" />;
  if (state.kind === "connect") return <ClusterPage onFound={adopt} />;
  return (
    <ClusterUnavailable
      state={state}
      onSignIn={leave}
      onRetry={() => { show({ kind: "working" }); run(); }}
      onChangeCluster={changeCluster}
      onSignOut={signOut}
      accountPage={sessionStore.accountPage()} />
  );
}

export { AuthGate };
