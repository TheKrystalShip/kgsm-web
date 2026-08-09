import React from "react";
import { Icon } from "../components/Icon.jsx";
import { ThemePicker } from "../components/ThemePicker.jsx";
import { useThemePref, THEME_OPTS } from "../lib/theme.js";

// The theme control the chat carries when it is the whole app.
//
// It is the same store, the same list and now the same PICKER the Control Panel's Settings page
// uses, so the preference is one value on the device, a theme added to tokens.css appears here with
// no edit, and neither surface can end up showing the palettes better than the other. What it exists
// for is the surface that has no Settings page: on the standalone assistant this is the only way to
// change the theme, so it sits at the foot of the conversation rail and, at phone width where that
// rail is replaced by the history popover, at the foot of the popover instead.
//
// A disclosure rather than the bare grid: the rail's job is the conversation list, and nineteen
// swatches unfurled by default would push it off the screen. Shut, it is one row naming the theme in
// force — which is more than the old dropdown said, since a dropdown shows its value and nothing
// about it.
function ChatThemePicker({ className = "" }) {
  const pref = useThemePref();
  const [open, setOpen] = React.useState(false);
  const current = THEME_OPTS.find((o) => o.id === pref);

  return (
    <div className={"chat-theme" + (open ? " chat-theme--open" : "") + (className ? " " + className : "")}>
      <button type="button" className="chat-theme__toggle" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <Icon name="palette" size={15} className="chat-theme__icon" />
        <span className="chat-theme__name">{(current && current.label) || pref}</span>
        <Icon name={open ? "chevron-down" : "chevron-up"} size={14} />
      </button>
      {open && (
        <div className="chat-theme__panel">
          <ThemePicker compact />
        </div>
      )}
    </div>
  );
}

export { ChatThemePicker };
