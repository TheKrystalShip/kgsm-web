import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { ErrorBoundary, AppCrash } from "./components/ErrorBoundary.jsx";
import { captureOAuthFragment, completeOAuthLogin } from "./lib/authRedirect.js";
import { registerServiceWorker } from "./lib/registerSW.js";

// Global styles. Order matters: design tokens (variables + @font-face) first,
// then the component class library, then consumer overrides.
import "./styles/tokens.css";
import "./styles/kit.css";
import "./styles/consumer.css";

// Theme preference store (client-only). Importing it applies the saved theme to
// <html data-theme>, wires the meta tag, and live-tracks the OS scheme for "auto".
// The index.html boot script already set the attribute pre-paint; this keeps the
// store + browser-chrome color in sync. See src/lib/theme.js.
import "./lib/theme.js";

// If we just landed from the OAuth callback (kgsm-api 302'd back with the session
// in the URL fragment), capture + strip it BEFORE the hash router reads
// location.hash, then resolve the app-shell identity from /me so the app mounts
// already signed in (no LoginPage flash). A normal load is a synchronous no-op.
async function boot() {
  const captured = captureOAuthFragment();
  // An assistant-leaf landing carries the same fragment keys as a node one and is told apart
  // by the marker its sign-in put in the return address. Its tokens belong to the leaf session,
  // never to kgsm-api, so it is adopted here and completeOAuthLogin is not run for it.
  if (captured && captured.issuer === "assistant") {
    const { assistantSession } = await import("./lib/assistantSession.js");
    if (captured.access) assistantSession.adopt(captured.hostId, { token: captured.access, refresh: captured.refresh, tier: captured.tier });
    else if (captured.error === "denied") assistantSession.deny(captured.hostId);
  }
  else if (captured && captured.access) await completeOAuthLogin(captured);
  // Dev convenience: when `npm run dev` seeds an auth-DISABLED local kgsm-api
  // (.env.development → VITE_API_BASE), sign in automatically so dev boots straight
  // into the app instead of stalling on the Discord LoginPage (which can't complete
  // against an auth-disabled host). Gated to dev builds → DCE'd in production; a
  // no-op against an auth-ENABLED seed. See connect.js devSeedAutoConnect.
  else if (import.meta.env.DEV) {
    try {
      const { devSeedAutoConnect } = await import("./lib/connect.js");
      await devSeedAutoConnect(import.meta.env.VITE_API_BASE);
    } catch {}
  }
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <ErrorBoundary
        fallback={(reset, error) => (
          <AppCrash error={error} onReload={() => window.location.reload()} />
        )}
      >
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
  // Install the PWA shell SW (production-only; see registerSW.js). Done after
  // mount so it never contends with first paint.
  registerServiceWorker();
}
boot();
