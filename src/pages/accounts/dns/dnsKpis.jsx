// dnsKpis.jsx — the DNS anchor's glance figures, each its own pinnable card exactly like the
// fleet's twelve tiles: one figure, one card, so a dashboard can carry just the one somebody
// watches. `useDnsStatus` is the one fetch all seven share.

import { fmtRelative } from "../../../lib/formatting.js";
import { KPI } from "../../../components/KPI.jsx";
import { PinButton } from "../../../components/widgets/PinButton.jsx";
import { daysUntil, fmtNext, fmtShortDate, fmtSince, shortName, useDnsStatus } from "./dnsKit.jsx";

// Let's Encrypt's own limit — certificates issued per registered domain per week — not a figure
// this cluster configures, and not carried on the wire because it never changes independently of
// the issuer. Named here so the KPI can say what the count is measured against.
const LETSENCRYPT_WEEKLY_LIMIT = 50;

// "2m ago" without the "ago" — the LED age reads as a bare duration beside its dot.
function fmtAge(iso, now = new Date()) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return fmtRelative(d, now).replace(/\s*ago$/, "");
}

function Loading({ icon, label, pinType }) {
  return <KPI icon={icon} label={label} value="—" tone="muted"
    pin={<PinButton type={pinType} params={{}} label={label} />} />;
}

function DnsKpiNames() {
  const { data } = useDnsStatus();
  if (!data) return <Loading icon="globe" label="Names published" pinType="dns.kpi.names" />;

  const names = data.names || [];
  const total = names.length;
  const published = names.filter((n) => n.state === "published").length;
  const blocked = names.filter((n) => n.state === "blocked").length;
  const contested = (data.zone && data.zone.contested) || [];

  const byKind = (kind) => names.filter((n) => n.kind === kind).length;
  const sub = blocked || contested.length
    ? [blocked ? blocked + " blocked" : null, contested.length ? contested.length + " contested" : null]
      .filter(Boolean).join(" · ")
    : byKind("member") + " nodes · " + byKind("capability") + " anchors · "
      + (byKind("game") + byKind("alias")) + " servers";

  return (
    <KPI icon="globe" label="Names published" value={total ? published + " of " + total : "0"}
      tone={published < total ? "warn" : "ok"} sub={sub}
      barPct={total ? (published / total) * 100 : 0}
      barColor={published < total ? "var(--warning-fg)" : "var(--krystal-teal)"}
      pin={<PinButton type="dns.kpi.names" params={{}} label="Names published" />}
    />
  );
}

function DnsKpiZone() {
  const { data } = useDnsStatus();
  if (!data) return <Loading icon="refresh-cw" label="Zone" pinType="dns.kpi.zone" />;

  const zone = data.zone || {};
  const pass = zone.lastPass;
  const ok = !!(pass && pass.succeeded);
  const unmeasured = !pass;

  const value = unmeasured ? "Not checked yet" : ok ? "In sync" : "Unreachable";
  const since = fmtSince(zone.lastSucceededAt) || (pass ? fmtSince(pass.startedAt) : null);
  const durationMs = pass ? pass.durationMs : null;
  const next = fmtNext(zone.nextPassAt);
  const sub = [
    since ? (ok ? "checked " + since : "in sync " + since) : null,
    ok && durationMs != null ? durationMs + " ms" : null,
    next ? (ok ? next : "next try " + next.replace(/^next /, "")) : null,
  ].filter(Boolean).join(" · ") || (pass && pass.error) || null;

  return (
    <KPI icon="refresh-cw" label="Zone" value={value} tone={unmeasured ? "muted" : ok ? "muted" : "danger"}
      sub={sub}
      led={unmeasured ? undefined : ok ? "live" : "down"}
      ledLabel={fmtAge(zone.lastSucceededAt || (pass && pass.startedAt))}
      pin={<PinButton type="dns.kpi.zone" params={{}} label="Zone" />}
    />
  );
}

