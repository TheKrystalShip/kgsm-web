import React from "react";
import { AuditEventRow } from "./AuditEventRow.jsx";
import { auditEventHost } from "../lib/stores.js";
import { BriefCard } from "./BriefCard.jsx";
import { Icon } from "./Icon.jsx";
import { useStore } from "../lib/store.js";
import { auditInScope, auditStore, hostsStore } from "../lib/stores.js";

// RecentActivity.jsx — a compact, read-only window onto the audit feed,
// extracted from DashboardPage.jsx. Shared by DashboardPage and
// DiagnosticsPage (DiagOverview). Renders the shared AuditEventRow (the same
// row the full AuditLogPage and the assistant chat "Recent events" card use)
// for one activity design across the app.

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
          {recent.map(ev => (
            <AuditEventRow
              resolveHost={auditEventHost}
              key={ev.id}
              ev={ev}
              now={now}
              hosts={hosts}
              avatarSize={24}
              showMeta={false}
              onClick={onViewAll}
            />
          ))}
        </div>
      )}
    </BriefCard>
  );
}

export { RecentActivity };
