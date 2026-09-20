// AnchorPage — one anchor of the cluster, with its own sub-tabs.
//
// A cluster has members, and a member is a node or an anchor. Both are reached at
// `#/cluster/member/<member>`, because both are the same kind of thing to a URL: one machine's role in one
// cluster. What differs is the body — a node runs game servers and reports capacity, an anchor
// provides one capability to the whole cluster and reports what that capability holds.
//
// **The component's own surface is served by the member on screen.** A component owns its
// configuration, its unit and its journal wherever it runs, and an anchor is a peer of every node
// rather than something one of them hosts — so System, Logs and Configuration are read at THIS
// member's address with the cluster's credential, and they are the same bodies a node's leaf page
// mounts. Only the transport differs, which is the whole of what `componentSurface` decides.
//
// **The capability's surface is the capability's.** The cluster's accounts belong to the `auth`
// holder and are reached at the door this browser signed in through; a conversation corpus belongs
// to the assistant; names and certificates to DNS. `anchorTabs` picks which of those this member
// offers, so a strip can never point one member's page at another member's data.
//
// The address is the member's, for the same reason. The door is this member's address only when this
// member IS the door.
//
// Reached from the Anchors card on the Cluster page, which is where a person meets this member as a
// member. The page repeats none of that card's columns — the trail says where it came from, and the
// same row twice is the one thing it has to avoid to be worth having.

import React from "react";

import { Icon } from "../../components/Icon.jsx";
import { SubTabs } from "../../components/SubTabs.jsx";
import { useAccountHolder } from "../../hooks/useAccountHolder.js";
import { anchorSurface } from "../../lib/componentSurface.js";
import { anchorTabs } from "../../lib/labels.js";
import { AccountsAdmin } from "./AccountsAdmin.jsx";
import { AnchorOverview } from "./AnchorOverview.jsx";
import { MemberSettings } from "../diagnostics/MemberSettings.jsx";
import { ComponentCommands } from "../component/ComponentCommands.jsx";
import { ComponentConfiguration } from "../component/ComponentConfiguration.jsx";
import { ComponentJournal, useServedJournal } from "../component/ComponentJournal.jsx";
import { ComponentSystem } from "../component/ComponentSystem.jsx";
import { AssistantConversations } from "../leaf/AssistantConversations.jsx";
import { AssistantOverview } from "../leaf/AssistantOverview.jsx";
import { DnsCertificates } from "./dns/DnsCertificates.jsx";
import { DnsNames } from "./dns/DnsNames.jsx";
import { DnsOverview } from "./dns/DnsOverview.jsx";

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
  // Every dns.* body reads through `dnsKit.useDnsStatus`, keyed on the CAPABILITY rather than this
  // member's id — the same document a pinned dns.* widget reads, so the page and a pin never fetch
  // it twice and a failover moves the data without anyone re-pinning anything.
  dns: {
    overview: () => <DnsOverview />,
    names: () => <DnsNames />,
    certificates: () => <DnsCertificates />,
  },
};

// What this member going down costs, said in the review before a change restarts it. Only the holder
// of a capability knows: the `auth` anchor holds every account in the cluster, so nobody can sign in
// anywhere while it is down, and the assistant takes every surface's chat with it.
const RESTART_COST = {
  auth: "It holds every account in the cluster, so nobody can sign in anywhere while it restarts — "
    + "and nothing puts these values back on its behalf if it does not come back.",
  assistant: "Every surface's chat goes quiet while it restarts, and a turn in flight ends where it "
    + "is — nothing puts these values back on its behalf if it does not come back.",
  dns: "It holds this cluster's names and the account that renews their certificates, so no name is "
    + "issued or renewed while it restarts.",
};

// A component's journal, read at this member's own address. Its own component so the read is a hook
// at the top of one, rather than a hook the page runs on every tab.
function AnchorJournal({ surface, label }) {
  const { lines, status, error, live } = useServedJournal(surface);
  return <ComponentJournal label={label} lines={lines} status={status} error={error} live={live} />;
}

