// LeafSettingsTab — the leaf page's Settings tab. Every knob a leaf declares is already rendered,
// grouped, provenance-annotated, reviewed and applied by LeafConfigPage; this mounts that in its
// embedded form (body only, no second title or tab strip) scoped to one leaf.
//
// It exists as its own file purely so the tab list in LeafPage reads uniformly. There is deliberately
// no logic here: a second implementation of the config surface would drift from the one the
// standalone page uses, and the descriptor contract is the same either way.

import { LeafConfigPage } from "../leafConfig/LeafConfigPage.jsx";

function LeafSettingsTab({ hostId, leafId }) {
  // onSelectLeaf is unreachable in embedded mode (the leaf strip is what calls it) — the leaf is
  // fixed by the page's own route.
  return <LeafConfigPage hostId={hostId} leafId={leafId} embedded onSelectLeaf={() => {}} onBackToHost={() => {}} />;
}

export { LeafSettingsTab };
