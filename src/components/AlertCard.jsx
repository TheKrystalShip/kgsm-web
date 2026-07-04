import { Icon } from "./Icon.jsx";
import { alertHost } from "./ContextualAlerts.jsx";
import { askAssistantUsable } from "../lib/capabilities.js";
import { hostsStore } from "../lib/stores.js";
import { fmtRelative, parseTs } from "../lib/formatting.js";

// AlertCard.jsx — the shared alert card component, extracted from AlertsPage.jsx.
// Used by AlertsPage and ContextualAlerts (InlineAlertCard).

function AlertSeverityTag({ severity }) {
  const label = { danger: "Critical", warn: "Warning", info: "Info" }[severity] || severity;
  return <span className={"alert-sev alert-sev--" + severity}>{label}</span>;
}

function AlertCard({ item, onAsk, onOpenServer, onOpenHost, onOpenAudit, now }) {
  const resolved = item.status === "resolved";
  const sys = item.resolution && item.resolution.by === "system";
  const stamp = resolved ? item.resolvedAt : item.raisedAt;
  const when = stamp
    ? fmtRelative(parseTs(stamp), now)
    : null;
  const hostId = alertHost(item);
  const host = hostId ? hostsStore.find(hostId) : null;

  return (
    <div className={"alert-card alert-card--" + item.severity
      + (resolved ? " alert-card--resolved" : "")
      + (item.escalated ? " alert-card--escalated" : "")
      + (item.justResolved ? " alert-card--just-resolved" : "")}>
      <span className="alert-card__icon"><Icon name={resolved ? "check" : item.icon} size={16} strokeWidth={resolved ? 2.4 : 1.9} /></span>
      <div className="alert-card__body">
        <div className="alert-card__titlerow">
          <span className="alert-card__title">{item.title}</span>
          {item.escalated
            ? <span className="alert-card__state alert-card__state--escalated"><Icon name="hand" size={11} strokeWidth={2.4} /> Needs you</span>
            : (!resolved && <AlertSeverityTag severity={item.severity} />)}
          {resolved && (sys
            ? <span className="alert-card__state alert-card__state--auto"><Icon name="shield-check" size={12} strokeWidth={2.4} /> Auto-resolved</span>
            : <span className="alert-card__state alert-card__state--completed"><Icon name="check" size={11} strokeWidth={2.6} /> Resolved</span>)}
        </div>
        <div className="alert-card__detail">{item.detail}</div>

        {item.escalated && (
          <div className="alert-card__escalation">
            <Icon name="circle-slash" size={11} strokeWidth={2.3} />
            <span>Auto-recovery gave up after {item.attempts} attempts — this one needs a human.</span>
          </div>
        )}

        {resolved && sys && (
          <div className="alert-card__resolution">
            <Icon name="shield-check" size={11} strokeWidth={2.4} />
            <span>Cleared{item.resolution.source ? " by " + item.resolution.source : ""}{item.resolution.reason ? " — " + item.resolution.reason : ""}</span>
            {item.resolution.actionId && (
              <button className="alert-card__action-link" onClick={() => onOpenAudit && onOpenAudit(item)} title="See the action in the audit log">
                View action <Icon name="arrow-up-right" size={10} strokeWidth={2.6} />
              </button>
            )}
          </div>
        )}

        <div className="alert-card__meta">
          <span className={"audit-row__host" + (hostId ? "" : " audit-row__host--panel")} title={hostId ? "Host: " + (host ? host.name : hostId) : "Panel-wide alert"}>
            <Icon name={hostId ? "server" : "layers"} size={10} strokeWidth={2.2} />
            {hostId ? (host ? host.name : hostId) : "panel"}
          </span>
          {item.source && <span className="alert-card__source">{item.source}</span>}
          {item.source && when && <span>·</span>}
          {when && <span>{when}</span>}
        </div>
      </div>

      {!resolved && (
        <div className="alert-card__actions">
          <button className="alert-btn alert-btn--primary"
            disabled={!askAssistantUsable(item)}
            title={!askAssistantUsable(item) ? "Assistant unavailable on this alert\u2019s host" : undefined}
            onClick={() => { if (askAssistantUsable(item)) onAsk(item); }}><Icon name="bot" size={13} /> Ask assistant</button>
          {item.serverId
            ? <button className="alert-btn" onClick={() => onOpenServer(item.serverId, item.anchor && item.anchor.tab)}><Icon name="external-link" size={13} /> Open server</button>
            : (hostId && onOpenHost && <button className="alert-btn" onClick={() => onOpenHost(hostId)}><Icon name="external-link" size={13} /> Open host</button>)}
        </div>
      )}
    </div>
  );
}

export { AlertCard, AlertSeverityTag };
