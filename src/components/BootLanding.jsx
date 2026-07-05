// BootLanding — neutral hold shown on a fresh DEFAULT landing while per-host
// roles resolve. Deep links never see this.

import { Icon } from "./Icon.jsx";

function BootLanding() {
  // Self-contained full-viewport hold — deliberately NOT the `.app` shell class,
  // whose grid-template-columns (sidebar + main) would pin this into the narrow
  // first column and push the content off-centre. Fixed overlay + flex centres on
  // both axes at every breakpoint.
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 10,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      textAlign: "center", background: "var(--canvas)", color: "var(--fg-3)",
    }}>
      <span style={{ display: "inline-block", animation: "act-spin 1.4s linear infinite" }}>
        <Icon name="loader-2" size={26} strokeWidth={1.7} />
      </span>
      <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--fg-2)" }}>{"Signing you in\u2026"}</div>
    </div>
  );
}

export { BootLanding };
