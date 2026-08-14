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

// A line is either a raw stdout STRING (game scrollback) or { id?, seq?, at?, ts?, tag?, level?, text }.
const lineText = (line) => (typeof line === "object" && line !== null ? (line.text || "") : String(line));

// The line's OWN identity where it has one — the journald cursor (`id`) or the console bridge's
// sequence (`seq`) — falling back to the index for a bare scrollback string. These feeds are capped
// windows that drop their oldest lines, which shifts every index by one: keyed on the index, a
// single arriving line rewrites the text of all thousand rows instead of appending one. It is also
// what lets the view hold a row still while the top is trimmed, and count what arrived unread.
function lineKey(line, idx) {
  if (typeof line !== "object" || line === null) return idx;
  if (line.id != null) return "i" + line.id;
  if (line.seq != null) return "s" + line.seq;
  return idx;
}

// Split a string around every case-insensitive occurrence of `q` → [{ s, hit }].
function splitQuery(s, q) {
  const out = [];
  const low = s.toLowerCase();
  let i = 0;
  for (;;) {
    const at = low.indexOf(q, i);
    if (at < 0) { if (i < s.length) out.push({ s: s.slice(i), hit: false }); break; }
    if (at > i) out.push({ s: s.slice(i, at), hit: false });
    out.push({ s: s.slice(at, at + q.length), hit: true });
    i = at + q.length;
  }
  return out;
}

// decorate — the line's text as nodes: §…§ wraps a teal highlight (player/world names the engine
// marked), and the find query marks its own hits inside whatever those segments are.
function decorate(text, q) {
  return text.split(/§([^§]+)§/g).map((seg, i) => {
    const inner = q
      ? splitQuery(seg, q).map((p, j) => (p.hit ? <mark key={j} className="ln__hit">{p.s}</mark> : p.s))
      : seg;
    return i % 2 === 1
      ? <span key={i} className="tag-player">{inner}</span>
      : <React.Fragment key={i}>{inner}</React.Fragment>;
  });
}

// renderLine — one console row. With `tsMode` the left gutter is reserved (so timestamped and
// un-timestamped lines align); `level`/`tag` tint the row. `currentKey` marks the find's active hit.
function renderLine(line, idx, tsMode, q, currentKey) {
  const obj = typeof line === "object" && line !== null;
  const ts = obj ? (line.ts != null ? line.ts : fmtClock(line.at)) : "";
  const tag = obj ? line.tag : null;
  const level = obj ? line.level : null;
  const key = lineKey(line, idx);
  const tagEl = tag ? <span className={"tag-" + tag}>[{tag}]</span> : null;
  const cls = "ln" + (level ? " ln--" + level : "")
    + (currentKey != null && String(key) === String(currentKey) ? " ln--hit-current" : "");
  return (
    <div className={cls} key={key} data-k={key}>
      {tsMode ? <span className="ts">{ts}</span> : null}
      <span className="ln__text">{tagEl}{tagEl && " "}{decorate(lineText(line), q)}</span>
    </div>
  );
}

// How many lines sit after the one the reader last saw. The marked line having been trimmed away
// means everything in view arrived since — never a fabricated 0.
function countAfter(arr, key) {
  if (key == null) return 0;
  for (let i = arr.length - 1; i >= 0; i--) if (String(lineKey(arr[i], i)) === String(key)) return arr.length - 1 - i;
  return arr.length;
}

// A selector-safe form of a line key (they are engine-issued — a journald cursor carries `;` and `=`).
const keySel = (k) => (window.CSS && CSS.escape ? CSS.escape(String(k)) : String(k));

// Slack at the bottom that still counts as "following" — a fractional scroll height, or a click that
// lands a pixel short, must not read as the reader having deliberately scrolled away.
const NEAR_BOTTOM = 24;

