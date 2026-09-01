// AnchorPage — one anchor of the cluster, with its own sub-tabs.
//
// A cluster has members, and a member is a node or an anchor. Both are reached at
// `#/cluster/member/<member>`, because both are the same kind of thing to a URL: one machine's role in one
// cluster. What differs is the body — a node runs game servers and reports capacity, an anchor
// provides one capability to the whole cluster and reports what that capability holds.
//
// The tabs are the anchor's own (`ROUTE_TABS.anchor`) and each one is a URL:
// `#/cluster/member/<member>` opens Overview, `#/cluster/member/<member>/users` opens the accounts,
// and the trail above names whichever
// is open. That is the node page's structure exactly, with different data in it.
//
// Reached from the Anchors card on the Cluster page, which is where a person meets this member as a
// member. The page repeats none of that card's columns — the trail says where it came from, and the
// same row twice is the one thing it has to avoid to be worth having.

import { Icon } from "../../components/Icon.jsx";
import { SubTabs } from "../../components/SubTabs.jsx";
import { useAccountHolder } from "../../hooks/useAccountHolder.js";
import { ROUTE_TABS } from "../../lib/labels.js";
import { AccountsAdmin } from "./AccountsAdmin.jsx";
import { AnchorConfiguration } from "./AnchorConfiguration.jsx";
import { AnchorLogs } from "./AnchorLogs.jsx";
import { AnchorOverview } from "./AnchorOverview.jsx";

function AnchorPage({ member, tab, onSelectTab }) {
  const { anchor, anchored } = useAccountHolder();

  const name = (member && (member.label || member.nodeId)) || "Anchor";
  // The door first: it is the address this browser actually reaches. The roster's is what one member
  // says about another, and where the two differ the working one is the one to show.
  const address = anchor || (member && member.clientUrl) || "";
  const capability = member && member.capability;

  const tabs = ROUTE_TABS.anchor;
  const active = tabs.some(t => t.id === tab) ? tab : "overview";

  const head = (
    <div className="dash-head dash-head--actions">
      <div className="dash-head__titles">
        <h1><Icon name="anchor" size={20} /> {name}</h1>
        <div className="dash-head__sub">
          {capability
            ? <>Holds this cluster’s <b>{capability}</b></>
            : "Holds no capability yet"}
          {address && <> &middot; <span className="svc-fact svc-fact--unit">{address}</span></>}
        </div>
      </div>
    </div>
  );

  // An anchor holding the accounts, reached by a browser signed in at a NODE. It can read nothing
  // here and write nothing anywhere, and naming the holder is the whole of what this browser knows —
  // a member gives out an anchor's name and never its address.
  const elsewhere = anchored && !anchor;

  const body = () => {
    if (elsewhere) {
      return (
        <div className="chat-brief">
          <div className="chat-brief__empty chat-brief__empty--neutral">
            <div className="chat-brief__empty-title">Signed in somewhere else</div>
            <div className="chat-brief__empty-sub">
              These accounts are {name}’s. Sign in there to manage them.
            </div>
          </div>
        </div>
      );
    }
    if (active === "users") return <AccountsAdmin />;
    if (active === "logs") return <AnchorLogs anchor={anchor} />;
    if (active === "config") return <AnchorConfiguration anchor={anchor} />;
    return <AnchorOverview anchor={anchor} member={member} />;
  };

  return (
    <>
      {head}
      <SubTabs tabs={tabs} active={active} onChange={onSelectTab} />
      {body()}
    </>
  );
}

export { AnchorPage };
export default AnchorPage;
