import React from "react";
import { Icon } from "../components/Icon.jsx";
import { NeedsAttention } from "../components/NeedsAttention.jsx";
import { AccountAvatar } from "../components/Sidebar.jsx";
import { TimeSeriesChart } from "../components/TimeSeriesChart.jsx";
import { VoiceComposerBar, VoiceNoteBubble, useVoiceRecorder } from "../components/VoiceNote.jsx";
import { assistantHosts, capUsable, hostCapability } from "../lib/capabilities.js";
import { canOperate, isAdmin } from "../lib/persona.js";
import { confirmCommand, serversStore } from "../lib/stores.js";
import { api } from "../lib/apiClient.js";
import { ACTION_META } from "./AuditLogPage.jsx";

// ChatPage — the assistant UI for a per-host assistant capability.
//
// The assistant is exposed BY each host and routed through the Krystal backend
// (POST /hosts/{id}/assistant/chat) — the browser never holds a model endpoint.
// Which host you're talking to is chosen in the header (AssistantHostPicker,
// sourced from assistantHosts); connection state + model come from that
// host's `assistant` capability (capabilities.js). There is no central
// assistant and no fallback: if no host exposes one, there's nothing to talk to.
//
// Conversations are persisted locally (single-user homelab tool); see
// architecture.html (§4).

const CHAT_LS_KEY      = "krystal:chat:conversations";
const CHAT_ENDPOINT_LS = "krystal:chat:endpoint";
const CHAT_MODEL_LS    = "krystal:chat:model";
const CHAT_ACTIONS_LS  = "krystal:chat:actions";   // the "Actions" toggle (operator+ only), persisted
const CHAT_THINK_LS    = "krystal:chat:think";     // the "Thinking" toggle (any tier), persisted
const DEFAULT_ENDPOINT = "http://localhost:11434";

