import React from "react";

import { GameCard, libraryNow } from "../../../components/GameCard.jsx";
import { useNav } from "../../../components/NavContext.jsx";
import { Rail } from "../../../components/Rail.jsx";
import { KRYSTAL_LABELS } from "../../../lib/labels.js";
import { fleetHeadroom, instancesOfBlueprint } from "../../../lib/servers.js";
import { useStore } from "../../../lib/store.js";
import { hostsStore, libraryStore, serversStore } from "../../../lib/stores.js";

// CatalogRail — the whole installable library on a rail, ordered so the actionable half comes first:
// what you could add, then what you already run.
//
// The card is the Catalog page's card, rendered with the Catalog page's inputs. A blueprint says the
// same things about itself wherever it is shown — its capacity, its footprint, whether it fits, what
// is already running from it — and a rail carrying a thinner version of it would be a second card to
// keep in agreement with the first.
//
// The backend blueprint catalog carries no "added" date (the LibraryEntry DTO has no timestamp), so
// within each half the order is alphabetical — predictable enough to find a game in, which is what
// matters once the rail reaches all of them.

function CatalogRail() {
  const nav = useNav();
  const library = useStore(libraryStore, s => s.list);
  const servers = useStore(serversStore, s => s.list);
  const allHosts = useStore(hostsStore, s => s.list);

  // What a fit is measured against, resolved ONCE for the rail: it is a fact about a machine, so
  // every card compares to the same reading rather than each asking for its own.
  const headroom = React.useMemo(() => fleetHeadroom(allHosts), [allHosts]);
  // What "recently" means, taken across the whole catalog rather than per card — a blueprint is new
  // relative to the rest of the library, not to itself.
  const now = React.useMemo(() => libraryNow(library), [library]);

  const ordered = React.useMemo(() => [...library].sort((a, b) => {
    const ia = instancesOfBlueprint(a, servers).length ? 1 : 0;
    const ib = instancesOfBlueprint(b, servers).length ? 1 : 0;
    if (ia !== ib) return ia - ib;
    return String(a.name || "").localeCompare(String(b.name || ""));
  }), [library, servers]);

  return (
    <Rail
      variant="catalog"
      icon="library"
      title={KRYSTAL_LABELS.catalog || "Catalog"}
      count={library.length}
      items={ordered}
      onViewAll={() => nav.library()}
      // No `onDeploy`: an install is a form — a node, a name, a port — and the rail has nowhere to
      // put one. The card reads "View" and the game's own page is where the deploy lives, which is
      // the same answer it gives a viewer on the Catalog page.
      renderItem={g => <GameCard game={g} addedNow={now} headroom={headroom} onPick={() => nav.openGame(g.id)} />}
    />
  );
}

export { CatalogRail };
export default CatalogRail;
