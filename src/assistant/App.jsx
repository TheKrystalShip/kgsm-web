import React from "react";
import { Icon, Toasts, useStore } from "@thekrystalship/krystal-ui";
import { ChatPage } from "../chat/ChatPage.jsx";
import { assistant } from "../lib/assistantClient.js";
import { useAssistantGate } from "../lib/assistantGate.js";
import { SettingsPage } from "./SettingsPage.jsx";
import { useRoute } from "./route.js";
import { SELF } from "./self.js";
import { soloSession } from "./session.js";

// The standalone assistant: a chat with one assistant, its settings, and nothing else.
//
// This surface has no cluster, so it has no host picker, no server roster and no capability model —
// it talks to the assistant that served it, on its own origin. That is why almost every prop
// `ChatPage` takes is left at its default here: the defaults describe this surface, and the Control
// Panel is the one that has to explain itself (src/pages/ChatPage.jsx). Its routing is two screens
// wide and is its own (`route.js`), because the panel's router is a cluster vocabulary resolved
// through a per-node policy.

// Authority is the assistant's own answer about this bearer, evaluated from its replica of the
// cluster's authority per request: `/me` says who this is and whether they may change a server
// anywhere it reaches, and its operations with `/me/access` (`lib/assistantGate.js`) whether a request
// may be made — a turn, switching on auto-run. The panel's dock asks the same, so a person cannot hold
// a power here that they lack there.
function App() {
  const session = useStore(soloSession);
  const signedIn = session.status === "live";
  const [route, go] = useRoute();
  const gate = useAssistantGate(signedIn ? SELF : null);

  // Who the assistant says we are. Fetched once a session exists.
  const [me, setMe] = React.useState(null);
  React.useEffect(() => {
    if (!signedIn) { setMe(null); return undefined; }
    let cancelled = false;
    assistant.host(SELF).me().then(
      (m) => { if (!cancelled) setMe(m || null); },
      () => {});
    return () => { cancelled = true; };
  }, [signedIn]);

  if (!signedIn) return <SignedOut session={session} />;

  // Signed in, and no turn may be asked of this assistant. It knows exactly who this is, so it says so
  // rather than opening a conversation that can answer nothing. An answer still loading, or one the
  // assistant could not give, is not the same as holding nothing: the assistant refuses each turn
  // itself then.
  if (me && gate.ready && !gate.mayCall("POST", "/turn")) return <NoAccess me={me} />;

  const user = {
    name: (me && me.displayName) || "You",
    display: (me && me.displayName) || null,
    // Left unstated rather than guessed: the assistant answers who you are without saying which way
    // you signed in, and naming the wrong one would put the wrong mark beside somebody's name.
    provider: null,
    id: (me && me.userId) || null,
  };

  return (
    <>
      {route.kind === "settings" ? (
        <SettingsPage
          tab={route.tab}
          onTabChange={(t) => go({ kind: "settings", tab: t })}
          onBack={() => go({ kind: "chat" })}
        />
      ) : (
        <ChatPage
          user={user}
          assistantHost={{ id: SELF, name: "Assistant" }}
          connection={{ tone: "online", label: "Connected", usable: true, message: null }}
          canSeeActions={!!(me && me.canPerformActions)}
          canUseActions={gate.mayCall("POST", "/commands/autorun")}
          pageClass="chat-page--solo"
          onOpenSettings={() => go({ kind: "settings" })}
        />
      )}
      {/* The host is mounted here too so a shared chat/ component can report an
          outcome on either surface. This surface has no sidebar, so it gets the
          live cards but no history browser. */}
      <Toasts />
    </>
  );
}

// No session. A browser holding nothing never sees this — it left for the provider before mount —
// so what is left are the states a person has to see: a session that ended while the page was open,
// a provider that did not answer, and an assistant that names no provider at all.
function SignedOut({ session }) {
  const unavailable = session.status === "unavailable";
  const unreachable = session.error === "unreachable";
  return (
    <div className="assistant-signin">
      <div className="chat-empty">
        <span className="chat-empty__logo"><Icon name="bot" size={26} /></span>
        <h2>{unavailable ? "No sign-in yet" : unreachable ? "Couldn’t reach the sign-in" : "Signed out"}</h2>
        {unavailable
          ? <p>This assistant doesn’t name anywhere to sign in yet.</p>
          : (
            <button className="chat-suggestion" type="button" onClick={() => soloSession.signIn()}>
              Sign in
            </button>
          )}
      </div>
    </div>
  );
}

function NoAccess({ me }) {
  return (
    <div className="assistant-signin">
      <div className="chat-empty">
        <span className="chat-empty__logo"><Icon name="user-x" size={26} /></span>
        <h2>No access</h2>
        <p>Signed in · this assistant takes no turns from you</p>
        {me && me.displayName && <p className="assistant-signin__who">{me.displayName}</p>}
        <button className="chat-suggestion" type="button" onClick={() => soloSession.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

export { App, SELF };
