// servers.js — shared server-related pure helpers, extracted from page files.

// ---------- Blueprint matching ----------

// Servers created from a catalog blueprint — the SINGLE match rule, shared by the
// blueprint detail page AND the library cards/counts so they can never drift.
// Match on the backend blueprint id; the rawg_slug branch is a fallback, guarded
// non-null on both sides or two slug-less servers (rawg_slug:null) would match
// EVERY blueprint via null === null (a data-corruption bug).
function instancesOfBlueprint(game, servers) {
  return (servers || []).filter(s =>
    (s.blueprint && s.blueprint === game.id) ||
    (s.rawg_slug && game.rawg_slug && s.rawg_slug === game.rawg_slug) ||
    s.id === game.id);
}

// ---------- Host availability ----------

// A blueprint is offered by one or more connected hosts. `game.hosts` (a list
// of host ids) names them; ABSENT means "offered everywhere" (identical catalog
// across the fleet — the common case). Only a subset is worth surfacing.
function offeringHosts(game, allHosts) {
  const ids = Array.isArray(game.hosts) ? game.hosts : null;
  if (!ids) return allHosts || [];
  return (allHosts || []).filter(h => ids.includes(h.id));
}

// Short label shown on the card / detail page — null when the game is on every
// host (nothing to flag). One host → "Primary only"; a subset → "2 of 3 hosts".
function hostAvailabilityLabel(game, allHosts) {
  const all = allHosts || [];
  const off = offeringHosts(game, all);
  if (!all.length || off.length >= all.length || off.length === 0) return null;
  if (off.length === 1) return off[0].name + " only";
  return off.length + " of " + all.length + " hosts";
}

export { hostAvailabilityLabel, instancesOfBlueprint, offeringHosts };
