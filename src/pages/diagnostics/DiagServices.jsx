// DiagServices — the Services sub-tab: KGSM leaf control center.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { useStore } from "../../lib/store.js";
import { canOn } from "../../lib/persona.js";
import { servicesStore } from "../../lib/stores.js";
import { LeafCard } from "./diagComponents.jsx";
import { LeafConfigModal } from "./LeafConfigModal.jsx";

function DiagServices({ host }) {
  const hostId = host && host.id;
  const list = useStore(servicesStore, s => s.list);
  const status = useStore(servicesStore, s => s.status);
  const forHost = useStore(servicesStore, s => s.hostId);
  const canManage = hostId ? canOn("host.manage", hostId) : false;
  const [configuring, setConfiguring] = React.useState(null);

  React.useEffect(() => {
    if (!hostId) return;
    servicesStore.refresh(hostId).catch(() => {});
  }, [hostId]);

  const ready = forHost === hostId;
  const rows = ready && Array.isArray(list) ? list : [];

  if (rows.length > 0) {
    const installed = rows.filter(r => r.state !== "not-installed");
    const running = rows.filter(r => r.state === "active").length;
    const configLeaf = configuring ? rows.find(r => r.id === configuring) : null;
    return (
      <>
        <div className="players-toolbar">
          <div className="svc-summary">
            <span className="svc-summary__stat"><b>{running}</b> running</span>
            <span className="svc-summary__sep">·</span>
            <span className="svc-summary__stat">{installed.length} of {rows.length} installed</span>
          </div>
          <span style={{ flex: 1 }}></span>
          <span style={{ color: "var(--fg-3)", fontSize: 12.5 }}>The KGSM services that make up this host.</span>
        </div>
        <div className="svc-grid">
          {rows.map(svc => (
            <LeafCard key={svc.id} svc={svc} hostId={hostId} canManage={canManage}
              onConfigure={() => setConfiguring(svc.id)} />
          ))}
        </div>
        {canManage && configLeaf && (
          <LeafConfigModal hostId={hostId} leaf={configLeaf} onClose={() => setConfiguring(null)} />
        )}
      </>
    );
  }

  const phase = (status === "loading" || !ready) ? "loading" : status === "error" ? "error" : "quiet";
  return (
    <div className="proc-unavailable">
      <span className="proc-unavailable__icon"><Icon name="server-cog" size={26} strokeWidth={1.9} /></span>
      <div className="proc-unavailable__title">
        {phase === "loading" ? "Reading host services\u2026" : phase === "error" ? "Host services unavailable" : "No services reported"}
      </div>
      <div className="proc-unavailable__sub">
        {phase === "loading"
          ? "Reading the state of this host\u2019s KGSM leaf services (watchdog \u00b7 monitor \u00b7 assistant \u00b7 firewall \u00b7 api \u00b7 bot)."
          : phase === "error"
            ? "Couldn\u2019t read the host\u2019s service state \u2014 the backend didn\u2019t respond."
            : "This host reports no KGSM leaf services."}
      </div>
      <span className="proc-unavailable__tag">
        <Icon name="activity" size={12} /> {phase === "loading" ? "loading" : phase === "error" ? "unavailable" : "none"}
      </span>
    </div>
  );
}

export { DiagServices };
