import React from "react";
import { Icon } from "./Icon.jsx";

// ConsolePanel — live log feed with timestamps + severity tags + input.

function renderLine(line, idx) {
  // §...§ wrapping = teal highlight (player names, world names).
  const parts = line.text.split(/§([^§]+)§/g).map((p, i) =>
    i % 2 === 1 ? <span key={i} className="tag-player">{p}</span> : p
  );
  const tagEl = line.tag ? (
    <span className={"tag-" + line.tag}>[{line.tag}]</span>
  ) : null;
  return (
    <div className="ln" key={idx}>
      <span className="ts">{line.ts}</span>
      <span>{tagEl}{tagEl && " "}{parts}</span>
    </div>
  );
}

function ConsolePanel({ server, extraLines = [], readOnly }) {
  const bodyRef = React.useRef(null);
  const lines = React.useMemo(() => [...server.log, ...extraLines], [server, extraLines]);
  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines.length]);
  return (
    <section className="console-card">
      <div className="console-card__head">
        <span className="console-card__title">
          <Icon name="terminal-square" size={14} strokeWidth={2} />
          Console
        </span>
        <span className="console-card__live">Live</span>
        <span className="console-card__count">{lines.length} lines</span>
      </div>
      <div className="console-card__body" ref={bodyRef}>
        {lines.map(renderLine)}
      </div>
      {readOnly ? (
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
