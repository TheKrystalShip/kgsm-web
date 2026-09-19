// DnsOverview — the dns anchor's Overview body, rendered under the shared `AnchorOverview` (which
// already carries the Membership card every anchor's page shows). Four KPIs, the "needs a look"
// lane, and a Publishing card naming the zone this member writes into.

import { DnsAttention } from "./DnsAttention.jsx";
import {
  DnsKpiCertWeek, DnsKpiCollisions, DnsKpiNames, DnsKpiZone,
} from "./dnsKpis.jsx";
import { DnsPublishing } from "./DnsPublishing.jsx";

function DnsOverview() {
  return (
    <>
      <div className="dns-kpis">
        <DnsKpiNames />
        <DnsKpiZone />
        <DnsKpiCertWeek />
        <DnsKpiCollisions />
      </div>
      <DnsAttention />
      <DnsPublishing />
    </>
  );
}

export { DnsOverview };
