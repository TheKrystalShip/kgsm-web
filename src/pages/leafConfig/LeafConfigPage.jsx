// LeafConfigPage — the per-node leaf configuration surface: every setting every leaf on this host
// declares, one leaf at a time, with a strip to move between them.
//
// It is its own page rather than a node sub-tab because it carries that leaf strip, and nesting it
// under the node page's tabs would stack two tab rows.
//
// What a leaf can be configured with is `ComponentConfiguration`, which every component's
// configuration is rendered with wherever it lives. What belongs here is the part that is the
// NODE's: which of its leaves publish a surface at all, which one is open, that leaf's unit facts,
// and the host journal beside them. So this page is discovery and framing, and the settings
// themselves are the same body an anchor's page mounts.
//
// Admin-only, end to end: kgsm-api's leaf controller is Admin-policy, so `persona.ROUTE_CAP` gates
// the route on `host.manage` and an operator never reaches it.

import React from "react";
import { ConsoleView } from "../../components/ConsoleView.jsx";
import { Icon } from "../../components/Icon.jsx";
import { SubTabs } from "../../components/SubTabs.jsx";
import { useStore } from "../../lib/store.js";
import { leafSurface } from "../../lib/componentSurface.js";
import {
  hostsStore, logSourcesStore, logsStore, servicesStore, subscribeHostLogs, subscribeHostServices,
} from "../../lib/stores.js";
import { fmtBytes, uptimeShort } from "../../lib/formatting.js";
import { leafIcon, leafStatus } from "../../lib/leaves.js";
import { ComponentConfiguration } from "../component/ComponentConfiguration.jsx";
import { isOverridden } from "../component/componentConfigHelpers.js";

