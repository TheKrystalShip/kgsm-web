import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { KRYSTAL_PORT_DEFAULTS } from "../components/InstallModal.jsx";
import { KPI } from "../components/KPI.jsx";
import { ServerTile } from "../components/ServerCard.jsx";
import { canOn } from "../lib/persona.js";
import { useStore } from "../lib/store.js";
import { hostsStore } from "../lib/stores.js";
import { offeringHosts } from "./LibraryPage.jsx";

// GamePage — the "blueprint" detail page for a single catalog game. A game in
// the library is a TEMPLATE you can run, not a running server, so this page is
// the catalog's hub: what the game is, its default runtime specs, the servers
// you're already running from it, and a primary "Create server" action that
// opens the install modal. Reuses the shared card family — KPI (glance specs),
// BriefCard (About / defaults / your servers) and ServerTile (instances) — so
// it reads identically to the dashboard and server-detail pages.

// Blueprint copy + recommended runtime footprint per catalog game. In a real
// product this comes from the backend's game-defaults endpoint; here it's a
// small static map keyed by catalog id, with a generic fallback.
const GAME_BLUEPRINTS = {
  valheim:        { blurb: "A brutal exploration-and-survival game set in a procedurally generated Norse purgatory. Co-op focused for small groups, with building, sailing and boss progression.", storage: ["3.4", "GB"], ram: ["4", "GB"], config: "server.cfg", crossplay: true },
  ark:            { blurb: "Tame and ride dinosaurs across a hostile open world. Dedicated servers carry heavy persistent world state, so plan for generous RAM and disk.", storage: ["12", "GB"], ram: ["16", "GB"], config: "GameUserSettings.ini", crossplay: false },
  mc:             { blurb: "The sandbox standard — lightweight to host, endlessly modifiable, and friendly to groups of any size. Vanilla or modded, it runs almost anywhere.", storage: ["1.2", "GB"], ram: ["8", "GB"], config: "server.properties", crossplay: true },
  pal:            { blurb: "Creature-collection survival crafting built for big groups. One dedicated world supports up to 32 players building, battling and taming together.", storage: ["8", "GB"], ram: ["12", "GB"], config: "PalWorldSettings.ini", crossplay: false },
  rust:           { blurb: "Hardcore multiplayer survival with large populations and weekly wipes. Expect high CPU under load and plan a recurring reset schedule.", storage: ["6", "GB"], ram: ["12", "GB"], config: "server.cfg", crossplay: false },
  csgo:           { blurb: "Competitive 5v5 tactical shooter. Light, low-latency dedicated servers are ideal for scrims, leagues and community match-making.", storage: ["35", "GB"], ram: ["2", "GB"], config: "server.cfg", crossplay: false },
  tf2:            { blurb: "Class-based team shooter with a long-running community scene. Cheap to host and endlessly replayable across dozens of game modes.", storage: ["25", "GB"], ram: ["2", "GB"], config: "server.cfg", crossplay: false },
  garrysmod:      { blurb: "A physics sandbox on the Source engine. Game modes span roleplay, prop hunt and sandbox; mod and addon support is vast.", storage: ["12", "GB"], ram: ["4", "GB"], config: "server.cfg", crossplay: false },
  factorio:       { blurb: "Build and automate sprawling factories. The deterministic simulation keeps dedicated servers smooth even on huge late-game maps.", storage: ["2", "GB"], ram: ["4", "GB"], config: "server-settings.json", crossplay: true },
  tlauncher:      { blurb: "2D sandbox adventure for up to 8 players. A tiny footprint and quick start make it perfect for a spontaneous co-op world.", storage: ["0.5", "GB"], ram: ["2", "GB"], config: "serverconfig.txt", crossplay: true },
  satisfactory:   { blurb: "First-person factory building in an open alien world. Dedicated servers keep your production lines running around the clock.", storage: ["12", "GB"], ram: ["6", "GB"], config: "ServerSettings.ini", crossplay: true },
  enshrouded:     { blurb: "Survival action-RPG with voxel building for up to 16 players. Shared co-op progression across a shrouded fantasy realm.", storage: ["10", "GB"], ram: ["8", "GB"], config: "enshrouded_server.json", crossplay: false },
  lod:            { blurb: "Four-player co-op against the zombie horde. Lightweight Source-engine servers spin up fast for a campaign night.", storage: ["14", "GB"], ram: ["2", "GB"], config: "server.cfg", crossplay: false },
  projectzomboid: { blurb: "Isometric zombie survival for persistent groups. The server tracks a large, durable world that rewards long-running communities.", storage: ["3", "GB"], ram: ["6", "GB"], config: "servertest.ini", crossplay: false },
};

