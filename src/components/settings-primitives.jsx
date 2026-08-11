import { BriefCard } from "./BriefCard.jsx";
import { Icon } from "./Icon.jsx";

// settings-primitives.jsx — reusable settings UI components extracted from
// ServerSettings.jsx. Consumed by ServerSettings, DiscordPage, SettingsPage,
// and InstallModal.

// `tone` (success | warn | danger | info) tints the left rule + icon chip via the
// shared brief-item modifiers — for a row that carries a verdict, not just a value.
// Omitted, the row is the neutral one every existing caller renders.
function SettingsRow({ icon, title, sub, tone, children }) {
  return (
    <div className={"chat-brief__item chat-brief__item--static" + (tone ? " chat-brief__item--" + tone : "")}>
      <span className="chat-brief__icon"><Icon name={icon} size={14} /></span>
      <div className="chat-brief__body">
        <span className="chat-brief__item-title"><span className="chat-brief__titletext">{title}</span></span>
        {sub && <span className="chat-brief__detail" style={{ whiteSpace: "normal" }}>{sub}</span>}
      </div>
      <div className="settings-row__controls">{children}</div>
    </div>
  );
}

// `disabled` renders the switch inert and faded — for a setting that exists but cannot be changed
// from here (one an admin has turned off host-wide, say). It stays visible rather than being hidden,
// because a missing row reads as "no such setting" when the truth is "not yours to change"; give the
// row a `sub` saying which.
function Toggle({ on, onChange, disabled = false, label }) {
  return (
    <button type="button" disabled={disabled} onClick={() => !disabled && onChange(!on)} style={{
      width: 38, height: 22, borderRadius: 999,
      background: on ? "var(--krystal-teal)" : "var(--surface-3)",
      border: "1px solid " + (on ? "transparent" : "var(--border-subtle)"),
      position: "relative", cursor: disabled ? "default" : "pointer", padding: 0,
      opacity: disabled ? 0.45 : 1,
      transition: "background 140ms, opacity 140ms",
    }} aria-pressed={on} aria-label={label}>
      <span style={{
        position: "absolute", top: 2, left: on ? 18 : 2,
        width: 16, height: 16, borderRadius: 999,
        background: on ? "var(--fg-inverse)" : "var(--fg-2)",
        transition: "left 140ms",
      }}></span>
    </button>
  );
}

function SettingsSection({ icon, title, meta, action, className, children }) {
  return (
    <BriefCard icon={icon} title={title} meta={meta} action={action} className={className}>
      <div className="chat-brief__list">{children}</div>
    </BriefCard>
  );
}

export { SettingsRow, SettingsSection, Toggle };
