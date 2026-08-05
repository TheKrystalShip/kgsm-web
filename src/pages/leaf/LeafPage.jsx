// LeafPage — one leaf on one node, with its own sub-tabs. The shell here is deliberately generic:
// identity header, the live service strip, the tab switcher, Logs and Settings are IDENTICAL for
// every leaf, because all of that comes from the services row and the leaf config descriptor the
// leaf already ships. Only the middle differs.
//
// The trail above the page is the app's own breadcrumb (`components/Breadcrumb.jsx`), which the shell
// renders for every route — this page names its place there rather than drawing a second one.
//
// Adding a leaf's own tabs is therefore a body, not a page: register it in LEAF_TABS below. A leaf
// with nothing special still gets Overview + Logs + Settings and needs no code at all.
//
// Admin-only end to end (persona.ROUTE_CAP.leaf = host.manage): every surface it aggregates — the
// service row, the config, the assistant's conversation review — is Admin-policy in kgsm-api.

import React from "react";

import { Icon } from "../../components/Icon.jsx";
import { SubTabs } from "../../components/SubTabs.jsx";
import { useStore } from "../../lib/store.js";
import { hostsStore, servicesStore, subscribeHostServices } from "../../lib/stores.js";
import { fmtBytes, leafStatus, uptimeShort } from "../diagnostics/diagHelpers.js";
import { leafIcon } from "../leafConfig/leafConfigHelpers.js";
import { AssistantOverview } from "./AssistantOverview.jsx";
import { AssistantConversations } from "./AssistantConversations.jsx";
import { LeafLogs } from "./LeafLogs.jsx";
import { LeafOverview } from "./LeafOverview.jsx";
import { LeafSettingsTab } from "./LeafSettingsTab.jsx";

// Per-leaf tabs, inserted between the always-present Overview and Settings. A leaf absent from this
// map simply has none — which is the correct answer for most of them today.
const LEAF_TABS = {
  assistant: [
    { id: "conversations", label: "Conversations", icon: "messages-square", render: (p) => <AssistantConversations {...p} /> },
  ],
};

// The Overview body a leaf renders. Falls back to the generic one, which is built purely from the
// service row + config descriptor and therefore works for any leaf.
const LEAF_OVERVIEW = {
  assistant: (p) => <AssistantOverview {...p} />,
};

function LeafPage({ hostId, leafId, tab, onSelectTab, onReviewConversation }) {
  const hosts = useStore(hostsStore, s => s.list);
  const services = useStore(servicesStore, s => s.list);
  const servicesFor = useStore(servicesStore, s => s.hostId);

  React.useEffect(() => {
    if (!hostId) return undefined;
    servicesStore.refresh(hostId).catch(() => {});
    return subscribeHostServices(hostId);
  }, [hostId]);

  const host = hosts.find(h => h.id === hostId) || null;
  const ready = servicesFor === hostId;
  const svc = ready && Array.isArray(services) ? services.find(s => s.id === leafId) || null : null;

  const extraTabs = LEAF_TABS[leafId] || [];
  // Logs is here for every leaf, not per-leaf like the map above: each one is a systemd unit and so
  // each one has a journal.
  const tabs = [
    { id: "overview", label: "Overview", icon: "layout-dashboard" },
    ...extraTabs.map(t => ({ id: t.id, label: t.label, icon: t.icon })),
    { id: "logs", label: "Logs", icon: "scroll-text" },
    { id: "settings", label: "Settings", icon: "sliders-horizontal" },
  ];
  const active = tabs.some(t => t.id === tab) ? tab : "overview";

  // The service row is the authority on liveness. Until it arrives the header shows the leaf id and
  // nothing else — an unknown state is left blank rather than guessed at.
  const status = svc ? leafStatus(svc) : null;
  const bodyProps = { hostId, leafId, svc, host, onReviewConversation };

  const renderBody = () => {
    if (active === "logs") return <LeafLogs hostId={hostId} leafId={leafId} svc={svc} />;
    if (active === "settings") return <LeafSettingsTab hostId={hostId} leafId={leafId} />;
    const extra = extraTabs.find(t => t.id === active);
    if (extra) return extra.render(bodyProps);
    const overview = LEAF_OVERVIEW[leafId];
    return overview ? overview(bodyProps) : <LeafOverview {...bodyProps} />;
  };

  return (
    <>
      <div className="dash-head dash-head--actions">
        <div className="dash-head__titles">
          <h1>
            <Icon name={leafIcon(leafId)} size={20} />{" "}
            {(svc && svc.displayName) || leafId}
            {status && (
              <span className={"cluster-chip cluster-chip--" + (status.tone === "up" ? "ok" : status.tone === "warn" ? "danger" : "muted")}>
                <span className={"status-led status-led--" + (status.tone === "up" ? "live" : status.tone === "warn" ? "down" : "idle")}></span>
                {status.label}
              </span>
            )}
          </h1>
          <div className="dash-head__sub">
            {svc && svc.role ? svc.role : " "}
            {svc && svc.unit && <> &middot; <span className="svc-fact svc-fact--unit">{svc.unit}</span></>}
          </div>
        </div>
      </div>

      <SubTabs tabs={tabs} active={active} onChange={onSelectTab} />

      {svc && (
        <div className="players-toolbar">
          <div className="svc-summary">
            <span className="svc-summary__stat">
              <span className={"status-led status-led--" + (svc.state === "active" ? "live" : "down")}></span>
              <b>{svc.state}</b>{svc.subState ? " (" + svc.subState + ")" : ""}
            </span>
            {/* Each fact is shown only when the backend gave it — an absent one is omitted, never
                rendered as a zero or a dash that reads like a measurement. */}
            {svc.since && <><span className="svc-summary__sep">&middot;</span>
              <span className="svc-summary__stat">up <b>{uptimeShort(svc.since)}</b></span></>}
            {svc.memoryBytes != null && <><span className="svc-summary__sep">&middot;</span>
              <span className="svc-summary__stat"><b>{fmtBytes(svc.memoryBytes)}</b></span></>}
            {svc.mainPid != null && <><span className="svc-summary__sep">&middot;</span>
              <span className="svc-summary__stat">pid <b>{svc.mainPid}</b></span></>}
            {svc.enabled != null && <><span className="svc-summary__sep">&middot;</span>
              <span className="svc-summary__stat">{svc.enabled ? "enabled at boot" : "not enabled at boot"}</span></>}
          </div>
        </div>
      )}

      {renderBody()}
    </>
  );
}

export { LeafPage };
export default LeafPage;
