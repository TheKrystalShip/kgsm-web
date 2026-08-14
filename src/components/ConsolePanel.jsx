import React from "react";
import { Icon } from "./Icon.jsx";
import { ConsoleView } from "./ConsoleView.jsx";
import { api } from "../lib/apiClient.js";
import { sendConsoleInput } from "../lib/stores.js";
import { serverOperable } from "../lib/persona.js";

// ConsolePanel — the server's stdout feed + command input, rendered through the shared
// ConsoleView (the same card the host-logs tab uses, so they look identical).
//
// A finite REST tail hydrates the scrollback (GET /servers/{id}/console?tail=N →
// { lines: [string] }, oldest-first), then the per-server WS topic servers/{id}/console
// follows live lines (console.line { id, seq, line }).
//
// A game stdout line carries no timestamp, so each LIVE line is stamped with the moment it
// arrived (observed-at) — honest, never fabricated; scrollback stays un-timed (the gutter is
// reserved once any line is timed, so the two align). The host-logs feed uses the real journald
// time instead — same gutter, same card.
//
// The input sends an arbitrary console command (POST /servers/{id}/console) to a running NATIVE
// server; the response, if any, streams back on the same WS topic (no local echo — we never
// fabricate console output, only show real stdout). The input is shown only to operators on native
// servers; otherwise an honest read-only note explains why (container / no permission).

// Non-"Live" pill copy, keyed by the FE run-state vocabulary (online maps to "Live" directly;
// anything missing falls back to "Unknown").
const PILL_LABEL = {
  offline: "Offline",
  crashed: "Crashed",
  updating: "Updating",
  stopping: "Stopping",
  restarting: "Restarting",
  installing: "Installing",
  "backing-up": "Backing up",
  restoring: "Restoring",
  error: "Error",
  unknown: "Unknown",
};

// The scrollback is a WINDOW, not a transcript: the feed follows for as long as the panel is open,
// so an uncapped buffer grows without limit and every arriving line re-renders all of it. The
// newest MAX_LINES are kept and the oldest fall off — the console is a tail, and the durable
// record of what a server printed is the server's own log on disk, not this card.
const MAX_LINES = 1000;

// Sent-command recall, per server, in this browser. Capped because it is a convenience, not a record.
const HISTORY_MAX = 50;
const historyKey = (server) => "krystal:console:history:" + (server && server.hostId) + ":" + (server && server.id);

function loadHistory(server) {
  if (!server || !server.id) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(historyKey(server)) || "[]");
    return Array.isArray(parsed) ? parsed.filter(h => typeof h === "string" && h) : [];
  } catch { return []; }   // unreadable / disabled storage is no history, never a broken console
}

function saveHistory(server, list) {
  if (!server || !server.id) return;
  try { localStorage.setItem(historyKey(server), JSON.stringify(list)); } catch { /* full or blocked — recall is best-effort */ }
}

// Live scrollback hook: REST tail then WS follow. Subscribes FIRST and buffers live lines, so a
// frame that arrives during the REST round-trip can't land before the tail (ordering: tail, then
// buffered live, then ongoing). Dedups WS frames by seq. Each live line is stamped with its arrival
// time ({ at, seq, text }); scrollback stays a raw string (no honest time). Returns null until
// hydrated.
function useLiveConsole(server) {
  const [lines, setLines] = React.useState(null);
  React.useEffect(() => {
    if (!server) return;
    if (!server.hostId) return;
    let alive = true, hydrated = false;
    const tail = [];          // REST scrollback (strings, no seq, no time)
    const follow = [];        // live WS lines, in arrival order, stamped with observed-at
    const seen = new Set();
    const flush = () => { if (alive) setLines([...tail, ...follow]); };
    // Drop the oldest lines down to the cap, scrollback first (it is the older half by
    // construction). A dropped line's seq leaves `seen` with it, so the dedup set stays the size of
    // what's retained instead of becoming the unbounded thing the buffer no longer is.
    const trim = () => {
      let over = tail.length + follow.length - MAX_LINES;
      if (over <= 0) return;
      if (tail.length) { const n = Math.min(over, tail.length); tail.splice(0, n); over -= n; }
      if (over > 0) for (const dropped of follow.splice(0, over)) if (dropped.seq != null) seen.delete(dropped.seq);
    };
    // Subscribe first so nothing emitted during hydrate is lost; buffer until tail lands.
    const dispose = api.stream.subscribe(["servers/" + server.id + "/console"], (m) => {
      if (!alive || !m || m.type !== "console.line" || !m.data) return;
      const { seq, line } = m.data;
      if (seq != null) { if (seen.has(seq)) return; seen.add(seq); }
      follow.push({ at: Date.now(), seq, text: line });   // observed-at timestamp for the live line
      trim();
      if (hydrated) flush();
    });
    api.host(server.hostId).get("/servers/" + server.id + "/console?tail=200").then(
      (res) => { (res && res.lines || []).forEach((l) => tail.push(l)); hydrated = true; trim(); flush(); },
      () => { hydrated = true; trim(); flush(); }   // no scrollback (watchdog down / non-native) — live follow still works
    );
    return () => { alive = false; dispose(); };   // unsubscribe re-idles the backend's console bridge
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only server.id/hostId are used (and in deps); the object churns each render, so depping it would resubscribe constantly
  }, [server && server.id, server && server.hostId]);
  return lines;
}

