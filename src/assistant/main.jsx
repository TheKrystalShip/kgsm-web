import React from "react";
import { createRoot } from "react-dom/client";
import { App, SELF } from "./App.jsx";
import { AppCrash, ErrorBoundary } from "../components/ErrorBoundary.jsx";
import { captureOAuthFragment } from "../lib/oauthFragment.js";
import { assistantSession } from "../lib/assistantSession.js";
import { registerServiceWorker } from "../lib/registerSW.js";

// The standalone assistant's own token + kit styles. A per-surface barrel over the SAME partials
// the Control Panel uses (src/styles/assistant.css), so the two look identical and cannot drift.
import "../styles/assistant.css";

// Theme preference store (client-only): applies the saved theme to <html data-theme> and tracks the
// OS scheme for "auto". The inline boot script in assistant.html already set the attribute
// pre-paint; this keeps the store and the browser-chrome colour in sync.
import "../lib/theme.js";

// This surface is served BY the leaf it talks to, so its address is simply where the page came
// from — there is nothing to discover, and no host store to discover it in.
assistantSession.setOriginResolver(() => window.location.origin);

async function boot() {
  // A returning sign-in lands here with the session in the URL fragment. Capture and strip it
  // BEFORE anything reads location, then adopt it — same handoff the panel uses, same key names.
  const captured = captureOAuthFragment();
  if (captured && captured.issuer === "assistant") {
    if (captured.access) {
      assistantSession.adopt(captured.hostId || SELF, {
        token: captured.access, refresh: captured.refresh, tier: captured.tier,
      });
    } else if (captured.error === "denied") {
      assistantSession.deny(captured.hostId || SELF);
    } else if (captured.error === "consent_required" || captured.error === "login_required") {
      // Discord declined the silent round trip and wants a human. The attempt marker stays set, so
      // nothing bounces the browser again; the shell offers the one button that can work.
      assistantSession.markConsentNeeded(captured.hostId || SELF);
    }
  } else {
    // No landing: spend whatever we hold. A live session does nothing, a refresh token is rotated
    // silently, and a browser with neither is sent through Discord — which renders nothing, because
    // authorizing the app for any surface on this host authorized it for this one.
    assistantSession.ensureSession(SELF);
  }

  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <ErrorBoundary fallback={(reset, error) => <AppCrash error={error} onReload={() => window.location.reload()} />}>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );

  // Install the PWA shell SW (production-only; see registerSW.js). Done after mount so it never
  // contends with first paint. This surface gets its OWN worker — the leaf's routes are unprefixed
  // at the root, so what may be cached is allowlisted rather than denied.
  registerServiceWorker("/assistant-sw.js");
}
boot();
