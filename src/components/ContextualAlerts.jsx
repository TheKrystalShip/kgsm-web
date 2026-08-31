import { Icon } from "./Icon.jsx";
import { KrystalAlerts, alertHost, alertInScope } from "../lib/alertsApi.js";
import { AlertCard } from "./AlertCard.jsx";

// ContextualAlerts — surface active alerts at their point of origin.
//
// One alert record, many views. These helpers read the SAME server feed
// (KrystalAlerts) that the Alerts page and the dashboard read, keep
// only the ACTIVE alerts whose `anchor` points at the current surface, and
// render the SHARED AlertCard — so lifecycle (complete / dismiss / ask)
// and styling can never drift from the dedicated page. Completed and dismissed
// history stays on the Alerts page; in-context we only ever show what's live.

// Active, anchored alerts matching a predicate over (anchor, alert).
function anchoredAlerts(match) {
  const list = KrystalAlerts.list();
  return list.filter(a => a.status === "firing" && a.anchor && match(a.anchor, a));
}

// Worst severity in a set → a tone, for badges and strip accents.
function alertsTone(items) {
  if (!items || items.length === 0) return "info";
  if (items.some(a => a.severity === "danger")) return "danger";
  if (items.some(a => a.severity === "warn")) return "warn";
  return "info";
}

// One inline alert: the shared AlertCard wrapped in a contextual surface so it
// reads as a self-contained card wherever it's dropped (between table rows, in
// a list, at the top of a section). `tether` adds a downward connector that
// points at the row immediately below it.
function InlineAlertCard({ item, onAsk, onOpenServer, onRun, now, tether }) {
  return (
    <div className={"ctx-alert ctx-alert--" + item.severity + (tether ? " ctx-alert--tether" : "")}>
      <AlertCard item={item} onAsk={onAsk} onOpenServer={onOpenServer} onRun={onRun} now={now || new Date()} />
    </div>
  );
}

// A labelled strip of inline cards for the top of a page/section — the
// "look here" summary when the precise element is scrolled away or aggregated.
function ContextualAlertStrip({ title, items, onAsk, onOpenServer, onRun, hint }) {
  if (!items || items.length === 0) return null;
  const now = new Date();
  const tone = alertsTone(items);
  return (
    <section className={"ctx-strip ctx-strip--" + tone}>
      <div className="ctx-strip__head">
        <span className="ctx-strip__icon"><Icon name="triangle-alert" size={13} strokeWidth={2.3} /></span>
        <span className="ctx-strip__title">{title || "Active alerts here"}</span>
        <span className="ctx-strip__count">{items.length}</span>
        {hint && <span className="ctx-strip__hint">{hint}</span>}
      </div>
      <div className="ctx-strip__list">
        {items.map(it => (
          <InlineAlertCard key={it.id} item={it} onAsk={onAsk} onOpenServer={onOpenServer} onRun={onRun} now={now} />
        ))}
      </div>
    </section>
  );
}

export { ContextualAlertStrip, InlineAlertCard, alertHost, alertInScope, alertsTone, anchoredAlerts };
