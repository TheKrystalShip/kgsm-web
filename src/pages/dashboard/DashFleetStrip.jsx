// DashFleetStrip — the dashboard's "Cluster capacity" card: one compact
// mini-meter row per CLUSTER NODE (connected host + federation "ghost" peers
// this browser holds no host session for), built from the same
// `buildClusterNodes` merge the Cluster page renders from — capacity can't be
// averaged across machines, so it's one row per node. A connected node keeps
// the capacity mini-meters (unchanged); a ghost has no capacity to show (never
// fabricated) and shows a compact "discovered, not connected" state instead.
// Reuses the fleet-meter visuals. Extracted from DashboardPage.jsx (#8).
// Hook-less → no React import (automatic JSX runtime).

import { BriefCard } from "../../components/BriefCard.jsx";
import { alertsTone, anchoredAlerts } from "../../components/ContextualAlerts.jsx";
import { HostMeters, hostHealth } from "../../components/HostCardBody.jsx";
import { Icon } from "../../components/Icon.jsx";
import { membershipRowTone } from "../diagnostics/clusterBadges.jsx";

// GhostFleetRow — a federation peer with no connected host: no capacity to
// show, so the meter slot honestly reads "discovered, not connected" instead
// of a meter row. Clicking drills to the Cluster page (there's no host detail
// to open), rather than a broken per-host drill.
function GhostFleetRow({ n, onViewCluster }) {
  const tone = membershipRowTone(n.fed.membership);
  const latencyLabel = n.latencyMs != null ? Math.round(n.latencyMs) + "ms" : "—";
  return (
    <button key={n.key} className={"dash-fleet-row dash-fleet-row--" + tone + " dash-fleet-row--ghost"} onClick={() => onViewCluster && onViewCluster()}>
      <span className="dash-fleet-row__id">
        <span className={"dash-fleet-row__dot dash-fleet-row__dot--" + tone}></span>
        <span className="dash-fleet-row__name">{n.fed.label}</span>
      </span>
      <span className="dash-fleet-row__offline dash-fleet-row__offline--ghost">
        <Icon name="radar" size={13} /> Discovered · not connected
      </span>
      <span className="dash-fleet-row__end">
        <span className="cluster-node-row__latency">{latencyLabel}</span>
        <Icon name="chevron-right" size={16} className="dash-fleet-row__go" />
      </span>
    </button>
  );
}

function DashFleetStrip({ nodes, onOpenDiagnostics, onOpenHost }) {
  const openHost = (id) => onOpenHost && onOpenHost(id);
  return (
    <BriefCard
      icon="network"
      title="Cluster capacity"
      count={nodes.length}
      countTone="neutral"
      onViewAll={onOpenDiagnostics}
      className="dash-fleet"
    >
      <div className="dash-fleet__rows">
        {nodes.map(n => {
          if (n.ghost) {
            return <GhostFleetRow key={n.key} n={n} onViewCluster={onOpenDiagnostics} />;
          }
          const h = n.host;
          const alerts = anchoredAlerts(an => an.surface === "diagnostics" && an.hostId === h.id);
          // Shared health snapshot — same source as the Fleet grid cards.
          const { denied, metricsDown, meters, tone } = hostHealth(h);
          return (
            <button key={n.key} className={"dash-fleet-row dash-fleet-row--" + tone} onClick={() => openHost(h.id)}>
              <span className="dash-fleet-row__id">
                <span className={"dash-fleet-row__dot dash-fleet-row__dot--" + tone}></span>
                <span className="dash-fleet-row__name">{h.name}</span>
                <span className="dash-fleet-row__region">{h.region}</span>
              </span>
              {meters.length ? (
                <div className="dash-fleet-row__meters">
                  <HostMeters meters={meters} />
                </div>
              ) : denied ? (
                <span className="dash-fleet-row__offline dash-fleet-row__offline--denied"><Icon name="lock" size={13} /> No access on this host</span>
              ) : metricsDown ? (
                <span className="dash-fleet-row__offline dash-fleet-row__offline--metrics"><Icon name="activity" size={13} /> Metrics unavailable</span>
              ) : (
                <span className="dash-fleet-row__offline"><Icon name="moon" size={13} /> {h._pending ? "Awaiting telemetry" : "Disconnected"}</span>
              )}
              {alerts.length > 0
                ? <span className="dash-fleet-row__end"><span className={"fleet-card__alerts fleet-card__alerts--" + alertsTone(alerts)}><Icon name="triangle-alert" size={11} strokeWidth={2.4} />{alerts.length}</span></span>
                : <span className="dash-fleet-row__end"><Icon name="chevron-right" size={16} className="dash-fleet-row__go" /></span>}
            </button>
          );
        })}
      </div>
    </BriefCard>
  );
}

export { DashFleetStrip };
