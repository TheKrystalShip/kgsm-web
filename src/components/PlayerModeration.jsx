import React from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.jsx";
import { useConfirmAction } from "./ServerActions.jsx";

// PlayerModeration — the per-row kick/ban/unban controls in the player roster.
//
// The contract that shapes this file: **the browser never names who gets
// moderated.** Every call sends only the roster's `playerIdentity`; the API
// resolves that against its own record of who has been on this server and builds
// the game's command from it. So there is deliberately no address or name in any
// request here, and nothing in this component should start adding one.
//
// What the game supports comes from the roster response's `moderation` block
// ({ kick, ban, unban, targetKind }) — the backend derives it from the
// blueprint's declared command templates. We render only what it reports, so a
// game with no ban command shows no ban button rather than one that 409s on
// click. `targetKind` names the identity the game addresses (ip | name | id); a
// player who carries no identity of that kind can't be moderated at all, and we
// say so on a disabled control instead of letting the click fail.
//
// Two presentations of the same action set: square icon buttons (`.icon-btn`,
// the panel's ghost row action) on desktop, and a "⋯" menu on phones, where the
// menu keeps both icon AND label. CSS picks which trigger is visible; both drive
// the same `onRun`.

// Which field of a roster row satisfies the game's declared target kind. Mirrors
// the API's own resolution so the control state matches what the call would do —
// this is a pre-emptive courtesy, NOT the authority. The API re-resolves from
// its own record on every request and is free to refuse.
function hasTargetIdentity(player, targetKind) {
  if (!player || !targetKind) return false;
  if (targetKind === "ip") return !!player.playerAddr;
  if (targetKind === "name") return !!player.playerName;
  if (targetKind === "id") return !!player.playerId;
  return false;
}

const KIND_LABEL = { ip: "an IP address", name: "a player name", id: "an account id" };

const ACTION = {
  kick: { label: "Kick", icon: "user-x", tone: "warn", confirm: true,
    pending: "Kicking…", title: "Kick — disconnect this player" },
  ban: { label: "Ban", icon: "ban", tone: "danger", confirm: true,
    pending: "Banning…", title: "Ban — disconnect and block this player" },
  // Restoring access is not destructive, so it doesn't need a misclick guard.
  unban: { label: "Unban", icon: "user-check", tone: "safe", confirm: false,
    pending: "Unbanning…", title: "Unban — lift this player's ban" },
};

const MENU_WIDTH = 196;

function ModerationButton({ action, disabled, reason, pending, onRun }) {
  const def = ACTION[action];
  const { armed, trigger } = useConfirmAction(() => onRun(action));

  const click = (e) => {
    e.stopPropagation();
    if (disabled || pending) return;
    if (def.confirm) trigger(); else onRun(action);
  };

  const cls = "icon-btn pmod-btn pmod-btn--" + def.tone
    + (armed ? " is-armed" : "")
    + (pending ? " is-pending" : "");

  // An icon-only control has to carry its meaning in the tooltip and the
  // accessible name, and both have to follow the state — an armed button that
  // still announces "Ban" hides the fact that the next click commits.
  const title = pending ? def.pending
    : armed ? "Click again to confirm"
      : disabled && reason ? reason
        : def.title;
  const label = pending ? def.pending
    : armed ? "Confirm " + def.label.toLowerCase()
      : def.label;

  return (
    <button type="button" className={cls} disabled={disabled || pending}
      title={title} aria-label={label} onClick={click}>
      {pending ? <span className="act-spin" />
        : <Icon name={armed ? "check" : def.icon} size={15} strokeWidth={armed ? 2.6 : 1.9} />}
    </button>
  );
}

// One row of the "⋯" menu. Arming keeps the menu OPEN and swaps the label in
// place, so the second tap lands on the same target the first one did — a menu
// that closed on arming would ask the operator to re-open it and aim again.
function ModerationMenuItem({ action, disabled, reason, pending, onRun, onDone }) {
  const def = ACTION[action];
  const { armed, trigger } = useConfirmAction(() => { onRun(action); onDone(); });

  const click = (e) => {
    e.stopPropagation();
    if (disabled || pending) return;
    if (def.confirm) trigger();
    else { onRun(action); onDone(); }
  };

  return (
    <button type="button"
      className={"pmod-menu__item pmod-menu__item--" + def.tone + (armed ? " is-armed" : "")}
      disabled={disabled || pending} title={disabled && reason ? reason : undefined}
      onClick={click}>
      <Icon name={armed ? "check" : def.icon} size={14} strokeWidth={armed ? 2.6 : 2.2} />
      <span>{pending ? def.pending : armed ? "Tap again to confirm" : def.label}</span>
    </button>
  );
}

