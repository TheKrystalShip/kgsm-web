import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { AuthShell } from "./AuthChrome.jsx";

// PendingPage — signed in, and allowed to do nothing yet.
//
// Proving who you are and being let in are two different things, and this is the gap
// between them. Someone here holds a real session on a real host: the backend knows
// exactly who they are, it simply has no authority on their account. Every screen behind
// this one would be an empty roster and a wall of 403s.
//
// Two states wear the same `none` tier and they are not the same sentence:
//   • pending — this host has an account for them, awaiting an administrator.
//   • unknown — this host has no account for them at all. Nothing is coming.
// Guessing between them would tell half of these people to wait for something that will
// never happen, which is why the backend reports the account state beside the tier.
//
// ── Why this polls ──────────────────────────────────────────────────────────────────
// Approval happens on somebody else's screen, minutes or days from now, and this browser
// has to notice. It cannot be told: a pending account is tier `none`, /api/v1/stream is
// viewer-gated, and the stream hub has no per-user delivery — there is literally nothing
// to subscribe to. So it re-reads GET /me, which is bare-authorized precisely so a
// tierless caller can ask what it is waiting for.
//
// The cadence is cheap and polite: every POLL_MS while the tab is visible, paused while
// it is hidden (nobody is watching a background tab for a redirect), and resumed with an
// immediate read when it comes back — which is also the case that matters most, since
// somebody who was told "you're in" alt-tabs straight here.

const POLL_MS = 5000;

function PendingPage({ account, user, hostName, onCheck, onLogout }) {
  const waiting = account === "pending";
  const handle = (user && (user.display || user.name)) || null;
  const id = (user && user.id) || null;
  const [checking, setChecking] = React.useState(false);

  const check = React.useCallback(async () => {
    setChecking(true);
    try { await onCheck(); } finally { setChecking(false); }
  }, [onCheck]);

  // Nothing is coming for a stranger, so there is nothing to poll for. Someone waiting on
  // an admin is the only case where the answer can change without them doing anything.
  React.useEffect(() => {
    if (!waiting) return undefined;

    let timer = null;
    let stopped = false;

    const tick = () => { if (!stopped) onCheck(); };

    const start = () => {
      if (timer) return;
      timer = setInterval(tick, POLL_MS);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") { tick(); start(); }
      else stop();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [waiting, onCheck]);

  return (
    <AuthShell tagline={null}>
      <div className="pending">
        <div className={"pending__icon" + (waiting ? "" : " pending__icon--stranger")}>
          <Icon name={waiting ? "hourglass" : "user-x"} size={26} strokeWidth={1.7} />
        </div>
        <h1 className="pending__title">{waiting ? "Waiting for approval" : "No access on this host"}</h1>
        <p className="pending__body">
          {waiting
            ? <>You’re signed in to <b>{hostName}</b>. An administrator has to approve your account before
              you can see anything — they’ll find you on their accounts screen. This page will let you
              in the moment they do.</>
            : <>You’re signed in, but <b>{hostName}</b> has no account for you. An administrator has to
              create one — signing in again won’t change it.</>}
        </p>
        {(handle || id) ? (
          <div className="pending__who">{handle}{handle && id ? " · " : ""}{id}</div>
        ) : null}
        <div className="pending__actions">
          <button className="login-form__submit" onClick={check} disabled={checking}>
            <Icon name="rotate-cw" size={15} className={checking ? "is-spinning" : ""} />
            {checking ? "Checking…" : "Check again"}
          </button>
          {onLogout ? <button className="btn-ghost" onClick={onLogout}>Sign out</button> : null}
        </div>
      </div>
    </AuthShell>
  );
}

export { PendingPage };
