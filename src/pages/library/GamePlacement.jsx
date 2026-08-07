import { BriefCard } from "../../components/BriefCard.jsx";
import { SettingsRow } from "../../components/settings-primitives.jsx";
import { fmtFootprintMb } from "../../lib/formatting.js";
import { FIT_LABEL, fitSummary, rankNodes } from "../../lib/placement.js";

// GamePlacement — "can this blueprint run on my fleet?", answered per node in the
// numbers that produced the answer. It is the join between the catalog and the
// cluster: the blueprint's declared RAM/disk against each node's live headroom.
//
// Every verdict comes from lib/placement.js, the same module the install modal
// preselects a node with, so the page and the modal can never disagree about
// where a game fits. Nothing is computed here — this file only renders.

// A verdict's tone (left rule + icon chip, via the shared brief-item modifiers)
// and its glyph. `unknown` is deliberately untoned: an absence of evidence is not
// a warning, and colouring it would read as a judgement we haven't measured.
const FIT_TONE = { fits: "success", tight: "warn", insufficient: "danger", offline: "danger", unknown: null };
const FIT_ICON = { fits: "check", tight: "alert-triangle", insufficient: "ban", offline: "power", unknown: "help-circle" };

// What the blueprint asks for, as a header strip. Each clause is present only
// when the blueprint declares it — an undeclared requirement is named as such
// rather than shown as a zero.
function requirementLine(game) {
  const specs = (game && game.specs) || {};
  const parts = [];
  if (specs.recommendedRamMb != null) {
    parts.push(fmtFootprintMb(specs.recommendedRamMb) + " RAM"
      + (specs.minRamMb != null ? " (" + fmtFootprintMb(specs.minRamMb) + " minimum)" : ""));
  } else if (specs.minRamMb != null) {
    parts.push(fmtFootprintMb(specs.minRamMb) + " RAM minimum");
  }
  if (specs.baseDiskMb != null) parts.push(fmtFootprintMb(specs.baseDiskMb) + " install");
  return parts.length ? "Needs " + parts.join(" · ") : "This blueprint declares no RAM or disk requirement.";
}

// The nodes that both offer this blueprint and measure as having room. Used for
// the Overview KPI as well, so the card and the tile always count the same thing.
function roomyNodes(game, hosts) {
  return rankNodes(game, hosts).filter(f => f.fit === "fits" || f.fit === "tight");
}

function GamePlacement({ game, hosts }) {
  const ranked = rankNodes(game, hosts);

  return (
    <BriefCard icon="server-cog" title="Where this can run"
      count={ranked.length || null} countTone="neutral"
      meta={requirementLine(game)}>
      {ranked.length === 0 ? (
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">No node offers this blueprint</div>
          <div className="chat-brief__empty-sub">Nothing in the cluster carries it, so there is nowhere to install it.</div>
        </div>
      ) : (
        <div className="chat-brief__list">
          {ranked.map(f => {
            const host = (hosts || []).find(h => h.id === f.hostId);
            return (
              <SettingsRow key={f.hostId} icon={FIT_ICON[f.fit]} tone={FIT_TONE[f.fit]}
                title={host ? host.name : f.hostId}
                sub={fitSummary(f)}>
                <span className="game-tag">{FIT_LABEL[f.fit]}</span>
              </SettingsRow>
            );
          })}
        </div>
      )}
    </BriefCard>
  );
}

export { GamePlacement, roomyNodes };
export default GamePlacement;
