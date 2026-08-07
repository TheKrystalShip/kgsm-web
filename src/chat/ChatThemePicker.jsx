import { Icon } from "../components/Icon.jsx";
import { Select } from "../components/Select.jsx";
import { themeStore, useThemePref, THEME_OPTS } from "../lib/theme.js";

// The theme control the chat carries when it is the whole app.
//
// It is the same store and the same list the Control Panel's Settings page uses, so the preference
// is one value on the device and a theme added to tokens.css appears here with no edit. What it
// exists for is the surface that has no Settings page: on the standalone assistant this is the only
// way to change the theme, so it sits at the foot of the conversation rail and, at phone width where
// that rail is replaced by the history popover, at the foot of the popover instead.
function ChatThemePicker({ className = "" }) {
  const pref = useThemePref();
  return (
    <div className={"chat-theme" + (className ? " " + className : "")}>
      <Icon name="palette" size={15} className="chat-theme__icon" />
      <Select value={pref} onChange={e => themeStore.set(e.target.value)} aria-label="Theme"
        options={THEME_OPTS.map(o => ({ value: o.id, label: o.label }))} />
    </div>
  );
}

export { ChatThemePicker };
