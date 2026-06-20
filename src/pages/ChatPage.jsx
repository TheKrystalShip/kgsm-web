import React from "react";
import { Icon } from "../components/Icon.jsx";
import { NeedsAttention } from "../components/NeedsAttention.jsx";
import { AccountAvatar } from "../components/Sidebar.jsx";
import { TimeSeriesChart } from "../components/TimeSeriesChart.jsx";
import { VoiceComposerBar, VoiceNoteBubble, useVoiceRecorder } from "../components/VoiceNote.jsx";
import { assistantHosts, capUsable, hostCapability } from "../lib/capabilities.js";
import { KrystalChat } from "../lib/chatTools.js";
import { scopeServers, serversStore } from "../lib/stores.js";
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
const DEFAULT_ENDPOINT = "http://localhost:11434";
const DEFAULT_MODEL    = "gemma3";

const SYSTEM_PROMPT =
  "You are Krystal's built-in assistant, helping a small gaming community run " +
  "their dedicated game servers. Be concise, friendly, and technical when asked. " +
  "You can explain server configs, troubleshoot crashes, and suggest commands.\n\n" +
  "You have live access to the website's data. When a 'Live website data' block " +
  "is supplied below a user message, treat it as ground truth — cite specific " +
  "metrics, anomalies, and audit events in your answer. If a spike in resource " +
  "usage lines up with an audit event (like a backup or update), point that out " +
  "as the likely cause. If you need to know WHEN something happened to look it up, " +
  "ask the user a short follow-up question (e.g. 'When did you notice the lag?').";

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

