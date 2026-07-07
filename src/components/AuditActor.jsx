import { Icon } from "./Icon.jsx";
import { AccountAvatar } from "./Sidebar.jsx";

// AuditActor — renders the avatar circle for an audit event's actor.
// System actors get a bot icon; human actors get an AccountAvatar.
function AuditActor({ actor, size = 28 }) {
  const isSystem = actor.kind === "system";
  if (isSystem) {
    return (
      <span style={{
        width: size, height: size, borderRadius: 999,
        background: "var(--surface-3)", color: "var(--fg-3)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }} title="System">
        <Icon name="bot" size={size * 0.55} />
      </span>
    );
  }
  return <AccountAvatar user={actor} size={size} />;
}

export { AuditActor };
