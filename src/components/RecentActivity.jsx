import React from "react";
import { AuditActor } from "./AuditActor.jsx";
import { BriefCard } from "./BriefCard.jsx";
import { Icon } from "./Icon.jsx";
import { useStore } from "../lib/store.js";
import { auditEventHost, auditInScope, auditStore, hostsStore } from "../lib/stores.js";
import { ACTION_META, fmtRelative, fmtTime, parseTs } from "../lib/formatting.js";

// RecentActivity.jsx — a compact, read-only window onto the audit feed,
// extracted from DashboardPage.jsx. Shared by DashboardPage and
// DiagnosticsPage (DiagOverview). Uses the same audit-row design as the
// full AuditLogPage for visual consistency.

function RecentActivity({ hostId, serverId, onViewAll, max = 3, title = "Recent activity" }) {
  const auditList = useStore(auditStore, s => s.list);
  const hosts = useStore(hostsStore, s => s.list);
  const scoped = React.useMemo(
    () => {
      if (serverId) return auditList.filter(ev => ev.serverId === serverId);
      return auditInScope ? auditList.filter(ev => auditInScope(ev, hostId)) : auditList;
    },
    [auditList, hostId, serverId]
  );
  const recent = scoped.slice(0, max);
  const [, setClock] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setClock(c => c + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const now = new Date();
  return (
    <BriefCard
      icon="scroll-text"
      title={title}
      count={scoped.length}
      countTone="neutral"
      onViewAll={onViewAll}
    >
      {scoped.length === 0 ? (
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <Icon name="scroll-text" size={20} />
          <span className="chat-brief__empty-title">No recent activity</span>
          <span className="chat-brief__empty-sub">Actions across your servers will show up here.</span>
        </div>
      ) : (
        <div className="chat-brief__list">
          {recent.map(ev => {
            const meta = ACTION_META[ev.action] || { label: ev.action, icon: "circle-dot", tone: "info" };
            const date = parseTs(ev.ts);
            const evHostId = auditEventHost(ev);
            const evHost = evHostId ? hosts.find(h => h.id === evHostId) : null;
            return (
              <div className="audit-row" key={ev.id} onClick={onViewAll} style={{ cursor: "pointer" }}>
                <AuditActor actor={ev.actor} size={24} />
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
                    <span className={"audit-row__host" + (evHostId ? "" : " audit-row__host--panel")} title={evHostId ? "Host: " + (evHost ? evHost.name : evHostId) : "Panel-wide event"}>
                      <Icon name={evHostId ? "server" : "layers"} size={10} strokeWidth={2.2} />
                      {evHostId ? (evHost ? evHost.name : evHostId) : "panel"}
                    </span>
                    {ev.origin && (
                      <span className="audit-row__origin"><Icon name="circle-arrow-out-up-right" size={10} strokeWidth={2.2} /> {ev.origin}</span>
                    )}
                  </div>
                </div>
                <div className="audit-row__when" title={date.toLocaleString()}>
                  <span className="audit-row__time">{fmtTime(date)}</span>
                  <span className="audit-row__rel">{fmtRelative(date, now)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </BriefCard>
  );
}

export { RecentActivity };
