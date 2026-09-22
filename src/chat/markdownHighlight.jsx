// markdownHighlight — the composer's live highlighter for RAW markdown. It is the sibling of
// renderMarkdown (chatUtils.jsx) with one different job: that one turns a finished reply into
// structure, this one paints the syntax a person is still typing, characters and all, so the
// styled copy can sit directly behind a textarea and stay aligned with it.
//
// That alignment is the whole contract, and it is strict: EVERY character of the input is emitted
// exactly once, in order, with no normalization and no styling that changes a glyph's advance
// width. So the tokens here are colored and filled — delimiters dimmed, content tinted — never
// bold, italic or a different family; a width change would shift the text and desync the two
// layers at the first wrap. The CSS (kit/chat.css, `.chat-composer__hl`) owns the palette; this
// file only decides what is a token and how the output is shaped.
//
// SHAPE: one block box per input line (`.md-line`), and a code block is ONE wrapper
// (`.md-codeblock`) around its lines. Lines as blocks is what makes the wrapper possible: its
// background paints once across the block's whole content box — inter-line space included — and
// with no per-line paint there is no seam that could gap, overlap or hairline. Line breaks come
// from block stacking (each box = one line box, blank lines held by min-height), never from
// newline text nodes, so line-for-line parity with the textarea holds at any width, through
// wraps, without depending on how a browser treats a forced break at a block edge.
//
// Delimiters are SWALLOWED once there is content to show in their place: a fence that holds text
// hides its "```", an inline span that holds text hides its backticks, and each shows its quotes
// again the moment that content is deleted. Swallowed means visibility:hidden, never dropped from
// the output — a hidden delimiter still occupies its width, which is what keeps the caret landing
// where the text really is.
//
// An unclosed fence or backtick — the state that describes most of the time spent typing one —
// behaves as its closed self rather than falling back to plain text, because mid-typing is when
// the feedback matters.

const FENCE_RE = /^(\s*)(```+)(.*)$/;
const HEADING_RE = /^(\s*)(#{1,6})(\s)/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s)/;
const HIDDEN = "md-delim md-delim--hidden";

// One input line as one block box. `key` is a counter — siblings in the output array need keys.
function line(children, key) {
  return <div key={key()} className="md-line">{children}</div>;
}

// A fence delimiter: the ticks (and the language after them), hidden as a whole once the block
// holds content — a tinted chip around hidden ticks would be a chip of nothing. An emptied block
// shows them again as a chip that matches the inline one.
function fenceSpans(parts, hidden, key) {
  return (
    <span key={key()} className={"md-fence" + (hidden ? " md-fence--hidden" : "")}>
      <span className="md-delim">{parts[1] + parts[2]}</span>
      {parts[3] ? <span className="md-fence-lang">{parts[3]}</span> : null}
    </span>
  );
}

// Inline code on ONE line: spans never cross a line break, so per-line scanning is exact.
// The chip wraps its own delimiters, hidden or not — hidden ticks inside the chip become its
// padding, so "before`code`after" reads as a padded pill rather than leaving a gap between the
// words.
function highlightInline(lineText, key) {
  const out = [];
  let i = 0;
  for (;;) {
    const start = lineText.indexOf("`", i);
    if (start === -1) {
      if (i < lineText.length) out.push(lineText.slice(i));   // plain remainder, or the whole line
      break;
    }
    if (start > i) out.push(lineText.slice(i, start));
    const end = lineText.indexOf("`", start + 1);
    // With content between the ticks they vanish and only the code shows; with none — the first
    // backtick just typed, or a pair emptied out — they stay, so there is something to see and
    // something to delete. An unclosed tick with text after it runs as code to end of line.
    const content = end === -1
      ? (start + 1 < lineText.length ? lineText.slice(start + 1) : null)
      : (start + 1 < end ? lineText.slice(start + 1, end) : null);
    const tick = content === null ? "md-delim" : HIDDEN;
    out.push(
      <span key={key()} className="md-code-inline">
        <span className={tick}>`</span>
        {content !== null ? <span>{content}</span> : null}
        {end === -1 ? null : <span className={tick}>`</span>}
      </span>
    );
    if (end === -1) break;
    i = end + 1;
  }
  return out;
}

// A non-fence line: an optional line prefix (heading hashes, list marker) then the inline scan
// over what follows it. Both prefixes are color-only, like everything here.
function lineParts(lineText, key) {
  const h = HEADING_RE.exec(lineText);
  if (h) {
    return [
      <span key={key()} className="md-delim">{h[1] + h[2]}</span>,
      h[3],                                   // the space after the hashes: plain, but emitted
      ...highlightInline(lineText.slice(h[0].length), key),
    ];
  }
  const l = LIST_RE.exec(lineText);
  if (l) {
    return [
      <span key={key()} className="md-list-marker">{l[1] + l[2]}</span>,
      l[3],                                   // ditto, after the marker
      ...highlightInline(lineText.slice(l[0].length), key),
    ];
  }
  return highlightInline(lineText, key);
}

function highlightMarkdown(text) {
  if (!text) return [];
  let n = 0;
  const key = () => "md" + (n++);
  const out = [];
  const lines = text.split("\n");

  let i = 0;
  while (i < lines.length) {
    const open = FENCE_RE.exec(lines[i]);
    if (open) {
      // The whole block at once, because whether its delimiters show depends on what it holds.
      // An unclosed block runs to the end of the input — the state most of typing happens in.
      let j = i + 1;
      while (j < lines.length && !FENCE_RE.test(lines[j])) j++;
      const closed = j < lines.length;
      const content = lines.slice(i + 1, closed ? j : lines.length);
      const empty = content.every((l) => l.trim() === "");
      const kids = [line(fenceSpans(open, !empty, key), key)];
      for (const cl of content) kids.push(line(cl, key));
      if (closed) kids.push(line(fenceSpans(FENCE_RE.exec(lines[j]), !empty, key), key));
      // ONE element around all of them: a single background across the block, no seams. An
      // emptied block drops it so the visible ticks aren't sitting on an empty slab.
      out.push(
        <div key={key()} className={"md-codeblock" + (empty ? " md-codeblock--empty" : "")}>
          {kids}
        </div>,
      );
      i = closed ? j + 1 : lines.length;
      continue;
    }
    out.push(line(lineParts(lines[i], key), key));
    i++;
  }
  return out;
}

export { highlightMarkdown };
