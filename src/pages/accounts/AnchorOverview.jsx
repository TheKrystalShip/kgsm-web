// AnchorOverview — what this anchor is, and what it holds for the cluster.
//
// A node's overview is capacity and health, because a node runs things. An anchor runs one thing for
// everybody, so its overview answers the questions that follow from that: which capability it holds,
// where the cluster reaches it, whether the cluster can currently see it, and how many accounts and
// live sessions are behind the capability.
//
// Every figure here is measured or absent. The counts come from the accounts the anchor lists, so a
// browser that cannot read them shows no count rather than a zero — an anchor with no accounts and an
// anchor that could not be asked are different things, and one of them is an emergency.

import React from "react";

import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { KPI } from "../../components/KPI.jsx";
import { api } from "../../lib/apiClient.js";
import { MemberState } from "../diagnostics/clusterBadges.jsx";
import { LeafFacts } from "../leaf/leafOverviewKit.jsx";

function AnchorOverview({ anchor, member }) {
  const [accounts, setAccounts] = React.useState(null);   // null = not read
  const [reachable, setReachable] = React.useState(true);

  React.useEffect(() => {
    let live = true;
    if (!anchor) { setAccounts(null); return undefined; }
    api.users().list().then(
      (rows) => { if (live) { setAccounts(rows); setReachable(true); } },
      () => { if (live) { setAccounts(null); setReachable(false); } });
    return () => { live = false; };
  }, [anchor]);

  const total = accounts ? accounts.length : null;
  const waiting = accounts ? accounts.filter(a => a.status === "pending").length : null;
  const admins = accounts ? accounts.filter(a => a.status === "active" && a.tier === "admin").length : null;

  // A figure that could not be read is a dash. Rendering 0 would say this anchor holds no accounts,
  // which for the thing that holds every account in the cluster is the worst thing it could say.
  const n = (v) => (v === null ? "—" : String(v));

  return (
    <>
      <div className="dash-summary">
        <KPI icon="users" label="Accounts" value={n(total)}
          sub={reachable ? "in this cluster" : "couldn’t read them"}
          tone={reachable ? "muted" : "warn"} />
        <KPI icon="hourglass" label="Awaiting approval" value={n(waiting)}
          sub={waiting ? "they can sign in and see nothing" : null}
          tone={waiting ? "warn" : "muted"} />
        <KPI icon="shield" label="Administrators" value={n(admins)} sub="active"
          tone={admins === 0 ? "danger" : "muted"} />
      </div>

      <BriefCard icon="anchor" title="Membership">
        <LeafFacts rows={[
          ["Holds", member && member.capability
            ? <>the cluster’s <b>{member.capability}</b></>
            : "no capability yet"],
          ["Reached at", anchor || (member && member.clientUrl) || "—"],
          member && ["State", <MemberState key="s" membership={member.membership}
            status={member.status} enabled={member.enabled} />],
          ["Latency", member && member.latencyMs != null ? Math.round(member.latencyMs) + "ms" : "—"],
        ]} />
      </BriefCard>

      {!reachable && (
        <div className="settings-users__note">
          <Icon name="alert-triangle" size={14} />
          This browser could not read the accounts. The figures above are blank rather than zero.
        </div>
      )}
    </>
  );
}

export { AnchorOverview };
