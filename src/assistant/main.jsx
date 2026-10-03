import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { AppCrash, ErrorBoundary } from "../components/ErrorBoundary.jsx";
import { assistantSession } from "../lib/assistantSession.js";
import { registerServiceWorker } from "../lib/registerSW.js";
import { soloSession } from "./session.js";

// The standalone assistant's own token + kit styles. A per-surface barrel over the SAME partials
// the Control Panel uses (src/styles/assistant.css), so the two look identical and cannot drift.
import "../styles/assistant.css";

// Theme preference store (client-only): applies the saved theme to <html data-theme> and tracks the
// OS scheme for "auto". The inline boot script in assistant.html already set the attribute
// pre-paint; this keeps the store and the browser-chrome colour in sync. The package declares that
// module side-effectful, so a bare import of it keeps the theme applied.
import "@thekrystalship/krystal-ui";

// This surface is served BY the assistant it talks to, so its address is simply where the page came
// from — there is nothing to discover, and no host store to discover it in. The session is this
// surface's own client of the cluster's sign-in provider.
assistantSession.setTargetResolver(() => window.location.origin);
assistantSession.setCredential(soloSession);

async function boot() {
  // Settled before mount: a landing exchanges its code, a stored session is restored, and a browser
  // holding nothing leaves for the provider — which returns at once when it recognises the browser.
  await soloSession.start();

  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <ErrorBoundary fallback={(reset, error) => <AppCrash error={error} onReload={() => window.location.reload()} />}>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );

  // Install the PWA shell SW (production-only; see registerSW.js). Done after mount so it never
  // contends with first paint. This surface gets its OWN worker — the assistant's routes are
  // unprefixed at the root, so what may be cached is allowlisted rather than denied.
  registerServiceWorker("/assistant-sw.js");
}
boot();
