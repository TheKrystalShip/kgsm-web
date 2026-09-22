import React from "react";
import { highlightMarkdown } from "./markdownHighlight.jsx";

// MarkdownTextarea — the composer's input as two layers: the highlight layer behind, the real
// <textarea> on top with transparent text and a visible caret. The textarea stays the textarea —
// same props, same events, same semantics — so Enter-to-send, the slash-command menu, selection,
// spellcheck, IME and mobile keyboards are untouched; the layer only paints what the caret rides
// over. `ref` resolves to that textarea, which is all ChatPage asks of it (focus and the autogrow
// height resets).
//
// Two things the layer has to do for itself:
//
//   scroll — past the 200px cap the textarea scrolls its own content, and the layer, which is
//   clipped rather than scrolled, has to be told to move with it or the styled copy walks out
//   from under the caret.
//
//   IME — while a composition is open (Chinese, Japanese, Korean input), the browser draws the
//   pre-edit text in the element's own color, and that color is transparent here. So during
//   composition the layer hides and the textarea shows its text; the swap back is the end of the
//   composition, before the next paint of committed characters.
const MarkdownTextarea = React.forwardRef(function MarkdownTextarea(
  { value = "", placeholder, rows = 1, onChange, onKeyDown },
  ref,
) {
  const taRef = React.useRef(null);
  const hlRef = React.useRef(null);
  const [composing, setComposing] = React.useState(false);

  // Both refs on one node: ChatPage's `taRef` and this component's own need for the element.
  const setTaRef = (node) => {
    taRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  const syncScroll = () => {
    const ta = taRef.current;
    const hl = hlRef.current;
    if (!ta || !hl) return;
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
  };

  return (
    <div className="chat-composer__field">
      <div
        className={"chat-composer__hl" + (composing ? " chat-composer__hl--off" : "")}
        aria-hidden="true"
        ref={hlRef}>
        {highlightMarkdown(value)}
      </div>
      <textarea
        ref={setTaRef}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onScroll={syncScroll}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onCompositionCancel={() => setComposing(false)}
        className={composing ? "is-composing" : undefined}
      />
    </div>
  );
});

export { MarkdownTextarea };
