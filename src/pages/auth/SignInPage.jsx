import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { providerStartUrl, register, signIn } from "../../lib/anchor.js";
import { takeOAuthError } from "../../lib/authRedirect.js";
import { AuthShell, DoorwayChip } from "./AuthChrome.jsx";
import { SignInCard } from "./SignInCard.jsx";

// SignInPage — the panel's sign-in: the shared card, pointed at a cluster.
//
// A session belongs to the cluster, so this signs in at the ANCHOR and at nothing else. The card is
// the same component the anchor's own sign-in page draws; what is the panel's here is where the
// credential goes, adopting the session that comes back, and the chip naming the door.
//
// Which providers exist and whether sign-up is open both come from the anchor's own
// /auth/providers. This SPA holds no list of providers and no opinion about whether a cluster takes
// new accounts — and the anchor's refusals name the rule they applied, which is why nothing here
// keeps a second copy of the rules to show alongside them.

function SignInPage({ cluster, tab, onTab, onSession, onChangeCluster }) {
  // Whichever door was chosen — an anchor holding a cluster's accounts, or a standalone node
  // holding its own. Both mint their own sessions. The credential calls are passed the whole door
  // rather than its address, because two of the paths are spelled differently on each and sending a
  // node the anchor's spelling reaches nothing.
  const door = cluster || null;
  const anchor = cluster && cluster.origin;
  const registering = tab === "register";

  // A refusal about the ANCHOR rather than about what was typed — it survives a tab switch and
  // disables both doors, because neither of them can work.
  const [anchorError, setAnchorError] = React.useState(null);
  // A provider bounce that came back refused. One-shot, read at mount.
  const [bounceError] = React.useState(() => takeOAuthError());

  const submit = async ({ username, password, displayName }) => {
    const result = registering
      ? await register(anchor, username, password, displayName)
      : await signIn(door, username, password);
    if (!result.ok) return result;

    // The anchor minted a session. Adopting it is the same path a provider's return leg takes, so a
    // session behaves identically whichever door it came through — and a registration lands holding
    // nothing, which is the same state a first provider arrival lands in.
    await onSession(result.session);
    return result;
  };

  return (
    <AuthShell tagline={registering ? "Create an account." : "Sign in to your control panel."}>
      <SignInCard
        tab={tab}
        onTab={onTab}
        providers={(cluster && cluster.providers) || []}
        registrationOpen={!!(cluster && cluster.registration)}
        available={!!anchor}
        anchorError={anchorError}
        onAnchorError={setAnchorError}
        notice={bounceError && !registering
          ? (bounceError === "denied"
            ? "That account holds nothing on this cluster yet."
            : "Sign-in didn’t complete — please try again.")
          : null}
        onSubmit={submit}
        onProvider={(provider) => { window.location.href = providerStartUrl(anchor, provider); }}
        extra={anchorError ? (
          <button type="button" className="btn-ghost" onClick={onChangeCluster}>
            <Icon name="arrow-left" size={15} /> Another cluster
          </button>
        ) : null} />

      <DoorwayChip
        anchor={anchor}
        verb={registering ? "register" : "login"}
        down={!!anchorError}
        onOpen={onChangeCluster} />
    </AuthShell>
  );
}

export { SignInPage };
