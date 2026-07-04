// chat utilities — pure functions, constants, and helpers used by ChatPage and
// its sub-modules. No React state, no component deps (except renderMarkdown
// which returns JSX from plain data).

import React from "react";
import { commandMeta, COMMAND_META, API_COMMAND_VERBS } from "./chatConstants.js";

const CHAT_LS_KEY      = "krystal:chat:conversations";
const CHAT_ACTIONS_LS  = "krystal:chat:actions";
const CHAT_THINK_LS    = "krystal:chat:think";

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

// ---------- command verified (compose client-side from M3 job outcome) ----------
const VERB_PAST = { start: "Started", stop: "Stopped", restart: "Restarted" };
function composeVerified(verb, serverName, settled) {
  const s = settled || {};
  if (s.status === "unknown") {
    return { ok: false, headline: "Couldn\u2019t confirm \u2014 no response from the host yet. Check the server.", lines: [] };
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
    headline: "Couldn\u2019t " + what + serverName + ".",
    lines: err ? [{ status: "fail", label: "Error", detail: String(err) }] : [],
  };
}

// ---------- tool.result → evidence card projection ----------
const HEALTH_CHECK_LABELS = {
  liveness: "Server",
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
      if (!d || !Array.isArray(d.checks)) return null;
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
        serverName: id || "this server",
        confidence: card.confidence || null,
        checks,
        passes: typeof d.passed === "number" ? d.passed : checks.filter(c => c.status === "pass").length,
        fails,
        warns,
      };
    }
    case "get_status": {
      const d = card.data;
      if (!d || !Array.isArray(d.servers)) return null;
      const TONE = { running: "success", stopped: "idle", unknown: "warn" };
      const servers = d.servers.map(s => {
        const state = String(s.state || "unknown").toLowerCase();
        const known = Object.prototype.hasOwnProperty.call(TONE, state);
        return {
          instance: s.instance || "\u2014",
          state: known ? state : "unknown",
          tone: known ? TONE[state] : "warn",
          reason: s.reason || null,
        };
      });
      const parts = [];
      if (typeof d.running === "number") parts.push(d.running + " running");
      if (typeof d.stopped === "number") parts.push(d.stopped + " stopped");
      if (d.unavailable) parts.push(d.unavailable + " unavailable");
      return {
        kind: "fleet",
        confidence: card.confidence || null,
        summary: parts.join(" \u00b7 ") || (servers.length + " server" + (servers.length === 1 ? "" : "s")),
        servers,
      };
    }
    default:
      return null;
  }
}

// ---------- SSE frame reducer ----------
function reduceTurnFrame(messages, ev) {
  const msgs = messages.slice();
  const lastIdx = msgs.length - 1;
  const bubble = msgs[lastIdx];
  if (!bubble || bubble.role !== "assistant") return messages;
  switch (ev.type) {
    case "text.delta":
      msgs[lastIdx] = { ...bubble, content: (bubble.content || "") + (ev.text || "") };
      break;
    case "thinking.delta":
      msgs[lastIdx] = { ...bubble, thinking: (bubble.thinking || "") + (ev.text || "") };
      break;
    case "tool.start": {
      const startTools = (bubble.tools || []).concat({ id: ev.id, label: toolLabel(ev.tool), state: "pending" });
      msgs[lastIdx] = { ...bubble, tools: startTools };
      break;
    }
    case "tool.result": {
      const resTools = (bubble.tools || []).slice();
      for (let k = resTools.length - 1; k >= 0; k--) {
        if (resTools[k].id === ev.id && resTools[k].state === "pending") {
          resTools[k] = { ...resTools[k], state: "done", summary: ev.summary || "" };
          break;
        }
      }
      let next = { ...bubble, tools: resTools };
      if (ev.result) {
        const card = adaptResultCard(ev.result);
        if (card) next = { ...next, cards: (bubble.cards || []).concat(card) };
      }
      msgs[lastIdx] = next;
      break;
    }
    case "error": {
      const note = "\u26a0\ufe0f " + (ev.message || "The assistant failed.");
      msgs[lastIdx] = bubble.content
        ? { ...bubble, content: bubble.content + "\n\n_" + note + "_" }
        : { ...bubble, content: note, error: true };
      break;
    }
    case "command.proposed":
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
      if (ev.text || ev.usage) {
        let done = bubble;
        if (ev.text) done = { ...done, content: ev.text };
        if (ev.usage) done = { ...done, usage: ev.usage };
        msgs[lastIdx] = done;
      }
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
      break;
  }
  return msgs;
}

// ---------- conversation history rebuild ----------
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
    if (t.usage) bubble.usage = t.usage;
    const tools = Array.isArray(t.tools)
      ? t.tools.map((tl, ti) => ({ id: "h" + ei + "_" + ti, label: toolLabel(tl.tool), state: "done", summary: tl.summary || "" }))
      : [];
    if (tools.length) bubble.tools = tools;
    const cards = Array.isArray(t.tools)
      ? t.tools.map(tl => (tl && tl.result ? adaptResultCard(tl.result) : null)).filter(Boolean)
      : [];
    if (cards.length) bubble.cards = cards;
    if (!t.final && t.outcome && t.outcome !== "ok") { bubble.content = "\u26a0\ufe0f This turn didn\u2019t complete."; bubble.error = true; }
    out.push(bubble);
  });
  return out;
}

function latestUsage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "assistant" && m.usage) return m.usage;
  }
  return null;
}

function mergeServerConversations(local, serverList, hostId) {
  if (!Array.isArray(serverList) || serverList.length === 0) return local;
  const byId = new Map(local.map(c => [c.id, c]));
  const merged = local.slice();
  for (const s of serverList) {
    if (!s || !s.id) continue;
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

export {
  CHAT_LS_KEY, CHAT_ACTIONS_LS, CHAT_THINK_LS, TOGGLE_COPY,
  loadConversations, saveConversations, loadSetting, saveSetting,
  uid, toolLabel, composeVerified, adaptResultCard,
  reduceTurnFrame, scaffoldHistory, latestUsage, mergeServerConversations,
  renderMarkdown,
};
