import React from "react";
import { Icon } from "./Icon.jsx";
import { Select } from "./Select.jsx";

// LogConsole — a reusable log viewer dressed in the standard card chrome
// (.chat-brief). ONE source is shown at a time, chosen from a dropdown — we do
// NOT merge sources into a single stream. A "Live" pill sits on the right of
// the title. Pass `onSend` to enable a command input (game-server consoles);
// omit it for read-only system logs.
//
//   sources: [{ id, label, hint?, lines: [{ at, text, level? }] }]
//     at    — sortable ingest timestamp (ISO/epoch); shown normalized in the
//             gutter. text stays in the source's own format. level optional.
//   defaultSource: id to select first (defaults to the first source).
//   live:    show the Live pill.
//   order:   "desc" newest-first (default) | "asc" tail (newest at bottom).
//   onSend:  (text, sourceId) => void — when present, renders the command input.
function LogConsole({
  title = "Logs",
  icon = "scroll-text",
  sources = [],
  defaultSource,
  live = false,
  order = "desc",
  onSend,
  sendPlaceholder = "Type a command…",
  emptyText = "— no log lines —",
}) {
  const [sourceId, setSourceId] = React.useState(defaultSource || (sources[0] && sources[0].id));
  const [draft, setDraft] = React.useState("");
  const bodyRef = React.useRef(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- current is derived from props each render; the lines memo is a cheap best-effort and correctness doesn't need referential stability
  const current = sources.find(s => s.id === sourceId) || sources[0] || { lines: [] };

  const lines = React.useMemo(() => {
    const l = (current.lines || []).slice().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return order === "asc" ? l.reverse() : l;
  }, [current, order]);

  // Tail mode keeps the newest line in view.
  React.useEffect(() => {
    if (order === "asc" && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines.length, order, sourceId]);

  const fmtTs = (at) => {
    if (!at) return "";
    const d = new Date(at);
    return isNaN(d.getTime()) ? String(at) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  };

  const submit = (e) => {
    e.preventDefault();
    const v = draft.trim();
    if (!v || !onSend) return;
    onSend(v, sourceId);
    setDraft("");
  };

  return (
    <div className="chat-brief log-console">
      <div className="chat-brief__head">
        <span className="chat-brief__title"><Icon name={icon} size={13} /> {title}</span>
        {sources.length > 1 ? (
          <Select variant="chip" value={sourceId} onChange={e => setSourceId(e.target.value)}>
            {sources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        ) : (current.label ? <span className="log-console__single">{current.label}</span> : null)}
        <span className="log-console__spacer"></span>
        {live && <span className="log-console__live"><span className="log-console__live-dot"></span> Live</span>}
      </div>

      <div className="log-view log-console__view" ref={bodyRef}>
        {lines.length === 0 ? (
          <div className="log-empty">{emptyText}</div>
        ) : lines.map((l, i) => (
          <div className={"log-line2" + (l.level ? " log-line2--" + l.level : "")} key={i}>
            <span className="log-line2__ts">{fmtTs(l.at)}</span>
            <span className="log-line2__text">{l.text}</span>
          </div>
        ))}
      </div>

      {onSend && (
        <form className="log-console__input" onSubmit={submit}>
          <span className="log-console__prompt">&rsaquo;</span>
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={sendPlaceholder} spellCheck="false" />
          <button type="submit" className="log-console__send" disabled={!draft.trim()}>
            Send <Icon name="corner-down-left" size={13} strokeWidth={2.2} />
          </button>
        </form>
      )}
    </div>
  );
}

export { LogConsole };
