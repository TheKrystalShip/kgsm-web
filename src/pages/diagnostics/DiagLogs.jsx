// DiagLogs — the Logs sub-tab: aggregated leaf-service journals.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { ConsoleView } from "../../components/ConsoleView.jsx";
import { useStore } from "../../lib/store.js";
import { logSourcesStore, logsStore, subscribeHostLogs } from "../../lib/stores.js";
import { LOG_SOURCE_META } from "./diagHelpers.js";

function DiagLogs({ host }) {
  const hostId = host && host.id;
  const list = useStore(logsStore, s => s.list);
  const status = useStore(logsStore, s => s.status);
  const forHost = useStore(logsStore, s => s.hostId);
  const logSources = useStore(logSourcesStore, s => s.sources);
  const logSourcesStatus = useStore(logSourcesStore, s => s.status);

  React.useEffect(() => {
    if (!hostId) return undefined;
    logsStore.refresh(hostId).catch(() => {});
    logSourcesStore.refresh(hostId).catch(() => {});
    return subscribeHostLogs(hostId);
  }, [hostId]);

  if (!ConsoleView) return null;

  const ready = forHost === hostId;
  const entries = ready && Array.isArray(list) ? list : [];
  const sourcesReady = logSourcesStatus === "ready";

  const sources = logSources.map(s => {
    const m = LOG_SOURCE_META[s.id] || {};
    return {
      id: s.id,
      label: s.label || m.label || s.id,
      lines: entries.filter(e => e.source === s.id).slice().reverse(),
    };
  });

  if (sources.length > 0)
    return <ConsoleView title="Host logs" icon="scroll-text" sources={sources} pill={{ label: "Live", live: true }} resetKey={hostId} />;

  const phase = (status === "loading" || !ready || !sourcesReady) ? "loading" : status === "error" ? "error" : "quiet";
  return (
    <div className="proc-unavailable">
      <span className="proc-unavailable__icon"><Icon name="scroll-text" size={26} strokeWidth={1.9} /></span>
      <div className="proc-unavailable__title">
        {phase === "loading" ? "Loading host logs\u2026" : phase === "error" ? "Host logs unavailable" : "No recent log lines"}
      </div>
      <div className="proc-unavailable__sub">
        {phase === "loading"
          ? "Reading the host\u2019s leaf-service journal (assistant \u00b7 monitor \u00b7 watchdog \u00b7 firewall \u00b7 api \u00b7 bot)."
          : phase === "error"
            ? "Couldn\u2019t read the host log stream \u2014 the backend journal source didn\u2019t respond."
            : "The host\u2019s leaf services haven\u2019t logged anything in the recent window."}
      </div>
      <span className="proc-unavailable__tag">
        <Icon name="activity" size={12} /> {phase === "loading" ? "loading" : phase === "error" ? "no log source" : "quiet"}
      </span>
    </div>
  );
}

export { DiagLogs };
