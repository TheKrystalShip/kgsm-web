// dnsKit.jsx — the fetch every dns.* card shares, and the small formatters this page's cards
// all need. Kept together so a card differs from its neighbour only in what it renders, not in how
// it gets a document or spells a date.

import { fmtRelative, fmtUntil } from "../../../lib/formatting.js";
import { useKeyedResource } from "../../../lib/keyedResource.js";
import { useStore } from "../../../lib/store.js";
import { DNS_KEY, dnsStore } from "../../../lib/stores/dns.js";

// The one hydrate and one poll every dns.* card and the anchor's own page share, acquired under the
// capability's key so a pin on the dashboard and the open page never fight over one fetch.
function useDnsStatus() {
  useKeyedResource(DNS_KEY, () => dnsStore.refresh(), () => dnsStore.follow());
  return useStore(dnsStore);
}

function toDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// "checked 2m ago", or the honest absence of a measurement.
function fmtSince(iso, now = new Date()) {
  const d = toDate(iso);
  return d ? fmtRelative(d, now) : null;
}

// "next in 3m" / "next due" / null when nothing is scheduled.
function fmtNext(iso, now = new Date()) {
  const d = toDate(iso);
  if (!d) return null;
  const words = fmtUntil(d, now);
  return words ? "next " + words : null;
}

// "17 Dec" — the short form every date-only cell on this page uses.
function fmtShortDate(iso) {
  const d = toDate(iso);
  return d ? d.toLocaleDateString([], { day: "numeric", month: "short" }) : null;
}

// "18 Sep 18:13" — the timestamped form the certificates table's Issued column uses.
function fmtDateTime(iso) {
  const d = toDate(iso);
  if (!d) return null;
  return d.toLocaleDateString([], { day: "numeric", month: "short" }) + " "
    + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

// Whole days from now, floored at 0 — "89 days" reads wrong as "88.7". Null when unmeasured or
// already past, since a negative day count on an expiry is the anchor's problem to report as failed.
function daysUntil(iso, now = new Date()) {
  const d = toDate(iso);
  if (!d) return null;
  const days = Math.floor((d - now) / 86400000);
  return days >= 0 ? days : null;
}

// The anchor names everything fully qualified (`ark.play.thekrystalship.com`) — the honest wire
// value, and what a resolver actually looks up. Every table on this page shows the short form
// instead (`ark.play`), the locked design's own choice: repeating the zone on every one of a
// cluster's names is noise once it is named once, in the KPI subtitle and the page's own address.
// Nothing here invents anything — it is the same string with a suffix it already carries removed.
function shortName(name, zone) {
  if (!name || !zone) return name;
  const suffix = "." + zone;
  return name.toLowerCase().endsWith(suffix.toLowerCase()) ? name.slice(0, -suffix.length) : name;
}

// The Name cell every table on this page renders: the name, and a phone-only second line carrying
// whatever the columns a phone hides would otherwise have said. Rendered always — `.dns-name__sub`
// is what shows it only at phone width — so a table needs no separate mobile markup of its own.
function NameCell({ name, sub, badge }) {
  return (
    <span className="dns-name">
      <span className="mono">{name}{badge}</span>
      {sub && <span className="dns-name__sub">{sub}</span>}
    </span>
  );
}

export { daysUntil, fmtDateTime, fmtNext, fmtShortDate, fmtSince, NameCell, shortName, toDate, useDnsStatus };
