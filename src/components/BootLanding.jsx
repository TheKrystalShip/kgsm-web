// BootLanding — neutral hold shown on a fresh DEFAULT landing while per-host
// roles resolve. Deep links never see this.

import React from "react";
import { Icon } from "./Icon.jsx";

function BootLanding() {
  return (
    <div className="app app--booting" style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--fg-3)" }}>
      <div style={{ textAlign: "center" }}>
        <span style={{ display: "inline-block", animation: "act-spin 1.4s linear infinite" }}>
          <Icon name="loader-2" size={26} strokeWidth={1.7} />
        </span>
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--fg-2)" }}>Signing you in\u2026</div>
      </div>
    </div>
  );
}

export { BootLanding };
