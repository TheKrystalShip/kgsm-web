import { Icon } from "../../components/Icon.jsx";
import { AuthShell } from "./AuthChrome.jsx";

// ClusterUnavailable — the cluster answered, and nobody can sign in.
//
// Four different facts reach this screen and a person acts on each of them differently, so they are
// not collapsed into one apology. Every one of them is a configuration somebody can fix; telling
// them only that sign-in is unavailable turns a fixable state into a mystery, and the member that
// reported it is the one place any of it can be said — every other surface reads healthy.
//
// What each says, and why it is its own sentence:
//
//   orphaned   a member holds the cluster's accounts on paper and has left. Nothing serves them.
//              Naming the departed holder is the whole content: an administrator reassigns it.
//   unrouted   the holder is known and states no address a browser can reach. It is reachable to
//              the cluster and not to a person, which is a vhost away from working.
//   none       this member knows of no anchor. Either the cluster has none, or it has not heard —
//              indistinguishable from here, so it is not guessed at.
//   unreachable  the anchor is named and is not answering. The one a person can wait out, which is
//              why it is the only one offering Try again.

const WHAT = {
  orphaned: {
    icon: "unlink",
    title: "The cluster’s accounts have no holder",
    body: (c) => (
      <>
        <b>{c.memberId}</b> is recorded as holding this cluster’s accounts and is no longer a member
        of it. Nobody can sign in until an administrator reassigns that.
      </>
    ),
  },
  unrouted: {
    icon: "route-off",
    title: "The sign-in has no address",
    body: (c) => (
      <>
        <b>{c.memberId}</b> holds this cluster’s accounts and states no address a browser can reach.
        It answers the other members and not you.
      </>
    ),
  },
  none: {
    icon: "help-circle",
    title: "This cluster has no sign-in",
    body: () => <>No member of this cluster is holding its accounts, or this one has not heard yet.</>,
  },
  unreachable: {
    icon: "plug-zap",
    title: "The sign-in isn’t answering",
    body: (c) => (
      <>
        <b>{(c.url || "").replace(/^https?:\/\//, "")}</b> holds this cluster’s accounts and is not
        answering. Everything already signed in keeps working until its session runs out.
      </>
    ),
  },
};

function ClusterUnavailable({ cluster, onChangeMember, onRetry }) {
  // A `ready` state that could not be reached is the waiting one; the rest are what discovery said.
  const key = cluster.state === "ready" ? "unreachable" : cluster.state;
  const what = WHAT[key] || WHAT.none;

  return (
    <AuthShell tagline="Sign in to your control panel.">
      <div className="login-card">
        <div className="host-remove__icon host-remove__icon--warn">
          <Icon name={what.icon} size={20} />
        </div>
        <div className="login-card__heading">{what.title}</div>
        <div className="login-card__sub">{what.body(cluster)}</div>

        <div className="login-card__actions">
          {key === "unreachable" ? (
            <button type="button" className="login-form__submit" onClick={onRetry}>Try again</button>
          ) : null}
          <button type="button" className="btn-ghost" onClick={onChangeMember}>
            <Icon name="arrow-left" size={15} /> Reach the cluster another way
          </button>
        </div>
      </div>
    </AuthShell>
  );
}

export { ClusterUnavailable };
