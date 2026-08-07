import { BriefCard } from "../../components/BriefCard.jsx";
import { SettingsRow } from "../../components/settings-primitives.jsx";
import { fmtFootprintMb } from "../../lib/formatting.js";

// GameBlueprintTab — everything the blueprint DECLARES, structured, so nobody has
// to open the YAML to answer a question about it. Read-only: the file itself is
// edited on the File tab, which is where the write gate lives.
//
// Viewer-visible, deliberately: every field here comes from `GET /library`, which
// the API serves at viewer. Gating the rendering of a payload the reader already
// holds would be theatre, not access control.
//
// The em dash is the whole vocabulary for "the blueprint declares nothing here" —
// a spec is nullable per blueprint and a missing one is never shown as a zero.

const DASH = "—";

// A fact's value: mono by default, because most of these are ports, ids and
// sizes that want to line up. `ui` opts a word out of it, `muted` marks an
// honest absence.
function Fact({ children, ui, muted }) {
  return (
    <span className={"game-fact" + (ui ? " game-fact--ui" : "") + (muted ? " game-fact--muted" : "")}>
      {children}
    </span>
  );
}

// A declared value, or the em dash when the blueprint carries none.
function Declared({ value, ui }) {
  return value == null || value === ""
    ? <Fact muted>{DASH}</Fact>
    : <Fact ui={ui}>{value}</Fact>;
}

// One port range, in the canonical {start, end, proto} shape kgsm emits. A single
// port has start == end and reads as one number rather than a degenerate range.
const portText = (p) => (p.start === p.end ? String(p.start) : p.start + "–" + p.end);

function GameBlueprintTab({ game, offeringHosts, allHosts }) {
  const specs = game.specs || {};
  const ports = game.ports || [];
  const restricted = offeringHosts.length > 0 && offeringHosts.length < (allHosts || []).length;
  const isContainer = game.type === "container";
  const steamAppId = game.steamAppId;
  const clientAppId = game.clientSteamAppId;
  const slug = game.rawg_slug;

  return (
    <div className="dash-feed">
      <BriefCard icon="box" title="Runtime">
        <div className="chat-brief__list">
          <SettingsRow icon={isContainer ? "container" : "cpu"} title="Runs as"
            sub={isContainer
              ? "A Docker container, from the compose embedded in the blueprint."
              : "A native process, supervised in its own cgroup by the watchdog."}>
            <Declared value={game.type} ui />
          </SettingsRow>
          <SettingsRow icon="file-code" title="Blueprint"
            sub="The engine name this blueprint is known by.">
            <Declared value={game.id} />
          </SettingsRow>
          <SettingsRow icon="server" title="Available on"
            sub={restricted
              ? "Only these nodes carry this blueprint — a server can be created nowhere else."
              : "Every node in the cluster carries this blueprint."}>
            <Fact ui={!restricted}>
              {restricted ? offeringHosts.map(h => h.name).join(", ") : "All nodes"}
            </Fact>
          </SettingsRow>
        </div>
      </BriefCard>

      <BriefCard icon="plug" title="Default ports" count={ports.length || null} countTone="neutral">
        {ports.length === 0 ? (
          <div className="chat-brief__empty chat-brief__empty--neutral">
            <div className="chat-brief__empty-title">No ports declared</div>
            <div className="chat-brief__empty-sub">
              {isContainer
                ? "Container ports are derived from the embedded compose at install time."
                : "This blueprint declares no default ports."}
            </div>
          </div>
        ) : (
          <div className="chat-brief__list">
            {ports.map((p, i) => (
              <SettingsRow key={p.proto + ":" + p.start + ":" + p.end + ":" + i}
                icon={p.proto === "udp" ? "radio" : "plug"}
                title={(p.proto || "").toUpperCase()}
                sub={p.start === p.end ? "one port" : (p.end - p.start + 1) + " ports"}>
                <Fact>{portText(p)}</Fact>
              </SettingsRow>
            ))}
          </div>
        )}
      </BriefCard>

      <BriefCard icon="gauge" title="Resources"
        meta="Advisory values the blueprint declares — what a server is sized against, not a measurement.">
        <div className="chat-brief__list">
          <SettingsRow icon="users" title="Max players"
            sub="What the blueprint declares this game supports.">
            <Declared value={specs.maxPlayers} />
          </SettingsRow>
          <SettingsRow icon="memory-stick" title="Minimum RAM"
            sub="Below this, don't expect it to run.">
            <Declared value={specs.minRamMb != null ? fmtFootprintMb(specs.minRamMb) : null} />
          </SettingsRow>
          <SettingsRow icon="memory-stick" title="Recommended RAM"
            sub="What placement sizes a node against.">
            <Declared value={specs.recommendedRamMb != null ? fmtFootprintMb(specs.recommendedRamMb) : null} />
          </SettingsRow>
          <SettingsRow icon="hard-drive" title="Base install"
            sub="The download and unpacked build, before any world data.">
            <Declared value={specs.baseDiskMb != null ? fmtFootprintMb(specs.baseDiskMb) : null} />
          </SettingsRow>
        </div>
      </BriefCard>

      <BriefCard icon="link" title="External catalogs"
        meta="The ids KGSM downloads the build with, and the catalog the art and blurb come from.">
        <div className="chat-brief__list">
          <SettingsRow icon="download" title="Steam app (server)"
            sub="The dedicated-server depot steamcmd installs.">
            <Declared value={steamAppId} />
          </SettingsRow>
          <SettingsRow icon="gamepad-2" title="Steam app (client)"
            sub="The game players own — the store page to connect from.">
            {clientAppId
              ? <a className="game-fact" href={"https://store.steampowered.com/app/" + clientAppId + "/"}
                  target="_blank" rel="noreferrer noopener">{clientAppId}</a>
              : <Fact muted>{DASH}</Fact>}
          </SettingsRow>
          <SettingsRow icon="lock" title="Steam account"
            sub="Whether the server build can be downloaded anonymously.">
            {game.steamAccountRequired == null
              ? <Fact muted>{DASH}</Fact>
              : <Fact ui>{game.steamAccountRequired ? "Required" : "Not required"}</Fact>}
          </SettingsRow>
          <SettingsRow icon="image" title="RAWG slug"
            sub="The lookup hint the cover art and description resolve from.">
            {slug
              ? <a className="game-fact" href={"https://rawg.io/games/" + slug}
                  target="_blank" rel="noreferrer noopener">{slug}</a>
              : <Fact muted>{DASH}</Fact>}
          </SettingsRow>
        </div>
      </BriefCard>
    </div>
  );
}

export { GameBlueprintTab };
export default GameBlueprintTab;
