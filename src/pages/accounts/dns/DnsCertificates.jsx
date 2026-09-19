// DnsCertificates — the Certificates tab: its own 4 KPIs plus the one table every certificate order
// this anchor has made is in. `DnsCertificatesTable` is the pinnable half — each KPI is separately
// pinnable too (`dnsKpis.jsx`), so a dashboard can carry just the figure somebody watches.
//
// A "name released" row (the alias or member it was issued for no longer exists) keeps its history
// but offers no action — renewing something nothing points at any more would ask the issuer for a
// certificate this cluster could not publish.

import React from "react";

import { CardTable } from "../../../components/CardTable.jsx";
import { PinButton } from "../../../components/widgets/PinButton.jsx";
import { renewCertificate } from "../../../lib/dnsClient.js";
import { dnsStore } from "../../../lib/stores/dns.js";
import {
  DnsKpiCertExpiry, DnsKpiCertFailed, DnsKpiCertInFlight, DnsKpiCertWeek,
} from "./dnsKpis.jsx";
import { daysUntil, fmtDateTime, fmtShortDate, NameCell, shortName, useDnsStatus } from "./dnsKit.jsx";
import { DnsRowActions } from "./dnsRowActions.jsx";

const ORDER_STATE_META = {
  issued: { tone: "ok", label: "issued" },
  queued: { tone: "provisional", label: "queued" },
  issuing: { tone: "provisional", label: "issuing" },
  failed: { tone: "danger", label: "failed" },
};

function OrderStateBadge({ state, released }) {
  if (released) return <span className="cluster-badge cluster-badge--muted"><span className="cluster-badge__dot"></span>name released</span>;
  const meta = ORDER_STATE_META[state] || { tone: "muted", label: state || "unknown" };
  return <span className={"cluster-badge cluster-badge--" + meta.tone}><span className="cluster-badge__dot"></span>{meta.label}</span>;
}

function DnsCertificatesTable() {
  const { data } = useDnsStatus();
  const [pending, setPending] = React.useState(null);
  const [err, setErr] = React.useState(null);

  const zone = data && data.standing && data.standing.zone;
  const orders = (data && data.certificates && data.certificates.orders) || [];
  const names = (data && data.names) || [];
  const nameByValue = new Map(names.map((n) => [n.name, n]));

  const renewAction = (order) => ({
    icon: "refresh-cw", label: "Renew now", tone: "safe", pending: pending === order.name,
    onRun: () => {
      setErr(null);
      setPending(order.name);
      renewCertificate(order.name)
        .catch((e) => setErr((e && e.userMessage) || "That didn’t work."))
        .finally(() => { setPending(null); dnsStore.refresh().catch(() => {}); });
    },
  });

  return (
    <>
      {err && <div className="settings-users__note"><span>{err}</span></div>}
      <CardTable icon="badge-check" title="Certificates" count={orders.length}
        pin={<PinButton type="dns.certificates" params={{}} label="Certificates" />}
        defaultSort={{ key: "expires", dir: "asc" }}
        columns={[
          {
            key: "name", label: "Name", width: "minmax(0,1.5fr)",
            render: (o) => {
              const released = !nameByValue.has(o.name);
              const sub = released ? "name released" : o.member + " · renews " + (fmtShortDate(o.renewsFrom) || "—");
              return <NameCell name={shortName(o.name, zone)} sub={sub} />;
            },
          },
          { key: "for", label: "For", width: "minmax(0,1fr)", render: (o) => o.member },
          {
            key: "state", label: "State", width: "130px",
            render: (o) => <OrderStateBadge state={o.state} released={!nameByValue.has(o.name)} />,
          },
          { key: "issued", label: "Issued", width: "140px", render: (o) => <span className="dim">{fmtDateTime(o.requestedAt)}</span> },
          {
            key: "expires", label: "Expires", width: "160px", sort: (o) => (o.notAfter ? new Date(o.notAfter) : null),
            render: (o) => o.notAfter
              ? <>{fmtShortDate(o.notAfter)} <span className="dim">{"· " + daysUntil(o.notAfter) + " days"}</span></>
              : <span className="dim">{"—"}</span>,
          },
          { key: "renewsFrom", label: "Renews from", width: "120px", render: (o) => <span className="dim">{fmtShortDate(o.renewsFrom) || "—"}</span> },
          {
            key: "actions", label: "", align: "right", width: "84px",
            render: (o) => <DnsRowActions action={
              o.state === "issued" && nameByValue.has(o.name) ? renewAction(o) : null
            } />,
          },
        ]}
        rows={orders}
        getKey={(o) => o.name}
        empty="No certificates ordered yet"
        className="dns-table dns-table--certs"
      />
    </>
  );
}

function DnsCertificates() {
  return (
    <>
      <div className="dns-kpis">
        <DnsKpiCertWeek />
        <DnsKpiCertExpiry />
        <DnsKpiCertFailed />
        <DnsKpiCertInFlight />
      </div>
      <DnsCertificatesTable />
    </>
  );
}

export { DnsCertificates, DnsCertificatesTable };
