// placement.js — the measured node recommendation for an install.
//
// A node is chosen because it MEASURABLY has room, never because it is first in
// a list. The inputs are the blueprint's declared requirements (advisory MB
// integers on the library entry's `specs`) against the node's live capacity
// (GiB doubles on the host record, sampled by kgsm-monitor). Units reconcile at
// 1 GiB = 1024 MiB.
//
// CPU is not a dimension. The blueprint schema carries no CPU requirement — a
// single number can't represent CPU capability — so placement reasons over RAM
// and disk headroom only.
//
// Honesty rules, in order of precedence:
//   - A node whose capacity isn't measured is "unknown", never assumed roomy.
//   - A blueprint that declares nothing leaves every node "unknown".
//   - A verdict names exactly which dimensions it checked; an undeclared
//     dimension is reported as undeclared, never treated as satisfied.
//   - Only a measured fit is recommended. "unknown" is selectable with its
//     honesty shown and is never ranked as if it fit.

import { fmtFootprintMb } from "./formatting.js";

const MIB_PER_GIB = 1024;

const toMib = (gib) => (gib == null || !Number.isFinite(gib) ? null : gib * MIB_PER_GIB);

// Verdicts, worst to best. `offline` and `insufficient` are never recommended;
// `unknown` is never recommended either — it is an absence of evidence, not
// evidence of room.
const FIT_RANK = { offline: 0, insufficient: 1, unknown: 2, tight: 3, fits: 4 };
const RECOMMENDABLE = { fits: true, tight: true };

const FIT_LABEL = {
  fits: "fits",
  tight: "tight",
  insufficient: "not enough room",
  unknown: "fit unknown",
  offline: "offline",
};

// The mount with the most room. The SPA can't know which filesystem KGSM
// installs into on a given node, so the honest reading is "this node has room
// somewhere" — and the mount is named so the operator can judge it.
function roomiestMount(host) {
  const disks = (host && host.disks) || [];
  let best = null;
  for (const d of disks) {
    if (!d || !d.total_gb) continue;
    const freeGb = d.total_gb - (d.used_gb || 0);
    if (!best || freeGb > best.freeGb) best = { mount: d.mount, freeGb };
  }
  return best;
}

// What a blueprint declares it needs. `recommendedRamMb` is the target and
// `minRamMb` the floor; a blueprint may declare either, both, or neither.
function requirementOf(game) {
  const specs = (game && game.specs) || null;
  return {
    minRamMb: (specs && specs.minRamMb != null) ? specs.minRamMb : null,
    wantRamMb: (specs && specs.recommendedRamMb != null) ? specs.recommendedRamMb : null,
    diskMb: (specs && specs.baseDiskMb != null) ? specs.baseDiskMb : null,
  };
}

// One node's fit for one blueprint. Returns the verdict plus every number that
// produced it, so the UI can show the reasoning rather than a bare word.
function nodeFit(game, host) {
  const req = requirementOf(game);
  const freeRamMb = (host && host.ram && host.ram.total_gb) ? toMib(host.ram.free_gb) : null;
  const mount = roomiestMount(host);
  const freeDiskMb = mount ? toMib(mount.freeGb) : null;
  const base = {
    hostId: host ? host.id : null,
    freeRamMb, freeDiskMb,
    mount: mount ? mount.mount : null,
    minRamMb: req.minRamMb, wantRamMb: req.wantRamMb, diskMb: req.diskMb,
    checked: [],
  };

  if (host && host.online === false) return { ...base, fit: "offline" };

  // Nothing declared, or nothing measured, on either dimension.
  const ramKnown = freeRamMb != null && (req.minRamMb != null || req.wantRamMb != null);
  const diskKnown = freeDiskMb != null && req.diskMb != null;
  if (!ramKnown && !diskKnown) return { ...base, fit: "unknown" };

  const checked = [];
  if (ramKnown) checked.push("ram");
  if (diskKnown) checked.push("disk");

  if (diskKnown && freeDiskMb < req.diskMb) return { ...base, checked, fit: "insufficient" };
  if (ramKnown) {
    const floor = req.minRamMb != null ? req.minRamMb : req.wantRamMb;
    if (freeRamMb < floor) return { ...base, checked, fit: "insufficient" };
    // Above the floor but under the recommendation is a real fit, reported as
    // the compromise it is rather than as a clean one.
    if (req.wantRamMb != null && freeRamMb < req.wantRamMb) return { ...base, checked, fit: "tight" };
  }
  return { ...base, checked, fit: "fits" };
}

// Every candidate node's fit, best first. Ties break on measured free RAM, so
// the order is always something that was sampled — never list position.
function rankNodes(game, hosts) {
  return (hosts || [])
    .map(h => nodeFit(game, h))
    .sort((a, b) => {
      const d = FIT_RANK[b.fit] - FIT_RANK[a.fit];
      if (d) return d;
      return (b.freeRamMb || 0) - (a.freeRamMb || 0);
    });
}

// The node to preselect, or null when nothing measured earns it. A null means
// the user picks — which is the correct outcome, not a reason to fall back to
// the first node.
function recommendedNode(game, hosts) {
  const ranked = rankNodes(game, hosts);
  const best = ranked[0];
  return best && RECOMMENDABLE[best.fit] ? best.hostId : null;
}

// The one-line reasoning behind a verdict, in the same numbers that produced it.
// Every clause is either a measurement or a named absence — there is no wording
// here that stands in for a value we don't have.
function fitSummary(f) {
  if (!f) return "";
  const mb = fmtFootprintMb;
  if (f.fit === "offline") return "This node is offline — it can't take an install right now.";

  const gaps = [];
  if (f.minRamMb == null && f.wantRamMb == null) gaps.push("declares no RAM requirement");
  else if (f.freeRamMb == null) gaps.push("reports no memory reading");
  if (f.diskMb == null) gaps.push("declares no install size");
  else if (f.freeDiskMb == null) gaps.push("reports no disk reading");
  const gapText = gaps.length ? gaps.join(" and ") : null;

  if (f.fit === "unknown") {
    return "Fit unknown — this blueprint " + (gapText || "and node have nothing to compare") + ".";
  }

  const where = f.mount ? " on " + f.mount : "";
  const need = f.wantRamMb != null ? f.wantRamMb : f.minRamMb;
  const parts = [];
  if (f.checked.includes("ram")) parts.push(mb(f.freeRamMb) + " RAM free of " + mb(need) + " wanted");
  if (f.checked.includes("disk")) parts.push(mb(f.freeDiskMb) + " free" + where + " for a " + mb(f.diskMb) + " install");
  const measured = parts.join(" · ");

  if (f.fit === "insufficient") return "Not enough room — " + measured + ".";
  if (f.fit === "tight") {
    return "Tight — " + measured + " (clears the " + mb(f.minRamMb) + " minimum)"
      + (gapText ? "; this blueprint " + gapText : "") + ".";
  }
  return "Fits — " + measured + (gapText ? "; this blueprint " + gapText : "") + ".";
}

export { FIT_LABEL, fitSummary, nodeFit, rankNodes, recommendedNode };
