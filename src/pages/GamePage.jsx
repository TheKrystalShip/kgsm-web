import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { KPI } from "../components/KPI.jsx";
import { ServerTile } from "../components/ServerCard.jsx";
import { canOn } from "../lib/persona.js";
import { useStore } from "../lib/store.js";
import { hostsStore } from "../lib/stores.js";
import { fmtFootprintMb, offeringHosts } from "./LibraryPage.jsx";

// GamePage — the "blueprint" detail page for a single catalog game. A game in
// the library is a TEMPLATE you can run, not a running server, so this page is
// the catalog's hub: what the game is, its default runtime specs, the servers
// you're already running from it, and a primary "Create server" action that
// opens the install modal. Reuses the shared card family — KPI (glance specs),
// BriefCard (About / defaults / your servers) and ServerTile (instances) — so
// it reads identically to the dashboard and server-detail pages.

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
  // Runtime facts come STRAIGHT from the backend blueprint DTO — never a
  // hardcoded per-game map. `ports` is served today (kgsm parses it from the
  // blueprint), so the game port is real; `specs` (maxPlayers / recommendedRamMb
  // / baseDiskMb) is null on every blueprint until metadata curation lands
  // upstream, so those render an honest em dash via fmtFootprintMb.
  const primaryPort = (game.ports && game.ports[0]) || null;
  const gamePort = primaryPort ? primaryPort.start : null;
  const portProto = primaryPort && primaryPort.proto ? primaryPort.proto.toUpperCase() : "";
  const maxPlayers = (game.specs && game.specs.maxPlayers != null) ? game.specs.maxPlayers : null;
  const recRamMb = game.specs ? game.specs.recommendedRamMb : null;
  const diskMb = game.specs ? game.specs.baseDiskMb : null;
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

  // kgsm-api serves cover/hero as absolute, directly-renderable URLs — the detail
  // page prefers the hero (a screenshot/detail image) then the cover, then the
  // themed `art` gradient when neither is present.
  const heroImg = game.hero || game.cover || null;
  const artBg = heroImg
    ? `linear-gradient(135deg, rgba(11,15,20,0.45) 0%, transparent 60%), url("${heroImg}")`
    : game.art;
  // Description precedence (decision 6): API `description` → nothing. Never
  // fabricate copy the backend didn't serve.
  const description = game.description ?? null;
  // RAWG metadata chips — genres then a few top tags. Guard undefined (only some
  // catalog entries carry them) and hide when empty.
  const genres = game.genres || [];
  const tags = game.tags || [];
  const metaChips = [...genres, ...tags.slice(0, 6)];
  // Show the RAWG attribution only where real RAWG-sourced data is displayed.
  const hasRawgData = !!(game.description || genres.length || tags.length);

  // The config file is a real per-instance fact (the running server's config
  // path); a blueprint with no servers yet has no honest source → em dash.
  const configFile = (instances[0] && instances[0].config && instances[0].config.file) || null;

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
        <div className="hero__art" style={{ backgroundImage: artBg, backgroundSize: "cover", backgroundPosition: "center" }}></div>
        <div className="hero__veil"></div>
        <div className="hero__content">
          <h1 className="hero__name">{game.name}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--fg-3)", fontSize: 13, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="gamepad-2" size={13} /> {game.category}</span>
            {game.players != null && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="users" size={13} /> {game.players} players</span>}
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
          value={gamePort != null ? gamePort : "—"} unit={gamePort != null ? portProto : ""}
          sub="game traffic"
          tone="muted" />
        <KPI icon="users" label="Max players"
          value={maxPlayers != null ? maxPlayers : "—"}
          sub={maxPlayers != null ? "blueprint default" : "not specified yet"}
          tone="muted" />
        <KPI icon="hard-drive" label="Disk footprint"
          value={fmtFootprintMb(diskMb)}
          sub={`${fmtFootprintMb(recRamMb)} RAM recommended`}
          tone="muted" />
      </div>

      {/* About + Blueprint defaults — two matched cards in the dashboard band. */}
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

        <BriefCard icon="sliders-horizontal" title="Blueprint defaults">
          <div className="chat-brief__list">
            <SpecRow icon="server" label="Available on" value={availValue} tone={hostRestricted ? null : "muted"} />
            <SpecRow icon="plug" label="Game port" value={gamePort != null ? gamePort : "—"} mono tone={gamePort != null ? null : "muted"} />
            <SpecRow icon="radio" label="Query port" value="—" mono tone="muted" />
            <SpecRow icon="users" label="Max players" value={maxPlayers != null ? maxPlayers : "—"} mono tone={maxPlayers != null ? null : "muted"} />
            <SpecRow icon="file-cog" label="Config file" value={configFile || "—"} mono tone={configFile ? null : "muted"} />
            <SpecRow icon="hard-drive" label="Recommended RAM" value={fmtFootprintMb(recRamMb)} tone={recRamMb != null ? null : "muted"} />
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

export { GamePage, instancesOfBlueprint };
