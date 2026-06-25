import React from "react";
import { Icon } from "../components/Icon.jsx";
import { NeedsAttention } from "../components/NeedsAttention.jsx";
import { AccountAvatar } from "../components/Sidebar.jsx";
import { TimeSeriesChart } from "../components/TimeSeriesChart.jsx";
import { VoiceComposerBar, VoiceNoteBubble, useVoiceRecorder } from "../components/VoiceNote.jsx";
import { assistantHosts, capUsable, hostCapability } from "../lib/capabilities.js";
import { canOperate } from "../lib/persona.js";
import { confirmCommand, scopeServers, serversStore } from "../lib/stores.js";
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
const DEFAULT_ENDPOINT = "http://localhost:11434";
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
    case "tool.start":
      msgs.splice(lastIdx, 0, { role: "context", toolId: ev.id, label: toolLabel(ev.tool), state: "pending" });
      break;
    case "tool.result":
      // Resolve only the MOST RECENT still-pending pill with this id. Tool-call ids
      // are turn-local (they reset per turn), so without the pending guard + reverse
      // scan a later turn's result would retroactively rewrite a prior turn's pill.
      for (let k = msgs.length - 1; k >= 0; k--) {
        if (msgs[k].role === "context" && msgs[k].toolId === ev.id && msgs[k].state === "pending") {
          msgs[k] = { ...msgs[k], state: "done", label: ev.summary || msgs[k].label };
          break;
        }
      }
      break;
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
      break;   // thinking.delta and any future additive frame — ignored
  }
  return msgs;
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