// ConsoleView — the shared console card (chrome + find bar + body + the full-screen pop-out). BOTH
// the game-server console (ConsolePanel) and the journal feeds (host logs, one leaf's journal) render
// through this, so they look identical — including the left-hand timestamp gutter.
//
//   lines    — strings or { id?, seq?, at?, ts?, tag?, level?, text }, OLDEST-FIRST (newest at the
//              bottom, tail).
//   sources  — optional [{ id, label, lines }] → a source dropdown in the head; the selected source's
//              lines are shown (overrides `lines`). A single source shows a quiet label, none = no chip.
//   pill     — optional { label, live } run-state / Live pill.
//   count    — optional line count for the head ("N lines"); `loading` shows "connecting…".
//   footer   — optional node under the body (a command input / a read-only note).
//   resetKey — when it changes, the pop-out collapses and the find/follow state resets: a server or
//              host switch is a new context, not a continuation of the one being read.
//   initialSourceId — which source to open on, when the caller knows (the leaf config page opens a
//              leaf's own journal). Ignored if it isn't in `sources`; only seeds the initial pick,
//              so the user's later choice always wins.
function ConsoleView({
  title = "Console", icon = "terminal-square",
  lines = [], sources, pill, count, loading = false,
  footer = null, emptyText = "— no output —", resetKey, initialSourceId,
}) {
  const bodyRef = React.useRef(null);
  const findRef = React.useRef(null);
  const [sourceId, setSourceId] = React.useState(() => {
    if (initialSourceId && sources && sources.some(s => s.id === initialSourceId)) return initialSourceId;
    return sources && sources[0] && sources[0].id;
  });
  const [expanded, setExpanded] = React.useState(false);
  const [finding, setFinding] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [onlyMatching, setOnlyMatching] = React.useState(false);
  const [matchAt, setMatchAt] = React.useState(0);

  // Following is the reader's POSITION, not a mode they set: the feed tails while they are at the
  // bottom and holds still the moment they scroll away to read something. `pinnedRef` mirrors the
  // state because the layout effect below reads it without wanting to re-run every time it flips.
  const [pinned, setPinned] = React.useState(true);
  const pinnedRef = React.useRef(true);
  const setPin = (v) => { pinnedRef.current = v; setPinned(v); };
  const [unread, setUnread] = React.useState(0);
  const anchorRef = React.useRef(null);   // { key, delta } — the row to hold still while unpinned
  const seenRef = React.useRef(null);     // the newest line the reader had seen when they scrolled away

  // Keep the source selection valid as the set changes; collapse the pop-out on a context switch.
  // Sources usually arrive after the first render, so the requested one is honoured here too —
  // otherwise seeding it above would lose the race and always fall to the first source.
  React.useEffect(() => {
    if (!sources || !sources.length || sources.some(s => s.id === sourceId)) return;
    const wanted = initialSourceId && sources.some(s => s.id === initialSourceId) ? initialSourceId : sources[0].id;
    setSourceId(wanted);
  }, [sources, sourceId, initialSourceId]);
  React.useEffect(() => {
    setExpanded(false); setFinding(false); setQuery(""); setOnlyMatching(false); setMatchAt(0);
    setUnread(0); anchorRef.current = null; seenRef.current = null;
    pinnedRef.current = true; setPinned(true);
  }, [resetKey]);
  React.useEffect(() => { if (finding && findRef.current) findRef.current.focus(); }, [finding]);

  const current = sources ? (sources.find(s => s.id === sourceId) || sources[0]) : null;
  const all = React.useMemo(() => (current ? (current.lines || []) : lines), [current, lines]);
  const q = query.trim().toLowerCase();

  // Which lines carry the query, as indices into `all`. null when nothing is being searched for.
  const matches = React.useMemo(() => {
    if (!q) return null;
    const out = [];
    for (let i = 0; i < all.length; i++) if (lineText(all[i]).toLowerCase().includes(q)) out.push(i);
    return out;
  }, [all, q]);
  const hits = matches ? matches.length : 0;
  const mAt = hits ? Math.min(matchAt, hits - 1) : 0;

  const shown = matches && onlyMatching ? matches.map(i => all[i]) : all;
  const shownCount = count != null ? count : all.length;
  // The key of the find's active hit — its row is tinted, and is what the stepper scrolls to.
  const currentKey = !hits ? null
    : onlyMatching ? lineKey(shown[mAt], mAt) : lineKey(all[matches[mAt]], matches[mAt]);
  // Reserve the timestamp gutter only when something in view is timestamped — so a plain stdout
  // tail (no times yet) isn't indented under an empty column, but a live/host-log feed aligns.
  const tsMode = shown.some(l => typeof l === "object" && l !== null && (l.at != null || l.ts != null));
  // A full window is exactly `length` lines long forever, so the count cannot say a line arrived —
  // the newest line's own identity is what does.
  const tailKey = shown.length ? lineKey(shown[shown.length - 1], shown.length - 1) : "";

  // Where the reader is now: following the newest line, or parked on a row with a note of which one
  // and where it sits, so the same row can be put back under their eyes after the content changes.
  const readPosition = (el) => {
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM) {
      setPin(true); setUnread(0);
      anchorRef.current = null; seenRef.current = null;
      return;
    }
    setPin(false);
    if (seenRef.current == null) seenRef.current = tailKey;   // everything past this line is unread
    for (const row of el.children) {
      if (row.dataset && row.dataset.k != null && row.offsetTop + row.offsetHeight > el.scrollTop) {
        anchorRef.current = { key: row.dataset.k, delta: row.offsetTop - el.scrollTop };
        break;
      }
    }
  };

  // Moving the view ourselves. The scroll event this raises is DROPPED, and each self-move states
  // the resulting position outright instead: the compensation that holds a row still runs on every
  // arriving line, and letting it re-enter through its own scroll event would re-scan the rows above
  // the viewport — hundreds of layout reads per line — to re-derive the anchor it was just applying.
  // The flag is only armed when the value actually changes, since a no-op assignment raises no event
  // and would leave it set to swallow the reader's next real scroll.
  const selfScrollRef = React.useRef(false);
  const moveTo = (el, top) => {
    const v = Math.max(0, top);
    if (Math.abs(el.scrollTop - v) < 0.5) return;
    selfScrollRef.current = true;
    el.scrollTop = v;
  };

  // Follow the feed, or hold the reader's place. The body tails only while pinned; while it isn't,
  // the topmost visible row is anchored so trimming the oldest lines off the top can't slide what is
  // being read out from under it. The browsers' own scroll anchoring is switched off in CSS
  // (`overflow-anchor: none`) so there is ONE mechanism here rather than two compensating at once.
  React.useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (pinnedRef.current) { moveTo(el, el.scrollHeight); setUnread(0); return; }
    const a = anchorRef.current;
    if (a && a.key != null) {
      const row = el.querySelector('[data-k="' + keySel(a.key) + '"]');
      // The anchored row itself having been trimmed means everything the reader had on screen is
      // gone; the oldest surviving line is where that content went, so go there and re-anchor rather
      // than leave the offset pointing at whatever now happens to occupy it.
      if (row) moveTo(el, row.offsetTop - a.delta);
      else { moveTo(el, 0); readPosition(el); }
    }
    setUnread(countAfter(shown, seenRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the CONTENT changes: the identity of the newest line, never the count, which a capped window pins forever. `pinned` is read through its ref on purpose, so merely scrolling to the bottom doesn't re-fire this.
  }, [shown.length, tailKey, sourceId, expanded, onlyMatching, q]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    if (selfScrollRef.current) { selfScrollRef.current = false; return; }
    readPosition(el);
  };

  const jumpToLatest = () => {
    const el = bodyRef.current;
    if (!el) return;
    moveTo(el, el.scrollHeight);
    setPin(true); setUnread(0);
    anchorRef.current = null; seenRef.current = null;
  };

  // Walk the view to the active hit whenever the search changes. A query that only matches up in the
  // scrollback has to be SHOWN, not merely counted — typing one and being left staring at the bottom
  // of the feed reads as "no match". Declared after the follow effect so it wins in the same commit;
  // landing away from the bottom unpins through the scroll handler, so the next arriving line can't
  // drag the reader off what they just searched for.
  React.useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || !hits) return;
    const key = onlyMatching ? lineKey(shown[mAt], mAt) : lineKey(all[matches[mAt]], matches[mAt]);
    const row = el.querySelector('[data-k="' + keySel(key) + '"]');
    if (!row) return;
    moveTo(el, row.offsetTop - (el.clientHeight - row.offsetHeight) / 2);
    readPosition(el);   // a hit up in the scrollback is a deliberate move away from the feed
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the SEARCH moving is what scrolls, never the feed: `shown`/`all`/`matches` are read for the current hit's position and would re-fire this on every arriving line if depped
  }, [q, mAt, onlyMatching, hits]);

  const step = (d) => { if (hits) setMatchAt((mAt + d + hits) % hits); };

  const closeFind = () => { setFinding(false); setQuery(""); setOnlyMatching(false); setMatchAt(0); };

  const headCount = loading ? "connecting…"
    : matches ? hits + " of " + shownCount
      : shownCount + " lines";

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
        <span className="console-card__count">{headCount}</span>
        <button type="button" className={"console-card__expand" + (finding ? " console-card__expand--on" : "")}
          onClick={() => (finding ? closeFind() : setFinding(true))}
          title="Find in console" aria-label="Find in console" aria-pressed={finding}>
          <Icon name="search" size={14} />
        </button>
        <button type="button" className="console-card__expand" onClick={() => setExpanded(v => !v)}
          title={expanded ? "Exit full screen (Esc)" : "Expand to full screen"}
          aria-label={expanded ? "Exit full screen" : "Expand to full screen"}>
          <Icon name={expanded ? "minimize-2" : "maximize-2"} size={14} />
        </button>
      </div>

      {finding ? (
        <div className="console-card__find">
          <Icon name="search" size={13} />
          <input
            ref={findRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setMatchAt(0); }}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
              else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
            }}
            placeholder="Find in console…"
            spellCheck="false"
            aria-label="Find in console"
          />
          <span className="console-card__find-count">{q ? (hits ? (mAt + 1) + "/" + hits : "no matches") : ""}</span>
          <button type="button" onClick={() => step(-1)} disabled={!hits}
            title="Previous match (Shift+Enter)" aria-label="Previous match">
            <Icon name="chevron-up" size={14} />
          </button>
          <button type="button" onClick={() => step(1)} disabled={!hits}
            title="Next match (Enter)" aria-label="Next match">
            <Icon name="chevron-down" size={14} />
          </button>
          <label className="console-card__find-only">
            <input type="checkbox" checked={onlyMatching} onChange={e => setOnlyMatching(e.target.checked)} />
            Only matches
          </label>
          <button type="button" onClick={closeFind} title="Close find (Esc)" aria-label="Close find">
            <Icon name="x" size={14} />
          </button>
        </div>
      ) : null}

      <div className="console-card__view">
        <div className={"console-card__body" + (tsMode ? " console-card__body--ts" : "")}
          ref={bodyRef} onScroll={onScroll}>
          {loading ? <div className="ln" style={{ color: "var(--fg-3)" }}>Loading console…</div>
            : shown.length === 0 ? <div className="ln" style={{ color: "var(--fg-3)" }}>{q ? "— no matching lines —" : emptyText}</div>
              : shown.map((l, i) => renderLine(l, i, tsMode, q, currentKey))}
        </div>
        {!pinned && !loading ? (
          <button type="button" className="console-card__jump" onClick={jumpToLatest}>
            <Icon name="arrow-down" size={13} />
            {unread ? unread + (unread >= shown.length ? "+" : "") + " new" : "Latest"}
          </button>
        ) : null}
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