// ---------- action proposals ----------
// Confirm-first action buttons the assistant proposes. Every action here came
// from KrystalChat.inferActions(), which only emits verbs that map 1:1 to a
// real App.handleAction() and pass the action's applies(server) guard — so
// nothing the model says can surface a button the website can't actually run.
// Two-step: tap proposes → "Confirm"/"Cancel" → runs + marks done.
function ChatActions({ msg, onRun }) {
  const [pendingId, setPendingId] = React.useState(null);
  const done = msg.done; // { id, label } once an action has been run

  if (done) {
    return (
      <div className="chat-actions">
        <div className="chat-actions__done">
          <Icon name="check" size={13} strokeWidth={2.6} />
          <span>Ran <b>{done.label}</b> on {done.serverName} · logged to audit</span>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-actions">
      <div className="chat-actions__label">
        <Icon name="zap" size={12} /> Suggested {msg.actions.length > 1 ? "actions" : "action"}
      </div>
      <div className="chat-actions__row">
        {msg.actions.map(a => {
          const armed = pendingId === a.id;
          if (armed) {
            return (
              <div className="chat-action chat-action--armed" key={a.id}>
                <span className="chat-action__confirm-q">{a.confirm}</span>
                <div className="chat-action__confirm-btns">
                  <button className={"chat-action__go chat-action__go--" + a.tone} onClick={() => { setPendingId(null); onRun(a); }}>
                    <Icon name="check" size={13} strokeWidth={2.4} /> Confirm
                  </button>
                  <button className="chat-action__cancel" onClick={() => setPendingId(null)}>Cancel</button>
                </div>
              </div>
            );
          }
          return (
            <button key={a.id} className={"chat-action chat-action--" + a.tone} onClick={() => setPendingId(a.id)}>
              <Icon name={a.icon} size={13} strokeWidth={2.2} />
              <span>{a.label}</span>
              {a.reason && <span className="chat-action__reason">{a.reason}</span>}
            </button>
          );
        })}
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

// ---------- follow-up chips ----------
// Tappable next-question suggestions shown only beneath the latest assistant
// answer. Grounded in the conversation's scoped server + last user intent, so
// they stay relevant. Tapping sends immediately — they're quick follow-ups.
function ChatFollowups({ suggestions, onPick }) {
  if (!suggestions || !suggestions.length) return null;
  return (
    <div className="chat-followups">
      {suggestions.map((s, i) => (
        <button key={i} className="chat-followup" onClick={() => onPick(s)}>
          <Icon name="corner-down-right" size={12} />
          {s}
        </button>
      ))}
    </div>
  );
}

// ---------- navigation suggestions ----------
// Contextual "jump to the relevant screen" chips. Distinct from follow-ups:
// these navigate the app rather than sending a message. Grounded in
// KrystalChat.suggestNavigation so every target maps to a real route.
function ChatNavSuggestions({ suggestions, onNavigate }) {
  if (!suggestions || !suggestions.length) return null;
  return (
    <div className="chat-navsugg">
      {suggestions.map((s, i) => (
        <button key={i} className="chat-navchip" onClick={() => onNavigate && onNavigate(s.target)}>
          <Icon name={s.icon} size={13} />
          {s.label}
          <Icon name="arrow-up-right" size={12} strokeWidth={2.2} />
        </button>
      ))}
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

function ChatPage({ user, onOpenServer, onOpenView, onRunAction, docked, pageContext, seed, onClose, onExpand, onNavigate, getServerState, assistantHost, assistantHosts = [], onSelectAssistantHost, showPin, pinned, pinDisabled, onTogglePin }) {
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

    // --- Context routing: decide what website data would help answer this,
    // gather it, and surface faded "reading…" pills in the thread. ---
    let contextText = "";
    let contextPills = [];
    let evidenceCards = [];
    let proposedActions = [];
    let scopeNotice = null;
    // Context routing works off the spoken/typed text; a voice note with no
    // transcript still posts, it just can't pull live data on its own.
    const routeText = text || "";
    if (KrystalChat && routeText) {
      const inferred = KrystalChat.inferContext(routeText, serverRef.current);
      if (inferred.serverId && inferred.serverId !== serverRef.current) {
        // First time this conversation locks onto a server — flag it inline
        // so the user sees the scope change, like the "Reading…" pills.
        const wasUnscoped = !serverRef.current;
        const srv = serversStore.getState().list.find(s => s.id === inferred.serverId);
        if (srv) scopeNotice = { role: "scope", label: (wasUnscoped ? "Focused this chat on " : "Switched focus to ") + srv.name, serverId: srv.id };
        setScope(inferred.serverId);
      }
      contextText = inferred.contextText;
      evidenceCards = inferred.evidence || [];
      proposedActions = inferred.actions || [];
      contextPills = inferred.pills.map(p => ({
        role: "context", label: p.label, detail: p.detail, state: "pending",
      }));
    }

    // Append user message, any context pills, then an empty assistant
    // placeholder we'll stream into.
    setConvos(prev => prev.map(c => {
      if (c.id !== convId) return c;
      const title = c.messages.length === 0 ? (text.slice(0, 40) || "Voice note") : c.title;
      const lead = scopeNotice ? [scopeNotice] : [];
      return { ...c, title, messages: [...c.messages, userMsg, ...lead, ...contextPills, { role: "assistant", content: "" }] };
    }));

    // Let the pills read as "in progress" briefly, then settle to done — a
    // clear signal the assistant consulted live data.
    // Sequence the pills one-at-a-time — like watching the assistant call each
    // tool in turn ("checking host… → found it"). Each pill resolves pending →
    // done with a stagger, instead of all settling at once.
    if (contextPills.length) {
      for (let k = 0; k < contextPills.length; k++) {
        await new Promise(res => setTimeout(res, k === 0 ? 450 : 600));
        setConvos(prev => prev.map(c => {
          if (c.id !== convId) return c;
          let seen = -1;
          const msgs = c.messages.map(m => {
            if (m.role !== "context") return m;
            seen++;
            return seen === k ? { ...m, state: "done" } : m;
          });
          return { ...c, messages: msgs };
        }));
      }
      // Brief beat after the last tool resolves before the answer streams.
      await new Promise(res => setTimeout(res, 250));
    }

    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Build the message history sent to Ollama. Context pills are UI-only, so
    // we strip them and instead fold the gathered data into a system message.
    const priorConvo = convos.find(c => c.id === convId);
    // Voice notes carry their transcript as content; if a note had no
    // transcript, hand the model a short marker so the turn still reads.
    const forModel = (m) => ({
      role: m.role,
      content: m.content || (m.voice ? "[The user sent a voice note; transcription was unavailable.]" : ""),
    });
    const history = (priorConvo ? priorConvo.messages : [])
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(forModel);
    const turnMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      forModel(userMsg),
    ];
    if (contextText) {
      turnMessages.push({
        role: "system",
        content: "Live website data for the user's last message:\n\n" + contextText,
      });
    }
    const payload = { model, messages: turnMessages, stream: true };

    try {
      // Routed through the backend to the host's assistant — the browser never
      // holds a model endpoint. (The mock backend has no streaming chat, so in
      // the demo this falls through to the graceful per-host error below.)
      const r = await fetch("/api/v1/hosts/" + assistantHost.id + "/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) throw new Error("HTTP " + r.status);

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop(); // keep the partial line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.message?.content) {
              acc += obj.message.content;
              setConvos(prev => prev.map(c => {
                if (c.id !== convId) return c;
                const msgs = [...c.messages];
                msgs[msgs.length - 1] = { role: "assistant", content: acc };
                return { ...c, messages: msgs };
              }));
            }
          } catch (e) { /* ignore keepalive / partial */ }
        }
      }
    } catch (e) {
      const aborted = e.name === "AbortError";
      setConvos(prev => prev.map(c => {
        if (c.id !== convId) return c;
        const msgs = [...c.messages];
        const lastMsg = msgs[msgs.length - 1];
        msgs[msgs.length - 1] = {
          role: "assistant",
          content: (lastMsg.content && !aborted)
            ? lastMsg.content + "\n\n_⚠ Interrupted — the assistant connection dropped._"
            : lastMsg.content || (aborted
            ? "_Stopped._"
            : "⚠️ " + assistantHost.name + "’s assistant didn’t respond. The backend couldn’t reach this host’s assistant — try again, or check the host."),
          error: !aborted && !lastMsg.content,
        };
        return { ...c, messages: msgs };
      }));
    } finally {
      // Drop the evidence cards in beneath the answer — the actual data
      // behind the assistant's diagnosis, so the user can verify it.
      if (evidenceCards.length) {
        setConvos(prev => prev.map(c => {
          if (c.id !== convId) return c;
          return { ...c, messages: [...c.messages, { role: "evidence", cards: evidenceCards }] };
        }));
      }
      // Then the grounded, confirm-first action proposals (if any apply).
      if (proposedActions.length) {
        setConvos(prev => prev.map(c => {
          if (c.id !== convId) return c;
          return { ...c, messages: [...c.messages, { role: "actions", actions: proposedActions }] };
        }));
      }
      setBusy(false);
      abortRef.current = null;
    }
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

  // Run a confirmed action. Marks the proposal message done in-thread, then
  // delegates to App (which performs the real state change + audit log).
  const runAction = (action) => {
    if (onRunAction) onRunAction(action);
    const verifyId = uid();
    setConvos(prev => prev.map(c => {
      if (c.id !== activeId) return c;
      const msgs = c.messages.map(m =>
        (m.role === "actions" && m.actions.some(a => a.id === action.id && a.serverId === action.serverId) && !m.done)
          ? { ...m, done: { id: action.id, label: action.label, serverName: action.serverName } }
          : m
      );
      // Drop a pending verification marker right after — the assistant
      // proactively confirms the action landed instead of leaving the user
      // to wonder.
      return { ...c, messages: [...msgs, { role: "verify", id: verifyId, action, state: "pending" }] };
    }));

    // Wait for the action's effect to settle (App's fake state machine), then
    // re-check and resolve the marker. Delays mirror App's action timings.
    const delay = { stop: 700, open_ports: 800, start: 1900, restart: 1900, update: 1700 }[action.verb] || 1200;
    setTimeout(() => {
      const live = getServerState ? getServerState(action.serverId) : null;
      const result = KrystalChat ? KrystalChat.verifyAction(action, live) : { ok: true, headline: "Done.", lines: [] };
      setConvos(prev => prev.map(c => {
        if (c.id !== activeId) return c;
        return { ...c, messages: c.messages.map(m => m.role === "verify" && m.id === verifyId ? { ...m, state: "done", result } : m) };
      }));
    }, delay);
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
                      : m.role === "actions"
                        ? <ChatActions key={i} msg={m} onRun={runAction} />
                        : m.role === "verify"
                          ? <ChatVerify key={i} msg={m} />
                          : <ChatMessage key={i} msg={m} user={user} />
              )}
              {/* Follow-up chips beneath the latest assistant answer only. */}
              {!busy && (() => {
                const msgs = active.messages;
                const lastIdx = msgs.length - 1;
                const last = msgs[lastIdx];
                if (!last || last.role !== "assistant" || !last.content || last.error) return null;
                // Find the most recent user message to ground the suggestions.
                let lastUser = "";
                for (let j = lastIdx; j >= 0; j--) { if (msgs[j].role === "user") { lastUser = msgs[j].content; break; } }
                const server = serversStore.getState().list.find(s => s.id === scopeId) || null;
                const sugg = KrystalChat ? KrystalChat.suggestFollowups(lastUser, server) : [];
                const nav = KrystalChat ? KrystalChat.suggestNavigation(lastUser, server) : [];
                return (
                  <>
                    <ChatNavSuggestions suggestions={nav} onNavigate={onNavigate} />
                    <ChatFollowups suggestions={sugg} onPick={send} />
                  </>
                );
              })()}
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

export { ChatPage };
