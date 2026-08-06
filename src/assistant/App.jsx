import React from "react";
import { Icon } from "../components/Icon.jsx";
import { ChatPage } from "../chat/ChatPage.jsx";
import { assistant } from "../lib/assistantClient.js";
import { assistantSession } from "../lib/assistantSession.js";
import { useStore } from "../lib/store.js";

// The standalone assistant: a chat with one leaf, and nothing else.
//
// This surface has no cluster, so it has no host picker, no server roster, no capability model and
// no routing — it talks to the leaf that served it, on its own origin. That is why almost every
// prop `ChatPage` takes is left at its default here: the defaults describe this surface, and the
// Control Panel is the one that has to explain itself (src/pages/ChatPage.jsx).

// The leaf is addressed by a host id like any other, because the session layer and the client are
// both keyed by one. There is only ever this one, and it is not a node — it is "the assistant that
// served this page".
const SELF = "self";

// Authority comes from the leaf's own answer about this bearer, re-derived from Discord per
// request. Proposing an action needs operator; auto-run needs admin — the same ladder every other
// surface reads, so a person cannot hold a power here that they lack in the panel.
const TIER_RANK = { none: 0, viewer: 1, operator: 2, admin: 3 };
const rankOf = (tier) => TIER_RANK[String(tier || "none").toLowerCase()] || 0;

function App() {
  const leaf = useStore(assistantSession, (s) => s.byHost[SELF] || null);
  const status = leaf ? leaf.status : "none";
  const signedIn = status === "live";

  // Who the leaf says we are. Fetched once a session exists — the tokens carry a tier, but the
  // display name is the leaf's to tell us, and asking is one request against a surface we are
  // already talking to.
  const [me, setMe] = React.useState(null);
  React.useEffect(() => {
    if (!signedIn) { setMe(null); return undefined; }
    let cancelled = false;
    assistant.host(SELF).me().then(
      (m) => { if (!cancelled) setMe(m || null); },
      () => {});
    return () => { cancelled = true; };
  }, [signedIn]);

  // Nothing is asked of the user while a silent sign-in is in flight; it is normally invisible and
  // resolves into a session or into the one case that needs a person.
  if (!signedIn) return <SignIn status={status} />;

  const tier = (me && me.tier) || (leaf && leaf.tier) || "none";
  const user = {
    name: (me && me.displayName) || "You",
    display: (me && me.displayName) || null,
    provider: "discord",
    id: (me && me.userId) || null,
  };

  return (
    <ChatPage
      user={user}
      assistantHost={{ id: SELF, name: "Assistant" }}
      connection={{ tone: "online", label: "Connected", usable: true, message: null }}
      canSeeActions={rankOf(tier) >= TIER_RANK.operator}
      canUseActions={rankOf(tier) >= TIER_RANK.admin}
      pageClass="chat-page--solo"
    />
  );
}

// The sign-in is automatic and silent (assistantSession.ensureSession, run at boot): this surface
// is served BY the leaf, so a browser that has authorized the Discord app completes it with nothing
// rendered. What is left here are the two states a person has to see — the wait, and the one case
// Discord wants a human for.
function SignIn({ status }) {
  const needsConsent = assistantSession.needsConsent(SELF);
  const denied = status === "denied";
  const waiting = !denied && !needsConsent && !assistantSession.attempted(SELF);

  return (
    <div className="chat-page chat-page--solo">
      <div className="chat-empty">
        <span className="chat-empty__logo"><Icon name="bot" size={26} /></span>
        {waiting ? (
          <>
            <h2>Signing you in…</h2>
            <p>One moment.</p>
          </>
        ) : denied ? (
          <>
            <h2>No access</h2>
            <p>Your Discord account doesn’t have access to this assistant.</p>
          </>
        ) : (
          <>
            <h2>Sign in</h2>
            <p>{needsConsent
              ? "Discord needs your permission once before this assistant can answer."
              : "Sign in with Discord to talk to this assistant."}</p>
            <button className="chat-suggestion" type="button"
              onClick={() => assistantSession.signIn(SELF, { prompt: "consent" })}>
              Continue with Discord
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export { App, SELF };
