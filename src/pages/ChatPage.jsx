import React from "react";
import { Icon } from "../components/Icon.jsx";
import { NeedsAttention } from "../components/NeedsAttention.jsx";
import { VoiceComposerBar, useVoiceRecorder } from "../components/VoiceNote.jsx";
import { capUsable, hostCapability } from "../lib/capabilities.js";
import { canOperate, isAdmin } from "../lib/persona.js";
import { useStore } from "../lib/store.js";
import { confirmCommand, confirmInstall, confirmUninstall, filesStore, serversStore } from "../lib/stores.js";
import { fetchAssistantTranscript } from "../lib/stores.js";
import { api } from "../lib/apiClient.js";

// Imports from extracted modules
import {
  CHAT_ACTIONS_LS, CHAT_THINK_LS, TOGGLE_COPY,
  loadConversations, saveConversations, loadSetting, saveSetting,
  uid, adaptResultCard, adaptBlueprintConfirm, composeVerified, reduceTurnFrame, promotePendingCards, scaffoldHistory,
  latestUsage, mergeServerConversations,
} from "./chat/chatUtils.jsx";
import { API_COMMAND_VERBS, CHAT_PRIVACY_NOTICE, commandMeta, pickGreeting } from "./chat/chatConstants.js";
// ChatCommand is imported only to re-export it (see the export list below); the
// message-role dispatch that used it now lives in ChatThread.
import { ChatCommand } from "./chat/ChatMessageParts.jsx";
import { ChatContextMeter } from "./chat/ChatContextMeter.jsx";
import { AssistantHostPicker } from "./chat/AssistantHostPicker.jsx";
import { ChatHistory } from "./chat/ChatHistory.jsx";
import { ChatThread } from "./chat/ChatThread.jsx";

