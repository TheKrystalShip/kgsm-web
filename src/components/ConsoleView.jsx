import React from "react";
import { Icon } from "./Icon.jsx";
import { Modal } from "./Modal.jsx";
import { Select } from "./Select.jsx";

// fmtClock — a wall-clock HH:MM:SS from an ISO string or epoch ms; "" for absent/garbage
// (never a fabricated time). Game stdout lines carry no time, so the live feed stamps each
// line with the moment it ARRIVED (observed-at); host logs carry the real journald `at`.
function fmtClock(at) {
  if (at == null) return "";
  const d = new Date(at);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

// renderLine — one console row. Accepts a raw stdout STRING (game scrollback) or a structured
// line { at?, ts?, tag?, level?, text }. With `tsMode` the left gutter is reserved (so timestamped
// and un-timestamped lines align); §…§ wraps a teal highlight (player/world names); `level`/`tag`
// tint the row.
function renderLine(line, idx, tsMode) {
  const obj = typeof line === "object" && line !== null;
  const text = obj ? (line.text || "") : String(line);
  const ts = obj ? (line.ts != null ? line.ts : fmtClock(line.at)) : "";
  const tag = obj ? line.tag : null;
  const level = obj ? line.level : null;
  const parts = text.split(/§([^§]+)§/g).map((p, i) =>
    i % 2 === 1 ? <span key={i} className="tag-player">{p}</span> : p
  );
  const tagEl = tag ? <span className={"tag-" + tag}>[{tag}]</span> : null;
  return (
    <div className={"ln" + (level ? " ln--" + level : "")} key={idx}>
      {tsMode ? <span className="ts">{ts}</span> : null}
      <span className="ln__text">{tagEl}{tagEl && " "}{parts}</span>
    </div>
  );
}

// ConsoleView — the shared console card (chrome + body + the full-screen pop-out). BOTH the
// game-server console (ConsolePanel) and the host-logs tab (DiagLogs) render through this, so they
// look identical — including the left-hand timestamp gutter.
//
//   lines    — strings or { at?, ts?, tag?, level?, text }, OLDEST-FIRST (newest at the bottom, tail).
//   sources  — optional [{ id, label, lines }] → a source dropdown in the head; the selected source's
//              lines are shown (overrides `lines`). A single source shows a quiet label, none = no chip.
//   pill     — optional { label, live } run-state / Live pill.
//   count    — optional line count for the head ("N lines"); `loading` shows "connecting…".
//   footer   — optional node under the body (a command input / a read-only note).
//   resetKey — when it changes, the full-screen pop-out collapses (a server / host switch).
function ConsoleView({
  title = "Console", icon = "terminal-square",
  lines = [], sources, pill, count, loading = false,
  footer = null, emptyText = "— no output —", resetKey,
}) {
  const bodyRef = React.useRef(null);
  const [sourceId, setSourceId] = React.useState(sources && sources[0] && sources[0].id);
  const [expanded, setExpanded] = React.useState(false);

  // Keep the source selection valid as the set changes; collapse the pop-out on a context switch.
  React.useEffect(() => {
    if (sources && sources.length && !sources.some(s => s.id === sourceId)) setSourceId(sources[0].id);
  }, [sources, sourceId]);
  React.useEffect(() => { setExpanded(false); }, [resetKey]);

  const current = sources ? (sources.find(s => s.id === sourceId) || sources[0]) : null;
  const shown = current ? (current.lines || []) : lines;
  const shownCount = count != null ? count : shown.length;
  // Reserve the timestamp gutter only when something in view is timestamped — so a plain stdout
  // tail (no times yet) isn't indented under an empty column, but a live/host-log feed aligns.
  const tsMode = shown.some(l => typeof l === "object" && l !== null && (l.at != null || l.ts != null));

  // Tail: keep the newest (bottom) line in view as lines arrive / the source changes.
  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [shown.length, sourceId]);

  const body = (
    <section className="console-card">
      <div className="console-card__head">
        <span className="console-card__title"><Icon name={icon} size={13} /> {title}</span>
        {sources && sources.length > 1 ? (
          <Select variant="chip" value={sourceId} onChange={e => setSourceId(e.target.value)}>
            {sources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        ) : (sources && sources[0] && sources[0].label ? <span className="console-card__single">{sources[0].label}</span> : null)}
        {pill ? <span className={"console-card__live" + (pill.live ? "" : " console-card__live--idle")}>{pill.label}</span> : null}
        <span className="console-card__count">{loading ? "connecting…" : shownCount + " lines"}</span>
        <button type="button" className="console-card__expand" onClick={() => setExpanded(v => !v)}
          title={expanded ? "Exit full screen (Esc)" : "Expand to full screen"}
          aria-label={expanded ? "Exit full screen" : "Expand to full screen"}>
          <Icon name={expanded ? "minimize-2" : "maximize-2"} size={14} />
        </button>
      </div>
      <div className={"console-card__body" + (tsMode ? " console-card__body--ts" : "")} ref={bodyRef}>
        {loading ? <div className="ln" style={{ color: "var(--fg-3)" }}>Loading console…</div>
          : shown.length === 0 ? <div className="ln" style={{ color: "var(--fg-3)" }}>{emptyText}</div>
            : shown.map((l, i) => renderLine(l, i, tsMode))}
      </div>
      {footer}
    </section>
  );

  // Expand lifts the whole card into a full-screen pop-out (portaled to <body>, not promoted in
  // place — .app__main is a container-type ancestor that would clip a fixed child). The inline slot
  // keeps a quiet placeholder behind the scrim. Same pattern as the Files tab.
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
      ) : body}
      {expanded && (
        <Modal onClose={() => setExpanded(false)} scrimClassName="console-modal-scrim">
          <div className="console-modal" role="dialog" aria-modal="true" aria-label={title}>
            {body}
          </div>
        </Modal>
      )}
    </>
  );
}

export { ConsoleView, renderLine };
