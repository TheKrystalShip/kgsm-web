import React from "react";
import { assistantHosts, assistantHostsAll, capUsable } from "../lib/capabilities.js";
import { fmtRelative, parseTs } from "../lib/formatting.js";
import { serverHostId, serversStore } from "../lib/stores.js";

// AssistantDockContext — extracts the assistant dock state, derived layout
// values, and interaction functions out of App.jsx. The provider owns all
// dock-related state; consumers read via useAssistantDock().

const AssistantDockContext = React.createContext(null);

function useAssistantDock() {
  return React.useContext(AssistantDockContext);
}

function alertAssistantPrompt(item) {
  if (!item) return "";
  const srv = item.serverId ? serversStore.find(item.serverId) : null;
  const where = srv ? " on " + srv.name : "";
  const when = item.raisedAt
    ? fmtRelative(parseTs(item.raisedAt), new Date())
    : null;
  const raised = when ? " (raised " + when + ")" : "";
  if (item.escalated) {
    return "The alert \u201C" + item.title + "\u201D" + where + " escalated \u2014 auto-recovery gave up after "
      + item.attempts + " attempt" + (item.attempts === 1 ? "" : "s") + " and it needs a human. "
      + "Walk me through diagnosing and fixing it.";
  }
  return "The alert \u201C" + item.title + "\u201D is firing" + where + raised
    + ". What's likely causing it, and how do I fix it?";
}

