// DiagnosticsPage shared components — barrel (#8 split). The grab-bag of nine
// components was carved into two cohesive modules; this file re-exports them so
// every consumer (DiagServices / DiagResources / DiagOverview /
// DiagnosticsPage) keeps importing from the same path.
//   • diagLeafCards.jsx — leaf/service cards (StatusLed, LeafProvisionControl,
//     LeafCard, ServicesSummaryCard)
//   • diagHostCards.jsx — host/fleet cards + host modals (HostMenu, FleetHostCard,
//     HostEditorModal, RemoveHostDialog)

export { StatusLed, LeafProvisionControl, LeafCard, ServicesSummaryCard } from "./diagLeafCards.jsx";
export { HostMenu, FleetHostCard, HostEditorModal, RemoveHostDialog } from "./diagHostCards.jsx";
