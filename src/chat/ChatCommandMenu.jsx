// ChatCommandMenu — the completion list that opens over the composer when a message starts with a
// slash. It renders what the leaf said this person can type, and nothing else: the catalog arrives
// already filtered to their tier, so a command they cannot run never reaches this component and
// there is no disabled row to explain.
//
// Portaled and placed above the composer rather than inside it, because the composer sits at the
// bottom of a scrolling column in the panel dock and inside a fixed shell on the standalone page —
// a list rendered in flow would be clipped by one and would push the textarea in the other.

import React from "react";
import { createPortal } from "react-dom";

import { Icon } from "../components/Icon.jsx";

function ChatCommandMenu({ items, active, onPick, anchorRef }) {
  const menuRef = React.useRef(null);
  const [pos, setPos] = React.useState(null);

  // Placed against the composer's own box, above it, every time the list changes shape — the number
  // of rows is what moves the top edge, so re-measuring on `items` is what keeps it seated while
  // someone types.
  React.useLayoutEffect(() => {
    if (!items.length) return;
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({
        left: Math.round(r.left),
        width: Math.round(r.width),
        bottom: Math.round(window.innerHeight - r.top + 8),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [items, anchorRef]);

  // Keep the highlighted row in view when the arrows walk past the edge of a long list.
  React.useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const row = el.querySelector('[data-active="true"]');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
  }, [active, items]);

  if (!items.length || !pos) return null;

  return createPortal(
    <div className="chat-cmdmenu" ref={menuRef} style={pos} role="listbox" aria-label="Commands">
      {items.map((item, i) => (
        <button
          key={item.key}
          type="button"
          className={"chat-cmdmenu__row" + (i === active ? " chat-cmdmenu__row--active" : "")}
          data-active={i === active ? "true" : "false"}
          role="option"
          aria-selected={i === active}
          // Mouse-down rather than click: the textarea is focused, and a click would blur it first,
          // closing the menu out from under the press.
          onMouseDown={(e) => { e.preventDefault(); onPick(item); }}>
          <code className="chat-cmdmenu__name">{item.label}</code>
          {item.detail && <span className="chat-cmdmenu__desc">{item.detail}</span>}
          {item.command && item.command.mutates && (
            <span className="chat-cmdmenu__tag" title="This command changes something">
              <Icon name="triangle-alert" size={10} strokeWidth={2.2} />
            </span>
          )}
        </button>
      ))}
      <div className="chat-cmdmenu__hint">
        <kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Tab</kbd> to complete · <kbd>Esc</kbd> to dismiss
      </div>
    </div>,
    document.body,
  );
}

export { ChatCommandMenu };
