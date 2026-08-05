// Leaf/service diagnostics pieces — StatusLed and the Overview's ServicesSummaryCard.
// Re-exported from diagComponents.jsx so consumers are unchanged. Pure render, no local state.
// The leaf card itself is `components/LeafCard.jsx` — it is shared UI, not a diagnostics part.

import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { leafStatus } from "../../lib/leaves.js";

function StatusLed({ live, label }) {
  return (
    <span className="led-group" title={live ? "Live" : "No signal"}>
      {label && <span className="led-group__age">{label}</span>}
      <span
        className={"status-led status-led--" + (live ? "live" : "down")}
        aria-label={live ? "Live" : "No signal"}
      ></span>
    </span>
  );
}

function ServicesSummaryCard({ services, status, ready, onViewAll }) {
  const rows = ready && Array.isArray(services) ? services : [];
  const running = rows.filter(r => r.state === "active").length;
  const unwell = rows.some(r => { const t = leafStatus(r).tone; return t === "down" || t === "warn"; });
  return (
    <BriefCard
      icon="server-cog"
      title="Services"
      count={rows.length ? running + "/" + rows.length : null}
      countTone={unwell ? undefined : "neutral"}
      onViewAll={rows.length ? onViewAll : undefined}
    >
      {rows.length > 0 ? (
        <div className="svc-rows">
          {rows.map(svc => {
            const s = leafStatus(svc);
            return (
              <button key={svc.id} className="svc-row" onClick={onViewAll} title={svc.role}>
                <span className="svc-row__id">
                  <span className={"svc-dot svc-dot--" + s.tone}></span>
                  <span className="svc-row__name">{svc.displayName}</span>
                </span>
                <span className="svc-row__status">
                  <span className={"svc-row__state svc-row__state--" + s.tone}>{s.label}</span>
                  {s.note ? <span className="svc-row__note">{s.note}</span> : null}
                </span>
                <span className="svc-row__end"><Icon name="chevron-right" size={16} className="svc-row__go" /></span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <Icon name="server-cog" size={20} />
          <span className="chat-brief__empty-title">{status === "error" ? "Services unavailable" : "Reading host services…"}</span>
          <span className="chat-brief__empty-sub">{status === "error" ? "Couldn’t read the host’s leaf-service state." : "This host’s KGSM leaf services will appear here."}</span>
        </div>
      )}
    </BriefCard>
  );
}

export { StatusLed, ServicesSummaryCard };
