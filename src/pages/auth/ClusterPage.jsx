import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { discoverProvider, originOf } from "../../lib/oidc.js";
import { AuthError, AuthShell } from "./AuthChrome.jsx";

// ClusterPage — one address, and nothing else.
//
// Shown only to a panel whose own origin names no sign-in provider: one served from a static host, a
// laptop, a bucket. Any member of the cluster answers where its provider is, and so does the provider
// itself, so the page does not ask which was typed. What was typed is checked before it is kept, so
// a refusal is what something answered rather than a guess about what was typed.

const REFUSAL = {
  invalid: "That is not a usable address.",
  unreachable: "Nothing there answered as a member of a cluster.",
  no_provider: "That member doesn’t know its cluster’s sign-in yet. Try again shortly.",
};

function ClusterPage({ onFound }) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const typed = value.trim();
  const usable = !!originOf(typed);

  const submit = async (e) => {
    e.preventDefault();
    if (!usable || busy) return;
    setBusy(true);
    setError(null);
    const found = await discoverProvider(typed);
    setBusy(false);
    if (!found.ok) { setError(REFUSAL[found.reason] || REFUSAL.unreachable); return; }
    onFound(found);
  };

  return (
    <AuthShell tagline="Sign in to your control panel.">
      <div className="login-card">
        <div className="login-card__heading">Where is your cluster?</div>

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