function gameBlueprint(id) {
  return GAME_BLUEPRINTS[id] || {
    blurb: "A dedicated game server you can spin up in a couple of clicks. Krystal handles the build download, port allocation and a starter config you can edit any time.",
    storage: ["3.4", "GB"], ram: ["4", "GB"], config: "server.cfg", crossplay: false,
  };
}

// Servers created from a catalog blueprint — the SINGLE match rule, shared by the
// blueprint detail page AND the library cards/counts so they can never drift.
// Match on the backend blueprint id; the rawg_slug branch is the mock path,
// guarded non-null on both sides or two slug-less live servers (rawg_slug:null)
// would match EVERY blueprint via null === null (a live data-corruption bug).
function instancesOfBlueprint(game, servers) {
  return (servers || []).filter(s =>
    (s.blueprint && s.blueprint === game.id) ||
    (s.rawg_slug && game.rawg_slug && s.rawg_slug === game.rawg_slug) ||
    s.id === game.id);
}

// Shared with the library grid (blueprint cards read the recommended footprint
// straight from here) so the catalog and detail page never disagree on specs.

// A single label → value spec line, in the shared chat-brief entry-line style
// (icon chip + title body + trailing value). Non-interactive, so it carries the
// --static modifier like the settings rows.
function SpecRow({ icon, label, value, mono, tone }) {
  return (
    <div className="chat-brief__item chat-brief__item--static">
      <span className="chat-brief__icon"><Icon name={icon} size={14} /></span>
      <div className="chat-brief__body">
        <span className="chat-brief__item-title"><span className="chat-brief__titletext">{label}</span></span>
      </div>
      <span style={{
        flexShrink: 0, color: "var(--fg-1)", fontSize: 13, fontWeight: 600,
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
        ...(tone === "muted" ? { color: "var(--fg-3)", fontWeight: 500 } : null),
      }}>{value}</span>
    </div>
  );
}

