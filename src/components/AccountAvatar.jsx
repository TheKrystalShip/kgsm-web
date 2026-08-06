// AccountAvatar — a person, as a circle.
//
// Its own module rather than a member of Sidebar.jsx, because the chat renders it on every user
// message and the sidebar reaches the whole app: persona, the session store, the connection model.
// Importing an avatar should not import the node session layer, and for a surface that has no nodes
// (the standalone assistant) it must not be possible to.
function AccountAvatar({ user, size = 24 }) {
  // Discord avatars come from cdn.discordapp.com via the OAuth profile; until one
  // is available we synthesise a teal-gradient circle with an initial.
  const initial = ((user && (user.display || user.name)) || "?")[0].toUpperCase();
  return (
    <span style={{
      width: size, height: size, borderRadius: 999,
      background: "linear-gradient(135deg, var(--krystal-teal-hover), var(--krystal-teal-press))",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      color: "var(--fg-inverse)", fontSize: size * 0.46, fontWeight: 700,
      flexShrink: 0,
    }}>{initial}</span>
  );
}

export { AccountAvatar };
