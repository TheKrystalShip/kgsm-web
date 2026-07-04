import React from "react";
import { BriefCard } from "./BriefCard.jsx";
import { Icon } from "./Icon.jsx";

// settings-primitives.jsx — reusable settings UI components extracted from
// ServerSettings.jsx. Consumed by ServerSettings, DiscordPage, SettingsPage,
// and InstallModal.

function SettingsRow({ icon, title, sub, children }) {
  return (
    <div className="chat-brief__item chat-brief__item--static">
      <span className="chat-brief__icon"><Icon name={icon} size={14} /></span>
      <div className="chat-brief__body">
        <span className="chat-brief__item-title"><span className="chat-brief__titletext">{title}</span></span>
        {sub && <span className="chat-brief__detail" style={{ whiteSpace: "normal" }}>{sub}</span>}
      </div>
      <div className="settings-row__controls" style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 38, height: 22, borderRadius: 999,
      background: on ? "var(--krystal-teal)" : "var(--surface-3)",
      border: "1px solid " + (on ? "transparent" : "var(--border-subtle)"),
      position: "relative", cursor: "pointer", padding: 0,
      transition: "background 140ms",
    }} aria-pressed={on}>
      <span style={{
        position: "absolute", top: 2, left: on ? 18 : 2,
        width: 16, height: 16, borderRadius: 999,
        background: on ? "var(--fg-inverse)" : "var(--fg-2)",
        transition: "left 140ms",
      }}></span>
    </button>
  );
}

function SettingsSection({ icon, title, action, children }) {
  return (
    <BriefCard icon={icon} title={title} action={action}>
      <div className="chat-brief__list">{children}</div>
    </BriefCard>
  );
}

export { SettingsRow, SettingsSection, Toggle };
