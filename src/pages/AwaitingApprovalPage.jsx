import { Icon } from "../components/Icon.jsx";

// AwaitingApprovalPage — signed in, and allowed to do nothing yet.
//
// Proving who you are and being let in are two different things, and this is the gap between
// them. Someone here holds a real session on a real host: the backend knows exactly who they
// are, it simply has no authority on their account. Every screen behind this one would be an
// empty roster and a wall of 403s, so the panel says the one true thing instead.
//
// Two states wear the same `none` tier and they are not the same sentence:
//   • pending  — this host has an account for them, awaiting an administrator.
//   • unknown  — this host has no account for them at all (their sign-in provisioned nothing,
//                or the account was removed). Nothing is coming; they have to be given one.
// Guessing between them would tell half of these people to wait for something that will never
// happen, which is why the backend reports the account state rather than only the tier.
function AwaitingApprovalPage({ account, user, onRetry, onLogout, checking }) {
  const waiting = account === "pending";
  const handle = (user && (user.display || user.name)) || null;
  const id = (user && user.id) || null;

  return (
    <div className="await-approval">
      <div className="await-approval__card">
        <div className="await-approval__icon">
          <Icon name={waiting ? "hourglass" : "user-x"} size={28} strokeWidth={1.7} />
        </div>
        <h1 className="await-approval__title">
          {waiting ? "Waiting for approval" : "No access on this host"}
        </h1>
        <p className="await-approval__body">
          {waiting
            ? "You're signed in, and an administrator of this host has to approve your account before you can see anything. They'll find you on their accounts screen."
            : "You're signed in, but this host has no account for you. An administrator has to create one — signing in again won't change it."}
        </p>
        {(handle || id) && (
          <p className="await-approval__who">
            {handle}{handle && id ? " · " : ""}{id}
          </p>
        )}
        <div className="await-approval__actions">
          {/* Re-checking is the whole interaction: approval happens elsewhere, and this is how
              somebody finds out it happened without being told to reload the page. */}
          <button className="await-approval__retry" onClick={onRetry} disabled={checking}>
            <Icon name="rotate-cw" size={15} className={checking ? "is-spinning" : ""} />
            {checking ? "Checking…" : "Check again"}
          </button>
          {onLogout && (
            <button className="await-approval__ghost" onClick={onLogout}>Sign out</button>
          )}
        </div>
      </div>
    </div>
  );
}

export { AwaitingApprovalPage };
