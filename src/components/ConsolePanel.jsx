import React from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.jsx";
import { api } from "../lib/apiClient.js";
import { sendConsoleInput } from "../lib/stores.js";
import { serverOperable } from "../lib/persona.js";

// ConsolePanel — the server's stdout feed + command input.
//
// A finite REST tail hydrates the scrollback (GET /servers/{id}/console?
// tail=N → { lines: [string] }, oldest-first), then the per-server WS topic
// servers/{id}/console follows live lines (console.line { id, seq, line }).
//
// The input sends an arbitrary console command (POST /servers/{id}/console) to a
// running NATIVE server; the response, if any, streams back on the same WS topic
// (no local echo — we never fabricate console output, only show real stdout). The
// input is shown only to operators on native servers; otherwise an honest read-only
// note explains why (container / no permission).

// Non-"Live" pill copy, keyed by the FE run-state vocabulary (online maps to
// "Live" directly; anything missing falls back to "Unknown").
const PILL_LABEL = {
  offline: "Offline",
  crashed: "Crashed",
  updating: "Updating",
  installing: "Installing",
  error: "Error",
  unknown: "Unknown",
};

function renderLine(line, idx) {
  // §...§ wrapping = teal highlight (player names, world names). A stdout line is
  // a raw string with no ts/tag; a structured line carries { ts, tag, text }.
  const text = typeof line === "string" ? line : (line.text || "");
  const parts = text.split(/§([^§]+)§/g).map((p, i) =>
    i % 2 === 1 ? <span key={i} className="tag-player">{p}</span> : p
  );
  const tag = typeof line === "object" ? line.tag : null;
  const ts = typeof line === "object" ? line.ts : null;
  const tagEl = tag ? (<span className={"tag-" + tag}>[{tag}]</span>) : null;
  return (
    <div className="ln" key={idx}>
      {ts ? <span className="ts">{ts}</span> : null}
      <span>{tagEl}{tagEl && " "}{parts}</span>
    </div>
  );
}

// Live scrollback hook: REST tail then WS follow. Subscribes FIRST and buffers
// live lines, so a frame that arrives during the REST round-trip can't land
// before the tail (ordering: tail, then buffered live, then ongoing). Dedups WS
// frames by seq. Returns null until hydrated so the panel can show "connecting".
function useLiveConsole(server) {
  const [lines, setLines] = React.useState(null);
  React.useEffect(() => {
    if (!server) return;
    let alive = true, hydrated = false;
    const tail = [];          // REST scrollback (strings, no seq)
    const follow = [];        // live WS lines, in arrival order
    const seen = new Set();
    const flush = () => { if (alive) setLines([...tail, ...follow]); };
    const client = (server.hostId && api.host) ? api.host(server.hostId) : api;
    // Subscribe first so nothing emitted during hydrate is lost; buffer until tail lands.
    const dispose = api.stream.subscribe(["servers/" + server.id + "/console"], (m) => {
      if (!alive || !m || m.type !== "console.line" || !m.data) return;
      const { seq, line } = m.data;
      if (seq != null) { if (seen.has(seq)) return; seen.add(seq); }
      follow.push(line);
      if (hydrated) flush();
    });
    client.get("/servers/" + server.id + "/console?tail=200").then(
      (res) => { (res && res.lines || []).forEach((l) => tail.push(l)); hydrated = true; flush(); },
      () => { hydrated = true; flush(); }   // no scrollback (watchdog down / non-native) — live follow still works
    );
    return () => { alive = false; dispose(); };   // unsubscribe re-idles the backend's console bridge
  }, [server && server.id, server && server.hostId]);
  return lines;
}

