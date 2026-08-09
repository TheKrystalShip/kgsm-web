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

  // Signed in, holding nothing. The leaf knows exactly who this is and has no authority for them —
  // so say which of the two reasons it is, rather than opening a conversation that can answer
  // nothing about their servers. `me` is still loading on the first paint, which is not the same as
  // holding nothing, so this waits for the answer.
  if (me && (me.tier || "none") === "none" && me.status !== "active") {
    return <AwaitingApproval status={me.status} me={me} />;
  }

  const tier = (me && me.tier) || (leaf && leaf.tier) || "none";
  const user = {
    name: (me && me.displayName) || "You",
    display: (me && me.displayName) || null,
    // Left unstated rather than guessed: this surface signs people in through Discord OR a KGSM
    // password, and the leaf's /auth/me answers who you are without saying which door you came
    // through. Naming the wrong one would put the wrong mark beside somebody's name.
    provider: null,
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

// A Discord sign-in here is automatic and silent (assistantSession.ensureSession, run at boot):
// this surface is served BY the leaf, so a browser that has authorized the Discord app completes it
// with nothing rendered. What is left are the states a person has to see — the wait, the one case
// Discord wants a human for, and the KGSM password form, which is the only door on a host with no
// identity provider configured at all.
function SignIn({ status }) {
  const needsConsent = assistantSession.needsConsent(SELF);
  const denied = status === "denied";
  const waiting = !denied && !needsConsent && !assistantSession.attempted(SELF);

  if (waiting) {
    return (
      <div className="assistant-signin">
        <div className="chat-empty">
          <span className="chat-empty__logo"><Icon name="bot" size={26} /></span>
          <h2>Signing you in…</h2>
          <p>One moment.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="assistant-signin">
      <div className="chat-empty">
        <span className="chat-empty__logo"><Icon name="bot" size={26} /></span>
        <h2>Sign in</h2>
        {denied && <p>That account doesn’t have access to this assistant.</p>}
        <PasswordSignIn />
        <div className="assistant-signin__divider login-divider"><span>or</span></div>
        <button className="chat-suggestion" type="button"
          onClick={() => assistantSession.signIn(SELF, { prompt: "consent" })}>
          {needsConsent ? "Continue with Discord (permission needed)" : "Continue with Discord"}
        </button>
      </div>
    </div>
  );
}

// Signed in, and allowed to do nothing yet.
//
// Two states wear the same `none` tier and they are opposite advice: "pending" means this host has
// an account for you and an administrator has to approve it, and anything else means it has no
// account for you at all, so waiting achieves nothing. Guessing between them would tell half these
// people to wait for something that is never coming.
function AwaitingApproval({ status, me }) {
  const waiting = status === "pending";
  return (
    <div className="assistant-signin">
      <div className="chat-empty">
        <span className="chat-empty__logo"><Icon name={waiting ? "hourglass" : "user-x"} size={26} /></span>
        <h2>{waiting ? "Waiting for approval" : "No access on this host"}</h2>
        <p>
          {waiting
            ? "You're signed in. An administrator has to approve your account before the assistant can help you — they'll find you on the Control Panel's accounts screen."
            : "You're signed in, but this host has no account for you. An administrator has to create one; signing in again won't change it."}
        </p>
        {me && me.displayName && <p className="assistant-signin__who">{me.displayName}</p>}
        <button className="chat-suggestion" type="button" onClick={() => window.location.reload()}>
          Check again
        </button>
      </div>
    </div>
  );
}

// Sign in with a KGSM account. The leaf issues its own session, so this posts to its own origin and
// adopts what comes back — the same shape the OAuth return leg adopts, reached without a redirect.
function PasswordSignIn() {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !username || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(window.location.origin + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setBusy(false);
        // The leaf gives one answer to a wrong username and a wrong password on purpose; this does
        // not re-open that distinction by guessing at one.
        const code = body && body.error;
        setError(
          code === "too_many_attempts" ? "Too many attempts. Try again shortly."
            : code === "account_disabled" ? "That account is disabled on this host."
            : code === "users_unavailable" ? "This host can’t reach its accounts right now."
            : "That username and password don’t match an account here.");
        return;
      }
      assistantSession.adopt(SELF, { token: body.token, refresh: body.refresh, tier: body.tier });
    } catch {
      setBusy(false);
      setError("Couldn’t reach this assistant. Try again.");
    }
  };

  return (
    <form className="login-form assistant-signin__form" onSubmit={submit}>
      {error && <div className="login-card__error" role="alert"><Icon name="alert-triangle" size={14} />{error}</div>}
      <label className="login-form__label" htmlFor="assistant-username">Username</label>
      <input id="assistant-username" className="login-form__input" type="text" autoComplete="username"
        autoCapitalize="off" spellCheck="false" value={username} disabled={busy}
        onChange={(e) => setUsername(e.target.value)} />
      <label className="login-form__label" htmlFor="assistant-password">Password</label>
      <input id="assistant-password" className="login-form__input" type="password"
        autoComplete="current-password" value={password} disabled={busy}
        onChange={(e) => setPassword(e.target.value)} />
      <button className="login-form__submit" type="submit" disabled={busy || !username || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export { App, SELF };
