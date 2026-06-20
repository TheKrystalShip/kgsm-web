import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { ErrorBoundary, AppCrash } from "./components/ErrorBoundary.jsx";
import { captureOAuthFragment, completeOAuthLogin } from "./lib/authRedirect.js";

// Global styles. Order matters: design tokens (variables + @font-face) first,
// then the component class library, then consumer overrides.
import "./styles/tokens.css";
import "./styles/kit.css";
import "./styles/consumer.css";

// If we just landed from the OAuth callback (kgsm-api 302'd back with the session
// in the URL fragment), capture + strip it BEFORE the hash router reads
// location.hash, then resolve the app-shell identity from /me so the app mounts
// already signed in (no LoginPage flash). A normal load is a synchronous no-op.
async function boot() {
  const captured = captureOAuthFragment();
  if (captured && captured.access) await completeOAuthLogin(captured);
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
}
boot();