// `embedded` renders the configuration BODY only — no page title, no back button, no leaf strip and
// no identity block. It is what the per-leaf page's Settings tab mounts: that page already names the
// host and the leaf, carries its own tabs, and its System tab owns the unit's state, uptime and
// memory, so repeating any of it here would put the same row on screen twice.
function LeafConfigPage({ hostId, leafId, onSelectLeaf, onBackToHost, embedded = false }) {
  const hosts = useStore(hostsStore, s => s.list);
  const svcEntry = useStore(servicesStore, s => (hostId ? s.byHost[hostId] : null));
  const services = (svcEntry && svcEntry.list) || [];
  const servicesFor = svcEntry ? hostId : null;
  const servicesStatus = svcEntry ? svcEntry.status : "loading";
  const logsEntry = useStore(logsStore, s => (hostId ? s.byHost[hostId] : null));
  const logLines = (logsEntry && logsEntry.list) || [];
  const sourcesEntry = useStore(logSourcesStore, s => (hostId ? s.byHost[hostId] : null));
  const logSources = (sourcesEntry && sourcesEntry.sources) || [];

  const [config, setConfig] = React.useState(null);
  const [showLogs, setShowLogs] = React.useState(false);

  const host = hosts.find(h => h.id === hostId) || null;
  const rows = servicesFor === hostId && Array.isArray(services) ? services : [];
  // Only leaves that actually publish a config surface; the API is the authority on which those
  // are, so this never carries a list of leaf ids.
  const configurable = rows.filter(r => r.id);
  // A leafless URL (#/config/<host>) opens the first leaf, and a leaf this host doesn't serve
  // falls back to it too. Deliberately WITHOUT rewriting the URL: normalising it here would push
  // a history entry that Back immediately re-normalises, trapping the back button.
  const active = configurable.find(r => r.id === leafId) || configurable[0] || null;
  const activeId = active ? active.id : null;

  React.useEffect(() => {
    if (!hostId) return undefined;
    servicesStore.refresh(hostId).catch(() => {});
    return subscribeHostServices(hostId);
  }, [hostId]);

  React.useEffect(() => { setConfig(null); setShowLogs(false); }, [hostId, activeId]);

  React.useEffect(() => {
    if (!showLogs || !hostId) return undefined;
    logsStore.refresh(hostId).catch(() => {});
    logSourcesStore.refresh(hostId).catch(() => {});
    return subscribeHostLogs(hostId);
  }, [showLogs, hostId]);

  const surface = React.useMemo(
    () => leafSurface({
      hostId,
      leafId: activeId,
      label: (active && active.displayName) || activeId || "This leaf",
    }),
    [hostId, activeId, active && active.displayName],  // eslint-disable-line react-hooks/exhaustive-deps -- the row's label is the only field read
  );

  if (!hostId || (!configurable.length && servicesStatus !== "loading")) {
    return (
      <div className="proc-unavailable">
        <span className="proc-unavailable__icon"><Icon name="sliders-horizontal" size={26} strokeWidth={1.9} /></span>
        <div className="proc-unavailable__title">
          {servicesStatus === "error" ? "Host services unavailable" : "Nothing configurable here"}
        </div>
        <div className="proc-unavailable__sub">
          {servicesStatus === "error"
            ? "Couldn’t read this host’s leaf services, so there is nothing to configure yet."
            : "This host reports no KGSM leaf services."}
        </div>
      </div>
    );
  }

  const st = active ? leafStatus(active) : null;
  const up = active && active.since ? uptimeShort(active.since) : null;
  const mem = active ? fmtBytes(active.memoryBytes) : null;
  const fields = (config && config.fields) || [];
  const overridden = fields.filter(isOverridden).length;

  // The site's own in-page switcher, configured exactly as every other tab strip is: an icon and a
  // label.
  const tabs = configurable.map(svc => ({
    id: svc.id,
    label: svc.displayName || svc.id,
    icon: leafIcon(svc.id),
    title: svc.role || undefined,
  }));

  return (
    <>
      {!embedded && (
        <div className="lcf-head">
          <button className="lcf-back" onClick={onBackToHost}>
            <Icon name="arrow-left" size={14} /> {host ? (host.name || host.id) : "Host"}
          </button>
          <h1 className="lcf-head__title">Leaf configuration</h1>
          <p className="lcf-head__sub">
            Every setting each leaf on this host declares. Changes are layered on top of the leaf’s own
            config and applied by restarting it — the leaf’s shipped files are never edited.
          </p>
        </div>
      )}

      {!embedded && tabs.length > 0 && (
        <SubTabs tabs={tabs} active={activeId} onChange={(id) => onSelectLeaf(id)} />
      )}

      {active && !embedded && (
        <div className="lcf-leaf">
          <div className="lcf-leaf__icon"><Icon name={leafIcon(activeId)} size={18} /></div>
          <div className="lcf-leaf__id">
            <div className="lcf-leaf__name">
              {active.displayName}
              <span className={"svc-dot svc-dot--" + st.tone}></span>
              <span className="lcf-leaf__state">{st.label}{st.note ? " · " + st.note : ""}</span>
              {config && !config.editable && (
                <span className="lcf-risk lcf-risk--wiring"><Icon name="lock" size={10} /> read-only</span>
              )}
            </div>
            <div className="lcf-leaf__meta">
              <span><Icon name="box" size={12} /> <code>{active.unit}</code></span>
              {up && <span><Icon name="clock" size={12} /> up {up}</span>}
              {mem && <span><Icon name="memory-stick" size={12} /> {mem}</span>}
              {config && <span><Icon name="sliders-horizontal" size={12} /> {fields.length} settings</span>}
              {overridden > 0 && (
                <span className="lcf-leaf__ovr"><Icon name="pencil" size={12} /> {overridden} overridden</span>
              )}
            </div>
          </div>
          <div className="lcf-leaf__acts">
            <button className={"lcf-btn lcf-btn--ghost" + (showLogs ? " is-on" : "")}
              onClick={() => setShowLogs(v => !v)}>
              <Icon name="scroll-text" size={13} /> Logs
            </button>
            {/* Restarting a leaf on its own has no endpoint yet — it arrives with leaf lifecycle
                actions. Shown disabled rather than hidden so the affordance's place is settled,
                and never wired to an empty PUT, which returns `unchanged` and restarts nothing. */}
            <button className="lcf-btn lcf-btn--ghost" disabled
              title="Restarting a leaf on its own isn’t available yet — applying a change restarts it.">
              <Icon name="refresh-cw" size={13} /> Restart
            </button>
          </div>
        </div>
      )}

      {showLogs && (
        <ConsoleView
          title={(active ? active.displayName : "Leaf") + " · journal"}
          icon="scroll-text"
          initialSourceId={activeId}
          resetKey={activeId}
          sources={(logSources || []).map(s => ({
            id: s.id,
            label: s.label || s.id,
            lines: (logLines || []).filter(e => e.source === s.id).slice().reverse(),
          }))}
          pill={{ label: "Live", live: true }} />
      )}

      <ComponentConfiguration
        surface={surface}
        onConfigChange={setConfig}
        // A wiring change can move what the panel reaches; re-read the board so its liveness and
        // capability state reflect what actually came back up.
        onApplied={() => servicesStore.refresh(hostId).catch(() => {})} />
    </>
  );
}

export default LeafConfigPage;
export { LeafConfigPage };
