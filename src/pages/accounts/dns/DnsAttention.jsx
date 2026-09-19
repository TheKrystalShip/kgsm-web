// DnsAttention — "DNS · needs a look". The one card that reads every lane of the anchor's status
// document for a problem, so a person opening the Overview tab (or this card alone, pinned) sees
// every open issue in one place rather than hunting three tabs.
//
// Four kinds of row, most severe first: the zone itself unreachable, a name a record this cluster
// did not publish is holding, a name blocked from publishing at all, and a certificate order that
// failed. Each carries the action this build can actually take — a zone recheck or a certificate
// renewal — and a row this build cannot yet act on (a contested name; nothing here ever redraws one)
// still reports the fact with no action rather than a control that would refuse.

import React from "react";

import { BriefCard } from "../../../components/BriefCard.jsx";
import { PinButton } from "../../../components/widgets/PinButton.jsx";
import { checkZoneNow, renewCertificate } from "../../../lib/dnsClient.js";
import { useNav } from "../../../components/NavContext.jsx";
import { dnsStore } from "../../../lib/stores/dns.js";
import { fmtSince, shortName, useDnsStatus } from "./dnsKit.jsx";
import { LeafBriefEmpty, LeafBriefItem } from "../../leaf/leafOverviewKit.jsx";

function DnsAttention() {
  const { data } = useDnsStatus();
  const nav = useNav();
  const [busy, setBusy] = React.useState(null);   // the item key currently running its action
  const [err, setErr] = React.useState(null);

  if (!data) {
    return (
      <BriefCard icon="triangle-alert" title="DNS · needs a look"
        pin={<PinButton type="dns.attention" params={{}} label="DNS · needs a look" />}>
        <LeafBriefEmpty title="Reading…" />
      </BriefCard>
    );
  }

  const holder = (data.standing && data.standing.holder) || null;
  const zoneName = data.standing && data.standing.zone;
  const zone = data.zone || {};
  const names = data.names || [];
  const orders = (data.certificates && data.certificates.orders) || [];
  const contested = zone.contested || [];
  const blocked = names.filter((n) => n.state === "blocked");
  const failed = orders.filter((o) => o.state === "failed");
  const zoneDown = !!(zone.lastPass && !zone.lastPass.succeeded);

  const goNames = () => holder && nav.openHost(holder, "names");

  const run = (key, action) => {
    setErr(null);
    setBusy(key);
    action().catch((e) => setErr((e && e.userMessage) || "That didn’t work.")).finally(() => {
      setBusy(null);
      dnsStore.refresh().catch(() => {});
    });
  };

  const items = [];
  if (zoneDown) {
    items.push({
      key: "zone", tone: "danger", icon: "refresh-cw", title: "Zone unreachable",
      detail: [zone.lastPass.error, fmtSince(zone.lastPass.startedAt) ? "since " + fmtSince(zone.lastPass.startedAt) : null]
        .filter(Boolean).join(" · "),
      action: "Check now", onClick: () => run("zone", checkZoneNow),
    });
  }
  for (const name of contested) {
    items.push({
      key: "contested:" + name, tone: "danger", icon: "circle-x",
      title: shortName(name, zoneName) + " contested",
      detail: "a record this cluster did not publish holds this name",
    });
  }
  for (const row of blocked) {
    items.push({
      key: "blocked:" + row.name, tone: "warn", icon: "globe",
      title: shortName(row.name, zoneName) + " blocked",
      detail: row.note || null,
      action: "Names", onClick: goNames,
    });
  }
  for (const order of failed) {
    items.push({
      key: "cert:" + order.name, tone: "warn", icon: "badge-check",
      title: shortName(order.name, zoneName) + " certificate failed",
      detail: [order.failure, fmtSince(order.finishedAt) ? fmtSince(order.finishedAt) : null]
        .filter(Boolean).join(" · "),
      action: "Renew now", onClick: () => run("cert:" + order.name, () => renewCertificate(order.name)),
    });
  }

  return (
    <BriefCard icon="triangle-alert" title="DNS · needs a look" count={items.length || null}
      pin={<PinButton type="dns.attention" params={{}} label="DNS · needs a look" />}>
      {items.length === 0 ? (
        <LeafBriefEmpty title="Nothing flagged" />
      ) : (
        <div className="chat-brief__list">
          {items.map((it) => (
            <LeafBriefItem key={it.key} tone={it.tone} icon={it.icon} title={it.title} detail={it.detail}
              action={it.onClick && busy !== it.key ? it.action : (busy === it.key ? "Working…" : null)}
              onClick={it.onClick && busy !== it.key ? it.onClick : undefined} />
          ))}
        </div>
      )}
      {err && <div className="settings-users__note"><span>{err}</span></div>}
    </BriefCard>
  );
}

export { DnsAttention };
