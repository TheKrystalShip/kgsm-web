import React from "react";
import { assistantSession } from "../lib/assistantSession.js";
import { answersFor, assistantForHost, assistantTargets, resolveTarget, usableTargets } from "../lib/assistants.js";
import { PREF_KEYS, prefsStore } from "../lib/stores/prefs.js";
import { useStore } from "../lib/store.js";
import { clusterStore } from "../lib/stores.js";
import { fmtRelative, parseTs } from "../lib/formatting.js";
import { serverHostId, serversStore } from "../lib/stores.js";

// AssistantDockContext — extracts the assistant dock state, derived layout
// values, and interaction functions out of App.jsx. The provider owns all
// dock-related state; consumers read via useAssistantDock().

const AssistantDockContext = React.createContext(null);

function useAssistantDock() {
  return React.useContext(AssistantDockContext);
}

// useAssistantFor(hostId) — which assistant would answer a question scoped to this node, or null.
//
// The ONE gate behind every "ask the assistant" affordance on the panel. It reads the same candidate
// list the dock resolves its own target from, through the same function, so a button that offers to
// ask and the dock that would answer cannot disagree about whether there is an assistant. They did:
// each affordance asked whether the alert's own NODE ran a leaf, which is false of every node in a
// cluster whose assistant is an anchor — so a healthy assistant sat behind disabled buttons.
function useAssistantFor(hostId) {
  const dock = useAssistantDock();
  return assistantForHost((dock && dock.assistantHostList) || [], hostId || null);
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

function AssistantDockProvider({ hosts, setRoute, children }) {
  // The cluster's own roster and its capability assignments — what says an assistant exists as a
  // member rather than as a service on a node. Both empty on a standalone deployment, which is what
  // makes this the same code in both.
  const clusterMembers = useStore(clusterStore, s => s.nodes);
  const clusterCapabilities = useStore(clusterStore, s => s.capabilities);
  const prefsHydrated = useStore(prefsStore, s => s.hydrated);
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
  // The candidates and the current target, readable from the interaction callbacks below — which are
  // defined before either is derived, and read them only after a click. Kept in a ref rather than in
  // their deps so a seeded ask does not rebuild every handler each time a node's health changes.
  const assistantHostListRef = React.useRef([]);
  const assistantHostRef = React.useRef(null);
  // Which assistant is addressed, and whether that was a decision. A seeded ask retargets to the
  // node a question is about, which is derived from the subject and lasts as long as the subject
  // does; the picker is a choice, and a choice is the account's and is kept.
  const chooseAssistant = React.useCallback((id, opts) => {
    setAssistantHostId(id);
    if (opts && opts.chosen) prefsStore.set(PREF_KEYS.ASSISTANT_TARGET, id || null);
  }, []);
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

  // Point the dock at something that can answer about `hostId`, without overriding a target that
  // already can. A leaf only sees the machine it runs on, so a question about another node has to
  // move; the cluster's own sees every node, so a deliberate choice of it is left alone.
  const scopeAssistant = React.useCallback((hostId) => {
    if (!hostId) return;
    if (answersFor(assistantHostRef.current, hostId)) return;
    const next = assistantForHost(assistantHostListRef.current, hostId);
    if (next) setAssistantHostId(next.id);
  }, []);

  const askAssistant = React.useCallback((serverId) => {
    if (serverId) scopeAssistant(serverHostId(serverId));
    setAssistantOpen(true);
  }, [scopeAssistant]);

  const askAboutAlert = React.useCallback((item) => {
    if (item && item.serverId) setRoute({ kind: "server", id: item.serverId });
    askAssistant(item && item.serverId);
    if (item) setAssistantSeed({ prompt: alertAssistantPrompt(item), serverId: item.serverId || null, nonce: Date.now() });
  }, [setRoute, askAssistant]);

  // Hand a blueprint-authoring request to the assistant, from the create page. Opens the
  // INLINE dock (the page stays put, so the half-written editor isn't thrown away) and seeds
  // an editable, not-yet-sent prompt — the user reads and sends it, we never speak for them.
  // The host is the one the create page picked: the blueprint lands on that host's disk.
  const askCreateBlueprint = React.useCallback((gameName, hostId) => {
    scopeAssistant(hostId);
    setAssistantOpen(true);
    setAssistantSeed({
      prompt: "Create a blueprint for " + (gameName || ""),
      serverId: null,
      nonce: Date.now(),
    });
  }, [scopeAssistant]);

  // Hand a NODE to the assistant, from the dashboard's node card. Same contract as every other
  // seeded ask: the dock opens on an assistant that can answer about that node, with an editable
  // prompt the user sends — we never speak for them.
  const askAboutHost = React.useCallback((hostId) => {
    const h = hostId && hosts.find(x => x.id === hostId);
    scopeAssistant(hostId);
    setAssistantOpen(true);
    setAssistantSeed({
      prompt: "How is " + ((h && h.name) || hostId) + " doing right now \u2014 what's using its capacity, "
        + "and is anything worth acting on?",
      serverId: null,
      nonce: Date.now(),
    });
  }, [scopeAssistant, hosts]);

  // Opening the dock with nothing in hand names no node. The target comes from
  // the subject — the server behind askAssistant, the blueprint behind
  // askCreateBlueprint, the node a picked conversation lives on — or, absent a
  // subject, from the dock's own host picker.
  const openAssistant = React.useCallback(() => {
    setAssistantOpen(true);
  }, []);

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

  // Every assistant this browser could address, of both standings: the cluster's own, held by the
  // member the `assistant` capability is assigned to, and any node running one of its own. A
  // deployment with no cluster contributes an empty roster and gets exactly the leaf list it had.
  const assistantHostList = React.useMemo(
    () => assistantTargets({ hosts, members: clusterMembers, capabilities: clusterCapabilities }),
    [hosts, clusterMembers, clusterCapabilities]
  );
  // Which one the dock addresses. The choice this account made wins; the cluster's own assistant is
  // the default behind it, because it acts on every node where a leaf knows only its own machine.
  // Several leaves, no cluster assistant and nothing chosen resolves to null on purpose — that is
  // the picker, and binding to whichever node sorted first would be a choice nobody made.
  // The ones that could answer right now. The palette offers "ask the assistant" off this, so an
  // empty list is what hides an action that could only fail.
  const usableAssistants = React.useMemo(() => usableTargets(assistantHostList), [assistantHostList]);
  const assistantHost = resolveTarget(assistantHostList, assistantHostId);
  assistantHostListRef.current = assistantHostList;
  assistantHostRef.current = assistantHost;

  // The chosen assistant is the ACCOUNT's, kept where every other preference is: it rides the same
  // mirror, so it follows the person to their other devices when they have sync on. Read once the
  // store has hydrated — before that the stored answer is not yet known, and writing this render's
  // fallback would overwrite it with a default nobody picked.
  React.useEffect(() => {
    if (!prefsHydrated) return;
    const stored = prefsStore.get(PREF_KEYS.ASSISTANT_TARGET, null);
    if (stored && stored !== assistantHostId) setAssistantHostId(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- adopts the stored choice once, when the mirror lands; assistantHostId is read, not tracked
  }, [prefsHydrated]);

  // Sign in to the targeted assistant's leaf without being asked to. Every surface on a host is the
  // same Discord application, so a browser signed into the panel has already authorized the
  // assistant and its round trip renders nothing — the second login is a redirect, not a decision.
  //
  // Keyed on the TARGETED host, which is what bounds this: no assistant in the cluster and there is
  // nothing to target; several and the target stays unset until the user picks one, so at most one
  // leaf is ever addressed. ensureSession spends a held refresh token before it spends a redirect,
  // and takes at most one redirect per host per tab.
  //
  // Gated on the leaf being USABLE, not merely declared: a redirect to a leaf that is down lands the
  // browser on a dead origin, which is a far worse answer than the dock saying it is unavailable.
  // The flag is in the deps so a leaf that comes up later still gets its one attempt.
  const assistantReachable = !!(assistantHost && usableTargets([assistantHost]).length);
  React.useEffect(() => {
    if (assistantHost && assistantReachable) assistantSession.ensureSession(assistantHost.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the targeted host id + reachability; the object is re-derived every render
  }, [assistantHost && assistantHost.id, assistantReachable]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot dock-open init guarded by didInitOpen; tw is a constant literal
  }, [assistantHostList.length]);

  React.useEffect(() => {
    try { localStorage.setItem("krystal:dock:open", assistantOpen ? "1" : "0"); } catch {}
  }, [assistantOpen]);

  // ===== Review mode (read-only replay of someone else's conversation) =====
  // An admin reviewing a transcript sees it in THIS dock, rendered by the very same components that
  // drew it for the person who had the conversation — the transcript DTO is identical to a user's own
  // history by design, so a second viewer would only be a copy free to drift.
  //
  // It is held here rather than in the reviewing page because the dock outlives that page: opening a
  // transcript and then navigating elsewhere must not strand the dock in a mode with nothing in it.
  const [review, setReview] = React.useState(null);

  // Enter review mode. `conversation` carries the opaque handle, the owning user, and the summary the
  // listing already had, so the header can render before the transcript arrives.
  const openReview = React.useCallback((hostId, conversation) => {
    if (!hostId || !conversation || !conversation.id) return;
    setReview({ hostId, conversation });
    setAssistantOpen(true);
  }, []);

  // Leave review mode and return the dock to the reviewer's own chat. Called by the banner's exit and
  // whenever the dock is closed, so the dock can never reopen still showing someone else's chat.
  const exitReview = React.useCallback(() => setReview(null), []);

  React.useEffect(() => { if (!assistantOpen) setReview(null); }, [assistantOpen]);

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
    vw, assistantHostId, setAssistantHostId, chooseAssistant,
    dockWidth, setDockWidth,
    tw, desktop, canPush, effPush, pushingPanel, railMode,
    assistantHostList, usableAssistants, assistantHost,
    dockResize, handleAssistantNavigate, openView,
    askAssistant, askAboutAlert, askAboutHost, askCreateBlueprint, openAssistant,
    review, openReview, exitReview,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tw is a fresh-per-render literal with constant contents; depping it would rebuild the context value every render
  }), [
    assistantOpen, setAssistantOpen,
    assistantSeed, setAssistantSeed,
    manualPin, setManualPin,
    vw, assistantHostId, setAssistantHostId, chooseAssistant,
    dockWidth, setDockWidth,
    desktop, canPush, effPush, pushingPanel, railMode,
    assistantHostList, usableAssistants, assistantHost,
    dockResize, handleAssistantNavigate, openView,
    askAssistant, askAboutAlert, askAboutHost, askCreateBlueprint, openAssistant,
    review, openReview, exitReview,
  ]);

  return (
    <AssistantDockContext.Provider value={value}>
      {children}
    </AssistantDockContext.Provider>
  );
}

export { AssistantDockProvider, useAssistantDock, useAssistantFor, alertAssistantPrompt };
