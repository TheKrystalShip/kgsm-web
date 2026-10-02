import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { AuthShell } from "./AuthChrome.jsx";

// PendingPage — an account the anchor knows, waiting to be let in.
//
// Proving who you are and being let in are two different things, and this is the gap
// between them: the anchor knows exactly who this is, and a pending account holds nothing
// until somebody holding `auth:accounts.approve` approves it. The anchor's wait page
// (`authui/WaitApp.jsx`) renders this.
//
// Two states and they are not the same sentence:
//   • pending — the cluster has an account for them, awaiting approval.
//   • unknown — the cluster has no account for them at all. Nothing is coming.
// Guessing between them would tell half of these people to wait for something that will
// never happen.
//
// ── Why this polls ──────────────────────────────────────────────────────────────────
// Approval happens on somebody else's screen, minutes or days from now, and this browser
// has to notice, with nothing it could subscribe to: a pending account holds no session
// yet. So `onCheck` asks again — the anchor's wait answers whether the request in flight
// can go on.
//
// The cadence is cheap and polite: every POLL_MS while the tab is visible, paused while
// it is hidden (nobody is watching a background tab for a redirect), and resumed with an
// immediate read when it comes back — which is also the case that matters most, since
// somebody who was told "you're in" alt-tabs straight here.

const POLL_MS = 5000;

function PendingPage({ account, user, onCheck, onLogout }) {
  const waiting = account === "pending";
  const handle = (user && (user.display || user.name)) || null;
  const id = (user && user.id) || null;
  const [checking, setChecking] = React.useState(false);

  const check = React.useCallback(async () => {
    setChecking(true);
    try { await onCheck(); } finally { setChecking(false); }
  }, [onCheck]);

  // Nothing is coming for a stranger, so there is nothing to poll for. Someone waiting on
  // approval is the only case where the answer can change without them doing anything.
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
        <h1 className="pending__title">{waiting ? "Waiting for approval" : "No access on this cluster"}</h1>
        <p className="pending__body">
          {waiting
            ? <>An administrator has to approve your account.</>
            : <>This cluster has no account for you.</>}
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
