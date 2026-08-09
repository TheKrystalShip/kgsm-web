import { Icon } from "./Icon.jsx";
import { Modal } from "./Modal.jsx";

// ConfirmRevokeDialog — the confirmation in front of ending a session, shared by the two surfaces
// that end one: your own devices in Settings, and an administrator acting on somebody else from the
// API leaf's Users tab. One component because it is one destructive act, and two implementations of
// "are you sure" is how the two come to promise different things about what they do.
//
// Shaped like RemoveHostDialog (pages/diagnostics/diagHostCards.jsx) — it reuses that dialog's
// `.host-remove` / `.host-btn` classes rather than adding a parallel set.
//
// Four variants over the same markup:
//   "one"       — self-service, one of the caller's own sessions
//   "all"       — self-service, every one of them (always includes the caller's current session)
//   "admin-one" — one of another person's sessions
//   "admin-all" — every one of another person's, on every device
//
// The admin variants take `targetName` so the copy names who is affected. A destructive action
// against another person is never anonymous: an admin about to sign somebody out is owed the name
// they will have to explain it to.
function ConfirmRevokeDialog({ mode, targetName, busy, onConfirm, onClose }) {
  const isAdmin = mode === "admin-one" || mode === "admin-all";
  const isAll = mode === "all" || mode === "admin-all";
  const who = targetName || "that account";

  let title = "Log out this device?";
  let text = "This ends the session on that device. If it's your current device, you'll need to sign in again.";
  if (mode === "all") {
    title = "Log out everywhere?";
    text = "This ends every active session on every device, including this one. You'll need to sign in again.";
  } else if (mode === "admin-one") {
    title = `End this session for ${who}?`;
    text = `This ends that one session. ${who}'s other devices stay signed in.`;
  } else if (mode === "admin-all") {
    title = `Sign ${who} out everywhere?`;
    text = `This ends every active session for ${who}, on every device. They can sign in again straight away — this ends the sessions, it does not disable the account.`;
  }

  return (
    <Modal onClose={busy ? undefined : onClose} canClose={!busy}>
      <div className="modal host-remove">
        <div className="host-remove__icon host-remove__icon--danger">
          <Icon name="log-out" size={20} />
        </div>
        <h2 className="host-remove__title">{title}</h2>
        <p className="host-remove__text">{text}</p>
        <div className="host-remove__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="host-btn host-btn--danger" onClick={onConfirm} disabled={busy}>
            <Icon name="log-out" size={14} />{" "}
            {busy
              ? (isAdmin ? "Working…" : "Logging out…")
              : (isAdmin ? (isAll ? "Sign out" : "End session") : "Log out")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export { ConfirmRevokeDialog };
