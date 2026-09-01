// AnchorPage — one anchor of the cluster, with its own sub-tabs.
//
// A cluster has members, and a member is a node or an anchor. Both are reached at
// `#/cluster/member/<member>`, because both are the same kind of thing to a URL: one machine's role in one
// cluster. What differs is the body — a node runs game servers and reports capacity, an anchor
// provides one capability to the whole cluster and reports what that capability holds.
//
// THE TABS ARE THE MEMBER'S CAPABILITY'S, not the kind's (`anchorTabs`). Every anchor answers
// Overview and Settings, because both are read from the roster and from the cluster rather than from
// the machine. Everything past them belongs to a capability: the accounts, the journal and the
// configuration are the auth anchor's own routes, and an anchor holding something else serves none
// of them. A fixed strip offered all five to every anchor and pointed the last three at the door
// this browser signed in through — which is a different member, rendering its journal and its
// accounts under this one's name.
//
// The address is the member's, for the same reason. The door is this member's address only when this
// member IS the door.
//
// Reached from the Anchors card on the Cluster page, which is where a person meets this member as a
// member. The page repeats none of that card's columns — the trail says where it came from, and the
// same row twice is the one thing it has to avoid to be worth having.

import { Icon } from "../../components/Icon.jsx";
import { SubTabs } from "../../components/SubTabs.jsx";
import { useAccountHolder } from "../../hooks/useAccountHolder.js";
import { anchorTabs } from "../../lib/labels.js";
import { AccountsAdmin } from "./AccountsAdmin.jsx";
import { AnchorConfiguration } from "./AnchorConfiguration.jsx";
import { MemberSettings } from "../diagnostics/MemberSettings.jsx";
import { AnchorLogs } from "./AnchorLogs.jsx";
import { AnchorOverview } from "./AnchorOverview.jsx";
import { AssistantConversations } from "../leaf/AssistantConversations.jsx";
import { AssistantOverview } from "../leaf/AssistantOverview.jsx";

// What a capability adds to its holder's page, addressed at THIS member's own origin.
//
// These need no door. An anchor holding something other than `auth` has its sign-in shut — another
// member holds the accounts — so it verifies the cluster session this browser is already carrying,
// and the seam that reaches it (`assistantSession`) resolves an anchored target by member id and
// sends that credential. So the bodies are the ones the leaf page mounts, unchanged and taking the
// same single id: what differs is which machine answers, which is the whole point of an anchor.
//
// `overview` renders UNDER the member's own membership card rather than instead of it, because the
// two answer different questions — what this member is, and what the capability it holds is doing.
//
// The tab ids match ANCHOR_CAPABILITY_TABS in lib/labels.js. A capability with an entry there and
// none here gets the tab and nothing in it, which is why they are added together.
const CAPABILITY_BODIES = {
  assistant: {
    overview: (p) => <AssistantOverview {...p} />,
    conversations: (p) => <AssistantConversations {...p} />,
  },
};

// What a person is standing in front of when the door is somewhere else. The accounts, the journal
// and the configuration are all the auth anchor's and all behind the same door, so the sentence names
// the one they came for rather than the three together.
const OUT_OF_REACH = {
  users: "These accounts are",
  logs: "This journal is",
  config: "This configuration is",
};

function AnchorPage({ member, tab, onSelectTab, onReviewConversation }) {
  const { anchor, holder } = useAccountHolder();

  const name = (member && (member.label || member.nodeId)) || "Anchor";
  const capability = member && member.capability;

  // Whether this member is the door this browser signed in through. Only then is the door's origin
  // this member's address, and only then are the accounts on screen its accounts.
  const isDoor = !!anchor && !!member && holder === member.nodeId;
  const address = (isDoor ? anchor : (member && member.clientUrl)) || "";

  const tabs = anchorTabs(capability);
  const active = tabs.some(t => t.id === tab) ? tab : "overview";

  const head = (
    <div className="dash-head dash-head--actions">
      <div className="dash-head__titles">
        <h1>
          <Icon name="anchor" size={20} /> {name}
          {/* An anchor has no name to change — the cluster's member patch carries the enabled flag
              and nothing else — so this leads to what CAN be changed about it: which capability it
              holds, and whether it is still a member. */}
          <button className="diag-head__edit" onClick={() => onSelectTab("settings")}
            title={"Settings for " + name} aria-label={"Settings for " + name}>
            <Icon name="settings" size={13} />
          </button>
        </h1>
        <div className="dash-head__sub">
          {capability
            ? <>Holds this cluster’s <b>{capability}</b></>
            : "Holds no capability yet"}
          {address && <> &middot; <span className="svc-fact svc-fact--unit">{address}</span></>}
        </div>
      </div>
    </div>
  );

  const body = () => {
    // Both of these are the cluster's rather than the member's: Overview is the roster's answer about
    // this member, and Settings moves a capability or removes a member, addressed to whichever member
    // answered the roster. Neither needs a session with the machine on screen.
    if (active === "settings") return <MemberSettings member={member} host={null} />;

    const own = CAPABILITY_BODIES[capability] || {};
    const ownProps = { hostId: member && member.nodeId, onReviewConversation };

    if (active === "overview") {
      return (
        <>
          <AnchorOverview member={member} address={address} showsAccounts={isDoor} />
          {own.overview ? own.overview(ownProps) : null}
        </>
      );
    }
    if (own[active]) return own[active](ownProps);

    // The rest are the auth anchor's own routes, and this browser reaches them at the door. A session
    // opened at a node holds nothing for them: naming the holder is the whole of what it knows, since
    // a member gives out an anchor's name and never its address. The sentence names WHICH surface is
    // out of reach, because the three are behind the same door and a person is standing at one.
    if (!anchor) {
      return (
        <div className="chat-brief">
          <div className="chat-brief__empty chat-brief__empty--neutral">
            <div className="chat-brief__empty-title">Signed in somewhere else</div>
            <div className="chat-brief__empty-sub">
              {OUT_OF_REACH[active] || "This is"} {name}’s. Sign in there to reach them.
            </div>
          </div>
        </div>
      );
    }
    if (active === "users") return <AccountsAdmin />;
    if (active === "logs") return <AnchorLogs anchor={anchor} />;
    return <AnchorConfiguration anchor={anchor} />;
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