function ConsolePanel({ server, extraLines = [], readOnly }) {
  const bodyRef = React.useRef(null);
  const live = !!server;
  const liveLines = useLiveConsole(live ? server : null);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState(null);

  // Full-screen pop-out for the whole console card — the inline card is capped
  // (max-height: 420px) so a long scrollback / a busy live feed is cramped.
  // Transient view state, not persisted; reset when the server changes. Esc /
  // scrim-click / the head toggle close it. Mirrors the Files tab pop-out.
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => { setExpanded(false); }, [server && server.id, server && server.hostId]);
  React.useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);
  const lines = React.useMemo(
    () => (live ? (liveLines || []) : [...((server && server.log) || []), ...extraLines]),
    [live, liveLines, server, extraLines]
  );
  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines.length]);
  const loading = live && liveLines == null;

  // The pill reflects the server's RUN-STATE, not a hardcoded "Live". The feed
  // follows live stdout only while the process is actually running; offline /
  // crashed / updating / unknown have nothing live to follow, so the pill drops
  // its green pulse and names the real state instead of dishonestly claiming "Live".
  const isRunning = live && server.status === "online";
  const pill = isRunning
    ? { label: "Live", live: true }
    : { label: PILL_LABEL[live ? server.status : "unknown"] || "Unknown", live: false };

  // The command channel is native-only (the watchdog owns a native process's stdin;
  // Docker owns a container's), needs operator permission ON THIS host, requires the
  // server to actually be running (you can't pipe stdin to a process that isn't
  // there), and is hidden in a forced read-only view (the player tab). The backend
  // re-checks all of this — this only decides whether to show the input vs. an
  // honest note explaining why it's unavailable.
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

  // When the input is hidden, say why (only meaningful for a live server). Order
  // by precedence of the blocking reason: structural (container) → permission →
  // run-state. The offline note only shows when the user could otherwise send
  // (operator on a native server) but the process isn't running.
  const note = !live ? null
    : !isNative ? { icon: "terminal-square", text: "Console input isn’t available for container servers — Docker owns their console." }
    : !serverOperable(server) ? { icon: "lock", text: "Read-only — you don’t have permission to send console commands." }
    : !isRunning ? { icon: "power-off", text: server.status === "unknown"
        ? "Console input is unavailable — the server’s state can’t be confirmed."
        : "Console input is unavailable while the server is offline — start it to send commands." }
    : null;

  // The console card, defined once so the SAME element renders either inline or
  // inside the full-screen pop-out modal below — only one is live at a time.
  const consoleBody = (
    <section className="console-card">
      <div className="console-card__head">
        <span className="console-card__title">
          <Icon name="terminal-square" size={14} strokeWidth={2} />
          Console
        </span>
        <span className={"console-card__live" + (pill.live ? "" : " console-card__live--idle")}>{pill.label}</span>
        <span className="console-card__count">{loading ? "connecting…" : lines.length + " lines"}</span>
        <button type="button" className="console-card__expand" onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Exit full screen (Esc)" : "Expand to full screen"}
          aria-label={expanded ? "Exit full screen" : "Expand to full screen"}>
          <Icon name={expanded ? "minimize-2" : "maximize-2"} size={14} />
        </button>
      </div>
      <div className="console-card__body" ref={bodyRef}>
        {loading ? <div className="ln" style={{ color: "var(--fg-3)" }}>Loading console…</div> : lines.map(renderLine)}
      </div>
      {canSend ? (
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
      ) : null}
    </section>
  );

  // Expand lifts the whole console card into a full-screen pop-out so a long
  // scrollback / busy live feed isn't capped. While popped, the inline slot
  // keeps a quiet placeholder and the real card lives in the portal below
  // (portaled to <body>, not promoted in place: .app__main is a container-type
  // ancestor that would otherwise clip a fixed child — same as the Files tab).
  return (
    <>
      {expanded ? (
        <section className="console-card">
          <div className="console-card__placeholder">
            <Icon name="maximize-2" size={24} strokeWidth={1.6} />
            <div style={{ fontSize: 13 }}>Console is in full screen.</div>
            <button type="button" className="console-card__restore" onClick={() => setExpanded(false)}>
              <Icon name="minimize-2" size={13} /> Restore
            </button>
          </div>
        </section>
      ) : consoleBody}
      {expanded && createPortal(
        <div className="console-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setExpanded(false); }}>
          <div className="console-modal" role="dialog" aria-modal="true" aria-label="Console">
            {consoleBody}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export { ConsolePanel };