function GamePage({ game, servers, onCreate, onOpenServer, onAction, onBrowse }) {
  const bp = gameBlueprint(game.id);
  const pd = (KRYSTAL_PORT_DEFAULTS || {})[game.id] || { port: 27015, slots: 16 };
  // Which hosts offer this blueprint — derived live from the hosts store, so a
  // catalog sync (a host matching its offering to the fleet) re-renders here.
  const allHosts = useStore(hostsStore, s => s.list);
  const offered = offeringHosts ? offeringHosts(game, allHosts) : allHosts;
  const hostRestricted = offered.length > 0 && offered.length < allHosts.length;
  // Creating a server is its own capability, scoped per host: it's offered iff
  // the user can create on at least one host that offers this blueprint
  // (architecture.html §3·f·1). A read-only viewer never sees the entry point —
  // and the install modal's host picker is filtered to the same set.
  const canCreate = canOn ? offered.some(h => canOn("server.create", h.id)) : true;
  const availValue = hostRestricted ? offered.map(h => h.name).join(", ") : "All hosts";
  // Instances of THIS blueprint — shared helper so the detail page and the
  // library grid/counts always agree (robust to per-instance ids like "rust-ab12").
  const instances = instancesOfBlueprint(game, servers);
  const onlineCount = instances.filter(s => s.status === "online").length;
  const shortName = game.name.split(":")[0].trim();

  const cover = (window.useRawgCover && game.rawg_slug)
    ? window.useRawgCover({ rawg_slug: game.rawg_slug, art: game.art })
    : null;
  const artBg = cover
    ? `linear-gradient(135deg, rgba(11,15,20,0.45) 0%, transparent 60%), url("${cover}")`
    : game.art;

  const configFile = (instances[0] && instances[0].config && instances[0].config.file) || bp.config;

  const createBtn = canCreate ? (
    <button className="chip" style={{ background: "var(--krystal-teal)" }} onClick={() => onCreate(game)}>
      <Icon name="plus" size={14} strokeWidth={2.4} /> Create server
    </button>
  ) : null;

  return (
    <>
      {/* Hero — blueprint identity. Reuses the server-hero chrome so a game
          and a server read as the same kind of object header. */}
      <section className="hero">
        <div className="hero__art" style={{ background: artBg, backgroundSize: "cover", backgroundPosition: "center" }}></div>
        <div className="hero__veil"></div>
        <div className="hero__content">
          <h1 className="hero__name">{game.name}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--fg-3)", fontSize: 13, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="gamepad-2" size={13} /> {game.category}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="users" size={13} /> {game.players} players</span>
            {bp.crossplay && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="link" size={13} /> Crossplay</span>}
            {hostRestricted && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--warning-fg)" }}><Icon name="server" size={13} /> {availValue} only</span>}
          </div>
          <div className="action-row">
            {createBtn}
          </div>
        </div>
      </section>

      {/* Glance specs — the runtime footprint at a look, in the shared KPI card. */}
      <div className="dash-summary">
        <KPI icon="server" label="Your servers"
          value={instances.length}
          sub={instances.length ? `${onlineCount} online now` : "none yet — create one"}
          tone={instances.length ? "info" : "muted"} />
        <KPI icon="plug" label="Default port"
          value={pd.port} unit={pd.query ? "" : "UDP"}
          sub={pd.query ? `query ${pd.query}` : "game traffic"}
          tone="muted" />
        <KPI icon="users" label="Max players"
          value={pd.slots}
          sub={`${game.players} typical`}
          tone="muted" />
        <KPI icon="hard-drive" label="Disk footprint"
          value={bp.storage[0]} unit={bp.storage[1]}
          sub={`~${bp.ram[0]} ${bp.ram[1]} RAM recommended`}
          tone="muted" />
      </div>

      {/* About + Blueprint defaults — two matched cards in the dashboard band. */}
      <div className="dash-feed">
        <BriefCard icon="book-open" title={"About " + shortName}>
          <div className="chat-brief__body" style={{ display: "block" }}>
            <p style={{ margin: 0, color: "var(--fg-2)", fontSize: 13.5, lineHeight: 1.65 }}>{bp.blurb}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <span className="game-tag">{game.category}</span>
              <span className="game-tag">{game.players} players</span>
              <span className="game-tag">{bp.crossplay ? "Crossplay" : "Platform-locked"}</span>
            </div>
          </div>
        </BriefCard>

        <BriefCard icon="sliders-horizontal" title="Blueprint defaults">
          <div className="chat-brief__list">
            <SpecRow icon="server" label="Available on" value={availValue} tone={hostRestricted ? null : "muted"} />
            <SpecRow icon="plug" label="Game port" value={pd.port} mono />
            <SpecRow icon="radio" label="Query port" value={pd.query || "—"} mono tone={pd.query ? null : "muted"} />
            <SpecRow icon="users" label="Max players" value={pd.slots} mono />
            <SpecRow icon="file-cog" label="Config file" value={configFile} mono />
            <SpecRow icon="hard-drive" label="Recommended RAM" value={`${bp.ram[0]} ${bp.ram[1]}`} />
            <SpecRow icon="link" label="Crossplay" value={bp.crossplay ? "Supported" : "Not supported"} tone={bp.crossplay ? null : "muted"} />
          </div>
        </BriefCard>
      </div>

      {/* Your servers — every instance running from this blueprint. Same
          ServerTile cards as the dashboard / Servers page. Empty for a game
          you haven't installed yet, with the create CTA front and centre. */}
      <div className="chat-brief">
        <div className="chat-brief__head">
          <span className="chat-brief__title">
            <Icon name="server" size={13} /> Your servers
            {instances.length > 0 && <span className="chat-brief__count chat-brief__count--neutral">{instances.length}</span>}
          </span>
          {canCreate && instances.length > 0 && (
            <button className="dash-section__more" onClick={() => onCreate(game)}>
              Create another <Icon name="plus" size={11} strokeWidth={2.4} />
            </button>
          )}
        </div>
        <div className="chat-brief__body">
          {instances.length === 0 ? (
            <div className="game-empty">
              <Icon name="server-off" size={22} />
              <div className="game-empty__title">No {shortName} servers yet</div>
              <div className="game-empty__sub">Spin one up and Krystal handles the build download, ports and a starter config.</div>
              <div style={{ marginTop: 6 }}>{createBtn}</div>
            </div>
          ) : (
            <div className="server-grid">
              {instances.map(s => (
                <ServerTile key={s.id} server={s} onOpen={onOpenServer} onAction={onAction} showHost />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export { GAME_BLUEPRINTS, GamePage, gameBlueprint, instancesOfBlueprint };
