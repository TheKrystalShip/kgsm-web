// DashFleetStrip — the "All hosts" form of the home capacity card. One compact
// mini-meter row per host (capacity can't be averaged across machines), each row
// drilling into that host's diagnostics. Reuses the fleet-meter visuals. Extracted
// from DashboardPage.jsx (#8). Hook-less → no React import (automatic JSX runtime).

import { alertsTone, anchoredAlerts } from "../../components/ContextualAlerts.jsx";
import { HostMeters, hostHealth } from "../../components/HostCardBody.jsx";
import { Icon } from "../../components/Icon.jsx";

function DashFleetStrip({ hosts, onOpenDiagnostics, onOpenHost }) {
  const openHost = (id) => onOpenHost && onOpenHost(id);
  return (
    <section className="cap-strip dash-fleet">
      <div className="cap-strip__head">
        <h2 className="cap-strip__title">
          <Icon name="server-cog" size={14} />
          Fleet capacity
          <span className="cap-strip__host">{hosts.length} hosts</span>
        </h2>
        <span style={{ flex: 1 }}></span>
        {onOpenDiagnostics && (
          <button className="dash-section__more" onClick={onOpenDiagnostics}>
            View all <Icon name="arrow-right" size={12} strokeWidth={2.2} />
          </button>
        )}
      </div>
      <div className="dash-fleet__rows">
        {hosts.map(h => {
          const alerts = anchoredAlerts(an => an.surface === "diagnostics" && an.hostId === h.id);
          // Shared health snapshot — same source as the Fleet grid cards.
          const { denied, metricsDown, meters, tone } = hostHealth(h);
          return (
            <button key={h.id} className={"dash-fleet-row dash-fleet-row--" + tone} onClick={() => openHost(h.id)}>
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
    </section>
  );
}

export { DashFleetStrip };
