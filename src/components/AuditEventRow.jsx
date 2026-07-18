import { AuditActor } from "./AuditActor.jsx";
import { Icon } from "./Icon.jsx";
import { auditEventHost } from "../lib/stores.js";
import { ACTION_META, fmtRelative, fmtTime, parseTs } from "../lib/formatting.js";

// AuditEventRow — the single presentational row for one audit event. Shared by
// three surfaces so activity looks the same everywhere it appears: the full
// AuditLogPage timeline, the compact "Recent activity" panel (RecentActivity, on
// the dashboard + server overview), and the assistant chat "Recent events"
// evidence card. Pure props-in: it renders the standard `ev` audit shape and
// never fetches or routes.
//
//   ev         one audit record { ts, action, actor:{name,kind}, summary, origin, serverId, hostId?, meta }
//   now        the wall-clock anchor relative times are measured against
//   hosts      host list, for resolving the provenance chip's display name
//   avatarSize actor-avatar diameter (the full page uses the 28px default; the
//              compact panels pass 24)
//   showMeta   render the meta "key=value" chips (the full page does; the compact
//              panels don't, to stay tidy in a narrow column)
//   onClick    optional row click (the compact panels deep-link to the audit log)
function AuditEventRow({ ev, now, hosts, avatarSize, showMeta = true, onClick }) {
  const meta = ACTION_META[ev.action] || { label: ev.action, icon: "circle-dot", tone: "info" };
  // Defensive: a well-formed audit record always has a string ts, but degrade to an em-dash rather
  // than crash if one is ever missing/malformed (an evidence card must never white-screen the app).
  const date = typeof ev.ts === "string" ? parseTs(ev.ts) : null;
  // Render the meta dictionary as compact "key=value" chips (full page only).
  const metaEntries = showMeta ? Object.entries(ev.meta || {}) : [];
  // Host provenance: explicit hostId / derived from server / null = panel-wide.
  const hostId = auditEventHost(ev);
  const host = hostId ? (hosts || []).find(h => h.id === hostId) : null;
  const clickable = typeof onClick === "function";

  return (
    <div className="audit-row" onClick={onClick} style={clickable ? { cursor: "pointer" } : undefined}>
      <AuditActor actor={ev.actor} {...(avatarSize ? { size: avatarSize } : {})} />
      <div className="audit-row__main">
        <div className="audit-row__line">
          <span className="audit-row__actor">{ev.actor.name}</span>
          {" "}
          <span className="audit-row__summary">{ev.summary}</span>
        </div>
        <div className="audit-row__meta">
          <span className={"audit-pill audit-pill--" + meta.tone}>
            <Icon name={meta.icon} size={11} strokeWidth={2.2} className="audit-pill__icon" />
            {ev.action}
          </span>
          <span className={"audit-row__host" + (hostId ? "" : " audit-row__host--panel")} title={hostId ? "Host: " + (host ? host.name : hostId) : "Panel-wide event"}>
            <Icon name={hostId ? "server" : "layers"} size={10} strokeWidth={2.2} />
            {hostId ? (host ? host.name : hostId) : "panel"}
          </span>
          {metaEntries.map(([k, v]) => (
            <span key={k} className="audit-row__chip"><b>{k}:</b> {String(v)}</span>
          ))}
          {ev.origin && (
            <span className="audit-row__origin"><Icon name="circle-arrow-out-up-right" size={10} strokeWidth={2.2} /> {ev.origin}</span>
          )}
        </div>
      </div>
      <div className="audit-row__when" title={date ? date.toLocaleString() : undefined}>
        <span className="audit-row__time">{date ? fmtTime(date) : "—"}</span>
        <span className="audit-row__rel">{date ? fmtRelative(date, now) : ""}</span>
      </div>
    </div>
  );
}

export { AuditEventRow };
