import React from "react";
import { BriefCard } from "./BriefCard.jsx";
import { alertInScope } from "./ContextualAlerts.jsx";
import { Icon } from "./Icon.jsx";
import { KrystalAlerts } from "../lib/alertsApi.js";
import { askAssistantUsable } from "../lib/capabilities.js";
import { useSelectedHostId } from "../lib/stores.js";

// NeedsAttention — compact FIRING-alerts panel, plus the client hooks over the
// server alert feed (KrystalAlerts, see alertsApi.js).
//
// Model A: the server is the authority and conditions resolve themselves. We
// only render KrystalAlerts.list() — the browser never marks an alert done.
// This panel is the at-a-glance view used on the dashboard (with a "View all"
// link to the Alerts page) and in the assistant empty state.

// Subscribe a component to feed changes (server pushes / local action echoes).
function useAlerts() {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => (KrystalAlerts ? KrystalAlerts.subscribe(force) : undefined), []);
  return KrystalAlerts;
}

// Split the feed for a host scope (["all"]/undefined → every alert; a host id →
// that host's alerts plus panel-wide ones). Model A buckets:
//   firing   — conditions true right now (the work surface)
//   resolved — cleared within the last 24h (the rear-view; ages off after)
// `active` is kept as an alias of `firing` for the sidebar badge + dashboard.
//
// `firing` is returned in canonical priority order — escalated ("Needs you")
// first, then by severity, then most-recent — so EVERY surface (Alerts page,
// dashboard card, sidebar badge) shows the same alerts in the same order from
// this one place. The dashboard's top-3 therefore always leads with whatever
// needs a human, instead of falling off the end in raw feed order.
// `serverId`, when given, scopes strictly to that game server's alerts (used by
// the server-detail Performance tab). Otherwise `hostId` applies the host scope.
function alertBuckets(hostId, serverId) {
  let list = KrystalAlerts ? KrystalAlerts.list() : [];
  if (serverId) {
    list = list.filter(a => a.serverId === serverId);
  } else if (hostId && hostId !== "all" && alertInScope) {
    list = list.filter(a => alertInScope(a, hostId));
  }
  const now = Date.now();
  const DAY = 24 * 3600 * 1000;
  const sevRank = { danger: 0, warn: 1, info: 2 };
  const firing = list
    .filter(a => a.status === "firing")
    .sort((a, b) =>
      (b.escalated ? 1 : 0) - (a.escalated ? 1 : 0) ||
      (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9) ||
      (new Date(b.raisedAt) - new Date(a.raisedAt)));
  const resolved = list
    .filter(a => a.status === "resolved" && a.resolvedAt && (now - new Date(a.resolvedAt).getTime()) <= DAY)
    .sort((a, b) => new Date(b.resolvedAt) - new Date(a.resolvedAt));
  return { all: list, firing, resolved, active: firing };
}

// `max` caps how many firing alerts are listed (header count still shows the
// true total). `emptyState` opts into the dashboard behaviour: instead of
// collapsing to null when nothing's firing, render the card with a calm
// "all clear" placeholder so it can sit balanced beside Recent activity. The
// assistant briefing keeps the original collapse-when-empty default.
//
// `hostId` pins the card to a specific host regardless of the global sidebar
// scope — used by the host diagnostics deep-dive, where the host being
// inspected is independent of the active scope. Omit it (the default) to track
// the global selection, as the dashboard and sidebar badge do.
//
// `serverId` (server-detail Performance tab) scopes strictly to one game
// server's alerts, ignoring the host scope entirely.
function NeedsAttention({ onPick, actionLabel = "Ask", onViewAll, className = "", max = Infinity, emptyState = false, hostId, serverId, title = "Alerts" }) {
  useAlerts();
  const selectedId = useSelectedHostId ? useSelectedHostId() : "all";
  const scopeId = hostId != null ? hostId : selectedId;
  const [hidden, setHidden] = React.useState(false);
  const { active } = alertBuckets(scopeId, serverId);
  const shown = active.slice(0, max);
  if (hidden) return null;
  if (active.length === 0 && !emptyState) return null;

  // Header-right affordance: "View all" when the dashboard passes onViewAll,
  // otherwise the dismiss "Hide" control (suppressed in the balanced empty-state
  // dashboard layout). Left undefined → BriefCard renders its onViewAll default.
  const action = onViewAll
    ? undefined
    : (!emptyState ? <button className="chat-brief__hide" onClick={() => setHidden(true)}>Hide</button> : null);
  return (
    <BriefCard
      className={className}
      icon="triangle-alert"
      title={title}
      count={active.length > 0 ? active.length : null}
      onViewAll={onViewAll}
      action={action}
    >
      {active.length === 0 ? (
        <div className="chat-brief__empty">
          <Icon name="circle-check" size={20} />
          <span className="chat-brief__empty-title">No active alerts</span>
          <span className="chat-brief__empty-sub">Everything's running clean right now.</span>
        </div>
      ) : (
      <div className="chat-brief__list">
        {shown.map(it => {
          const askOk = !askAssistantUsable || askAssistantUsable(it);
          return (
          <div key={it.id} className={"chat-brief__item chat-brief__item--" + it.severity + (it.escalated ? " chat-brief__item--escalated" : "") + (askOk ? "" : " chat-brief__item--noask")} onClick={() => askOk && onPick && onPick(it)}>
            <span className="chat-brief__icon"><Icon name={it.icon} size={14} /></span>
            <div className="chat-brief__body">
              <span className="chat-brief__item-title">
                <span className="chat-brief__titletext">{it.title}</span>
                {it.escalated && <span className="chat-brief__needs-you"><Icon name="hand" size={9} strokeWidth={2.6} /> Needs you</span>}
              </span>
              <span className="chat-brief__detail">{it.detail}</span>
            </div>
            <span className={"chat-brief__ask" + (askOk ? "" : " chat-brief__ask--off")}>{askOk ? actionLabel : "Unavailable"} <Icon name="arrow-right" size={12} strokeWidth={2.2} /></span>
          </div>
          );
        })}
      </div>
      )}
    </BriefCard>
  );
}

export { NeedsAttention, alertBuckets, useAlerts };