function ConsolePanel({ server, extraLines = [], readOnly }) {
  const live = !!server;
  const liveLines = useLiveConsole(live ? server : null);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState(null);

  // ↑/↓ recall what has been sent to THIS server. Kept per (host, server) because the commands a
  // console takes are the game's, not the operator's — a Minecraft `/kick` recalled into a Factorio
  // console is noise. This browser's own record: the authoritative one is kgsm-api's audit log,
  // which records every command with its actor, including the ones sent from somewhere else.
  const [history, setHistory] = React.useState(() => loadHistory(server));
  const [histAt, setHistAt] = React.useState(-1);   // -1 = the live draft, 0 = the most recent command
  const draftRef = React.useRef("");                // what was being typed before stepping back into history
  React.useEffect(() => {
    setHistory(loadHistory(server)); setHistAt(-1); draftRef.current = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the identity of the server, not the row object, which churns every render
  }, [server && server.id, server && server.hostId]);

  const recall = (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    if (!history.length) return;
    // Already back at the live draft — ↓ is an ordinary caret key again, and must not overwrite
    // what is being typed with a draft held from before the last edit.
    if (e.key === "ArrowDown" && histAt === -1) return;
    e.preventDefault();
    if (e.key === "ArrowUp") {
      if (histAt === -1) draftRef.current = draft;   // hold the half-typed command to come back to
      const at = Math.min(histAt + 1, history.length - 1);
      setHistAt(at); setDraft(history[at]);
      return;
    }
    const at = histAt - 1;
    if (at < 0) { setHistAt(-1); setDraft(draftRef.current); }
    else { setHistAt(at); setDraft(history[at]); }
  };

  const lines = React.useMemo(
    () => (live ? (liveLines || []) : [...((server && server.log) || []), ...extraLines]),
    [live, liveLines, server, extraLines]
  );
  const loading = live && liveLines == null;

  // The pill reflects the server's RUN-STATE, not a hardcoded "Live". The feed follows live stdout
  // only while the process is actually running; offline / crashed / updating / unknown have nothing
  // live to follow, so the pill drops its green pulse and names the real state.
  const isRunning = live && server.status === "online";
  const pill = isRunning
    ? { label: "Live", live: true }
    : { label: PILL_LABEL[live ? server.status : "unknown"] || "Unknown", live: false };

  // The command channel is native-only (the watchdog owns a native process's stdin; Docker owns a
  // container's), needs operator permission ON THIS host, requires the server to actually be running,
  // and is hidden in a forced read-only view (the player tab). The backend re-checks all of this —
  // this only decides whether to show the input vs. an honest note explaining why it's unavailable.
  const isNative = live && server.runtime === "native";
  const canSend = live && !readOnly && isNative && isRunning && serverOperable(server);

  const submit = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setErr(null);
    // Recorded on SEND, not on the 202: a command the engine refused because the server had just
    // stopped is exactly the one worth pressing ↑ for.
    setHistory((prev) => {
      const next = [text, ...prev.filter(h => h !== text)].slice(0, HISTORY_MAX);
      saveHistory(server, next);
      return next;
    });
    setHistAt(-1); draftRef.current = "";
    sendConsoleInput(server, text).then(
      () => { setDraft(""); setSending(false); },   // delivered — the response streams in live
      (e2) => { setSending(false); setErr((e2 && (e2.userMessage || e2.message)) || "Couldn't send the command."); }
    );
  };

  // When the input is hidden, say why (only meaningful for a live server). Order by precedence of the
  // blocking reason: structural (container) → permission → run-state.
  const note = !live ? null
    : !isNative ? { icon: "terminal-square", text: "Console input isn’t available for container servers — Docker owns their console." }
    : !serverOperable(server) ? { icon: "lock", text: "Read-only — you don’t have permission to send console commands." }
    : !isRunning ? { icon: "power-off", text: server.status === "unknown"
        ? "Console input is unavailable — the server’s state can’t be confirmed."
        : "Console input is unavailable while the server is offline — start it to send commands." }
    : null;

  // The footer (input or read-only note) renders inside the card, below the body — so the
  // full-screen pop-out (owned by ConsoleView) carries it too.
  const footer = canSend ? (
    <>
      <form className="console-card__input" onSubmit={submit}>
        <input
          value={draft}
          onChange={e => { setDraft(e.target.value); setHistAt(-1); if (err) setErr(null); }}
          onKeyDown={recall}
          placeholder="Type a console command (e.g. say hello, kick player)…"
          title={history.length ? "↑ / ↓ recalls the commands you've sent to this server" : undefined}
          spellCheck="false"
          disabled={sending}
        />
        <button type="submit" disabled={!draft.trim() || sending}>Send</button>
      </form>
      {err ? (
        <div className="console-card__error" role="alert">
          <Icon name="triangle-alert" size={12} /> {err}
        </div>
      ) : null}
    </>
  ) : note ? (
    <div className="console-card__readonly">
      <Icon name={note.icon} size={12} /> {note.text}
    </div>
  ) : null;

  return (
    <ConsoleView
      title="Console"
      lines={lines}
      pill={pill}
      loading={loading}
      footer={footer}
      resetKey={(server && server.id) + "@" + (server && server.hostId)}
    />
  );
}

export { ConsolePanel };
