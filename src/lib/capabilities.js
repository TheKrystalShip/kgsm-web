import { alertHost } from "../components/ContextualAlerts.jsx";
import { sessionStore } from "./sessionStore.js";
import { hostsStore, serverHostId } from "./stores.js";

// capabilities.js — the host capability model.
//
// Each host OPTIONALLY exposes backend services as capabilities. A host
// DECLARES which it provides when it's added (`provisioned`), and the backend
// reports each one's runtime `status` independently — so a capability can fail
// (e.g. the metrics exporter drops) WITHOUT the host going offline. Every
// surface reads this layer through hostCapability() and degrades
// gracefully, per-capability, rather than assuming a service is always there.
//
// There is no central service behind any capability. In particular the
// ASSISTANT is per-host: if a host doesn't expose it, that host has no
// assistant and there is no fallback. The dock's host picker is sourced from
// assistantHosts(). See architecture.html (§4·b).
//
// Shape on each host:
//   host.capabilities = {
//     <capId>: {
//       provisioned: boolean,   // does the host offer this at all? (set at add-time, editable)
//       status: "operational" | "degraded" | "down" | "unknown",  // runtime health
//       since:   ISO8601,       // when status last changed (drives "down for 6m" copy)
//       message: string|null,   // human reason shown in the graceful fallback
//       info:    { ... },       // capability-specific config the backend reports
//     }
//   }

  var CAPS = { METRICS: "metrics", ASSISTANT: "assistant", WATCHDOG: "watchdog" };
  var CAP_ORDER = [CAPS.METRICS, CAPS.ASSISTANT, CAPS.WATCHDOG];

  // Catalogue — label / icon / one-liner. Drives nav, pickers and docs so the
  // copy lives in one place.
  var CAP_META = {
    metrics:   { id: "metrics",   label: "Live metrics", icon: "activity",    blurb: "CPU \u00b7 RAM \u00b7 disk \u00b7 network telemetry streamed from the host agent." },
    assistant: { id: "assistant", label: "Assistant",    icon: "bot",         blurb: "Per-host AI, routed by the host's own backend. No central assistant \u2014 each host runs one, or none." },
    watchdog:  { id: "watchdog",  label: "Watchdog",     icon: "heart-pulse", blurb: "Keeps game servers alive \u2014 restarts on crash or hang per the host's policy." },
  };

  // Runtime status the backend reports for a PROVISIONED capability.
  //   operational — healthy; full feature.
  //   degraded    — working but impaired (stale/partial data); soft warning.
  //   down        — provisioned but not functioning right now; graceful fallback.
  //   unknown     — can't be determined (host offline / access denied / not yet probed).
  var STATUS = { OPERATIONAL: "operational", DEGRADED: "degraded", DOWN: "down", UNKNOWN: "unknown" };

  // Derived render state the UI switches on. Folds provisioning + status into
  // one value; `absent` means the host doesn't offer the capability at all.
  var STATE = { ABSENT: "absent", OPERATIONAL: "operational", DEGRADED: "degraded", DOWN: "down", UNKNOWN: "unknown" };

  // Status-pill tone per state (maps onto the kit's --success/--warning/--danger).
  var TONE = { absent: "muted", operational: "success", degraded: "warn", down: "danger", unknown: "muted" };
  var STATE_LABEL = { absent: "Not offered", operational: "Operational", degraded: "Degraded", down: "Down", unknown: "Unknown" };

  function isDenied(host) {
    try { return !!(host && sessionStore.isDenied(host.id)); }
    catch { return false; }
  }

  // Normalize one host's capability into a render-ready descriptor. Safe on
  // partial / empty data (denied or never-probed hosts) — returns absent/unknown
  // rather than throwing, so every surface can render without its own guards.
  function hostCapability(host, capId) {
    var meta = CAP_META[capId] || { id: capId, label: capId, icon: "circle", blurb: "" };
    var rec = (host && host.capabilities && host.capabilities[capId]) || null;

    var provisioned = rec ? (rec.provisioned !== false) : false;
    var status = rec ? (rec.status || STATUS.UNKNOWN) : STATUS.UNKNOWN;

    // A denied or offline host can't have its capability health determined.
    if (provisioned && (isDenied(host) || (host && host.online === false))) status = STATUS.UNKNOWN;

    var state = !provisioned ? STATE.ABSENT : status; // statuses map 1:1 onto state
    return {
      id: meta.id, label: meta.label, icon: meta.icon, blurb: meta.blurb,
      provisioned: provisioned,
      status: status,
      state: state,
      tone: TONE[state] || "muted",
      stateLabel: STATE_LABEL[state] || status,
      message: rec ? (rec.message || null) : null,
      since: rec ? (rec.since || null) : null,
      info: rec ? (rec.info || {}) : {},
    };
  }

  // Is the capability USABLE right now (feature shown & active)? operational and
  // degraded both count; down / unknown / absent do not.
  function capUsable(host, capId) {
    var s = hostCapability(host, capId).state;
    return s === STATE.OPERATIONAL || s === STATE.DEGRADED;
  }
  function capProvisioned(host, capId) { return hostCapability(host, capId).provisioned; }

  // Hosts that can serve the assistant RIGHT NOW — provisioned, usable and
  // reachable. The source list for the dock's host selector; when empty there
  // is genuinely no assistant to talk to (hide the launcher entirely).
  function assistantHosts(hosts) {
    return (hosts || []).filter(function (h) { return capUsable(h, CAPS.ASSISTANT); });
  }

  // Dynamic update — the point of the model. Patch a capability's runtime record
  // on the live host store; every useStore subscriber re-renders. Stands in for
  // the backend pushing a capability.status change over the socket.
  function setHostCapability(hostId, capId, patch) {
    var host = hostsStore.find(hostId);
    if (!host) return;
    var caps = Object.assign({}, host.capabilities || {});
    var prev = caps[capId] || { provisioned: true };
    caps[capId] = Object.assign({}, prev, patch, { since: patch.since || new Date().toISOString() });
    hostsStore.patch(hostId, { capabilities: caps });
  }

  const CAP_STATUS = STATUS;
  const CAP_STATE = STATE;
  const CAP_TONE = TONE;
  const CAP_STATE_LABEL = STATE_LABEL;
  // serverCapUsable(server, capId) — capabilities are per-HOST, so a server's
  // access to a capability is its host's. Used by per-server surfaces (action
  // buttons, settings) to gate on the watchdog/metrics/assistant of its host.
  function serverCapUsable(server, capId) {
    if (!server) return true;
    var host = server.hostId ? hostsStore.find(server.hostId) : null;
    return host ? capUsable(host, capId) : true;
  }
  // askAssistantUsable(alert) — can the "Ask assistant" action work for this
  // alert? Resolves the alert's host (anchor / server) and checks its assistant.
  // Host-less (panel-wide) alerts route to the default assistant → allowed.
  function askAssistantUsable(item) {
    var hostId = alertHost(item)
      || (item && item.anchor && item.anchor.hostId)
      || (item && item.serverId && serverHostId(item.serverId));
    if (!hostId) return true;
    var host = hostsStore.find(hostId);
    return host ? capUsable(host, CAPS.ASSISTANT) : true;
  }
  // Hosts that OFFER an assistant (provisioned, access not denied) — the dock
  // lists them all so a host whose assistant dropped stays visible (disabled).
  function assistantHostsAll(hosts) {
    return (hosts || []).filter(function (h) {
      return capProvisioned(h, CAPS.ASSISTANT) && !isDenied(h);
    });
  }

export { CAPS, CAP_META, CAP_ORDER, CAP_STATE, CAP_STATE_LABEL, CAP_STATUS, CAP_TONE, askAssistantUsable, assistantHosts, assistantHostsAll, capProvisioned, capUsable, hostCapability, serverCapUsable, setHostCapability };
