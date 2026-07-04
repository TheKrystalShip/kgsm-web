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
  installing: "Installing",
  error: "Error",
  unknown: "Unknown",
};

// Live scrollback hook: REST tail then WS follow. Subscribes FIRST and buffers live lines, so a
// frame that arrives during the REST round-trip can't land before the tail (ordering: tail, then
// buffered live, then ongoing). Dedups WS frames by seq. Each live line is stamped with its arrival
// time ({ at, text }); scrollback stays a raw string (no honest time). Returns null until hydrated.
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
    // Subscribe first so nothing emitted during hydrate is lost; buffer until tail lands.
    const dispose = api.stream.subscribe(["servers/" + server.id + "/console"], (m) => {
      if (!alive || !m || m.type !== "console.line" || !m.data) return;
      const { seq, line } = m.data;
      if (seq != null) { if (seen.has(seq)) return; seen.add(seq); }
      follow.push({ at: Date.now(), text: line });   // observed-at timestamp for the live line
      if (hydrated) flush();
    });
    api.host(server.hostId).get("/servers/" + server.id + "/console?tail=200").then(
      (res) => { (res && res.lines || []).forEach((l) => tail.push(l)); hydrated = true; flush(); },
      () => { hydrated = true; flush(); }   // no scrollback (watchdog down / non-native) — live follow still works
    );
    return () => { alive = false; dispose(); };   // unsubscribe re-idles the backend's console bridge
  }, [server && server.id, server && server.hostId]);
  return lines;
}

function ConsolePanel({ server, extraLines = [], readOnly }) {
  const live = !!server;
  const liveLines = useLiveConsole(live ? server : null);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState(null);

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
          onChange={e => { setDraft(e.target.value); if (err) setErr(null); }}
          placeholder="Type a console command (e.g. say hello, kick player)…"
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