// In-thread copy dropped when a behaviour toggle flips mid-chat, so the user
// sees the conversation's rules change as it goes on (both directions).
const TOGGLE_COPY = {
  thinking: {
    on:  "Thinking on — replies may take a little longer but tend to be more thorough and accurate.",
    off: "Thinking off — the assistant answers directly, for quicker replies.",
  },
  actions: {
    on:  "Auto-run on — the assistant will carry out start/stop/restart actions immediately, without asking you to confirm each one.",
    off: "Auto-run off — the assistant will propose actions and wait for you to confirm before anything runs.",
  },
};
// ---------- persistence ----------
function loadConversations() {
  try {
    const raw = localStorage.getItem(CHAT_LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}
function saveConversations(convos) {
  try { localStorage.setItem(CHAT_LS_KEY, JSON.stringify(convos)); } catch (e) {}
}
function loadSetting(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}
function saveSetting(key, val) {
  try { localStorage.setItem(key, val); } catch (e) {}
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// A pending-tense display label for a live §5·a `tool.start` frame. The wire
// carries no honest `label` (the spec drops it on purpose), so the SPA derives a
// name from the tool id; the context pill appends "…" while pending. Unknown
// tools fall back to the snake_case name spaced out, so a tool added upstream
// still renders something sensible without a client change.
const TOOL_LABELS = {
  run_health_check:    "Running health check",
  get_status:          "Checking status",
  get_performance:     "Reading metrics",
  get_audit_log:       "Reading recent events",
  get_console:         "Reading console output",
  get_config:          "Reading config",
  get_host_diagnostics:"Checking host health",
  trace_root_cause:    "Tracing the root cause",
  server_command:      "Running command",
};
function toolLabel(tool) {
  if (!tool) return "Working";
  return TOOL_LABELS[tool] || (tool.charAt(0).toUpperCase() + tool.slice(1).replace(/_/g, " "));
}

// ---------- live command proposals (slice 9b / fork (a)) ----------
// The verbs the panel can actually EXECUTE via the M3 command path
// (POST /servers/{id}/commands). The assistant may PROPOSE more
// (update/install/uninstall/backup/set_config), but those have no API endpoint
// yet (m7-sse-5a-spec §6 verb matrix) → the SPA renders the proposal but disables
// it with an honest reason rather than firing a 400. Exported for the smoke.
const API_COMMAND_VERBS = new Set(["start", "stop", "restart", "open_ports"]);
const COMMAND_META = {
  start:      { label: "Start",         icon: "play",      tone: "success" },
  stop:       { label: "Stop",          icon: "square",    tone: "danger" },
  restart:    { label: "Restart",       icon: "rotate-cw", tone: "update" },
  open_ports: { label: "Open ports",    icon: "network",   tone: "info" },
  update:     { label: "Update",        icon: "download",  tone: "info" },
  install:    { label: "Install",       icon: "download",  tone: "success" },
  uninstall:  { label: "Uninstall",     icon: "trash-2",   tone: "danger" },
  backup:     { label: "Back up",       icon: "database",  tone: "info" },
  set_config: { label: "Update config", icon: "settings",  tone: "info" },
};
function commandMeta(verb) {
  return COMMAND_META[verb] || { label: (verb || "Run").replace(/_/g, " "), icon: "zap", tone: "info" };
}

// Compose the command.verified block client-side from the M3 job outcome. Per the
// spec (fork (a)), command.verified is NOT a backend frame — the SPA owns both the
// proposal render and the M3 call, so it composes the verification. `ok` is the
// load-bearing fact and comes from the job (clean id correlation — adaptJob keeps the
// id + error). The headline is composed from verb+server: for a lifecycle verb this is
// identical to the audit summary ("started X"), and lifecycle audit rows carry no jobId,
// so correlating one buys fragility for no gain (a conscious deviation from the plan's
// "3-source correlation" → job-outcome primary + locally-composed headline). `lines[]`
// is honest-thin: the real job error on failure, nothing fabricated. status "unknown"
// (no WS response) → an honest "couldn't confirm", never a fabricated ✓. open_ports is intent-
// only (the client never receives the port list) → the headline stays generic; naming
// ports would fabricate. Pure + exported so the deliverable is unit-exercised.
const VERB_PAST = { start: "Started", stop: "Stopped", restart: "Restarted" };
function composeVerified(verb, serverName, settled) {
  const s = settled || {};
  if (s.status === "unknown") {
    return { ok: false, headline: "Couldn’t confirm — no response from the host yet. Check the server.", lines: [] };
  }
  if (s.status === "sent") {
    return { ok: true, headline: commandMeta(verb).label + " sent to " + serverName + ".", lines: [] };
  }
  if (s.status === "succeeded") {
    const headline = verb === "open_ports"
      ? "Opened the required ports for " + serverName + "."
      : (VERB_PAST[verb] || ("Ran " + verb + " on")) + " " + serverName + ".";
    return { ok: true, headline, lines: [] };
  }
  const err = s.job && s.job.error;
  const what = verb === "open_ports" ? "open ports for " : (verb + " ");
  return {
    ok: false,
    headline: "Couldn’t " + what + serverName + ".",
    lines: err ? [{ status: "fail", label: "Error", detail: String(err) }] : [],
  };
}

// ---------- §5·a structured result → evidence card ----------
// A `tool.result` frame may carry a structured `result` envelope (the §5·a
// ToolResultCard: { tool, confidence, subject:{resource,id}, data, links }) IN
// ADDITION to its text `summary`. When it does, project it into one of the rich
// Evidence cards (ChatEvidence) instead of discarding it — the summary still rides
// on the resolved tool pill; the card is additive. Honest by construction: only a
// tool with a real structured source AND a matching renderer yields a card;
// anything else returns null and the turn keeps just the text pill (never a
// fabricated card). Pure + exported so the projection is smoke-exercisable.
const HEALTH_CHECK_LABELS = {
  liveness: "Server online",
  logs:     "Console",
  updates:  "Updates",
  disk:     "Disk space",
};
function adaptResultCard(card) {
  if (!card || !card.tool) return null;
  const id = (card.subject && card.subject.id) || null;
  switch (card.tool) {
    case "run_health_check": {
      const d = card.data;
      if (!d || !Array.isArray(d.checks)) return null;   // no structured source → no card
      let fails = 0, warns = 0;
      const checks = d.checks.map(ck => {
        if (ck.state === "fail") fails++;
        else if (ck.state === "warn") warns++;
        return {
          label: HEALTH_CHECK_LABELS[ck.name] || (ck.name || "check"),
          status: ck.state || "skip",
          detail: ck.detail || "",
        };
      });
      return {
        kind: "health",
        serverId: id,
        serverName: id || "this server",   // the instance id IS its canonical name in kgsm
        confidence: card.confidence || null,
        checks,
        passes: typeof d.passed === "number" ? d.passed : checks.filter(c => c.status === "pass").length,
        fails,
        warns,
      };
    }
    default:
      // get_status (fleet) and any future structured tool have real data on the wire
      // but no renderer yet → keep the text pill, add no card. Never fabricate.
      return null;
  }
}

// Pure reducer: fold one live §5·a frame into a conversation's message list. The
// streaming assistant bubble is always the LAST message; tool pills are spliced
// in just before it. Exported + pure (no React, no convo state) so the live SSE
// translation — slice 9a's actual deliverable — is unit-exercisable end to end
// (sendLive just wraps it in setConvos). Returns a NEW array; the input is never
// mutated. Returns the input unchanged if there's no trailing assistant bubble.
function reduceTurnFrame(messages, ev) {
  const msgs = messages.slice();
  const lastIdx = msgs.length - 1;
  const bubble = msgs[lastIdx];
  if (!bubble || bubble.role !== "assistant") return messages;   // no streaming bubble — defensive
  switch (ev.type) {
    case "text.delta":
      msgs[lastIdx] = { ...bubble, content: (bubble.content || "") + (ev.text || "") };
      break;
    case "thinking.delta":
      // The model's reasoning (opt-in via the "Thinking" toggle → think:true). Accumulated on
      // the bubble and rendered as a collapsed-by-default block above the answer (ChatThinking),
      // so a long chain-of-thought never dominates the thread. Survives done/error (both spread
      // the bubble). Frames arrive BEFORE text.delta — the model thinks, then answers.
      msgs[lastIdx] = { ...bubble, thinking: (bubble.thinking || "") + (ev.text || "") };
      break;
    case "tool.start": {
      // Tool calls belong to the assistant's turn, so they ride ON the streaming bubble (like
      // thinking) and render inside its body — NOT spliced as a separate row before the bubble,
      // which made the tool output appear between the user's message and the assistant header.
      const startTools = (bubble.tools || []).concat({ id: ev.id, label: toolLabel(ev.tool), state: "pending" });
      msgs[lastIdx] = { ...bubble, tools: startTools };
      break;
    }
    case "tool.result": {
      // Resolve the most recent still-pending tool with this id. Ids are turn-local (they reset
      // per turn), but the bubble owns only THIS turn's tools, so the reverse scan is naturally
      // turn-isolated — a later turn can't rewrite a prior turn's resolved tool.
      const resTools = (bubble.tools || []).slice();
      for (let k = resTools.length - 1; k >= 0; k--) {
        if (resTools[k].id === ev.id && resTools[k].state === "pending") {
          // Keep the friendly tool name as the label; the result text rides as `summary`
          // (shown inline when short, collapsed behind the name when verbose).
          resTools[k] = { ...resTools[k], state: "done", summary: ev.summary || "" };
          break;
        }
      }
      let next = { ...bubble, tools: resTools };
      // A structured `result` envelope rides alongside the text summary when the tool
      // has a real structured source (e.g. run_health_check → HealthData). Project it
      // into a rich Evidence card on the bubble (rendered below the reply). Additive:
      // the pill keeps the summary; adaptResultCard returns null for tools without a
      // matching renderer, so unknown results add no card (no fabrication).
      if (ev.result) {
        const card = adaptResultCard(ev.result);
        if (card) next = { ...next, cards: (bubble.cards || []).concat(card) };
      }
      msgs[lastIdx] = next;
      break;
    }
    case "error": {
      const note = "⚠️ " + (ev.message || "The assistant failed.");
      msgs[lastIdx] = bubble.content
        ? { ...bubble, content: bubble.content + "\n\n_" + note + "_" }
        : { ...bubble, content: note, error: true };
      break;
    }
    case "command.proposed":
      // A §5·a command proposal → a confirm-first action card spliced just before
      // the streaming bubble (the same invariant-safe spot as a tool pill — the
      // bubble stays last so text.delta keeps targeting it). On `done` the card is
      // moved BELOW the reply (see below) so the turn reads reply → action. Rendered
      // from the proposal itself (confirm + subject) — never a store lookup, since the
      // model may propose a server the SPA has no row for. The `token` is inert here
      // (this path routes to M3, not the assistant's /confirm) → dropped.
      msgs.splice(lastIdx, 0, {
        role: "command",
        cmdId: ev.id,
        verb: ev.verb,
        subjectId: ev.subject ? ev.subject.id : null,
        subjectResource: (ev.subject && ev.subject.resource) || "server",
        confirm: ev.confirm || (commandMeta(ev.verb).label + "?"),
        reason: ev.reason || null,
        state: "proposed",
      });
      break;
    case "done": {
      if (ev.text) msgs[lastIdx] = { ...bubble, content: ev.text };
      // Readability: move THIS turn's command cards (the contiguous run spliced just
      // before the bubble) to AFTER the reply. Scoped to the contiguous run, so prior
      // turns' cards (separated by their own user/assistant messages) stay in place.
      // Safe post-`done`: the turn is over (no further text.delta to target the bubble),
      // and the defensive role!=="assistant" guard above covers any stray late frame.
      let start = lastIdx;
      while (start > 0 && msgs[start - 1].role === "command") start--;
      if (start < lastIdx) {
        const bub = msgs[lastIdx];
        const cards = msgs.slice(start, lastIdx);
        msgs.splice(start, lastIdx - start + 1, bub, ...cards);
      }
      break;
    }
    default:
      break;   // any future additive frame — ignored
  }
  return msgs;
}

// ---------- conversation history (the reverse path) ----------
// Rebuild a stored conversation's message list from the server transcript
// (GET /assistant/conversations/{id}). Each turn maps to the SAME message shapes
// reduceTurnFrame produces for a LIVE turn — a user bubble, then an assistant
// bubble carrying content + thinking + resolved tool pills — so a loaded history
// renders through ChatMessage identically to one that streamed in (the §5·a schema
// reuse: no second renderer). A compaction checkpoint becomes a quiet divider so
// the user sees the whole history as it happened, compaction included. Pure +
// exported so the mapping is unit-exercisable.
function scaffoldHistory(entries) {
  const out = [];
  if (!Array.isArray(entries)) return out;
  entries.forEach((e, ei) => {
    if (!e) return;
    if (e.kind === "checkpoint") {
      out.push({ role: "checkpoint", label: "Conversation compacted to save context", at: e.createdAt });
      return;
    }
    const t = e.turn;
    if (!t) return;
    out.push({ role: "user", content: t.prompt || "" });
    const bubble = { role: "assistant", content: t.final || "" };
    if (t.thinking) bubble.thinking = t.thinking;
    const tools = Array.isArray(t.tools)
      ? t.tools.map((tl, ti) => ({ id: "h" + ei + "_" + ti, label: toolLabel(tl.tool), state: "done", summary: tl.summary || "" }))
      : [];
    if (tools.length) bubble.tools = tools;
    // Forward-compat: if a stored tool entry carries its structured `result` envelope,
    // rebuild the same Evidence card a live turn shows. Dormant until the conversation
    // read-back surfaces the trajectory `Data` (RecordedToolCall.Data) — then history
    // lights up with no second mapping. Until then there's no `result` → no card.
    const cards = Array.isArray(t.tools)
      ? t.tools.map(tl => (tl && tl.result ? adaptResultCard(tl.result) : null)).filter(Boolean)
      : [];
    if (cards.length) bubble.cards = cards;
    // An error/cancelled turn with no reply → an honest marker, never a fabricated answer.
    if (!t.final && t.outcome && t.outcome !== "ok") { bubble.content = "⚠️ This turn didn’t complete."; bubble.error = true; }
    out.push(bubble);
  });
  return out;
}

// Fold the current host's server-side conversation summaries into the local list,
// so a fresh browser/device shows history that lives server-side (not only in
// localStorage). Join is by id (the chat id the SPA sent as conversationId == the
// summary's id). A local convo wins (it already has messages, possibly unsynced) —
// we only backfill a placeholder title and tag its owning host; a server-only
// conversation becomes a lazy, unloaded stub fetched on open. Skips the legacy bare
// per-user convo (id ""), which the SPA can't address. Newest-active first. Pure.
function mergeServerConversations(local, serverList, hostId) {
  if (!Array.isArray(serverList) || serverList.length === 0) return local;
  const byId = new Map(local.map(c => [c.id, c]));
  const merged = local.slice();
  for (const s of serverList) {
    if (!s || !s.id) continue;   // the bare per-user conversation isn't addressable by the SPA
    const existing = byId.get(s.id);
    if (existing) {
      const patch = {};
      if ((!existing.title || existing.title === "New chat") && s.title) patch.title = s.title;
      if (!existing.hostId) patch.hostId = hostId;
      if (Object.keys(patch).length) merged[merged.indexOf(existing)] = { ...existing, ...patch };
    } else {
      merged.push({
        id: s.id,
        title: s.title || "Untitled chat",
        messages: [],
        created: Date.parse(s.createdAt) || 0,
        lastActivity: Date.parse(s.lastActivityAt) || 0,
        hostId,
        remote: true,
        loaded: false,
      });
    }
  }
  merged.sort((a, b) => (b.lastActivity || b.created || 0) - (a.lastActivity || a.created || 0));
  return merged;
}

// ---------- lightweight markdown ----------
// Just enough to render fenced code blocks, inline code, and bold — the
// things an LLM emits constantly. Everything else stays plain text.
function renderMarkdown(text) {
  const blocks = [];
  const fenceRe = /```(\w+)?\n([\s\S]*?)```/g;
  let last = 0, m;
  while ((m = fenceRe.exec(text)) !== null) {
    if (m.index > last) blocks.push({ type: "text", value: text.slice(last, m.index) });
    blocks.push({ type: "code", lang: m[1] || "", value: m[2].replace(/\n$/, "") });
    last = fenceRe.lastIndex;
  }
  if (last < text.length) blocks.push({ type: "text", value: text.slice(last) });

  return blocks.map((b, i) => {
    if (b.type === "code") {
      return (
        <pre className="chat-code" key={i}>
          {b.lang && <span className="chat-code__lang">{b.lang}</span>}
          <code>{b.value}</code>
        </pre>
      );
    }
    // inline: `code` and **bold**
    const parts = [];
    const inlineRe = /(`[^`]+`|\*\*[^*]+\*\*)/g;
    let li = 0, im;
    let key = 0;
    while ((im = inlineRe.exec(b.value)) !== null) {
      if (im.index > li) parts.push(b.value.slice(li, im.index));
      const tok = im[0];
      if (tok.startsWith("`")) parts.push(<code key={key++} className="chat-inline-code">{tok.slice(1, -1)}</code>);
      else parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
      li = inlineRe.lastIndex;
    }
    if (li < b.value.length) parts.push(b.value.slice(li));
    return <span key={i} style={{ whiteSpace: "pre-wrap" }}>{parts}</span>;
  });
}

// ---------- tool/context pill ----------
// The assistant running a tool, shown by its FRIENDLY name (toolLabel). The result text
// rides as `summary`: a short one shows inline (· detail); a verbose one — e.g. a
// server_command staging a confirmation returns a full instruction paragraph meant for the
// model — collapses behind the friendly name as a trace disclosure (collapsed by default).
function ChatContextPill({ msg }) {
  const pending = msg.state === "pending";
  const label = msg.label || "Working";    // the friendly tool name
  const summary = msg.summary || "";        // the tool's result text
  const verbose = !pending && (summary.length > 120 || summary.includes("\n"));
  const [open, setOpen] = React.useState(false);

  if (verbose) {
    return (
      <div className={"chat-disc chat-disc--tool" + (open ? " chat-disc--open" : "")}>
        <button
          type="button"
          className="chat-disc__toggle"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          <Icon name="database" size={13} className="chat-disc__icon" />
          <span className="chat-disc__label">{label}</span>
          <Icon name="chevron-down" size={13} strokeWidth={2.2} className="chat-disc__chev" />
        </button>
        {open && <div className="chat-disc__body">{summary}</div>}
      </div>
    );
  }

  return (
    <div className={"chat-context" + (pending ? " chat-context--pending" : "")}>
      <span className="chat-context__icon">
        {pending
          ? <span className="chat-context__spinner"></span>
          : <Icon name="database" size={12} />}
      </span>
      <span className="chat-context__label">
        {pending ? label + "…" : label}
        {!pending && summary && <span className="chat-context__detail"> · {summary}</span>}
      </span>
      {!pending && <Icon name="check" size={12} strokeWidth={2.6} className="chat-context__check" />}
    </div>
  );
}

// ---------- thinking block ----------
// The model's step-by-step reasoning (opt-in via the composer "Thinking" toggle →
// `think:true` on the turn → the assistant's `thinking.delta` frames). It can run
// long, so it's collapsed by default — a one-line header the user expands to read
// the reasoning. While the answer hasn't started (`streaming`) it reads "Thinking…".
function ChatThinking({ text, streaming }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={"chat-disc chat-disc--think" + (open ? " chat-disc--open" : "")}>
      <button
        type="button"
        className="chat-disc__toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name="brain" size={13} className="chat-disc__icon" />
        <span className="chat-disc__label">{streaming ? "Thinking…" : "Thinking"}</span>
        <Icon name="chevron-down" size={13} strokeWidth={2.2} className="chat-disc__chev" />
      </button>
      {open && <div className="chat-disc__body">{text}</div>}
    </div>
  );
}

// ---------- evidence cards ----------
// Rendered beneath the assistant's answer: the actual graph / log lines /
// config rows / host issues behind a diagnostic claim, so the user can
// verify it. Each card deep-links to the full context (read-only for now;
// an action button slots in here later).
function ChatEvidence({ cards, onOpenServer, onOpenView }) {
  if (!cards || !cards.length) return null;
  return (
    <div className="chat-evidence">
      <div className="chat-evidence__label">
        <Icon name="search-check" size={12} /> Evidence
      </div>
      {cards.map((c, i) => {
        if (c.kind === "performance") return <EvidencePerformance key={i} c={c} onOpen={() => onOpenServer && onOpenServer(c.serverId, "performance")} />;
        if (c.kind === "console")     return <EvidenceConsole     key={i} c={c} onOpen={() => onOpenServer && onOpenServer(c.serverId, "console")} />;
        if (c.kind === "config")      return <EvidenceConfig      key={i} c={c} onOpen={() => onOpenServer && onOpenServer(c.serverId, "files")} />;
        if (c.kind === "host")        return <EvidenceHost        key={i} c={c} onOpen={() => onOpenView && onOpenView("fleet")} />;
        if (c.kind === "network")     return <EvidenceNetwork     key={i} c={c} onOpen={() => onOpenView && onOpenView("fleet")} />;
        if (c.kind === "health")      return <EvidenceHealth      key={i} c={c} onOpenServer={onOpenServer} />;
        if (c.kind === "rootcause")   return <EvidenceRootCause   key={i} c={c} onOpenServer={onOpenServer} />;
        if (c.kind === "changes")     return <EvidenceChanges     key={i} c={c} onOpenServer={onOpenServer} />;
        return null;
      })}
    </div>
  );
}

function ConfidenceBadge({ level }) {
  if (!level) return null;
  // confirmed = directly measured · likely = correlation · possible = inferred / can't-see
  const meta = {
    confirmed: { label: "Confirmed", icon: "badge-check", title: "Directly measured" },
    likely:    { label: "Likely",    icon: "trending-up", title: "Inferred from correlation" },
    possible:  { label: "Possible",  icon: "help-circle", title: "Can't be measured directly" },
  }[level];
  if (!meta) return null;
  return (
    <span className={"ev-conf ev-conf--" + level} title={meta.title}>
      <Icon name={meta.icon} size={10} strokeWidth={2.4} />
      {meta.label}
    </span>
  );
}

function EvidenceCardShell({ icon, title, sub, onOpen, openLabel, children, confidence }) {
  return (
    <div className="ev-card">
      <div className="ev-card__head">
        <span className="ev-card__icon"><Icon name={icon} size={13} /></span>
        <div className="ev-card__titles">
          <span className="ev-card__title">{title}</span>
          {sub && <span className="ev-card__sub">{sub}</span>}
        </div>
        <ConfidenceBadge level={confidence} />
        {onOpen && (
          <button className="ev-card__open" onClick={onOpen}>
            {openLabel} <Icon name="arrow-right" size={12} strokeWidth={2.2} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function EvidencePerformance({ c, onOpen }) {
  const TSChart = TimeSeriesChart;
  return (
    <EvidenceCardShell icon="line-chart" title={c.metric.label + " · " + c.serverName} sub={c.caption}
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Performance">
      <div className="ev-chart">
        {TSChart && (
          <TSChart
            range="1h"
            height={96}
            yMin={0}
            yMax={c.yMax || undefined}
            series={[{ key: c.metric.key, color: c.metric.color, fill: true, values: c.values }]}
            anomalies={[c.anomaly]} />
        )}
      </div>
      {c.correlated && (
        <div className="ev-correlate">
          <Icon name="link-2" size={11} />
          <span className="ev-correlate__text">
            Lines up with <b>{c.correlated.summary}</b>
          </span>
          {ACTION_META && ACTION_META[c.correlated.action] && (
            <span className={"audit-pill audit-pill--" + ACTION_META[c.correlated.action].tone}>
              <Icon name={ACTION_META[c.correlated.action].icon} size={10} strokeWidth={2.2} className="audit-pill__icon" />
              {c.correlated.action}
            </span>
          )}
        </div>
      )}
    </EvidenceCardShell>
  );
}

function EvidenceConsole({ c, onOpen }) {
  return (
    <EvidenceCardShell icon="terminal-square" title={"Console · " + c.serverName} sub={c.lines.length + " flagged line" + (c.lines.length === 1 ? "" : "s")}
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Console">
      <div className="ev-console">
        {c.lines.map((l, i) => (
          <div className={"ev-console__line ev-console__line--" + l.tag} key={i}>
            <span className="ev-console__ts">{l.ts}</span>
            <span className="ev-console__tag">[{l.tag}]</span>
            <span className="ev-console__text">{l.text}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceConfig({ c, onOpen }) {
  return (
    <EvidenceCardShell icon="file-text" title={c.file + " · " + c.serverName} sub="relevant settings"
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Files">
      <div className="ev-config">
        {c.rows.map((r, i) => (
          <div className={"ev-config__row" + (r.flagged ? " ev-config__row--hi" : "")} key={i}>
            <span className="ev-config__key">{r.key}</span>
            <span className="ev-config__val">{r.value}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceHost({ c, onOpen }) {
  return (
    <EvidenceCardShell icon="server" title={"Host · " + c.hostName} sub={c.problems.length + " issue" + (c.problems.length === 1 ? "" : "s")}
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Diagnostics">
      <div className="ev-host">
        {c.problems.map((p, i) => (
          <div className={"ev-host__row ev-host__row--" + p.tone} key={i}>
            <Icon name={p.icon} size={12} />
            <span>{p.text}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceChanges({ c, onOpenServer }) {
  const TONE = { info: "var(--info)", warn: "var(--warning)", update: "var(--update)" };
  return (
    <EvidenceCardShell icon="history" title={"What changed · " + c.serverName} sub={c.windowLabel + " · " + c.changes.length + " change" + (c.changes.length === 1 ? "" : "s")}
      confidence="confirmed"
      onOpen={() => onOpenServer && onOpenServer(c.serverId, "overview")} openLabel="Open server">
      <div className="ev-changes">
        {c.changes.map((ch, i) => (
          <div className="ev-changes__row" key={i}>
            <span className="ev-changes__icon" style={{ color: TONE[ch.tone] || "var(--fg-3)" }}><Icon name={ch.icon} size={12} /></span>
            <div className="ev-changes__body">
              <span className="ev-changes__label">{ch.label}<span className="ev-changes__by"> · {ch.by}</span></span>
              <span className="ev-changes__detail">{ch.detail}</span>
            </div>
            <span className="ev-changes__rel">{ch.rel}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceRootCause({ c, onOpenServer }) {
  const TONE_DOT = { danger: "var(--danger)", warn: "var(--warning)", update: "var(--update)", info: "var(--info)", success: "var(--success)" };
  return (
    <EvidenceCardShell icon="git-merge" title={"Root cause · " + c.serverName} sub={c.headline}
      confidence={c.confidence} onOpen={() => onOpenServer && onOpenServer(c.serverId, "overview")} openLabel="Open server">
      <div className="ev-chain">
        {c.steps.map((s, i) => (
          <div className={"ev-chain__step ev-chain__step--" + s.tone} key={i}>
            <span className="ev-chain__rail">
              <span className="ev-chain__dot" style={{ background: TONE_DOT[s.tone] || "var(--fg-3)" }}></span>
              {i < c.steps.length - 1 && <span className="ev-chain__line"></span>}
            </span>
            <span className="ev-chain__icon"><Icon name={s.icon} size={12} /></span>
            <div className="ev-chain__body">
              <span className="ev-chain__label">{s.label}</span>
              <span className="ev-chain__detail">{s.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceHealth({ c, onOpenServer }) {
  const verdict = c.fails ? "danger" : c.warns ? "warn" : "success";
  const headline = c.fails
    ? `${c.fails} issue${c.fails === 1 ? "" : "s"} found`
    : c.warns ? `${c.warns} thing${c.warns === 1 ? "" : "s"} to watch` : "All clear";
  const ICON = { pass: "check", warn: "alert-triangle", fail: "x", skip: "minus" };
  return (
    <EvidenceCardShell icon="stethoscope" title={"Health check · " + c.serverName}
      sub={`${c.passes}/${c.checks.length} passed`}
      confidence={c.confidence}
      onOpen={() => onOpenServer && onOpenServer(c.serverId, "overview")} openLabel="Open server">
      <div className={"ev-health__verdict ev-health__verdict--" + verdict}>
        <Icon name={verdict === "success" ? "circle-check-big" : "alert-triangle"} size={13} />
        {headline}
      </div>
      <div className="ev-health">
        {c.checks.map((ck, i) => (
          <div className={"ev-health__row ev-health__row--" + ck.status} key={i}>
            <span className="ev-health__icon"><Icon name={ICON[ck.status]} size={11} strokeWidth={2.6} /></span>
            <span className="ev-health__label">{ck.label}</span>
            <span className="ev-health__detail">{ck.detail}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceNetwork({ c, onOpen }) {
  const closed = c.closedCount > 0;
  return (
    <EvidenceCardShell icon="network" title={"Network · " + c.serverName}
      sub={closed ? c.closedCount + " required port" + (c.closedCount === 1 ? "" : "s") + " closed" : "all required ports open"}
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Diagnostics">
      <div className="ev-net">
        <div className="ev-net__ports">
          {c.rows.map((r, i) => (
            <div className={"ev-net__port ev-net__port--" + (r.open ? "open" : "closed")} key={i}>
              <Icon name={r.open ? "check" : "x"} size={11} strokeWidth={2.6} />
              <code>{r.port}/{r.proto}</code>
              <span>{r.open ? "open" : "closed"}</span>
            </div>
          ))}
        </div>
        {c.iface && (
          <div className="ev-net__traffic">
            <Icon name="arrow-down" size={11} /> {c.iface.rx} kbps
            <Icon name="arrow-up" size={11} style={{ marginLeft: 10 }} /> {c.iface.tx} kbps
            <span className={"ev-net__err" + (c.iface.errors > 0 ? " ev-net__err--bad" : "")} style={{ marginLeft: 10 }}>
              {c.iface.errors} errors
            </span>
          </div>
        )}
      </div>
    </EvidenceCardShell>
  );
}

// ---------- live command proposal ----------
// A §5·a `command.proposed` rendered as a confirm-first action card — the
// assistant's REAL proposal relayed over the turn SSE. API-backed verbs
// (start/stop/restart/open_ports) arm → Confirm → run the M3 path
// (confirmCommand, origin:"assistant"); the rest render disabled with an honest
// reason (no API endpoint yet — spec §6). Two-step so a destructive verb can't
// fire on a single tap.
function ChatCommand({ msg, onRun }) {
  const [armed, setArmed] = React.useState(false);
  const meta = commandMeta(msg.verb);
  const apiBacked = API_COMMAND_VERBS.has(msg.verb);
  const target = msg.subjectId || "this server";

  if (msg.state === "confirmed") {
    return (
      <div className="chat-actions">
        <div className="chat-actions__done">
          <Icon name="check" size={13} strokeWidth={2.6} />
          <span>Confirmed <b>{meta.label}</b> on {target}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="chat-actions">
      <div className="chat-actions__label">
        <Icon name="zap" size={12} /> Suggested action
      </div>
      <div className="chat-actions__row">
        {!apiBacked ? (
          <button className="chat-action chat-action--disabled" disabled
            title="This action isn’t available from the panel yet.">
            <Icon name={meta.icon} size={13} strokeWidth={2.2} />
            <span>{meta.label} {target}</span>
            <span className="chat-action__reason">Not available from the panel yet</span>
          </button>
        ) : armed ? (
          <div className="chat-action chat-action--armed">
            <span className="chat-action__confirm-q">{msg.confirm}</span>
            <div className="chat-action__confirm-btns">
              <button className={"chat-action__go chat-action__go--" + meta.tone} onClick={() => { setArmed(false); onRun(msg); }}>
                <Icon name="check" size={13} strokeWidth={2.4} /> Confirm
              </button>
              <button className="chat-action__cancel" onClick={() => setArmed(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className={"chat-action chat-action--" + meta.tone} onClick={() => setArmed(true)}>
            <Icon name={meta.icon} size={13} strokeWidth={2.2} />
            <span>{meta.label} {target}</span>
            {msg.reason && <span className="chat-action__reason">{msg.reason}</span>}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- host-switch notice ----------
// Inline marker shown when the user switches which host's assistant the chat is
// talking to ("Now talking to X's assistant"), mirroring the "Reading…" context
// pills so the change reads inline. (Older conversations may also carry these
// from the removed per-server scope control; they still render fine.)
function ChatScopeNotice({ msg }) {
  return (
    <div className="chat-scope-notice">
      <Icon name="crosshair" size={12} />
      <span>{msg.label}</span>
    </div>
  );
}

// A compaction checkpoint replayed from history: a quiet divider so a loaded
// conversation shows WHERE the assistant compacted its context, without hiding
// anything (the full prior history stays visible above). Reuses the scope-notice
// styling (centered + muted) so it needs no new CSS.
function ChatCheckpointNotice({ msg }) {
  return (
    <div className="chat-scope-notice" style={{ opacity: 0.65 }}>
      <Icon name="history" size={12} />
      <span>{msg.label || "Conversation compacted"}</span>
    </div>
  );
}

// A quiet, centered marker dropped into the thread when the user flips a
// behaviour toggle (Thinking / Actions), so the change is visible inline as the
// conversation goes on. Faded by default; the icon picks up the toggle's accent
// only when it's switched ON (teal for thinking, amber for actions).
function ChatToggleNotice({ msg }) {
  const isThink = msg.toggle === "thinking";
  const icon = isThink ? "brain" : (msg.on ? "zap" : "zap-off");
  const cls = "chat-toggle-notice"
    + (msg.on ? " chat-toggle-notice--on" : "")
    + (isThink ? " chat-toggle-notice--think" : " chat-toggle-notice--actions");
  return (
    <div className={cls}>
      <Icon name={icon} size={12} className="chat-toggle-notice__icon" />
      <span className="chat-toggle-notice__text">{msg.label}</span>
    </div>
  );
}

// ---------- post-action verification ----------
// After a confirmed action runs, the assistant proactively re-checks and
// reports whether it worked — pending spinner → ✓/⚠ result with detail lines.
function ChatVerify({ msg }) {
  if (msg.state === "pending") {
    return (
      <div className="chat-verify chat-verify--pending">
        <span className="oauth-spinner"></span>
        <span>Verifying {msg.action.label.toLowerCase()}…</span>
      </div>
    );
  }
  const r = msg.result || { ok: true, headline: "Done.", lines: [] };
  return (
    <div className={"chat-verify chat-verify--" + (r.ok ? "ok" : "warn")}>
      <div className="chat-verify__head">
        <Icon name={r.ok ? "circle-check-big" : "alert-triangle"} size={14} />
        <span>{r.headline}</span>
      </div>
      {r.lines && r.lines.length > 0 && (
        <div className="chat-verify__lines">
          {r.lines.map((l, i) => (
            <span key={i} className={"chat-verify__chip chat-verify__chip--" + l.status}>
              {l.label}: <b>{l.detail}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- message bubble ----------
function ChatMessage({ msg, user, onOpenServer, onOpenView }) {
  const isUser = msg.role === "user";
  return (
    <div className={"chat-msg" + (isUser ? " chat-msg--user" : " chat-msg--assistant")}>
      <div className="chat-msg__avatar">
        {isUser
          ? <AccountAvatar user={user} size={28} />
          : <span className="chat-msg__bot"><Icon name="bot" size={16} /></span>}
      </div>
      <div className="chat-msg__body">
        <div className="chat-msg__name">
          {isUser ? (user.display || user.name) : "Krystal assistant"}
          {msg.voice && <span className="chat-msg__voicetag"><Icon name="mic" size={11} strokeWidth={2.2} /> Voice note</span>}
        </div>
        {msg.voice && VoiceNoteBubble && <VoiceNoteBubble voice={msg.voice} />}
        {/* The assistant's "working" — reasoning, then tool calls — grouped under its turn,
            above the reply (the temporal order: think → run tools → answer). */}
        {!isUser && msg.thinking && <ChatThinking text={msg.thinking} streaming={!msg.content} />}
        {!isUser && msg.tools && msg.tools.map((t, i) => <ChatContextPill key={(t.id || "t") + ":" + i} msg={t} />)}
        <div className="chat-msg__content">
          {msg.content
            ? renderMarkdown(msg.content)
            : (msg.thinking || (msg.tools && msg.tools.length))
              ? null   /* the thinking / pending-tool pill is the activity signal — skip typing dots */
              : <span className="chat-typing"><span></span><span></span><span></span></span>}
        </div>
        {/* Rich result cards from this turn's structured tool results (§5·a `result`
            envelopes), below the reply — the "behind the scenes" evidence, mockup-style. */}
        {!isUser && msg.cards && msg.cards.length > 0 && (
          <ChatEvidence cards={msg.cards} onOpenServer={onOpenServer} onOpenView={onOpenView} />
        )}
      </div>
    </div>
  );
}

// ---------- settings popover ----------
function ChatSettings({ endpoint, model, models, status, onEndpoint, onModel, onRefresh, onClose }) {
  const [draft, setDraft] = React.useState(endpoint);
  return (
    <div className="chat-settings" onClick={e => e.stopPropagation()}>
      <div className="chat-settings__head">
        <span>Connection</span>
        <button className="chat-settings__close" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      <div className="chat-settings__field">
        <label>Ollama endpoint</label>
        <div className="chat-settings__row">
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={DEFAULT_ENDPOINT} spellCheck="false" />
          <button onClick={() => onEndpoint(draft)}>Save</button>
        </div>
        <span className={"chat-settings__status chat-settings__status--" + status.tone}>
          <span className="dot"></span>{status.label}
        </span>
      </div>
      <div className="chat-settings__field">
        <label>Model</label>
        <div className="chat-settings__row">
          <select value={model} onChange={e => onModel(e.target.value)}>
            {models.length === 0 && <option value={model}>{model}</option>}
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={onRefresh} title="Refresh model list"><Icon name="refresh-cw" size={13} /></button>
        </div>
      </div>
      <div className="chat-settings__hint">
        <Icon name="info" size={12} />
        Ollama must allow browser requests:
        <code>OLLAMA_ORIGINS='*' ollama serve</code>
      </div>
    </div>
  );
}

// AssistantHostPicker — chooses WHICH host's assistant the dock talks to.
// Sourced from assistantHosts(); the assistant is a per-host capability
// with no central fallback, so this is the only way to switch assistants. Shows
// the live status dot + model, and only opens a menu when >1 host qualifies.
function AssistantHostPicker({ hosts, current, onSelect }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  if (!current) return null;
  const cap = hostCapability(current, "assistant");
  const dotTone = cap.state === "operational" ? "online" : cap.state === "degraded" ? "warn" : "danger";
  const many = (hosts || []).length > 1;
  const pick = (id) => { setOpen(false); if (id !== current.id) onSelect(id); };
  return (
    <div className="asst-host" ref={ref}>
      <button
        className={"asst-host__trigger" + (open ? " asst-host__trigger--open" : "") + (many ? "" : " asst-host__trigger--solo")}
        onClick={() => many && setOpen(o => !o)} title="Which host's assistant"
        aria-haspopup={many ? "listbox" : undefined} aria-expanded={open}>
        <span className={"asst-host__dot asst-host__dot--" + dotTone}></span>
        <span className="asst-host__name">{current.name}</span>
        {many && <Icon name="chevrons-up-down" size={13} className="asst-host__caret" />}
      </button>
      {open && many && (
        <div className="asst-host__menu" role="listbox">
          <div className="asst-host__menu-label">Host assistant</div>
          {hosts.map(h => {
            const c = hostCapability(h, "assistant");
            const usable = c.state === "operational" || c.state === "degraded";
            const t = c.state === "operational" ? "online" : c.state === "degraded" ? "warn" : "danger";
            const active = h.id === current.id;
            return (
              <button key={h.id} className={"asst-host__opt" + (active ? " asst-host__opt--active" : "") + (usable ? "" : " asst-host__opt--down")}
                onClick={() => usable && pick(h.id)} disabled={!usable} role="option" aria-selected={active}>
                <span className={"asst-host__dot asst-host__dot--" + t}></span>
                <span className="asst-host__opt-name">{h.name}</span>
                {!usable && <span className="asst-host__opt-state">offline</span>}
                {active && <Icon name="check" size={14} className="asst-host__opt-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ChatHistory — conversation list as a site-style popover (matches the host
// switcher / account menus), replacing the old dropdown bar. Opens from the
// header's history button.
function ChatHistory({ convos, activeId, onPick, onDelete, conn, onOpen, loading }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  // Fetch the server-side history only on the open transition (lazy) — clicking the
  // button is the explicit signal; closing/reopening refreshes.
  const toggle = () => setOpen(o => { const next = !o; if (next && onOpen) onOpen(); return next; });
  return (
    <div className="chat-hist" ref={ref}>
      <button className={"chat-headbtn" + (open ? " chat-headbtn--on" : "")} onClick={toggle} title="Chat history" aria-label="Chat history" aria-haspopup="menu" aria-expanded={open}>
        <Icon name="history" size={16} />
      </button>
      {open && (
        <div className="chat-hist__menu" role="menu">
          <div className="chat-hist__head">
            <span className="chat-hist__head-label">Chat history</span>
          </div>
          <div className="chat-hist__list">
            {convos.length === 0 && !loading && <div className="chat-rail__empty">No conversations yet.</div>}
            {convos.map(c => (
              <div key={c.id}
                className={"chat-rail__item" + (c.id === activeId ? " chat-rail__item--active" : "")}
                onClick={() => { onPick(c.id); setOpen(false); }}>
                <Icon name="message-square" size={14} />
                <span className="chat-rail__title">{c.title || "New chat"}</span>
                <button className="chat-rail__del" onClick={(e) => onDelete(c.id, e)} title="Delete">
                  <Icon name="trash-2" size={13} />
                </button>
              </div>
            ))}
            {loading && (
              <div className="chat-rail__empty" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <span className="oauth-spinner"></span> Loading chat history…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ChatSystemNotice — a PLATFORM status row in the thread (not an assistant
// message): the assistant capability dropping/returning mid-session. Visually
// distinct (centred, muted, status LED) so it never reads as the model talking.
function ChatSystemNotice({ msg }) {
  const down = msg.kind === "assistant-down";
  return (
    <div className={"chat-system chat-system--" + (down ? "down" : "up")}>
      <span className={"status-led status-led--" + (down ? "down" : "live")}></span>
      <div className="chat-system__body">
        <span className="chat-system__title">
          {down ? msg.host + "\u2019s assistant is unavailable" : msg.host + "\u2019s assistant reconnected"}
        </span>
        {down && (
          <span className="chat-system__detail">
            {(msg.message || "The connection to this host\u2019s assistant dropped.") + " Your messages will send once it\u2019s back."}
            {msg.others && msg.others.length > 0 &&
              " Other assistants are online (" + msg.others.join(", ") + "), but they run on different hosts and can\u2019t see this host\u2019s data \u2014 so they can\u2019t pick up where this one left off."}
          </span>
        )}
      </div>
    </div>
  );
}

function ChatPage({ user, onOpenServer, onOpenView, docked, seed, onClose, onExpand, onNavigate, getServerState, assistantHost, assistantHosts = [], onSelectAssistantHost, showPin, pinned, pinDisabled, onTogglePin }) {
  // The assistant is a per-host capability the BACKEND routes to — there is no
  // browser-side endpoint or model config. Connection state + model are read
  // from the selected host's `assistant` capability; when it isn't operational
  // the chat says so instead of pretending to be connected.
  const assistantCap = (assistantHost && hostCapability) ? hostCapability(assistantHost, "assistant") : null;
  const model = (assistantCap && assistantCap.info && assistantCap.info.model) || "assistant";
  const conn = !assistantHost
    ? { tone: "muted",  label: "No assistant" }
    : assistantCap.state === "operational" ? { tone: "online", label: "Connected \u00b7 " + assistantHost.name }
    : assistantCap.state === "degraded"    ? { tone: "warn",   label: "Degraded \u00b7 " + assistantHost.name }
    : { tone: "danger", label: "Unavailable \u00b7 " + assistantHost.name };

  // Is this host's assistant usable right now? Gates the composer + drives the
  // in-thread status notices when it changes while the chat is open.
  const assistantUsable = !!(assistantHost && capUsable && capUsable(assistantHost, "assistant"));

  const [convos, setConvos]     = React.useState(loadConversations);
  const [activeId, setActiveId] = React.useState(() => loadConversations()[0]?.id || null);
  const [input, setInput]       = React.useState("");
  const [busy, setBusy]         = React.useState(false);

  // The "Auto-run" toggle — AUTO-ACCEPT: when on, the assistant runs the lifecycle action it decides
  // on immediately, with NO confirm-card step (start/stop/restart/update/backup). Off (default) the
  // assistant still proposes — you confirm each one. Two-level permission, both re-checked server-side
  // (the SPA gate is only UX; kgsm-api folds the toggle with the VERIFIED tier → X-Relay-Auto-Act):
  //   • viewer  → can't act at all → toggle HIDDEN.
  //   • operator → may propose + confirm, but NOT auto-run → toggle VISIBLE but DISABLED.
  //   • admin    → may auto-run → toggle ENABLED.
  // So `canSeeActions` (operator+) drives visibility; `canUseActions` (admin) drives enablement.
  const canSeeActions = !!(assistantHost && canOperate(assistantHost.id));
  const canUseActions = !!(assistantHost && isAdmin(assistantHost.id));
  const [actionsOn, setActionsOn] = React.useState(() => loadSetting(CHAT_ACTIONS_LS, "") === "1");
  React.useEffect(() => { saveSetting(CHAT_ACTIONS_LS, actionsOn ? "1" : "0"); }, [actionsOn]);
  // Effective auto-accept: the toggle's stored intent gated by admin authority, so a stale "on" from
  // a host where you're now only an operator reads (and sends) as off. The api re-checks anyway.
  const autoAcceptActive = actionsOn && canUseActions;
  // The "Thinking" toggle — no permission gate (reasoning is benign; unlike Actions it can't run
  // anything). When on, the turn carries think:true → the assistant emits thinking.delta frames.
  const [thinkOn, setThinkOn] = React.useState(() => loadSetting(CHAT_THINK_LS, "") === "1");
  React.useEffect(() => { saveSetting(CHAT_THINK_LS, thinkOn ? "1" : "0"); }, [thinkOn]);

  // Flip a behaviour toggle and, if a conversation is already underway, drop an
  // inline notice describing the change so it's visible as the chat continues.
  // Guarded to non-empty threads — toggling before the first message just sets
  // state (the button's own On/Off + tooltip already say what it does).
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

  const active = convos.find(c => c.id === activeId) || null;

  // Persist on every change.
  React.useEffect(() => { saveConversations(convos); }, [convos]);

  // The reverse path is LAZY: the caller's server-side chat history is fetched only
  // when they explicitly open the "Chat history" popover (loadServerHistory, wired to
  // ChatHistory's onOpen) — never eagerly on connect, since most opens of the panel
  // never need it. The popover shows a loading row until the API responds, then
  // mergeServerConversations folds the results into the list (join by id; local convos
  // win, so unsynced ones are never clobbered). Each host's assistant has its OWN
  // store, so this re-fetches per host on each open (cheap; keeps the list fresh). A
  // request id guards against a stale in-flight response clearing a newer one.
  const [histLoading, setHistLoading] = React.useState(false);
  const histReqRef = React.useRef(0);
  const loadServerHistory = React.useCallback(() => {
    if (!assistantHost || !assistantUsable) return;
    const reqId = ++histReqRef.current;
    setHistLoading(true);
    api.host(assistantHost.id).get("/assistant/conversations").then(
      (list) => { if (histReqRef.current === reqId) setConvos(prev => mergeServerConversations(prev, list, assistantHost.id)); },
      () => { /* no server history available → keep the local list */ })
      .finally(() => { if (histReqRef.current === reqId) setHistLoading(false); });
  }, [assistantHost && assistantHost.id, assistantUsable]);

  // Lazily load a server-only conversation's transcript the first time it's opened.
  // Only a remote, not-yet-loaded, empty stub owned by the CURRENT host is fetched
  // (a local convo already carries its messages; a stub from another host's
  // assistant can't be loaded here). Scaffolded through the same message vocabulary
  // a live turn produces, so it renders identically. Keyed on the active id + host;
  // the guard makes it idempotent.
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
      () => { /* leave the stub unloaded; the user can still continue it (server memory is intact) */ });
    return () => { cancelled = true; };
  }, [activeId, assistantHost && assistantHost.id]);

  // Mid-session capability change: if THIS host's assistant drops (or returns)
  // while the chat is open, drop a system status row into the active thread.
  // Guarded to the same host so switching hosts doesn't fire it.
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
  }, [assistantUsable, assistantHost && assistantHost.id, activeId]);

  // Auto-scroll to bottom as messages stream in.
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [active?.messages, busy]);

  // No browser-side model probe: the backend owns the connection to each host's
  // assistant. `conn` and `model` above are derived from the host capability.

  // Switch which host's assistant we're talking to. Posts a visible notice in
  // the thread (never a silent swap — you're changing which AI + backend you're
  // addressing).
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

  // ---- conversation helpers ----
  const newChat = () => {
    const c = { id: uid(), title: "New chat", messages: [], created: Date.now(), hostId: assistantHost && assistantHost.id };
    setConvos(prev => [c, ...prev]);
    setActiveId(c.id);
    setInput("");
    if (taRef.current) taRef.current.focus();
  };
  const deleteChat = (id, e) => {
    e.stopPropagation();
    // Soft-delete server-side too, so a removed chat doesn't resurrect from the host's history the next
    // time the "Chat history" popover is opened. Best-effort + idempotent: any chat that has had a turn is
    // persisted under its owning host's assistant; deleting an id with no server-side content just writes a
    // harmless tombstone (and the assistant keeps the transcript — soft-delete only hides it from the list).
    const chat = convos.find(c => c.id === id);
    const hostId = (chat && chat.hostId) || (assistantHost && assistantHost.id);
    if (hostId) api.host(hostId).del("/assistant/conversations/" + encodeURIComponent(id)).catch(() => {});
    setConvos(prev => {
      const next = prev.filter(c => c.id !== id);
      if (id === activeId) setActiveId(next[0]?.id || null);
      return next;
    });
  };
  const patchActive = (patch) => {
    setConvos(prev => prev.map(c => c.id === activeId ? { ...c, ...patch } : c));
  };
  const setMessages = (updater) => {
    setConvos(prev => prev.map(c => {
      if (c.id !== activeId) return c;
      const messages = typeof updater === "function" ? updater(c.messages) : updater;
      return { ...c, messages };
    }));
  };

  // ---- assistant turn ----
  // Stream a real assistant turn (kgsm-api POST /assistant/turn → §5·a SSE) and
  // translate its frames onto the thread's message roles: text.delta → the
  // assistant bubble; tool.start → a pending "reading…" pill spliced in just
  // before the streaming bubble; tool.result → that pill resolved to its summary;
  // error → an in-band failure; done → the authoritative full reply (reconciled
  // only when present). The assistant owns context/memory/tools. Command
  // proposals (fork (a)) + post-action verification are handled below.
  const sendLive = async (convId, text, userMsg) => {
    setConvos(prev => prev.map(c => {
      if (c.id !== convId) return c;
      const title = c.messages.length === 0 ? (text.slice(0, 40) || "Voice note") : c.title;
      return { ...c, title, messages: [...c.messages, userMsg, { role: "assistant", content: "" }] };
    }));

    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Each frame folds into the active conversation via the pure reducer above.
    const applyFrame = (ev) => setConvos(prev => prev.map(c =>
      c.id === convId ? { ...c, messages: reduceTurnFrame(c.messages, ev) } : c));

    try {
      // The turn body carries no server field — the assistant resolves the server from the prompt.
      // `conversationId` IS sent: it is THIS chat's local id, so each "New chat" gets a FRESH
      // assistant context window. The backend namespaces memory under web:<userId>:<conversationId>,
      // so a new chat no longer recalls a prior one's history (the user-id prefix stays
      // server-authoritative → never cross-user). See WIRING §9.
      // A voice note whose transcription failed has empty text → send a short
      // marker, so the turn reads instead of a 400 on an empty prompt.
      const prompt = text || "[The user sent a voice note; transcription was unavailable.]";
      // `actions` = AUTO-ACCEPT intent (admin + toggle). The backend re-checks admin tier before it
      // lets the assistant auto-run; proposing works regardless of this flag, so off ≠ "can't act".
      // `think` = the Thinking toggle → the assistant reasons before answering (thinking.delta frames).
      await api.host(assistantHost.id).turn({ prompt, actions: autoAcceptActive, think: thinkOn, conversationId: convId }, { onEvent: applyFrame, signal: ctrl.signal });
    } catch (e) {
      const aborted = e && e.name === "AbortError";
      const reason = e && e.code === 503 ? assistantHost.name + "’s assistant is currently unavailable."
        : e && e.code === 502 ? "Couldn’t reach " + assistantHost.name + "’s assistant — try again, or check the host."
        : e && e.code === 404 ? assistantHost.name + " isn’t serving an assistant right now."
        : (e && e.userMessage) || (assistantHost.name + "’s assistant didn’t respond.");
      setConvos(prev => prev.map(c => {
        if (c.id !== convId) return c;
        const msgs = c.messages.slice();
        const lastIdx = msgs.length - 1;
        const bubble = msgs[lastIdx];
        if (!bubble || bubble.role !== "assistant") return c;
        msgs[lastIdx] = aborted
          ? { ...bubble, content: bubble.content || "_Stopped._" }
          : bubble.content
            ? { ...bubble, content: bubble.content + "\n\n_⚠ Interrupted — the assistant connection dropped._" }
            : { ...bubble, content: "⚠️ " + reason, error: true };
        return { ...c, messages: msgs };
      }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  // ---- send ----
  const send = async (override, voiceMeta) => {
    const text = (typeof override === "string" ? override : input).trim();
    if ((!text && !voiceMeta) || busy) return;

    // Ensure we have an active conversation.
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

    // Per-host routing: the backend proxies to THIS host's assistant. If the
    // capability isn't usable (down / unknown / absent), don't pretend to
    // answer — post the reason in-thread and stop.
    if (!assistantHost || !(capUsable && capUsable(assistantHost, "assistant"))) {
      const why = !assistantHost
        ? "No host is serving an assistant right now."
        : (assistantCap && assistantCap.message) ? assistantCap.message
        : "This host's assistant is currently " + (assistantCap ? assistantCap.state : "unavailable") + ".";
      setConvos(prev => prev.map(c => {
        if (c.id !== convId) return c;
        const title = c.messages.length === 0 ? (text.slice(0, 40) || "Voice note") : c.title;
        return { ...c, title, messages: [...c.messages, userMsg, { role: "assistant", content: "⚠️ " + why, error: true }] };
      }));
      return;
    }

    // Stream a real assistant turn (kgsm-api POST /assistant/turn → §5·a SSE).
    // The assistant owns its own context, memory (keyed on the forwarded Discord
    // id) and tools, so we send only the bare prompt. Command proposals +
    // verification (fork (a)) are handled inside sendLive / runLiveCommand.
    sendLive(convId, text, userMsg);
  };

  const stop = () => { if (abortRef.current) abortRef.current.abort(); };

  // Voice notes: hold the mic, we capture audio + transcribe, then post the
  // note (with its transcript) through the same send pipeline.
  const voice = useVoiceRecorder();
  const sendVoice = async () => {
    const payload = await voice.finish();
    if (!payload) return;
    const { id, duration, peaks, transcript } = payload;
    send(transcript || "", { id, duration, peaks });
  };

  // From a briefing item → pre-fill the composer with its prompt and focus. We
  // pre-fill (rather than auto-send) so the user stays in control.
  const startBriefingChat = (item) => {
    setInput(item.prompt);
    setTimeout(() => {
      const ta = taRef.current;
      if (ta) { ta.focus(); ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 200) + "px"; }
    }, 0);
  };

  // External seed (the "Ask assistant" button on an alert) → pre-fill the
  // composer with a grounded question about that alert. Same pre-fill-don't-send
  // contract as briefing items, keyed on the seed's nonce so each click re-seeds
  // even when the prompt text is identical.
  React.useEffect(() => {
    if (!seed || !seed.prompt) return;
    startBriefingChat({ prompt: seed.prompt });
  }, [seed && seed.nonce]);

  // Confirm + run an assistant-proposed command (fork (a)). Routes through
  // confirmCommand → the SAME M3 path as the UI buttons, origin:"assistant"
  // (the backend writes the audit row from the kgsm echo — never the SPA).
  // Marks the card confirmed, drops a pending verify marker, then resolves it from
  // the job outcome the WS carries back. The card is rendered from its own fields;
  // only the EXECUTE path resolves a server row (for its hostId) — falling back to the
  // assistant's host when the row isn't loaded, so a propose-for-unknown can't crash.
  const runLiveCommand = (card) => {
    if (!API_COMMAND_VERBS.has(card.verb)) return;   // not API-backed → the card is disabled
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
          ? { ok: false, headline: ((assistantHost && assistantHost.name) || "This host") + "’s session expired — re-authorize this host to run commands.", lines: [] }
          : { ok: false, headline: "Couldn’t run " + meta.label.toLowerCase() + " — " + ((err && err.userMessage) || "the command failed."), lines: [] });
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

  // Shared "needs attention" panel (also used on the dashboard).
  const ChatBriefingPanel = NeedsAttention;

  // Mobile: the conversation rail collapses into a dropdown menu.
  const [railOpen, setRailOpen] = React.useState(false);
  const railWrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!railOpen) return;
    const h = (e) => { if (railWrapRef.current && !railWrapRef.current.contains(e.target)) setRailOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [railOpen]);
  // Close the dropdown whenever the active conversation changes.
  React.useEffect(() => { setRailOpen(false); }, [activeId]);

  return (
    <div className={"chat-page" + (docked ? " chat-page--docked" : "")}>
      {/* conversation rail — desktop sidebar */}
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

      {/* main panel */}
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
                    title={pinDisabled ? "Not enough room to pin — floating over the page" : pinned ? "Unpin — float over the page" : "Pin — push the page aside"}
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

        <div className="chat-scroll" ref={scrollRef}>
          {(!active || active.messages.length === 0) ? (
            <div className="chat-empty">
              <span className="chat-empty__logo"><Icon name="bot" size={26} /></span>
              <h2>{assistantHost ? "Ask " + assistantHost.name + "’s assistant" : "No assistant available"}</h2>
              <p>{assistantHost
                ? "Routed by " + assistantHost.name + "’s backend. Each host runs its own — there is no central assistant."
                : "No connected host is serving an assistant capability."}</p>
              {ChatBriefingPanel && <ChatBriefingPanel onPick={startBriefingChat} />}
              <div className="chat-suggestions">
                {suggestions.map((s, i) => (
                  <button key={i} className="chat-suggestion" onClick={() => { setInput(s); if (taRef.current) taRef.current.focus(); }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="chat-thread">
              {active.messages.map((m, i) =>
                m.role === "context"
                  ? <ChatContextPill key={i} msg={m} />
                  : m.role === "system"
                    ? <ChatSystemNotice key={i} msg={m} />
                  : m.role === "scope"
                    ? <ChatScopeNotice key={i} msg={m} />
                  : m.role === "checkpoint"
                    ? <ChatCheckpointNotice key={i} msg={m} />
                  : m.role === "toggle"
                    ? <ChatToggleNotice key={i} msg={m} />
                    : m.role === "evidence"
                      ? <ChatEvidence key={i} cards={m.cards} onOpenServer={onOpenServer} onOpenView={onOpenView} />
                      : m.role === "command"
                        ? <ChatCommand key={i} msg={m} onRun={runLiveCommand} />
                        : m.role === "verify"
                          ? <ChatVerify key={i} msg={m} />
                          : <ChatMessage key={i} msg={m} user={user} onOpenServer={onOpenServer} onOpenView={onOpenView} />
              )}
            </div>
          )}
        </div>

        <div className="chat-composer">
          {voice.phase === "idle" ? (
            <div className="chat-composer__box">
              <textarea
                ref={taRef}
                rows={1}
                value={input}
                placeholder={assistantHost ? "Message " + assistantHost.name + "’s assistant…" : "Message the assistant…"}
                onChange={onInputChange}
                onKeyDown={onKeyDown} />
              <div className="chat-composer__bar">
                {/* Thinking toggle — any tier (reasoning is benign). Makes the assistant reason
                    step by step before answering; the reasoning streams into a collapsed-by-default
                    block above the reply (ChatThinking). */}
                {assistantHost && (
                  <button
                    type="button"
                    className={"chat-act-toggle chat-think-toggle" + (thinkOn ? " chat-think-toggle--on" : "")}
                    onClick={toggleThinking}
                    title={thinkOn
                      ? "Thinking ON — the assistant reasons step by step before answering (shown collapsed in the reply). Click to turn off."
                      : "Thinking OFF — the assistant answers directly. Turn on to have it reason first."}
                    aria-pressed={thinkOn}>
                    <Icon name="brain" size={13} />
                    <span className="chat-act-toggle__label">Thinking</span>
                    <span className="chat-act-toggle__state">{thinkOn ? "On" : "Off"}</span>
                  </button>
                )}
                {/* Auto-run (auto-accept) toggle — visible to operator+ (viewers never see it), but only
                    ENABLED for admins. An operator sees it disabled, so it's clear the capability exists
                    and is admin-only — the real gate is server-side (kgsm-api re-checks admin tier). */}
                {canSeeActions && (
                  <button
                    type="button"
                    className={"chat-act-toggle" + (autoAcceptActive ? " chat-act-toggle--on" : "")}
                    onClick={canUseActions ? toggleActions : undefined}
                    disabled={!canUseActions}
                    title={!canUseActions
                      ? "Auto-run is admin-only. As an operator you can still have the assistant propose actions and confirm them yourself."
                      : autoAcceptActive
                        ? "Auto-run ON — the assistant carries out start/stop/restart actions immediately, no confirmation. Click to turn off."
                        : "Auto-run OFF — the assistant proposes actions for you to confirm. Turn on to let it run them automatically."}
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

export { adaptResultCard, API_COMMAND_VERBS, ChatCommand, ChatPage, composeVerified, mergeServerConversations, reduceTurnFrame, scaffoldHistory };