// ---------- context pill ----------
// Faded inline indicator that the assistant pulled live website data.
function ChatContextPill({ msg }) {
  const pending = msg.state === "pending";
  return (
    <div className={"chat-context" + (pending ? " chat-context--pending" : "")}>
      <span className="chat-context__icon">
        {pending
          ? <span className="chat-context__spinner"></span>
          : <Icon name="database" size={12} />}
      </span>
      <span className="chat-context__label">
        {pending ? msg.label + "…" : msg.label}
        {msg.detail && <span className="chat-context__detail"> · {msg.detail}</span>}
      </span>
      {!pending && <Icon name="check" size={12} strokeWidth={2.6} className="chat-context__check" />}
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

// ---------- scope lock notice ----------
// Inline marker shown when the conversation locks onto (or switches) a server,
// mirroring the "Reading…" context pills so the scope change is visible.
function ChatScopeNotice({ msg }) {
  return (
    <div className="chat-scope-notice">
      <Icon name="crosshair" size={12} />
      <span>{msg.label}</span>
    </div>
  );
}

// ---------- scope chip ----------
// Header control showing which game-server the conversation is about, so the
// user doesn't re-type the name every turn. Auto-set from the first server
// the assistant resolves; changeable / clearable via the dropdown.
function ScopeChip({ servers, value, onChange }) {
  const current = servers.find(s => s.id === value) || null;
  return (
    <label className={"chat-scope" + (current ? " chat-scope--on" : "")} title="Which server this chat is about">
      <Icon name="crosshair" size={13} />
      <span className="chat-scope__label">
        {current ? current.name : "All servers"}
      </span>
      <Icon name="chevron-down" size={13} />
      <select value={value || ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">All servers</option>
        {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </label>
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
function ChatMessage({ msg, user }) {
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
        <div className="chat-msg__content">
          {msg.content
            ? renderMarkdown(msg.content)
            : <span className="chat-typing"><span></span><span></span><span></span></span>}
        </div>
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
function ChatHistory({ convos, activeId, onPick, onDelete, conn }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="chat-hist" ref={ref}>
      <button className={"chat-headbtn" + (open ? " chat-headbtn--on" : "")} onClick={() => setOpen(o => !o)} title="Chat history" aria-label="Chat history" aria-haspopup="menu" aria-expanded={open}>
        <Icon name="history" size={16} />
      </button>
      {open && (
        <div className="chat-hist__menu" role="menu">
          <div className="chat-hist__head">
            <span className="chat-hist__head-label">Chat history</span>
          </div>
          <div className="chat-hist__list">
            {convos.length === 0 && <div className="chat-rail__empty">No conversations yet.</div>}
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

function ChatPage({ user, onOpenServer, onOpenView, docked, pageContext, seed, onClose, onExpand, onNavigate, getServerState, assistantHost, assistantHosts = [], onSelectAssistantHost, showPin, pinned, pinDisabled, onTogglePin }) {
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

  // The "Actions" toggle — lets the assistant suggest + run changes (start/stop/restart/…). It is
  // INTENT, not authority: only operator+ on this host even see it (viewers never can), and the
  // backend re-folds it with the caller's verified tier (kgsm-api → X-Relay-Can-Act), so flipping
  // it on a host where you're a viewer does nothing. Persisted across sessions; default OFF (safe).
  const canUseActions = !!(assistantHost && canOperate(assistantHost.id));
  const [actionsOn, setActionsOn] = React.useState(() => loadSetting(CHAT_ACTIONS_LS, "") === "1");
  React.useEffect(() => { saveSetting(CHAT_ACTIONS_LS, actionsOn ? "1" : "0"); }, [actionsOn]);

  const scrollRef = React.useRef(null);
  const abortRef  = React.useRef(null);
  const taRef     = React.useRef(null);
  const serverRef = React.useRef(null);   // last game-server the convo referenced
  // Mirror of serverRef in state so the scope header re-renders. serverRef
  // stays for synchronous reads inside send(); setScope keeps the two aligned.
  const [scopeId, setScopeId] = React.useState(null);
  const setScope = (id) => { serverRef.current = id; setScopeId(id); };

  // Manual scope change from the header dropdown. Mirrors the inline notice
  // that auto-scope produces during send, so picking a server (or clearing to
  // "All servers") is reflected in the thread every time it changes.
  const changeScope = (id) => {
    const next = id || null;
    if (next === scopeId) return;
    setScope(next);
    if (!activeId) return;  // no thread to annotate yet
    const srv = serversStore.getState().list.find(s => s.id === next);
    const label = srv ? "Switched focus to " + srv.name : "Cleared focus — now considering all servers";
    setConvos(prev => prev.map(c => {
      if (c.id !== activeId || c.messages.length === 0) return c;
      return { ...c, messages: [...c.messages, { role: "scope", label, serverId: next }] };
    }));
  };

  const active = convos.find(c => c.id === activeId) || null;

  // Reset the conversation scope when switching chats.
  React.useEffect(() => { serverRef.current = null; setScopeId(null); }, [activeId]);

  // Page-aware context: when docked and the user navigates to a server page,
  // silently scope the assistant to that server so its context + suggestions
  // track wherever they are. Passive (no thread notice) since the user didn't
  // explicitly ask — the header chip reflects the change.
  React.useEffect(() => {
    if (!docked || !pageContext) return;
    const pid = pageContext.serverId || null;
    if (pid && pid !== serverRef.current) setScope(pid);
  }, [docked, pageContext && pageContext.serverId]);

  // Persist on every change.
  React.useEffect(() => { saveConversations(convos); }, [convos]);

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
  // addressing) and clears the server scope, since a server belongs to a host.
  const pickAssistantHost = (id) => {
    if (!onSelectAssistantHost) return;
    const next = (assistantHosts || []).find(h => h.id === id);
    onSelectAssistantHost(id);
    setScope(null);
    if (activeId && next) {
      setConvos(prev => prev.map(c => (c.id === activeId && c.messages.length > 0)
        ? { ...c, messages: [...c.messages, { role: "scope", label: "Now talking to " + next.name + "\u2019s assistant" }] }
        : c));
    }
  };

  // ---- conversation helpers ----
  const newChat = () => {
    const c = { id: uid(), title: "New chat", messages: [], created: Date.now() };
    setConvos(prev => [c, ...prev]);
    setActiveId(c.id);
    setInput("");
    if (taRef.current) taRef.current.focus();
  };
  const deleteChat = (id, e) => {
    e.stopPropagation();
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
      // {prompt} only — the scope chip has NO turn transport (the body carries no
      // server field; the assistant resolves the server from the prompt). The chip
      // stays a display + follow-up-grounding affordance. See WIRING §9.
      // A voice note whose transcription failed has empty text → send a short
      // marker, so the turn reads instead of a 400 on an empty prompt.
      const prompt = text || "[The user sent a voice note; transcription was unavailable.]";
      // `actions` = the toggle's intent (only meaningful for operator+; the backend re-checks tier).
      const allowActions = actionsOn && canUseActions;
      await api.host(assistantHost.id).turn({ prompt, actions: allowActions }, { onEvent: applyFrame, signal: ctrl.signal });
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
      const c = { id: convId, title: "New chat", messages: [], created: Date.now() };
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

  // From a briefing item → pre-fill the composer with its prompt and focus,
  // also pinning the conversation's server scope so context resolves. We
  // pre-fill (rather than auto-send) so the user stays in control.
  const startBriefingChat = (item) => {
    if (item.serverId) setScope(item.serverId);
    setInput(item.prompt);
    setTimeout(() => {
      const ta = taRef.current;
      if (ta) { ta.focus(); ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 200) + "px"; }
    }, 0);
  };

  // External seed (the "Ask assistant" button on an alert) → pre-fill the
  // composer with a grounded question about that alert and pin its server
  // scope. Same pre-fill-don't-send contract as briefing items, keyed on the
  // seed's nonce so each click re-seeds even when the prompt text is identical.
  React.useEffect(() => {
    if (!seed || !seed.prompt) return;
    startBriefingChat({ serverId: seed.serverId, prompt: seed.prompt });
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
              <ChatHistory convos={convos} activeId={activeId} onPick={setActiveId} onDelete={deleteChat} conn={conn} />
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
                    : m.role === "evidence"
                      ? <ChatEvidence key={i} cards={m.cards} onOpenServer={onOpenServer} onOpenView={onOpenView} />
                      : m.role === "command"
                        ? <ChatCommand key={i} msg={m} onRun={runLiveCommand} />
                        : m.role === "verify"
                          ? <ChatVerify key={i} msg={m} />
                          : <ChatMessage key={i} msg={m} user={user} />
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
                {assistantHost && (
                  <ScopeChip servers={scopeServers(serversStore.getState().list, assistantHost.id)} value={scopeId} onChange={changeScope} />
                )}
                {/* Actions toggle — operator+ only (viewers never see it). Lets the assistant
                    suggest + run changes; each one is still a confirm-first card (ChatCommand). */}
                {canUseActions && (
                  <button
                    type="button"
                    className={"chat-act-toggle" + (actionsOn ? " chat-act-toggle--on" : "")}
                    onClick={() => setActionsOn(v => !v)}
                    title={actionsOn
                      ? "Actions ON — the assistant can suggest and run changes (you confirm each one). Click to turn off."
                      : "Actions OFF — the assistant only answers. Turn on to let it suggest and run changes."}
                    aria-pressed={actionsOn}>
                    <Icon name={actionsOn ? "zap" : "zap-off"} size={13} />
                    <span className="chat-act-toggle__label">Actions</span>
                    <span className="chat-act-toggle__state">{actionsOn ? "On" : "Off"}</span>
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

export { API_COMMAND_VERBS, ChatCommand, ChatPage, composeVerified, reduceTurnFrame };
