import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { ErrorBoundary, AppCrash } from "./components/ErrorBoundary.jsx";
import { noteSignInRefusal, writeStoredUser } from "./lib/authStorage.js";
import { registerServiceWorker } from "./lib/registerSW.js";
import { sessionStore } from "./lib/sessionStore.js";

// Global styles. Order matters: the component class library (which opens with the
// design tokens — variables + @font-face), then consumer overrides.
import "./styles/kit.css";
import "./styles/consumer.css";

// Theme preference store (client-only). Importing it applies the saved theme to
// <html data-theme>, wires the meta tag, and live-tracks the OS scheme for "auto".
// The index.html boot script already set the attribute pre-paint; this keeps the
// store + browser-chrome color in sync. The package declares that module side-effectful,
// so a bare import of it keeps the theme applied.
import "@thekrystalship/krystal-ui";

// The session is settled BEFORE anything mounts, so the gate knows on its first render whether this
// browser holds one. The provider sending a browser back lands on its own path with a code in the
// query: that is exchanged for a session and the address put back to the route the browser left
// from, before the hash router reads it. Any other load restores what is stored, which asks nobody
// anything.
async function boot() {
  if (sessionStore.isLanding()) {
    const landed = await sessionStore.completeSignIn();
    if (!landed.ok) noteSignInRefusal(landed.error);
    const back = landed.ok && landed.back && landed.back.startsWith("#") ? landed.back : "";
    try { history.replaceState(null, "", "/" + back); } catch { /* the router reads what is there */ }
  } else {
    await sessionStore.restore();
  }
  // Dev convenience: when `npm run dev` seeds an auth-DISABLED local kgsm-api
  // (.env.development → VITE_API_BASE), sign in automatically so dev boots straight
  // into the app instead of stalling in front of it. Gated to dev builds → DCE'd in production; a
  // no-op against an auth-ENABLED seed. See connect.js devSeedAutoConnect. An auth-disabled host has no
  // session to restore — its session is opened against it — so it is opened here, on every dev load,
  // before the identity check below reads one.
  let openedSeed = false;
  if (import.meta.env.DEV && !sessionStore.isLive() && import.meta.env.VITE_API_BASE) {
    try {
      const { devSeedAutoConnect } = await import("./lib/connect.js");
      await devSeedAutoConnect(import.meta.env.VITE_API_BASE);
      openedSeed = true;
      await sessionStore.authorize();
    } catch {}
  }
  // The stored identity mounts the shell, and the session record is what the shell settles on. An
  // identity with no record behind it — the library's session removed by a refused renewal, or no
  // provider recorded at all — is a shell nothing will ever authorize, so it is dropped here and the
  // gate, which can sign somebody in, takes the load instead. So is one whose dev seed did not open.
  if (!sessionStore.getState().session || (openedSeed && !sessionStore.isLive())) writeStoredUser(null);
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
