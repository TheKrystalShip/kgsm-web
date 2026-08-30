import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { adoptMember, probeMember } from "../../lib/authFlow.js";
import { normalizeHostUrl } from "../../lib/connect.js";
import { AuthError, AuthShell } from "./AuthChrome.jsx";

// ClusterPage — which cluster, and nothing else.
//
// An account is the cluster's, so a cluster is the only thing there is to choose. The address typed
// here reaches one of its members, which is a routing detail and never surfaces: what comes back is
// where the cluster signs people in, and everything after this is about the cluster.
//
// The address is checked before it is kept, so a refusal is what something answered rather than a
// guess about what was typed.

function ClusterPage({ onPick }) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const typed = value.trim();
  const usable = !!normalizeHostUrl(typed);

  const submit = async (e) => {
    e.preventDefault();
    if (!usable || busy) return;
    setBusy(true);
    setError(null);
    const probe = await probeMember(typed);
    setBusy(false);
    if (!probe.reachable) { setError(probe.reason); return; }
    adoptMember(probe);
    onPick(probe);
  };

  return (
    <AuthShell tagline="Sign in to your control panel.">
      <div className="login-card">
        <div className="login-card__heading">Which cluster do you want to authenticate against?</div>

        <AuthError>{error}</AuthError>

        <form className="login-form" onSubmit={submit}>
          <div className={"addr" + (typed && !usable ? " addr--bad" : "")}>
            <span className="addr__scheme">https://</span>
            <input
              id="cluster-address"
              aria-label="Cluster address"
              value={value}
              onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
              placeholder="kgsm.example.com"
              spellCheck="false" autoCapitalize="off" autoCorrect="off" autoFocus
              disabled={busy} />
          </div>

          <button type="submit" className="login-form__submit" disabled={!usable || busy}>
            {busy ? (<><span className="oauth-spinner" /> Checking…</>) : (<>Next <Icon name="arrow-right" size={15} /></>)}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}

export { ClusterPage };