function DnsKpiCertWeek() {
  const { data } = useDnsStatus();
  if (!data) return <Loading icon="badge-check" label="Certificates this week" pinType="dns.kpi.certWeek" />;

  const issued = (data.certificates && data.certificates.issuedLastWeek) || 0;
  const zone = (data.standing && data.standing.zone) || null;
  const ratio = issued / LETSENCRYPT_WEEKLY_LIMIT;

  return (
    <KPI icon="badge-check" label="Certificates this week"
      value={issued + " of " + LETSENCRYPT_WEEKLY_LIMIT}
      tone={ratio >= 0.8 ? "warn" : "muted"}
      sub={(zone || "this cluster") + " · Let’s Encrypt"}
      barPct={Math.min(100, ratio * 100)}
      barColor={ratio >= 0.8 ? "var(--warning-fg)" : "var(--krystal-teal)"}
      pin={<PinButton type="dns.kpi.certWeek" params={{}} label="Certificates this week" />}
    />
  );
}

function DnsKpiCollisions() {
  const { data } = useDnsStatus();
  if (!data) return <Loading icon="shuffle" label="Port collisions" pinType="dns.kpi.collisions" />;

  const names = data.names || [];
  const games = names.filter((n) => n.kind === "game");
  const measured = games.filter((n) => Array.isArray(n.collisions));
  const colliding = measured.filter((n) => n.collisions.length > 0).length;

  return (
    <KPI icon="shuffle" label="Port collisions" value={String(colliding)}
      tone={colliding ? "warn" : "ok"}
      sub={measured.length + " of " + games.length + " servers checked"}
      pin={<PinButton type="dns.kpi.collisions" params={{}} label="Port collisions" />}
    />
  );
}

function newestExpiring(data) {
  const orders = (data.certificates && data.certificates.orders) || [];
  const withExpiry = orders.filter((o) => o.state === "issued" && o.notAfter);
  if (!withExpiry.length) return null;
  return withExpiry.reduce((soonest, o) =>
    new Date(o.notAfter) < new Date(soonest.notAfter) ? o : soonest);
}

function DnsKpiCertExpiry() {
  const { data } = useDnsStatus();
  if (!data) return <Loading icon="timer" label="Next to expire" pinType="dns.kpi.certExpiry" />;

  const soonest = newestExpiring(data);
  const days = soonest ? daysUntil(soonest.notAfter) : null;
  const zone = data.standing && data.standing.zone;

  return (
    <KPI icon="timer" label="Next to expire"
      value={days == null ? "—" : String(days)} unit={days == null ? undefined : "days"}
      tone="muted"
      sub={soonest ? shortName(soonest.name, zone) + " · " + fmtShortDate(soonest.notAfter) : "nothing issued yet"}
      pin={<PinButton type="dns.kpi.certExpiry" params={{}} label="Next to expire" />}
    />
  );
}

function DnsKpiCertFailed() {
  const { data } = useDnsStatus();
  if (!data) return <Loading icon="circle-x" label="Failed orders" pinType="dns.kpi.certFailed" />;

  const failed = (data.certificates && data.certificates.failedLastWeek) || 0;
  return (
    <KPI icon="circle-x" label="Failed orders" value={String(failed)} tone={failed ? "danger" : "ok"}
      sub="last 7 days"
      pin={<PinButton type="dns.kpi.certFailed" params={{}} label="Failed orders" />}
    />
  );
}

function DnsKpiCertInFlight() {
  const { data } = useDnsStatus();
  if (!data) return <Loading icon="timer" label="In flight" pinType="dns.kpi.certInFlight" />;

  const orders = (data.certificates && data.certificates.orders) || [];
  const inFlight = orders.filter((o) => o.state === "queued" || o.state === "issuing").length;
  return (
    <KPI icon="timer" label="In flight" value={String(inFlight)} tone="muted" sub="queued or issuing"
      pin={<PinButton type="dns.kpi.certInFlight" params={{}} label="In flight" />}
    />
  );
}

export {
  DnsKpiCertExpiry, DnsKpiCertFailed, DnsKpiCertInFlight, DnsKpiCertWeek,
  DnsKpiCollisions, DnsKpiNames, DnsKpiZone, LETSENCRYPT_WEEKLY_LIMIT,
};
