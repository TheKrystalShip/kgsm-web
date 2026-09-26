import { Icon } from "../../components/Icon.jsx";
import { AuthShell } from "./AuthChrome.jsx";

// ClusterUnavailable — the panel knows where to sign in, and cannot right now.
//
// Each fact reaching this screen is acted on differently, so they are not collapsed into one
// apology.
//
//   unreachable  the provider, or the member asked for it, did not answer. The one a person can wait
//                out, so it offers Try again
//   no_provider  a member answered and knows of no sign-in provider yet — its cluster is still
//                settling, or has nobody holding its accounts
//   ended        a session this page was using could not be renewed. Never followed on its own: the
//                panel was on screen, and leaving for the provider unasked would discard whatever
//                somebody was doing
//   refused      the provider sent the browser back without a session, naming why
//   no_access    signed in, and the cluster holds no active account for this session

const WHAT = {
  unreachable: {
    icon: "plug-zap",
    title: "Nothing answered",
    body: (c) => (c.origin
      ? <><b>{c.origin.replace(/^https?:\/\//, "")}</b> isn’t answering.</>
      : <>The cluster’s sign-in isn’t answering.</>),
  },
  no_provider: {
    icon: "unlink",
    title: "No sign-in yet",
    body: () => <>This cluster doesn’t name anywhere to sign in yet.</>,
  },
  ended: {
    icon: "log-out",
    title: "Signed out",
    body: () => <>Your session ended.</>,
  },
  refused: {
    icon: "shield-x",
    title: "Not signed in",
    body: (c) => <>The sign-in came back without a session{c.error ? <> (<code>{c.error}</code>)</> : null}.</>,
  },
  no_access: {
    icon: "user-x",
    title: "No access",
    body: () => <>You’re signed in, and this cluster has no active account for you.</>,
  },
};

function ClusterUnavailable({ state, onSignIn, onRetry, onChangeCluster, onSignOut, accountPage }) {
  const key = WHAT[state.kind] ? state.kind : "unreachable";
  const what = WHAT[key];

  return (
    <AuthShell tagline="Sign in to your control panel.">
      <div className="login-card">
        <div className="host-remove__icon host-remove__icon--warn">
          <Icon name={what.icon} size={20} />
        </div>
        <div className="login-card__heading">{what.title}</div>
        <div className="login-card__sub">{what.body(state)}</div>

        <div className="login-card__actions">
          {(key === "ended" || key === "refused") && onSignIn ? (
            <button type="button" className="login-form__submit" onClick={onSignIn}>Sign in</button>
          ) : null}
          {(key === "unreachable" || key === "no_provider") && onRetry ? (
            <button type="button" className="login-form__submit" onClick={onRetry}>Try again</button>
          ) : null}
          {key === "no_access" && accountPage ? (
            <a className="login-form__submit" href={accountPage}>Your account</a>
          ) : null}
          {key === "no_access" && onSignOut ? (
            <button type="button" className="btn-ghost" onClick={onSignOut}>
              <Icon name="log-out" size={15} /> Sign out
            </button>
          ) : null}
          {key !== "no_access" && onChangeCluster ? (
            <button type="button" className="btn-ghost" onClick={onChangeCluster}>
              <Icon name="arrow-left" size={15} /> Another address
            </button>
          ) : null}
        </div>
      </div>
    </AuthShell>
  );
}

export { ClusterUnavailable };
