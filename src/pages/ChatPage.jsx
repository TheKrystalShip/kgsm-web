import React from "react";
import { Icon } from "../components/Icon.jsx";
import { NeedsAttention } from "../components/NeedsAttention.jsx";
import { VoiceComposerBar, useVoiceRecorder } from "../components/VoiceNote.jsx";
import { capUsable, hostCapability } from "../lib/capabilities.js";
import { canOperate, isAdmin } from "../lib/persona.js";
import { confirmCommand, serversStore } from "../lib/stores.js";
import { api } from "../lib/apiClient.js";

// Imports from extracted modules
import {
  CHAT_ACTIONS_LS, CHAT_THINK_LS, TOGGLE_COPY,
  loadConversations, saveConversations, loadSetting, saveSetting,
  uid, adaptResultCard, composeVerified, reduceTurnFrame, scaffoldHistory,
  latestUsage, mergeServerConversations,
} from "./chat/chatUtils.jsx";
import { API_COMMAND_VERBS, commandMeta } from "./chat/chatConstants.js";
// ChatCommand is imported only to re-export it (see the export list below); the
// message-role dispatch that used it now lives in ChatThread.
import { ChatCommand } from "./chat/ChatMessageParts.jsx";
import { ChatContextMeter } from "./chat/ChatContextMeter.jsx";
import { AssistantHostPicker } from "./chat/AssistantHostPicker.jsx";
import { ChatHistory } from "./chat/ChatHistory.jsx";
import { ChatThread } from "./chat/ChatThread.jsx";

function ChatPage({ user, onOpenServer, onOpenView, docked, seed, onClose, onExpand, onNavigate, getServerState, assistantHost, assistantHosts = [], onSelectAssistantHost, showPin, pinned, pinDisabled, onTogglePin }) {
  const assistantCap = assistantHost ? hostCapability(assistantHost, "assistant") : null;
  const conn = !assistantHost
    ? { tone: "muted",  label: "No assistant" }
    : assistantCap.state === "operational" ? { tone: "online", label: "Connected \u00b7 " + assistantHost.name }
    : assistantCap.state === "degraded"    ? { tone: "warn",   label: "Degraded \u00b7 " + assistantHost.name }
    : { tone: "danger", label: "Unavailable \u00b7 " + assistantHost.name };

  const assistantUsable = !!(assistantHost && capUsable(assistantHost, "assistant"));

  const [convos, setConvos]     = React.useState(loadConversations);
  const [activeId, setActiveId] = React.useState(() => loadConversations()[0]?.id || null);
  const [input, setInput]       = React.useState("");
  const [busy, setBusy]         = React.useState(false);

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
      await api.host(assistantHost.id).turn({ prompt, actions: autoAcceptActive, think: thinkOn, conversationId: convId }, { onEvent: applyFrame, signal: ctrl.signal });
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
        msgs[lastIdx] = aborted
          ? { ...bubble, content: bubble.content || "_Stopped._" }
          : bubble.content
            ? { ...bubble, content: bubble.content + "\n\n_\u26a0 Interrupted \u2014 the assistant connection dropped._" }
            : { ...bubble, content: "\u26a0\ufe0f " + reason, error: true };
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
      ? { role: "user", content: text, voice: voiceMeta }
      : { role: "user", content: text };
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
    const found = serversStore.getState().list.find(s => s.id === card.subjectId) || null;
    const hostId = (found && found.hostId) || (assistantHost && assistantHost.id) || null;
    const server = { id: card.subjectId, hostId };
    const serverName = (found && found.name) || card.subjectId;
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
    confirmCommand(server, card.verb).then(
      settled => resolveVerify(composeVerified(card.verb, serverName, settled)),
      err => {
        const expired = err && err.code === 401;
        resolveVerify(expired
          ? { ok: false, headline: ((assistantHost && assistantHost.name) || "This host") + "\u2019s session expired \u2014 re-authorize this host to run commands.", lines: [] }
          : { ok: false, headline: "Couldn\u2019t run " + meta.label.toLowerCase() + " \u2014 " + ((err && err.userMessage) || "the command failed."), lines: [] });
      });
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };
  const onInputChange = (e) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  };

  const suggestions = [
    "Run a health check on MyValheimServer",
    "Why might my Valheim server be lagging?",
    "Explain the server.cfg raid_freq setting",
    "How do I port-forward UDP 2456?",
  ];

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
              onClick={() => setActiveId(c.id)}>
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
              <ChatHistory convos={convos} activeId={activeId} onPick={setActiveId} onDelete={deleteChat} conn={conn} onOpen={loadServerHistory} loading={histLoading} />
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
          </div>
        </div>

        <div className="chat-scroll" ref={scrollRef} onScroll={onThreadScroll}>
          {(!active || active.messages.length === 0) ? (
            <div className="chat-empty">
              <span className="chat-empty__logo"><Icon name="bot" size={26} /></span>
              <h2>{assistantHost ? "Ask " + assistantHost.name + "\u2019s assistant" : "No assistant available"}</h2>
              <p>{assistantHost
                ? "Routed by " + assistantHost.name + "\u2019s backend. Each host runs its own \u2014 there is no central assistant."
                : "No connected host is serving an assistant capability."}</p>
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
              onOpenServer={onOpenServer} onOpenView={onOpenView} onRun={runLiveCommand} />
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
                  {(assistantHost ? assistantHost.name + "\u2019s assistant is unavailable" : "Assistant unavailable") + " \u2014 your message will send once it\u2019s back."}
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
