import React from "react";
import { BriefCard } from "./BriefCard.jsx";
import { Icon } from "./Icon.jsx";
import { useStore } from "../lib/store.js";
import { auditInScope, auditStore } from "../lib/stores.js";
import { ACTION_META, fmtRelative, parseTs } from "../lib/formatting.js";

// RecentActivity.jsx — a compact, read-only window onto the audit feed,
// extracted from DashboardPage.jsx. Shared by DashboardPage and
// DiagnosticsPage (DiagOverview).

function RecentActivity({ hostId, serverId, onViewAll, max = 3, title = "Recent activity" }) {
  const auditList = useStore(auditStore, s => s.list);
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
            const meta = ACTION_META[ev.action] || { icon: "circle-dot", tone: "info" };
            const d = parseTs(ev.ts);
            return (
              <div className={"chat-brief__item chat-brief__item--" + meta.tone} key={ev.id} onClick={onViewAll}>
                <span className="chat-brief__icon"><Icon name={meta.icon} size={14} /></span>
                <div className="chat-brief__body">
                  <span className="chat-brief__item-title chat-brief__item-title--wrap"><b>{ev.actor.name}</b> {ev.summary}</span>
                  <span className="chat-brief__detail">{fmtRelative(d, now)}</span>
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