// What systemd reports about this member's unit, read the same way.
function AnchorSystem({ surface, capability }) {
  const [row, setRow] = React.useState(null);
  const key = surface ? surface.key : null;
  const ref = React.useRef(surface);
  ref.current = surface;

  React.useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    setRow(null);
    ref.current.readSystem().then(
      (r) => { if (!cancelled) setRow(r); },
      // An unreadable row stays null, which the body renders as "nothing is shown until it answers"
      // rather than as a unit that is down.
      () => {},
    );
    return () => { cancelled = true; };
  }, [key]);

  // No resources below the facts: kgsm-monitor records a machine's history, and a component serving
  // its own row has none to offer.
  return <ComponentSystem svc={row} componentId={capability} selfServed />;
}

// The commands it declares, from its own manifest. Null until one is in hand, and null is also the
// answer for a component that ships none — the body says so rather than claiming an empty set.
function AnchorCommands({ surface }) {
  const [manifest, setManifest] = React.useState(null);
  const key = surface ? surface.key : null;
  const ref = React.useRef(surface);
  ref.current = surface;

  React.useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    setManifest(null);
    ref.current.readCommands().then(
      (m) => { if (!cancelled) setManifest(m); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [key]);

  return <ComponentCommands commands={manifest} />;
}

function AnchorPage({ member, tab, onSelectTab, onReviewConversation }) {
  const { anchor, holder } = useAccountHolder();

  const name = (member && (member.label || member.nodeId)) || "Anchor";
  const capability = member && member.capability;

  // Whether this member is the door this browser signed in through. Only then is the door's origin
  // this member's address, and only then are the accounts on screen its accounts.
  const isDoor = !!anchor && !!member && holder === member.nodeId;
  const address = (isDoor ? anchor : (member && member.clientUrl)) || "";

  // What reaches the component this member IS. Keyed on the address and the capability, which is
  // everything it resolves — a re-render rebuilds the object and nothing re-reads.
  const surface = React.useMemo(
    () => anchorSurface({ address, capability, label: name }),
    [address, capability, name]);

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
    // The cluster's rather than the member's: Settings moves a capability or removes a member,
    // addressed to whichever member answered the roster. It needs no session with the machine on
    // screen, which is what makes it the one tab a departed member can still answer.
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

    // The cluster's accounts, which are the `auth` holder's and behind the door this browser signed
    // in through. A session opened at a node holds nothing for them: naming the holder is the whole
    // of what it knows, since a member gives out an anchor's name and never its address.
    if (active === "users") {
      if (!anchor) {
        return (
          <div className="chat-brief">
            <div className="chat-brief__empty chat-brief__empty--neutral">
              <div className="chat-brief__empty-title">Signed in somewhere else</div>
              <div className="chat-brief__empty-sub">
                These accounts are {name}’s. Sign in there to reach them.
              </div>
            </div>
          </div>
        );
      }
      return <AccountsAdmin />;
    }

    if (own[active]) return own[active](ownProps);

    // Everything below is the COMPONENT's own, served by this member at its own address. A
    // capability the panel has no route prefix for has no such surface, and that is said plainly
    // rather than rendered as a component answering nothing.
    if (!surface) {
      return (
        <div className="chat-brief">
          <div className="chat-brief__empty chat-brief__empty--neutral">
            <div className="chat-brief__empty-title">No surface here</div>
            <div className="chat-brief__empty-sub">
              {address
                ? name + " serves no configuration, journal or unit facts this panel can read."
                : "The roster gives no address for " + name + ", so there is nothing to ask."}
            </div>
          </div>
        </div>
      );
    }

    if (active === "system") return <AnchorSystem surface={surface} capability={capability} />;
    if (active === "logs") return <AnchorJournal surface={surface} label={name} />;
    if (active === "commands") return <AnchorCommands surface={surface} />;

    return (
      <ComponentConfiguration
        surface={surface}
        restartWarning={RESTART_COST[capability]} />
    );
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
