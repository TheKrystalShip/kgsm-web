import { Icon } from "@thekrystalship/krystal-ui";
import { AuthShell } from "./AuthChrome.jsx";

// BootFailed — signed in, and the first paint could not be settled.
//
// The boot cover waits only on questions somebody is answering; when one of them comes back with an
// answer the shell cannot be drawn from, this is what is shown instead, and it always offers a way
// forward. Try again reloads, which re-asks every question from the start; Sign out ends the session
// at the provider.
//
//   refused        every node answered `GET /hosts` with a refusal or an error
//   unaddressable  the cluster names nodes and none has an address this page can reach
//   timeout        the boot deadline passed with a question still unanswered

const WHAT = {
  refused: {
    icon: "shield-x",
    title: "Couldn’t load your nodes",
    body: (c) => (c.error ? <>{c.error}</> : <>Every node refused the request.</>),
  },
  unaddressable: {
    icon: "unplug",
    title: "No reachable nodes",
    body: (c) => <>{c.count === 1 ? "The cluster’s node has" : `The cluster’s ${c.count} nodes have`} no address this page can reach.</>,
  },
  timeout: {
    icon: "clock",
    title: "Still waiting on the cluster",
    body: () => <>The cluster didn’t answer in time.</>,
  },
};

function BootFailed({ reason, onRetry, onSignOut }) {
  const what = WHAT[reason.kind] || WHAT.timeout;
  return (
    <AuthShell tagline="Sign in to your control panel.">
      <div className="login-card">
        <div className="host-remove__icon host-remove__icon--warn">
          <Icon name={what.icon} size={20} />
        </div>
        <div className="login-card__heading">{what.title}</div>
        <div className="login-card__sub">{what.body(reason)}</div>
        <div className="login-card__actions">
          <button type="button" className="login-form__submit" onClick={onRetry}>Try again</button>
          <button type="button" className="btn-ghost" onClick={onSignOut}>
            <Icon name="log-out" size={15} /> Sign out
          </button>
        </div>
      </div>
    </AuthShell>
  );
}

export { BootFailed };
