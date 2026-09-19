// DnsPublishing — how the zone is being kept: which zone, who is writing it, how long a record
// lives, how often it is checked against the zone, and which issuer certificates come from. The
// "Check zone now" action asks for a pass sooner than the timer would run one; it is harmless to
// press more than once, since a check that finds nothing to do simply reports that.

import React from "react";

import { BriefCard } from "../../../components/BriefCard.jsx";
import { Icon } from "../../../components/Icon.jsx";
import { PinButton } from "../../../components/widgets/PinButton.jsx";
import { checkZoneNow } from "../../../lib/dnsClient.js";
import { dnsStore } from "../../../lib/stores/dns.js";
import { LeafFacts } from "../../leaf/leafOverviewKit.jsx";
import { useDnsStatus } from "./dnsKit.jsx";

function DnsPublishing() {
  const { data } = useDnsStatus();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const standing = data && data.standing;

  const check = () => {
    setErr(null);
    setBusy(true);
    checkZoneNow()
      .catch((e) => setErr((e && e.userMessage) || "That didn’t work."))
      .finally(() => { setBusy(false); dnsStore.refresh().catch(() => {}); });
  };

  const action = (
    <button type="button" className="dash-section__more" onClick={check} disabled={busy || !standing}>
      <Icon name="refresh-cw" size={11} strokeWidth={2.2} className={busy ? "cluster-spin" : ""} />
      {busy ? "Checking…" : "Check zone now"}
    </button>
  );

  return (
    <BriefCard icon="globe" title="Publishing" action={action}
      pin={<PinButton type="dns.publishing" params={{}} label="Publishing" />}>
      {standing ? (
        <LeafFacts rows={[
          ["Zone", standing.zone || "—"],
          ["Written by", standing.member
            ? <>{standing.member} <span className={"cluster-chip cluster-chip--" + (standing.holds ? "ok" : "muted")}>
              {standing.holds ? "holding" : "standing by"}</span></>
            : "—"],
          ["Record lifetime", standing.ttlSeconds != null ? standing.ttlSeconds + " s" : "—"],
          ["Zone check", standing.reconcileSeconds != null
            ? "every " + Math.round(standing.reconcileSeconds / 60) + " min" : "—"],
          ["Certificates", "Let’s Encrypt · " + (standing.acmeDirectory && /staging/i.test(standing.acmeDirectory)
            ? "staging" : "production")],
        ]} />
      ) : (
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">Reading…</div>
        </div>
      )}
      {err && <div className="settings-users__note"><span>{err}</span></div>}
    </BriefCard>
  );
}

export { DnsPublishing };
