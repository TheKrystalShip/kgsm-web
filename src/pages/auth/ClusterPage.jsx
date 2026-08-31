import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { identifyAddress } from "../../lib/authFlow.js";
import { normalizeHostUrl } from "../../lib/connect.js";
import { AuthError, AuthShell } from "./AuthChrome.jsx";

// ClusterPage — one address, and nothing else.
//
// There are two things worth typing here and the page does not ask which: an auth anchor holding a
// cluster's accounts, or a standalone node holding its own. Both are doors, neither is above the
// other, and what was typed is classified by what answers rather than by being told in advance.
//
// A node that belongs to a cluster is the third thing somebody types, and it is the one that cannot
// work: it serves no auth and announces nothing about its cluster, so the only honest answer is that
// this is not the door. It is refused here rather than after a sign-in attempt.
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
    const found = await identifyAddress(typed);
    setBusy(false);
    if (found.kind === "unreachable" || found.kind === "invalid") { setError(found.reason); return; }
    onPick(found);
  };

  return (
    <AuthShell tagline="Sign in to your control panel.">
      <div className="login-card">
        <div className="login-card__heading">Where do you want to sign in?</div>

        <AuthError>{error}</AuthError>

        <form className="login-form" onSubmit={submit}>
          <div className={"addr" + (typed && !usable ? " addr--bad" : "")}>
            <span className="addr__scheme">https://</span>
            <input
              id="cluster-address"
              aria-label="Address"
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
