// AnchorPage — the cluster's auth anchor, and the accounts it holds.
//
// An anchor is a member that provides ONE capability to the whole cluster, and the one that holds
// `auth` holds every account in it. So this is where accounts are administered in a cluster: on the
// member that owns them and is the only thing that writes them. A node holds a read-only replica and
// refuses every write against it, which is why no node's page offers the screen.
//
// There is one route and it names no member. A cluster has one auth anchor, this browser signed in
// at it, and addressing the page by the member id would make the URL depend on a roster read that
// the accounts themselves do not need.
//
// Reached from the Anchors card on the Cluster page, which is where a person meets the anchor as a
// member. The page repeats none of that card's health columns — the trail above says where it came
// from, and the same row twice is the one thing this page has to avoid to be worth having.

import { Icon } from "../../components/Icon.jsx";
import { useAccountHolder } from "../../hooks/useAccountHolder.js";
import { useStore } from "../../lib/store.js";
import { clusterStore } from "../../lib/stores/cluster.js";
import { AccountsAdmin } from "./AccountsAdmin.jsx";

function AnchorPage() {
  const { anchor, anchored, holder, known } = useAccountHolder();
  const members = useStore(clusterStore, s => s.nodes);

  const row = holder ? members.find(m => m.nodeId === holder) : null;
  const name = (row && row.label) || holder || "Auth anchor";
  // The door first: it is the address this browser actually reaches, and the roster's is what one
  // member says. They agree in every case that works, and when they do not the working one is the
  // one to show.
  const address = anchor || (row && row.clientUrl) || "";

  const head = (
    <div className="dash-head dash-head--actions">
      <div className="dash-head__titles">
        <h1><Icon name="anchor" size={20} /> {name}</h1>
        <div className="dash-head__sub">
          Holds this cluster’s accounts
          {address && <> &middot; <span className="svc-fact svc-fact--unit">{address}</span></>}
        </div>
      </div>
    </div>
  );

  // Nothing holds the cluster's accounts, so there is no anchor to be on. Reachable by typing the
  // address, and by standing here while an anchor is removed.
  if (known && !anchored) {
    return (
      <>
        <div className="dash-head dash-head--actions">
          <div className="dash-head__titles">
            <h1><Icon name="anchor" size={20} /> Auth anchor</h1>
          </div>
        </div>
        <div className="chat-brief">
          <div className="chat-brief__empty chat-brief__empty--neutral">
            <div className="chat-brief__empty-title">This cluster has no auth anchor</div>
            <div className="chat-brief__empty-sub">
              Each node holds its own accounts. They are administered on that node’s API service.
            </div>
          </div>
        </div>
      </>
    );
  }

  // The accounts belong to the anchor and this session was opened at a node, so it can read nothing
  // here and write nothing anywhere. Naming the holder is the whole of what this browser knows —
  // a member gives out the anchor's name and never its address.
  if (anchored && !anchor) {
    return (
      <>
        {head}
        <div className="chat-brief">
          <div className="chat-brief__empty chat-brief__empty--neutral">
            <div className="chat-brief__empty-title">Signed in somewhere else</div>
            <div className="chat-brief__empty-sub">
              These accounts are {name}’s. Sign in there to manage them.
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {head}
      <AccountsAdmin />
    </>
  );
}

export { AnchorPage };
export default AnchorPage;
