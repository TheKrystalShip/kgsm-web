import React from "react";

import { sessionStore } from "../lib/sessionStore.js";

// useAccountHolder — where this cluster's accounts are held.
//
// A cluster whose accounts sit with an anchor has ONE set of them, and the member a screen happens
// to be pointed at is a routing detail nobody chooses: no picker, no "on this node", one list. A
// cluster without an anchor keeps its accounts on each node, and there the node is the subject and
// naming it is the honest thing to do. Both screens that administer accounts ask the same question,
// so they ask it the same way.
//
// `anchor` is the anchor's address, or "" when the node holds its own. `known` says whether a member
// has answered yet — a screen that draws the per-node framing before the answer arrives would show
// it and then take it away. A browser that has signed in already knows on the first render, because
// the address is kept; only a first visit waits.
function useAccountHolder() {
  const [state, setState] = React.useState(() => {
    const held = sessionStore.anchorOrigin();
    return { anchor: held || "", known: !!held };
  });

  React.useEffect(() => {
    let live = true;
    sessionStore.resolveAnchor().then(
      (url) => { if (live) setState({ anchor: url || "", known: true }); },
      () => { if (live) setState((s) => (s.known ? s : { anchor: "", known: false })); });
    return () => { live = false; };
  }, []);

  return state;
}

export { useAccountHolder };
