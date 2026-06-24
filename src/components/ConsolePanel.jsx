import React from "react";
import { Icon } from "./Icon.jsx";
import { api } from "../lib/apiClient.js";

// ConsolePanel — the server's stdout feed.
//
// A finite REST tail hydrates the scrollback (GET /servers/{id}/console?
// tail=N → { lines: [string] }, oldest-first), then the per-server WS topic
// servers/{id}/console follows live lines (console.line { id, seq, line }). The
// console is FOLLOW-ONLY upstream (#8) — there is no command-send channel — so the
// input is replaced with an honest read-only note (for everyone, not a
// permission thing).

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
  const lines = React.useMemo(
    () => (live ? (liveLines || []) : [...((server && server.log) || []), ...extraLines]),
    [live, liveLines, server, extraLines]
  );
  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines.length]);
  const loading = live && liveLines == null;
  return (
    <section className="console-card">
      <div className="console-card__head">
        <span className="console-card__title">
          <Icon name="terminal-square" size={14} strokeWidth={2} />
          Console
        </span>
        <span className="console-card__live">Live</span>
        <span className="console-card__count">{loading ? "connecting…" : lines.length + " lines"}</span>
      </div>
      <div className="console-card__body" ref={bodyRef}>
        {loading ? <div className="ln" style={{ color: "var(--fg-3)" }}>Loading console…</div> : lines.map(renderLine)}
      </div>
      {live ? (
        <div className="console-card__readonly">
          <Icon name="terminal-square" size={12} /> Live stdout · read-only (no command channel yet)
        </div>
      ) : readOnly ? (
        <div className="console-card__readonly">
          <Icon name="lock" size={12} /> Read-only — you don’t have permission to send console commands.
        </div>
      ) : (
        <form className="console-card__input" onSubmit={e => e.preventDefault()}>
          <input placeholder="Type a console command (e.g. say hello, kick player)…" />
          <button type="submit">Send</button>
        </form>
      )}
    </section>
  );
}

export { ConsolePanel };
