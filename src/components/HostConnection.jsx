import { Icon } from "./Icon.jsx";
import { api, connectionStore, realtimeStore } from "../lib/apiClient.js";
import { useStore } from "../lib/store.js";

// Lives apart from ErrorBoundary.jsx because it is the part that reads the NODE data layer — the
// connection stores, the host roster, the reconnect action. An error boundary is needed by every
// surface; this is needed only by the one that drives a cluster, and importing the two together
// drags apiClient into a surface that has no nodes at all.

// A node's live channel, on that node's own surface and nowhere else. `full` (the node's header)
// always renders live/reconnecting/offline with a retry control; the compact form (the node cards)
// stays SILENT when live and speaks only when a link is degraded.
function HostConnection({ hostId, full }) {
  const rt = useStore(realtimeStore, s => s);
  const restDown = useStore(connectionStore, s => s.status === "down");
  const h = rt.hosts[hostId];
  const mode = !rt.online ? "offline"
    : (restDown || (h && h.mode === "reconnecting")) ? "reconnecting"
    : "live";
  if (!full && mode === "live") return null;

  const META = {
    live:         { tone: "live", label: "Live" },
    reconnecting: { tone: "warn", label: "Reconnecting" },
    offline:      { tone: "down", label: "Offline" },
  }[mode];
  const retrySecs = h ? Math.ceil((h.nextRetryInMs || 0) / 1000) : 0;

  return (
    <span className={"host-conn host-conn--" + META.tone + (full ? " host-conn--full" : "")}
      title={"Live data channel for this host: " + META.label}>
      <span className={"host-conn__dot host-conn__dot--" + META.tone}></span>
      <span className="host-conn__label">{META.label}</span>
      {full && mode === "reconnecting" && (
        <>
          <span className="host-conn__meta">{retrySecs > 0 ? "retry in " + retrySecs + "s" : "retrying…"}{h && h.polling ? " · polling" : ""}</span>
          <button className="host-conn__btn" onClick={() => api.reconnectHost(hostId)}>
            <Icon name="rotate-cw" size={12} /> Reconnect
          </button>
        </>
      )}
      {full && mode === "offline" && (
        <span className="host-conn__meta">your device has no network</span>
      )}
    </span>
  );
}

export { HostConnection };
