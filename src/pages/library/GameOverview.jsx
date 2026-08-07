import { BriefCard } from "../../components/BriefCard.jsx";
import { KPI } from "../../components/KPI.jsx";
import { GamePlacement, roomyNodes } from "./GamePlacement.jsx";
import { fmtFootprintMb } from "../../lib/formatting.js";
import { rankNodes } from "../../lib/placement.js";

// GameOverview — the blueprint detail page's first tab: what this game is, and
// whether the cluster can take it. Everything the blueprint *declares* (ports,
// steam ids, resource specs) lives on the Blueprint tab; this one answers the two
// questions someone opening a catalog entry actually has — "what is it" and
// "where would it go".

// The placement KPI. A node with nothing to compare is `unknown`, which is an
// absence of evidence, not a zero: with no measured verdict anywhere the tile
// shows an em dash and says why, rather than reporting "0 of 3" as if the fleet
// had been measured and found wanting.
function placementKpi(game, hosts) {
  const ranked = rankNodes(game, hosts);
  const measured = ranked.filter(f => f.fit !== "unknown");
  const roomy = roomyNodes(game, hosts);
  if (!ranked.length) return { value: "—", sub: "no node offers this blueprint", tone: "muted" };
  if (!measured.length) return { value: "—", sub: "nothing measurable to compare", tone: "muted" };
  const best = roomy[0];
  const hostName = (id) => { const h = (hosts || []).find(x => x.id === id); return h ? h.name : id; };
  return {
    value: roomy.length + " of " + ranked.length,
    sub: best ? hostName(best.hostId) + " has the most room" : "no node measures as having room",
    tone: roomy.length === 0 ? "danger" : (roomy.every(f => f.fit === "fits") ? "ok" : "warn"),
  };
}

function GameOverview({ game, hosts, instances }) {
  const onlineCount = instances.filter(s => s.status === "online").length;
  const recRamMb = game.specs ? game.specs.recommendedRamMb : null;
  const diskMb = game.specs ? game.specs.baseDiskMb : null;
  const shortName = game.name.split(":")[0].trim();
  const fit = placementKpi(game, hosts);

  // Description precedence: API `description` → nothing. Never fabricate copy the
  // backend didn't serve.
  const description = game.description ?? null;
  // RAWG metadata chips — genres then a few top tags. Guard undefined (only some
  // catalog entries carry them) and hide when empty.
  const genres = game.genres || [];
  const tags = game.tags || [];
  const metaChips = [...genres, ...tags.slice(0, 6)];
  // Show the RAWG attribution only where real RAWG-sourced data is displayed.
  const hasRawgData = !!(game.description || genres.length || tags.length);

  return (
    <>
      {/* Glance stats — what you have, and whether the fleet can take another. */}
      <div className="dash-summary">
        <KPI icon="server" label="Your servers"
          value={instances.length}
          sub={instances.length ? `${onlineCount} online now` : "none yet — create one"}
          tone={instances.length ? "info" : "muted"} />
        <KPI icon="server-cog" label="Nodes with room"
          value={fit.value} sub={fit.sub} tone={fit.tone} />
        <KPI icon="memory-stick" label="Recommended RAM"
          value={fmtFootprintMb(recRamMb)}
          sub={recRamMb != null ? "per server" : "not specified yet"}
          tone="muted" />
        <KPI icon="hard-drive" label="Disk footprint"
          value={fmtFootprintMb(diskMb)}
          sub={diskMb != null ? "base install" : "not specified yet"}
          tone="muted" />
      </div>

      <div className="dash-feed">
        <BriefCard icon="book-open" title={"About " + shortName}>
          <div className="chat-brief__body" style={{ display: "block" }}>
            {description && (
              <p style={{ margin: 0, color: "var(--fg-2)", fontSize: 13.5, lineHeight: 1.65 }}>{description}</p>
            )}
            {/* RAWG genres + top tags when present; otherwise the coarse
                category / players chips (only what the backend honestly backs). */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: description ? 14 : 0 }}>
              {metaChips.length > 0
                ? metaChips.map(t => <span key={t} className="game-tag">{t}</span>)
                : (<>
                    <span className="game-tag">{game.category}</span>
                    {game.players != null && <span className="game-tag">{game.players} players</span>}
                  </>)}
            </div>
            {hasRawgData && (
              <div style={{ marginTop: 14, fontSize: 11.5, color: "var(--fg-3)" }}>
                Game data from <a href="https://rawg.io" target="_blank" rel="noreferrer noopener"
                  style={{ color: "var(--fg-2)" }}>RAWG.io</a>
              </div>
            )}
          </div>
        </BriefCard>

        <GamePlacement game={game} hosts={hosts} />
      </div>
    </>
  );
}

export { GameOverview };
export default GameOverview;
