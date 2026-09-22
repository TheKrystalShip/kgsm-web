// BootLanding — neutral hold shown while something the first paint depends on resolves. Displayed
// for default landings and deep links until hosts + authz are ready, and for the moment a clustered
// panel spends asking its anchor who is in the cluster.
//
// `label` is why it is waiting, because those are different waits and one of them is new: a panel
// that keeps no node list has nothing to draw until the anchor answers, and saying "signing you in"
// to somebody already signed in is a small lie that makes a slow cluster look like a slow login.

import { Icon } from "./Icon.jsx";

function BootLanding({ label }) {
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
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", verticalAlign: "middle", animation: "act-spin 1.4s linear infinite" }}>
        <Icon name="loader-2" size={26} strokeWidth={1.7} />
      </span>
      <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--fg-2)" }}>{label || "Signing you in\u2026"}</div>
    </div>
  );
}

export { BootLanding };