function ChatPage({ user, onOpenServer, onOpenView, docked, seed, onClose, onExpand, onNavigate, getServerState, assistantHost, assistantHosts = [], onSelectAssistantHost, showPin, pinned, pinDisabled, onTogglePin, review, onExitReview }) {
  const assistantCap = assistantHost ? hostCapability(assistantHost, "assistant") : null;
  const conn = !assistantHost
    ? { tone: "muted", label: assistantHosts.length ? "No node chosen" : "No assistant" }
    : assistantCap.state === "operational" ? { tone: "online", label: "Connected \u00b7 " + assistantHost.name }
    : assistantCap.state === "degraded"    ? { tone: "warn",   label: "Degraded \u00b7 " + assistantHost.name }
    : { tone: "danger", label: "Unavailable \u00b7 " + assistantHost.name };

  const assistantUsable = !!(assistantHost && capUsable(assistantHost, "assistant"));

  const [convos, setConvos]     = React.useState(loadConversations);
  const [activeId, setActiveId] = React.useState(() => loadConversations()[0]?.id || null);
  const [input, setInput]       = React.useState("");
  const [busy, setBusy]         = React.useState(false);

  const serverList = useStore(serversStore, s => s.list);

  const canSeeActions = !!(assistantHost && canOperate(assistantHost.id));
  const canUseActions = !!(assistantHost && isAdmin(assistantHost.id));
  const [actionsOn, setActionsOn] = React.useState(() => loadSetting(CHAT_ACTIONS_LS, "") === "1");
  React.useEffect(() => { saveSetting(CHAT_ACTIONS_LS, actionsOn ? "1" : "0"); }, [actionsOn]);
  const autoAcceptActive = actionsOn && canUseActions;
  const [thinkOn, setThinkOn] = React.useState(() => loadSetting(CHAT_THINK_LS, "") === "1");
  React.useEffect(() => { saveSetting(CHAT_THINK_LS, thinkOn ? "1" : "0"); }, [thinkOn]);

  const announceToggle = (toggle, on) => {
    if (!activeId) return;
    const label = TOGGLE_COPY[toggle][on ? "on" : "off"];
    setConvos(prev => prev.map(c =>
      (c.id === activeId && c.messages.length > 0)
        ? { ...c, messages: [...c.messages, { role: "toggle", toggle, on, label }] }
        : c));
  };
  const toggleThinking = () => { const next = !thinkOn;  setThinkOn(next);  announceToggle("thinking", next); };
  const toggleActions  = () => { const next = !actionsOn; setActionsOn(next); announceToggle("actions", next); };

  const scrollRef = React.useRef(null);
  const abortRef  = React.useRef(null);
  // The OPEN blueprint draft's live content, so a chat turn can carry it to the assistant (which lets it
  // revise the draft via revise_blueprint). draftEditsRef maps a draft's cmdId → its current editor text
  // (manual edits included); activeDraftRef is the cmdId of the draft currently being reviewed.
  const draftEditsRef  = React.useRef({});
  const activeDraftRef = React.useRef(null);
  const onDraftEdit   = React.useCallback((cmdId, text) => { if (cmdId) draftEditsRef.current[cmdId] = text; }, []);
  const onDraftActive = React.useCallback((cmdId, active) => {
    if (active) activeDraftRef.current = cmdId;
    else if (activeDraftRef.current === cmdId) activeDraftRef.current = null;
  }, []);
  const taRef     = React.useRef(null);
  const pinnedRef = React.useRef(true);

  const active = convos.find(c => c.id === activeId) || null;

  React.useEffect(() => { saveConversations(convos); }, [convos]);

  const [histLoading, setHistLoading] = React.useState(false);
  const histReqRef = React.useRef(0);
  const loadServerHistory = React.useCallback(() => {
    if (!assistantHost || !assistantUsable) return;
    const reqId = ++histReqRef.current;
    setHistLoading(true);
    api.host(assistantHost.id).get("/assistant/conversations").then(
      (list) => { if (histReqRef.current === reqId) setConvos(prev => mergeServerConversations(prev, list, assistantHost.id)); },
      () => {})
      .finally(() => { if (histReqRef.current === reqId) setHistLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only assistantHost.id is used (and in deps); the object is re-derived each render
  }, [assistantHost && assistantHost.id, assistantUsable]);

  React.useEffect(() => {
    if (!assistantHost) return;
    const c = convos.find(x => x.id === activeId);
    if (!c || !c.remote || c.loaded || (c.messages && c.messages.length > 0)) return;
    if (c.hostId && c.hostId !== assistantHost.id) return;
    let cancelled = false;
    api.host(assistantHost.id).get("/assistant/conversations/" + encodeURIComponent(c.id)).then(
      (data) => {
        if (cancelled) return;
        const messages = scaffoldHistory(data && data.entries);
        setConvos(prev => prev.map(x => x.id === c.id ? { ...x, messages, loaded: true } : x));
      },
      () => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only assistantHost.id is used (in deps); convos is intentionally excluded — depping it would refetch history on every streamed message
  }, [activeId, assistantHost && assistantHost.id]);

  // ===== Review mode =====
  // Replaying someone ELSE's conversation, read-only. The admin transcript DTO is deliberately the
  // same shape as the caller's own history, so it goes through the very same scaffoldHistory →
  // ChatThread path — a reviewer sees what that person saw, drawn by the same components, and there
  // is no second renderer able to drift from this one.
  const [reviewMessages, setReviewMessages] = React.useState(null);
  const [reviewState, setReviewState] = React.useState("idle");

  React.useEffect(() => {
    if (!review || !review.conversation) { setReviewMessages(null); setReviewState("idle"); return undefined; }
    let cancelled = false;
    setReviewState("loading");
    setReviewMessages(null);
    fetchAssistantTranscript(review.hostId, review.conversation.id).then(
      (data) => {
        if (cancelled) return;
        setReviewMessages(scaffoldHistory(data && data.entries));
        setReviewState("ready");
      },
      () => { if (!cancelled) setReviewState("error"); },
    );
    return () => { cancelled = true; };
  }, [review]);

  const prevUsableRef = React.useRef(assistantUsable);
  const prevHostRef = React.useRef(assistantHost && assistantHost.id);
  React.useEffect(() => {
    const hostId = assistantHost && assistantHost.id;
    if (prevHostRef.current === hostId && prevUsableRef.current !== assistantUsable && activeId) {
      const others = (assistantHosts || []).filter(h => h.id !== hostId).map(h => h.name);
      const note = assistantUsable
        ? { role: "system", kind: "assistant-up", host: (assistantHost && assistantHost.name) || "The" }
        : { role: "system", kind: "assistant-down", host: (assistantHost && assistantHost.name) || "This host", others: others, message: assistantCap && assistantCap.message };
      setConvos(prev => prev.map(c =>
        (c.id === activeId && c.messages.length > 0) ? { ...c, messages: [...c.messages, note] } : c));
    }
    prevUsableRef.current = assistantUsable;
    prevHostRef.current = hostId;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref-based edge detector on the usable-flip; the extra values are read once at the transition, minimal deps keep the edge correct
  }, [assistantUsable, assistantHost && assistantHost.id, activeId]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [active?.messages, busy]);

  React.useEffect(() => {
    pinnedRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId]);

  const onThreadScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distanceFromBottom <= 80;
  }, []);

  const pickAssistantHost = (id) => {
    if (!onSelectAssistantHost) return;
    const next = (assistantHosts || []).find(h => h.id === id);
    onSelectAssistantHost(id);
    if (activeId && next) {
      setConvos(prev => prev.map(c => (c.id === activeId && c.messages.length > 0)
        ? { ...c, messages: [...c.messages, { role: "scope", label: "Now talking to " + next.name + "\u2019s assistant" }] }
        : c));
    }
  };

  // A conversation lives on the node that holds it, so opening one targets that
  // node — the subject decides where we're talking. A conversation whose node
  // isn't among the assistant-capable ones is opened without retargeting; the
  // history load below then declines it rather than asking the wrong node.
  const pickChat = (id) => {
    const c = convos.find(x => x.id === id);
    const want = c && c.hostId;
    if (want && want !== (assistantHost && assistantHost.id)
        && onSelectAssistantHost && (assistantHosts || []).some(h => h.id === want)) {
      onSelectAssistantHost(want);
    }
    setActiveId(id);
  };

  const newChat = () => {
    const c = { id: uid(), title: "New chat", messages: [], created: Date.now(), hostId: assistantHost && assistantHost.id };
    setConvos(prev => [c, ...prev]);
    setActiveId(c.id);
    setInput("");
    if (taRef.current) taRef.current.focus();
  };
  const deleteChat = (id, e) => {
    e.stopPropagation();
    const chat = convos.find(c => c.id === id);
    const hostId = (chat && chat.hostId) || (assistantHost && assistantHost.id);
    if (hostId) api.host(hostId).del("/assistant/conversations/" + encodeURIComponent(id)).catch(() => {});
    setConvos(prev => {
      const next = prev.filter(c => c.id !== id);
      if (id === activeId) setActiveId(next[0]?.id || null);
      return next;
    });
  };
  const setMessages = (updater) => {
    setConvos(prev => prev.map(c => {
      if (c.id !== activeId) return c;
      const messages = typeof updater === "function" ? updater(c.messages) : updater;
      return { ...c, messages };
    }));
  };

  const sendLive = async (convId, text, userMsg) => {
    setConvos(prev => prev.map(c => {
      if (c.id !== convId) return c;
      const title = c.messages.length === 0 ? (text.slice(0, 40) || "Voice note") : c.title;
      return { ...c, title, messages: [...c.messages, userMsg, { role: "assistant", content: "" }] };
    }));

    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const applyFrame = (ev) => setConvos(prev => prev.map(c =>
      c.id === convId ? { ...c, messages: reduceTurnFrame(c.messages, ev) } : c));

    try {
      const prompt = text || "[The user sent a voice note; transcription was unavailable.]";
      // If a blueprint draft is open, carry its CURRENT content so the assistant can revise it from chat.
      const openCmdId = activeDraftRef.current;
      const draftYaml = openCmdId ? draftEditsRef.current[openCmdId] : undefined;
      await api.host(assistantHost.id).turn(
        { prompt, actions: autoAcceptActive, think: thinkOn, conversationId: convId, draftYaml },
        { onEvent: applyFrame, signal: ctrl.signal });
    } catch (e) {
      const aborted = e && e.name === "AbortError";
      const reason = e && e.code === 503 ? assistantHost.name + "\u2019s assistant is currently unavailable."
        : e && e.code === 502 ? "Couldn\u2019t reach " + assistantHost.name + "\u2019s assistant \u2014 try again, or check the host."
        : e && e.code === 404 ? assistantHost.name + " isn\u2019t serving an assistant right now."
        : (e && e.userMessage) || (assistantHost.name + "\u2019s assistant didn\u2019t respond.");
      setConvos(prev => prev.map(c => {
        if (c.id !== convId) return c;
        const msgs = c.messages.slice();
        const lastIdx = msgs.length - 1;
        const bubble = msgs[lastIdx];
        if (!bubble || bubble.role !== "assistant") return c;
        const finalized = aborted
          ? { ...bubble, content: bubble.content || "_Stopped._" }
          : bubble.content
            ? { ...bubble, content: bubble.content + "\n\n_\u26a0 Interrupted \u2014 the assistant connection dropped._" }
            : { ...bubble, content: "\u26a0\ufe0f " + reason, error: true };
        // The stream ended without a done frame \u2014 still surface any gathered evidence.
        msgs[lastIdx] = promotePendingCards(finalized);
        return { ...c, messages: msgs };
      }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const send = async (override, voiceMeta) => {
    const text = (typeof override === "string" ? override : input).trim();
    if ((!text && !voiceMeta) || busy) return;

    let convId = activeId;
    if (!convId) {
      convId = uid();
      const c = { id: convId, title: "New chat", messages: [], created: Date.now(), hostId: assistantHost && assistantHost.id };
      setConvos(prev => [c, ...prev]);
      setActiveId(convId);
    }

    const userMsg = voiceMeta
      ? { role: "user", content: text, voice: voiceMeta, ts: Date.now() }
      : { role: "user", content: text, ts: Date.now() };
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";

    if (!assistantHost || !capUsable(assistantHost, "assistant")) {
      const why = !assistantHost
        ? "No host is serving an assistant right now."
        : (assistantCap && assistantCap.message) ? assistantCap.message
        : "This host\u2019s assistant is currently " + (assistantCap ? assistantCap.state : "unavailable") + ".";
      setConvos(prev => prev.map(c => {
        if (c.id !== convId) return c;
        const title = c.messages.length === 0 ? (text.slice(0, 40) || "Voice note") : c.title;
        return { ...c, title, messages: [...c.messages, userMsg, { role: "assistant", content: "\u26a0\ufe0f " + why, error: true }] };
      }));
      return;
    }

    sendLive(convId, text, userMsg);
  };

  const stop = () => { if (abortRef.current) abortRef.current.abort(); };

  const compactActive = React.useCallback(async () => {
    if (!assistantHost || !activeId) return { compacted: false };
    const convId = activeId;
    const res = await api.host(assistantHost.id).post(
      "/assistant/conversations/" + encodeURIComponent(convId) + "/compact");
    const compacted = !!(res && res.compacted);
    const n = res && typeof res.messagesCompacted === "number" ? res.messagesCompacted : 0;
    if (compacted) {
      const label = "Conversation compacted to save context"
        + (n ? " \u00b7 " + n + " message" + (n === 1 ? "" : "s") : "");
      setConvos(prev => prev.map(c => c.id === convId
        ? { ...c, messages: [...c.messages, { role: "checkpoint", label }] }
        : c));
    }
    return { compacted, messagesCompacted: n };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only assistantHost.id is used (and in deps); the object is re-derived each render
  }, [assistantHost && assistantHost.id, activeId]);

  const voice = useVoiceRecorder();
  const sendVoice = async () => {
    const payload = await voice.finish();
    if (!payload) return;
    const { id, duration, peaks, transcript } = payload;
    send(transcript || "", { id, duration, peaks });
  };

  const startBriefingChat = (item) => {
    setInput(item.prompt);
    setTimeout(() => {
      const ta = taRef.current;
      if (ta) { ta.focus(); ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 200) + "px"; }
    }, 0);
  };

  React.useEffect(() => {
    if (!seed || !seed.prompt) return;
    startBriefingChat({ prompt: seed.prompt });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per seed via seed.nonce; seed.prompt is read fresh at that edge
  }, [seed && seed.nonce]);

  const runLiveCommand = (card) => {
    if (!API_COMMAND_VERBS.has(card.verb)) return;
    const isInstall = card.verb === "install";
    // Install targets a blueprint (subject.id is the blueprint, not an existing instance); the rest
    // target an existing server. Resolve the host from the instance where there is one, else the
    // host the assistant is running on (install always lands on the assistant's own host).
    const found = isInstall ? null : (serversStore.getState().list.find(s => s.id === card.subjectId) || null);
    const hostId = (found && found.hostId) || (assistantHost && assistantHost.id) || null;
    const serverName = isInstall
      ? (card.instanceName || card.subjectId)
      : (found && found.name) || card.subjectId;
    const meta = commandMeta(card.verb);
    const verifyId = uid();
    setMessages(msgs => {
      const marked = msgs.map(m =>
        (m.role === "command" && m.cmdId === card.cmdId && m.state === "proposed")
          ? { ...m, state: "confirmed" } : m);
      return [...marked, { role: "verify", id: verifyId, action: { label: meta.label, verb: card.verb, serverName }, state: "pending" }];
    });
    const resolveVerify = (result) =>
      setMessages(msgs => msgs.map(m => (m.role === "verify" && m.id === verifyId) ? { ...m, state: "done", result } : m));
    // write_file writes the assistant's proposed content through the file-content endpoint (the same
    // jailed, operator-gated path the file editor uses) — it returns the saved file, not a job, so its
    // verified block is composed here rather than through composeVerified.
    if (card.verb === "write_file") {
      if (!card.file || !card.file.path) {
        resolveVerify({ ok: false, headline: "Couldn’t update the file — no change was proposed.", lines: [] });
        return;
      }
      filesStore.saveFile(hostId, card.subjectId, card.file.path, card.file.proposedContent).then(
        () => resolveVerify({ ok: true, headline: "Updated " + card.file.path + " on " + serverName + ". It takes effect on the next restart.", lines: [] }),
        err => {
          const expired = err && err.code === 401;
          resolveVerify(expired
            ? { ok: false, headline: ((assistantHost && assistantHost.name) || "This host") + "’s session expired — re-authorize this host to run commands.", lines: [] }
            : { ok: false, headline: "Couldn’t update " + card.file.path + " — " + ((err && err.userMessage) || "the write failed."), lines: [] });
        });
      return;
    }
    // install → POST /servers, uninstall → DELETE /servers/{id}, everything else → the M3 command
    // path. All three return a job the SPA awaits to a terminal outcome, then composes the same
    // client-side command.verified block (never fabricating success from the 202 alone).
    const run = isInstall
      ? confirmInstall({ game: { id: card.subjectId }, name: card.instanceName || undefined, hostId })
      : card.verb === "uninstall"
        ? confirmUninstall(hostId, card.subjectId)
        : confirmCommand({ id: card.subjectId, hostId }, card.verb);
    run.then(
      settled => resolveVerify(composeVerified(card.verb, serverName, settled)),
      err => {
        const expired = err && err.code === 401;
        resolveVerify(expired
          ? { ok: false, headline: ((assistantHost && assistantHost.name) || "This host") + "\u2019s session expired \u2014 re-authorize this host to run commands.", lines: [] }
          : { ok: false, headline: "Couldn\u2019t run " + meta.label.toLowerCase() + " \u2014 " + ((err && err.userMessage) || "the command failed."), lines: [] });
      });
  };

  // ---- blueprint-review checkpoint (assistant-blueprint-review-plan.md P2) ----
  // Patch bpState (+ any outcome fields) onto the one blueprint command message being reviewed.
  const patchBlueprintMsg = (cmdId, patch) =>
    setMessages(msgs => msgs.map(m =>
      (m.role === "command" && m.verb === "blueprint" && m.cmdId === cmdId) ? { ...m, ...patch } : m));

  // Save = finalize: send the (possibly edited) YAML to the assistant, which re-validates,
  // test-installs, boots + verifies, and runs its repair loop before answering (minutes). The
  // card sits in a "verifying" state meanwhile. On a verified win it flips to the catalog outcome;
  // on repair exhaustion / an invalid edit it comes back editable with a fresh token + boot log
  // (the re-edit loop); anything else is an honest failure. Never fabricates success from the 202.
  const onSaveBlueprint = (msg, editedYaml) => {
    const hostId = (assistantHost && assistantHost.id) || null;
    if (!hostId || !msg.token) {
      patchBlueprintMsg(msg.cmdId, { bpState: "failed", bpReason: "This draft has expired — ask the assistant to draft it again." });
      return;
    }
    patchBlueprintMsg(msg.cmdId, { bpState: "verifying", bpProgress: null });
    // The finalize streams its own steps (research/install/verify/repair) — surface the latest as a live
    // sub-label under the "verifying" spinner so the user sees it advancing, not a dead wait. Cleared on
    // every terminal branch below.
    const onProgress = (evt) => patchBlueprintMsg(msg.cmdId, { bpProgress: evt && evt.label ? evt.label : null });
    api.host(hostId).confirmBlueprint({ token: msg.token, editedContent: editedYaml }, { onProgress }).then(
      resp => {
        const r = adaptBlueprintConfirm(resp);
        if (r.state === "verified") {
          patchBlueprintMsg(msg.cmdId, { bpState: "verified", bpSlug: r.slug, bpDisplayName: r.displayName, bpProof: r.proof, bpProgress: null });
        } else if (r.state === "proposed") {
          // Re-edit loop: adopt the returned draft + fresh token + boot evidence, back to editable.
          patchBlueprintMsg(msg.cmdId, { bpState: "proposed", token: r.token, draftYaml: r.draftYaml, evidence: r.evidence, bpDisplayName: r.displayName, bpProgress: null });
        } else {
          patchBlueprintMsg(msg.cmdId, { bpState: "failed", bpDisplayName: r.displayName, bpReason: r.reason, bpProgress: null });
        }
      },
      err => {
        const expired = err && err.code === 401;
        patchBlueprintMsg(msg.cmdId, {
          bpState: "failed",
          bpProgress: null,
          bpReason: expired
            ? ((assistantHost && assistantHost.name) || "This host") + "’s session expired — re-authorize this host to continue."
            : (err && err.userMessage) || "The test-install couldn’t run — try saving again.",
        });
      });
  };

  // Abandon is the only terminal Failed a user can reach directly — always offered so a draft can't
  // get stuck in an un-closable loop. Client-side only: the token simply expires unused server-side.
  const onGiveUpBlueprint = (msg) =>
    patchBlueprintMsg(msg.cmdId, { bpState: "failed", bpReason: "You dismissed this draft — nothing was added." });

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };
  const onInputChange = (e) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  };

  const suggestions = React.useMemo(() => {
    const running = serverList.find(s => s.status === "running");
    const srv = running || serverList[0] || null;
    if (!srv) {
      return [
        "Run a health check on my server",
        "Why might my server be lagging?",
        "Explain a setting in my server's config file",
        "Server is online but I can't connect \u2014 why?",
      ];
    }
    const name = srv.displayName || srv.name || "MyServer";
    const game = srv.game || "my game";
    return [
      `Run a health check on ${name}`,
      `Why might my ${game} server be lagging?`,
      "Explain a setting in my server's config file",
      `Server is online but I can't connect \u2014 why?`,
    ];
  }, [serverList]);

  // A fresh greeting per conversation — drawn once and held, so a re-render (typing,
  // a store tick) never swaps the wording out from under the reader.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activeId is the POINT: it re-rolls the greeting per conversation, not a value read inside.
  const greeting = React.useMemo(() => pickGreeting(), [activeId]);

  // What the assistant can do for you, phrased to match what THIS caller may actually
  // ask of it: a viewer can't have it act, so promising start/stop would be a promise
  // the composer's own gating then breaks.
  const primer = canSeeActions
    ? "I can check server health, dig through logs and configuration, start or stop a server, and help work out what’s going wrong."
    : "I can check server health, read through logs and configuration, and help work out what’s going wrong.";

  const ChatBriefingPanel = NeedsAttention;

  const [railOpen, setRailOpen] = React.useState(false);
  const railWrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!railOpen) return;
    const h = (e) => { if (railWrapRef.current && !railWrapRef.current.contains(e.target)) setRailOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [railOpen]);
  React.useEffect(() => { setRailOpen(false); }, [activeId]);

  // Review mode replaces the whole surface: no rail (there is no "your chats" here), no composer
  // (there is no admin write, and a disabled input would still invite typing), and a banner that
  // cannot be scrolled away — a dock that is usually YOUR chat now holds someone else's, and that has
  // to be unmissable for as long as it is true.
  if (review && review.conversation) {
    const who = review.conversation.user
      ? (review.conversation.user.displayName || review.conversation.user.userId)
      : null;
    return (
      <div className={"chat-page chat-page--review" + (docked ? " chat-page--docked" : "")}>
        <div className="chat-main">
          <div className="chat-review__banner">
            <Icon name="lock" size={13} />
            <span>
              Reading{who ? <> <b>{who}</b>’s</> : " someone else’s"} conversation — read-only.
            </span>
            <button className="chat-review__exit" onClick={onExitReview}>
              Back to your chat
            </button>
          </div>

          <div className="chat-main__head">
            <div className="chat-id">
              <span className="chat-id__mark"><Icon name="message-square" size={17} /></span>
              <div className="chat-id__text">
                <span className="chat-id__title">{review.conversation.title || "Untitled conversation"}</span>
                <span className="chat-id__sub">
                  {review.conversation.turnCount} turn{review.conversation.turnCount === 1 ? "" : "s"}
                  {review.conversation.deleted ? " · deleted by its owner" : ""}
                </span>
              </div>
            </div>
            <div className="chat-head__actions">
              <div className="chat-head__win">
                <button className="chat-headbtn" onClick={onExitReview} title="Close review" aria-label="Close review">
                  <Icon name="x" size={16} />
                </button>
              </div>
            </div>
          </div>

          <div className="chat-scroll">
            {reviewState === "loading" && <div className="chat-empty"><p>Loading the transcript…</p></div>}
            {reviewState === "error" && (
              <div className="chat-empty">
                <h2>Transcript unavailable</h2>
                <p>This conversation could not be read. It may have been removed from the log.</p>
              </div>
            )}
            {reviewState === "ready" && reviewMessages && reviewMessages.length === 0 && (
              <div className="chat-empty"><p>This conversation has no turns.</p></div>
            )}
            {reviewState === "ready" && reviewMessages && reviewMessages.length > 0 && (
              // Read-only: no onRun/onSaveBlueprint/onDraftEdit, so every actionable affordance a live
              // chat would offer is simply absent rather than present-and-inert.
              <ChatThread messages={reviewMessages} user={user}
                onOpenServer={onOpenServer} onOpenView={onOpenView} />
            )}
          </div>

          <div className="chat-review__foot">
            You are reading a saved conversation. Replying, running actions and editing are not possible here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={"chat-page" + (docked ? " chat-page--docked" : "")}>
      <aside className="chat-rail">
        <button className="chat-rail__new" onClick={newChat}>
          <Icon name="plus" size={15} strokeWidth={2.2} /> New chat
        </button>
        <div className="chat-rail__list">
          {convos.length === 0 && <div className="chat-rail__empty">No conversations yet.</div>}
          {convos.map(c => (
            <div key={c.id}
              className={"chat-rail__item" + (c.id === activeId ? " chat-rail__item--active" : "")}
              onClick={() => pickChat(c.id)}>
              <Icon name="message-square" size={14} />
              <span className="chat-rail__title">{c.title || "New chat"}</span>
              <button className="chat-rail__del" onClick={(e) => deleteChat(c.id, e)} title="Delete">
                <Icon name="trash-2" size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="chat-rail__foot">
          <span className={"chat-conn chat-conn--" + conn.tone}><span className="dot"></span>{conn.label}</span>
        </div>
      </aside>

      <div className="chat-main">
        <div className="chat-main__head">
          <div className="chat-id">
            <span className="chat-id__mark"><Icon name="bot" size={17} /></span>
            <div className="chat-id__text">
              <span className="chat-id__title">Assistant</span>
              <AssistantHostPicker hosts={assistantHosts} current={assistantHost} onSelect={pickAssistantHost} />
            </div>
          </div>
          <div className="chat-head__actions">
            <div className="chat-head__nav">
              <button className="chat-headbtn" onClick={newChat} title="New chat" aria-label="New chat">
                <Icon name="square-pen" size={16} />
              </button>
              <ChatHistory convos={convos} activeId={activeId} onPick={pickChat} onDelete={deleteChat} conn={conn} onOpen={loadServerHistory} loading={histLoading} />
            </div>
            {docked && (
              <div className="chat-head__win">
                {showPin && (
                  <button
                    className={"chat-headbtn" + (pinned ? " chat-headbtn--pinned" : "")}
                    onClick={onTogglePin}
                    disabled={pinDisabled}
                    title={pinDisabled ? "Not enough room to pin \u2014 floating over the page" : pinned ? "Unpin \u2014 float over the page" : "Pin \u2014 push the page aside"}
                    aria-label="Toggle dock pin" aria-pressed={!!pinned}>
                    <Icon name={pinned ? "pin" : "pin-off"} size={16} />
                  </button>
                )}
                {onExpand && (
                  <button className="chat-headbtn" onClick={onExpand} title="Expand to full screen" aria-label="Expand to full screen">
                    <Icon name="maximize-2" size={16} />
                  </button>
                )}
                <button className="chat-headbtn" onClick={onClose} title="Close assistant" aria-label="Close assistant">
                  <Icon name="panel-right-close" size={16} />
                </button>
              </div>
            )}
            {!docked && onClose && (
              <div className="chat-head__win">
                <button className="chat-headbtn" onClick={onClose} title="Exit full screen (ESC)" aria-label="Exit full screen (ESC)">
                  <Icon name="minimize-2" size={16} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="chat-scroll" ref={scrollRef} onScroll={onThreadScroll}>
          {(!active || active.messages.length === 0) ? (
            <div className="chat-empty">
              <span className="chat-empty__logo"><Icon name="bot" size={26} /></span>
              <h2>{assistantHost ? greeting : "No assistant available"}</h2>
              <p>{assistantHost ? primer : "No connected host is serving an assistant capability."}</p>
              {/* On the fresh-conversation screen only — it opens every new chat, and the
                  composer's own footprint stays exactly as it is without a pinned line. */}
              {assistantHost && <p className="chat-empty__notice">{CHAT_PRIVACY_NOTICE}</p>}
              <ChatBriefingPanel onPick={startBriefingChat} />
              <div className="chat-suggestions">
                {suggestions.map((s, i) => (
                  <button key={i} className="chat-suggestion" onClick={() => { setInput(s); if (taRef.current) taRef.current.focus(); }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ChatThread messages={active.messages} user={user}
              onOpenServer={onOpenServer} onOpenView={onOpenView} onRun={runLiveCommand}
              onSaveBlueprint={onSaveBlueprint} onGiveUpBlueprint={onGiveUpBlueprint}
              onDraftEdit={onDraftEdit} onDraftActive={onDraftActive} />
          )}
        </div>

        <div className="chat-composer">
          {voice.phase === "idle" ? (
            <div className="chat-composer__box">
              <textarea
                ref={taRef}
                rows={1}
                value={input}
                placeholder={assistantHost ? "Message " + assistantHost.name + "\u2019s assistant\u2026" : "Message the assistant\u2026"}
                onChange={onInputChange}
                onKeyDown={onKeyDown} />
              <div className="chat-composer__bar">
                <ChatContextMeter
                  usage={latestUsage(active && active.messages)}
                  onCompact={(assistantUsable && active && active.messages.length > 0) ? compactActive : null} />
                {assistantHost && (
                  <button
                    type="button"
                    className={"chat-act-toggle chat-think-toggle" + (thinkOn ? " chat-think-toggle--on" : "")}
                    onClick={toggleThinking}
                    title={thinkOn
                      ? "Thinking ON \u2014 the assistant reasons step by step before answering (shown collapsed in the reply). Click to turn off."
                      : "Thinking OFF \u2014 the assistant answers directly. Turn on to have it reason first."}
                    aria-pressed={thinkOn}>
                    <Icon name="brain" size={13} />
                    <span className="chat-act-toggle__label">Thinking</span>
                    <span className="chat-act-toggle__state">{thinkOn ? "On" : "Off"}</span>
                  </button>
                )}
                {canSeeActions && (
                  <button
                    type="button"
                    className={"chat-act-toggle" + (autoAcceptActive ? " chat-act-toggle--on" : "")}
                    onClick={canUseActions ? toggleActions : undefined}
                    disabled={!canUseActions}
                    title={!canUseActions
                      ? "Auto-run is admin-only. As an operator you can still have the assistant propose actions and confirm them yourself."
                      : autoAcceptActive
                        ? "Auto-run ON \u2014 the assistant carries out start/stop/restart actions immediately, no confirmation. Click to turn off."
                        : "Auto-run OFF \u2014 the assistant proposes actions for you to confirm. Turn on to let it run them automatically."}
                    aria-pressed={autoAcceptActive}>
                    <Icon name={autoAcceptActive ? "zap" : "zap-off"} size={13} />
                    <span className="chat-act-toggle__label">Auto-run</span>
                    <span className="chat-act-toggle__state">{autoAcceptActive ? "On" : "Off"}</span>
                  </button>
                )}
                <span className="chat-composer__bar-spacer"></span>
                {!busy && !input.trim() && assistantUsable && (
                  <button className="chat-mic" onClick={voice.start} title="Record a voice note" aria-label="Record a voice note">
                    <Icon name="mic" size={17} />
                  </button>
                )}
                {busy
                  ? <button className="chat-send chat-send--stop" onClick={stop} title="Stop"><Icon name="square" size={15} /></button>
                  : <button className="chat-send" onClick={send} disabled={!input.trim() || !assistantUsable} title={assistantUsable ? "Send" : "Assistant unavailable"}><Icon name="arrow-up" size={16} strokeWidth={2.4} /></button>}
              </div>
              {!assistantUsable && (
                <div className="chat-composer__downhint">
                  <span className="status-led status-led--down"></span>
                  {assistantHost
                    ? assistantHost.name + "\u2019s assistant is unavailable \u2014 your message will send once it\u2019s back."
                    : assistantHosts.length
                      ? "Pick which node\u2019s assistant to talk to \u2014 several can answer."
                      : "Assistant unavailable \u2014 your message will send once it\u2019s back."}
                </div>
              )}
            </div>
          ) : (
            <VoiceComposerBar rec={voice} onSend={sendVoice} onCancel={voice.cancel} />
          )}
          <div className="chat-composer__hint">
            {voice.phase === "recording" || voice.phase === "requesting"
              ? <span>Recording a voice note · I'll transcribe it and reply</span>
              : <>Enter to send, Shift+Enter for newline</>}
          </div>
        </div>
      </div>
    </div>
  );
}

export { adaptResultCard, API_COMMAND_VERBS, ChatCommand, ChatPage, composeVerified, latestUsage, mergeServerConversations, reduceTurnFrame, scaffoldHistory };
// Default export so React.lazy(() => import("./ChatPage.jsx")) resolves (AppRouter's
// chat route + App.jsx's dock both lazy-load this).
export default ChatPage;
