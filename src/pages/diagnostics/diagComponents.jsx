// DiagnosticsPage shared components — barrel (#8 split). The grab-bag of nine
// components was carved into two cohesive modules; this file re-exports them so
// every consumer (DiagServices / DiagResources / DiagOverview /
// DiagnosticsPage) keeps importing from the same path.
//   • diagLeafCards.jsx — StatusLed, ServicesSummaryCard
//   • diagHostCards.jsx — a node's own controls (NodeEditButton, HostEditorModal)

export { StatusLed, ServicesSummaryCard } from "./diagLeafCards.jsx";
export { NodeEditButton, HostEditorModal } from "./diagHostCards.jsx";