function AssistantDockProvider({ hosts, selectedHostId, setRoute, children }) {
  // ===== State =====
  const [assistantOpen, setAssistantOpen] = React.useState(false);
  const [assistantSeed, setAssistantSeed] = React.useState(null);
  const tw = { dockBehavior: "auto", contentFloor: 1000, openByDefault: true };
  const [manualPin, setManualPin] = React.useState(() => {
    const v = localStorage.getItem("krystal:dock:pin");
    return v === "1" ? true : v === "0" ? false : null;
  });
  const [vw, setVw] = React.useState(() => window.innerWidth);
  const [assistantHostId, setAssistantHostId] = React.useState(null);
  const [dockWidth, setDockWidth] = React.useState(() => {
    const saved = parseInt(localStorage.getItem("krystal:dock:width") || "", 10);
    return saved && saved >= 320 && saved <= 900 ? saved : 420;
  });

  // ===== Functions =====
  const dockResize = React.useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = dockWidth;
    const min = 320, max = Math.min(900, window.innerWidth - 80);
    const onMove = (ev) => {
      setDockWidth(Math.max(min, Math.min(max, startW + (startX - ev.clientX))));
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      const handle = document.querySelector(".assistant-dock__resize");
      if (handle) handle.classList.remove("assistant-dock__resize--active");
    };
    document.body.style.userSelect = "none";
    e.currentTarget.classList.add("assistant-dock__resize--active");
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [dockWidth]);

  const handleAssistantNavigate = React.useCallback((target) => {
    if (!target) return;
    if (target.kind === "server") setRoute({ kind: "server", id: target.serverId, tab: target.tab });
    else if (target.kind === "audit") setRoute({ kind: "audit" });
    else setRoute({ kind: target.kind === "diagnostics" ? "fleet" : target.kind });
  }, [setRoute]);

  const openView = React.useCallback((view) => {
    setRoute({ kind: view === "diagnostics" ? "fleet" : view });
  }, [setRoute]);

  const askAssistant = React.useCallback((serverId) => {
    if (serverId) {
      const hid = serverHostId(serverId);
      const h = hid && hosts.find(x => x.id === hid);
      if (h && capUsable(h, "assistant")) setAssistantHostId(hid);
    }
    setAssistantOpen(true);
  }, [hosts]);

  const askAboutAlert = React.useCallback((item) => {
    if (item && item.serverId) setRoute({ kind: "server", id: item.serverId });
    askAssistant(item && item.serverId);
    if (item) setAssistantSeed({ prompt: alertAssistantPrompt(item), serverId: item.serverId || null, nonce: Date.now() });
  }, [setRoute, askAssistant]);

  const openAssistant = React.useCallback(() => {
    const sh = hosts.find(h => h.id === selectedHostId);
    if (!assistantHostId && sh && capUsable(sh, "assistant")) setAssistantHostId(sh.id);
    setAssistantOpen(true);
  }, [hosts, selectedHostId, assistantHostId]);

  // ===== Effects =====
  React.useEffect(() => {
    try { localStorage.setItem("krystal:dock:width", String(dockWidth)); } catch {}
  }, [dockWidth]);

  React.useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  React.useEffect(() => {
    try {
      if (manualPin == null) localStorage.removeItem("krystal:dock:pin");
      else localStorage.setItem("krystal:dock:pin", manualPin ? "1" : "0");
    } catch {}
  }, [manualPin]);

  // Per-host assistant capability
  const assistantHostList = React.useMemo(
    () => assistantHostsAll(hosts),
    [hosts]
  );
  const usableAssistants = React.useMemo(
    () => assistantHosts(hosts),
    [hosts]
  );
  const assistantHost = hosts.find(h => h.id === assistantHostId) || usableAssistants[0] || assistantHostList[0] || null;

  React.useEffect(() => {
    if (!assistantHostId && assistantHost) setAssistantHostId(assistantHost.id);
  }, [assistantHost && assistantHost.id, assistantHostId]);

  // Restore dock open/closed state across sessions
  const storedOpenRef = React.useRef(localStorage.getItem("krystal:dock:open"));
  const didInitOpen = React.useRef(false);
  React.useEffect(() => {
    if (didInitOpen.current) return;
    if (assistantHostList.length === 0) return;
    didInitOpen.current = true;
    if (window.innerWidth <= 768) return;
    const stored = storedOpenRef.current;
    if (stored === "0") return;
    if (stored === "1") { openAssistant(); return; }
    if (tw.openByDefault && tw.dockBehavior !== "rail") openAssistant();
  }, [assistantHostList.length]);

  React.useEffect(() => {
    try { localStorage.setItem("krystal:dock:open", assistantOpen ? "1" : "0"); } catch {}
  }, [assistantOpen]);

  // ===== Layout derivations =====
  const desktop = vw > 768;
  const canPush = desktop && (vw - dockWidth) >= tw.contentFloor;
  const effPush = manualPin == null ? canPush : (manualPin && canPush);
  const pushingPanel = desktop && assistantOpen && (
    tw.dockBehavior === "auto" ? effPush
    : tw.dockBehavior === "rail" ? canPush
    : false
  );
  const railMode = tw.dockBehavior === "rail" && desktop;

  // ===== Context value =====
  const value = React.useMemo(() => ({
    assistantOpen, setAssistantOpen,
    assistantSeed, setAssistantSeed,
    manualPin, setManualPin,
    vw, assistantHostId, setAssistantHostId,
    dockWidth, setDockWidth,
    tw, desktop, canPush, effPush, pushingPanel, railMode,
    assistantHostList, usableAssistants, assistantHost,
    dockResize, handleAssistantNavigate, openView,
    askAssistant, askAboutAlert, openAssistant,
  }), [
    assistantOpen, setAssistantOpen,
    assistantSeed, setAssistantSeed,
    manualPin, setManualPin,
    vw, assistantHostId, setAssistantHostId,
    dockWidth, setDockWidth,
    desktop, canPush, effPush, pushingPanel, railMode,
    assistantHostList, usableAssistants, assistantHost,
    dockResize, handleAssistantNavigate, openView,
    askAssistant, askAboutAlert, openAssistant,
  ]);

  return (
    <AssistantDockContext.Provider value={value}>
      {children}
    </AssistantDockContext.Provider>
  );
}

export { AssistantDockProvider, useAssistantDock, alertAssistantPrompt };
