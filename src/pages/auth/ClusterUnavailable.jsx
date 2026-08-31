import { Icon } from "../../components/Icon.jsx";
import { AuthShell } from "./AuthChrome.jsx";

// ClusterUnavailable — something answered, and it is not a door.
//
// Each fact reaching this screen is acted on differently, so they are not collapsed into one
// apology. Every one is a configuration somebody can fix, and this is the one place any of it can be
// said — every other surface reads healthy.
//
//   held-elsewhere  a node that belongs to a cluster. It serves no auth and announces nothing about
//                   its cluster, so the holder's NAME is the whole of what can be said — a name is
//                   not an address, and somebody who knows the cluster knows where that is
//   anchor-standby  an anchor that is not holding. A promotion candidate rather than a second
//                   authority, so sending anybody here would put them at a door that refuses them
//   unreachable     nothing answered. The one a person can wait out, which is why it is the only one
//                   offering Try again

const WHAT = {
  "held-elsewhere": {
    icon: "route-off",
    title: "Not the door",
    body: (c) => (c.holder
      ? <>This node belongs to a cluster whose accounts are held by <b>{c.holder}</b>. Sign in there.</>
      : <>This node belongs to a cluster that keeps its accounts elsewhere.</>),
  },
  "anchor-standby": {
    icon: "unlink",
    title: "Standing by",
    body: () => <>This anchor is not holding a cluster’s accounts.</>,
  },
  unreachable: {
    icon: "plug-zap",
    title: "Nothing answered",
    body: (c) => <><b>{(c.origin || "").replace(/^https?:\/\//, "")}</b> isn’t answering.</>,
  },
};

function ClusterUnavailable({ cluster, onChangeCluster, onRetry }) {
  const key = WHAT[cluster.kind] ? cluster.kind : "unreachable";
  const what = WHAT[key];

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
          <button type="button" className="btn-ghost" onClick={onChangeCluster}>
            <Icon name="arrow-left" size={15} /> Another address
          </button>
        </div>
      </div>
    </AuthShell>
  );
}

export { ClusterUnavailable };