// The menu panel. Rendered into <body> and positioned from the trigger's rect:
// the roster's card frame and its cells both clip their overflow, so an
// absolutely-positioned panel inside the row would be cut off — most visibly on
// the last row, which is where a ban is as likely to be aimed as any other.
function ModerationMenu({ anchorRef, actions, disabled, reason, pending, onRun, onClose }) {
  const [pos, setPos] = React.useState(null);
  const panelRef = React.useRef(null);

  React.useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const height = 12 + actions.length * 38;
    // Flip above the trigger when there isn't room below, so the panel is never
    // pushed off the bottom of a short viewport.
    const below = window.innerHeight - r.bottom;
    const top = below < height + 12 ? Math.max(8, r.top - height - 6) : r.bottom + 6;
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setPos({ top, left });
  }, [anchorRef, actions.length]);

  React.useEffect(() => {
    const onDocDown = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (anchorRef.current && anchorRef.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    // The panel is anchored to a rect taken once, so any scroll or resize would
    // leave it pointing at nothing. Closing is honest; re-aiming a stale panel is not.
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [anchorRef, onClose]);

  if (!pos) return null;

  return createPortal(
    <div className="pmod-menu" role="menu" ref={panelRef}
      style={{ top: pos.top + "px", left: pos.left + "px", width: MENU_WIDTH + "px" }}>
      {disabled && reason ? <div className="pmod-menu__note">{reason}</div> : null}
      {actions.map((a) => (
        <ModerationMenuItem key={a} action={a} disabled={disabled} reason={reason}
          pending={pending === a} onRun={onRun} onDone={onClose} />
      ))}
    </div>,
    document.body
  );
}

// player: the roster row · moderation: the capability block · pending: the action
// currently in flight for THIS player (or null) · onRun(action)
function PlayerModeration({ player, moderation, pending, onRun }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef(null);
  const close = React.useCallback(() => setOpen(false), []);

  const banned = player.status === "banned";
  const online = player.status === "online";

  // A banned player gets the counterpart action, never both — offering "ban" on
  // someone already banned states a change that wouldn't happen.
  const actions = [];
  if (moderation) {
    if (banned) {
      if (moderation.unban) actions.push("unban");
    } else {
      // Kicking someone who isn't connected does nothing; the game has nobody to
      // disconnect. Offer it only when they're actually here.
      if (moderation.kick && online) actions.push("kick");
      if (moderation.ban) actions.push("ban");
    }
  }

  // Close the menu if this row's action set empties out from under it (a ban
  // landing turns "kick/ban" into "unban" while the panel is open).
  React.useEffect(() => { if (!actions.length) setOpen(false); }, [actions.length]);

  if (!moderation || !actions.length) return null;

  const usable = hasTargetIdentity(player, moderation.targetKind);
  const reason = usable ? null
    : "This game moderates by " + (KIND_LABEL[moderation.targetKind] || "an identity")
      + ", which this player has none of.";

  return (
    <span className="pmod">
      <span className="pmod__inline">
        {actions.map((a) => (
          <ModerationButton key={a} action={a} disabled={!usable} reason={reason}
            pending={pending === a} onRun={onRun} />
        ))}
      </span>

      <span className="pmod__compact">
        <button type="button" ref={triggerRef}
          className={"icon-btn pmod-kebab" + (open ? " icon-btn--on" : "")}
          aria-haspopup="menu" aria-expanded={open}
          aria-label={"Moderate " + (player.playerName || player.playerIdentity)}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
          <Icon name="ellipsis" size={15} />
        </button>
        {open && (
          <ModerationMenu anchorRef={triggerRef} actions={actions} disabled={!usable}
            reason={reason} pending={pending} onRun={onRun} onClose={close} />
        )}
      </span>
    </span>
  );
}

export { PlayerModeration, hasTargetIdentity };
