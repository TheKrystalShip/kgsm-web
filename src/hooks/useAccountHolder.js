import { sessionStore } from "../lib/sessionStore.js";
import { useStore } from "@thekrystalship/krystal-ui/lib/store";
import { clusterStore } from "../lib/stores/cluster.js";

// useAccountHolder — which member holds this cluster's accounts, and where this browser reaches them.
//
// Two facts, and keeping them apart is the whole point. `holder` is the member the cluster's capability
// assignment names for `auth`. `anchor` is the provider THIS browser signed in through — empty for a
// panel that knows none. The anchor's page shows the accounts' figures and the way into the provider's
// admin pages only on the member that is both, so one member's accounts are never reported under
// another's name.
//
// Live, because the cluster is. The capability assignment is re-read on every roster read and on
// cluster discovery's own cadence, so an anchor joining, leaving or being reassigned moves the
// surfaces on its own — no reload, no redeploy.
const AUTH_CAPABILITY = "auth";

function useAccountHolder() {
  // Subscribed for its own sake — the value is read back through the store's resolver, so what
  // "held" means is defined once, where the capability list lives.
  useStore(clusterStore, s => s.capabilities);

  const anchor = sessionStore.anchorOrigin() || "";
  const holder = clusterStore.holderOf(AUTH_CAPABILITY);

  return { anchor, holder };
}

export { useAccountHolder };
