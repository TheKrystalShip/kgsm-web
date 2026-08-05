// DiagnosticsPage shared components — barrel (#8 split). The grab-bag of nine
// components was carved into two cohesive modules; this file re-exports them so
// every consumer (DiagServices / DiagResources / DiagOverview /
// DiagnosticsPage) keeps importing from the same path.
//   • diagLeafCards.jsx — StatusLed, ServicesSummaryCard
//   • diagHostCards.jsx — host/fleet cards + host modals (HostMenu, FleetHostCard,
//     HostEditorModal, RemoveHostDialog)

export { StatusLed, ServicesSummaryCard } from "./diagLeafCards.jsx";
export { HostMenu, FleetHostCard, HostEditorModal, RemoveHostDialog } from "./diagHostCards.jsx";
