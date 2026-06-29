import React from "react";
import { Icon } from "./Icon.jsx";

// ServerActions.jsx — confirm-first, job-aware lifecycle buttons.
//
// Shared by the server hero (big chips) and the server tiles (quick row), so
// the two never diverge. Two behaviours layered on a normal button:
//
//   1. Confirm-first (misclick guard). Verbs flagged `confirm` arm on the first
//      click — the button swaps in place to "Confirm?" — and only dispatch on a
//      second click. It reverts on its own after a short timeout. Start is NOT
//      gated by default (bringing a server up is safe); Stop/Restart/Update are.
//
//   2. Job progress. While the server's command job is in flight (tracked on
//      serversStore via the `jobs` channel), the acting button shows a spinner
//      and its pending label, and the sibling actions are disabled until done.

const SERVER_ACTION = {
  start:   { label: "Start",    pending: "Starting…",   icon: "play",      tone: "start",   confirm: false },
  update:  { label: "Update",   pending: "Updating…",   icon: "download",  tone: "update",  confirm: true  },
  stop:    { label: "Shutdown", short: "Stop", pending: "Stopping…", icon: "square", tone: "stop", confirm: true },
  restart: { label: "Restart",  pending: "Restarting…", icon: "rotate-cw", tone: "restart", confirm: true  },
};

// Single click arms (returns to idle after `ms`); a click while armed fires.
function useConfirmAction(onConfirm, ms = 3500) {
  const [armed, setArmed] = React.useState(false);
  const timer = React.useRef(null);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const trigger = () => {
    if (armed) { clearTimeout(timer.current); setArmed(false); onConfirm(); }
    else { setArmed(true); timer.current = setTimeout(() => setArmed(false), ms); }
  };
  return { armed, trigger };
}

// verb: lifecycle verb · variant: "chip" | "glass" | "quick" · disabled: base guard
// pendingVerb: the verb of the server's in-flight job (or null) · onRun(verb)
// reason: optional tooltip shown when disabled (e.g. why the watchdog blocks it)
//
// "glass" is the cinematic server-hero button — a ghost button with a tone-coloured
// icon that lives inside the hero's frosted control bar. It shares the chip's
// confirm-first + pending behaviour (is-armed / is-pending), only the chrome differs.
function ServerActionButton({ verb, variant = "quick", disabled, pendingVerb, onRun, reason }) {
  const def = SERVER_ACTION[verb];
  const { armed, trigger } = useConfirmAction(() => onRun(verb));
  const jobRunning = !!pendingVerb;
  const isPending = pendingVerb === verb;
  const isDisabled = disabled || (jobRunning && !isPending);
  const size = variant === "quick" ? 11 : 13;
  const iconCls = variant === "chip" ? "chip__icon" : (variant === "glass" ? "gbtn__icon" : undefined);
  const labelCls = variant === "chip" ? "chip__label" : undefined;

  const click = (e) => {
    e.stopPropagation();
    if (isDisabled || isPending) return;
    if (def.confirm) trigger(); else onRun(verb);
  };

  const base = variant === "chip" ? "chip chip--" + def.tone
    : variant === "glass" ? "gbtn gbtn--" + def.tone
    : "";
  const cls = base
    + (armed ? " is-armed" : "")
    + (isPending ? " is-pending" : "");

  let inner;
  if (isPending) {
    inner = <><span className="act-spin"></span><span className={labelCls}>{def.pending}</span></>;
  } else if (armed) {
    inner = <><Icon name="check" size={size} strokeWidth={2.6} className={iconCls} /><span className={labelCls}>Confirm?</span></>;
  } else if (variant === "chip" && def.short) {
    inner = <><Icon name={def.icon} size={size} strokeWidth={2.2} className={iconCls} /><span className="chip__label chip__label--full">{def.label}</span><span className="chip__label chip__label--short">{def.short}</span></>;
  } else {
    inner = <><Icon name={def.icon} size={size} strokeWidth={2.2} className={iconCls} /><span className={labelCls}>{def.label}</span></>;
  }

  return (
    <button className={cls} disabled={isDisabled} aria-label={def.label}
      title={armed ? "Click again to confirm" : (isDisabled && reason ? reason : def.label)} onClick={click}>
      {inner}
    </button>
  );
}

export { SERVER_ACTION, ServerActionButton, useConfirmAction };
