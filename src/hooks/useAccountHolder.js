import { sessionStore } from "../lib/sessionStore.js";
import { useStore } from "../lib/store.js";
import { clusterStore } from "../lib/stores/cluster.js";

// useAccountHolder — whether this cluster's accounts belong to an anchor, and where this browser can
// reach them.
//
// Two facts, and keeping them apart is the whole point. `anchored` says the accounts are the
// CLUSTER's: one set, one tier everywhere, administered on the anchor's page and on no node's.
// `anchor` says where THIS browser can read and write them — the door it signed in through — and it
// is empty for a session opened at a node, whatever the cluster has since become.
//
// They answer differently exactly once, and it is the case worth rendering honestly: a node that
// held its own accounts joins a cluster with an anchor. The cluster now says the anchor holds them
// and this session still cannot act on them, so the surface names the holder rather than offering a
// table whose every write the node refuses.
//
// Live, because the cluster is. The capability assignment is re-read on every roster read and on
// cluster discovery's own cadence, so an anchor joining, leaving or being reassigned moves the
// surfaces on its own — no reload, no redeploy.
//
// `known` says whether there is an answer yet. A door that is an anchor answers on the first render,
// because the address is kept; otherwise it waits for the cluster to have been read once. Until
// then the answer is "no anchor", which is the safe way round: the account calls resolve their own
// door, so a surface drawn a moment early still reaches the right place.
const AUTH_CAPABILITY = "auth";

function useAccountHolder() {
  // Subscribed for its own sake — the value is read back through the store's resolver, so what
  // "held" means is defined once, where the capability list lives.
  useStore(clusterStore, s => s.capabilities);
  const everLoaded = useStore(clusterStore, s => s.everLoaded);

  const anchor = sessionStore.anchorOrigin() || "";
  const holder = clusterStore.holderOf(AUTH_CAPABILITY);

  return { anchor, holder, anchored: !!anchor || !!holder, known: !!anchor || everLoaded };
}

export { useAccountHolder };
