import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { ErrorBoundary, AppCrash } from "./components/ErrorBoundary.jsx";

// Global styles. Order matters: design tokens (variables + @font-face) first,
// then the component class library, then consumer overrides.
import "./styles/tokens.css";
import "./styles/kit.css";
import "./styles/consumer.css";

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
