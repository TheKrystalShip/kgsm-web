import { Icon } from "./Icon.jsx";
import { can } from "../lib/persona.js";
import { useStore } from "../lib/store.js";
import { hostsStore, serversStore } from "../lib/stores.js";
import { artBg } from "../lib/art.js";
import { fmtFootprintMb } from "../lib/formatting.js";
import { blueprintFit, hostAvailabilityLabel, instancesOfBlueprint } from "../lib/servers.js";

// GameCard.jsx — the catalog game card. One card, wherever a blueprint is shown: the Catalog page's
// grid and the dashboard's catalog rail render the same component with the same props, so a fact
// added to it appears on both and neither can quietly say less than the other.
//
// `onDeploy` and `headroom` are OPTIONAL, and their absence is a fact rather than a lesser variant.
// A surface that cannot start an install passes no `onDeploy` and the card's action reads "View"; a
// surface with no measured headroom passes none and the fit chip stays quiet rather than guessing.

// "Recently added" helpers (shared with LibraryPage).
const RECENT_WINDOW_DAYS = 30;
const NEW_WINDOW_DAYS = 14;

function libraryNow(list) {
  const times = (list || []).map(g => g.addedAt ? +new Date(g.addedAt) : 0).filter(Boolean);
  return times.length ? new Date(Math.max(...times)) : new Date();
}

function GameCard({ game, onPick, onDeploy, addedNow, headroom }) {
  const servers = useStore(serversStore, s => s.list);
  const allHosts = useStore(hostsStore, s => s.list);
  const instances = instancesOfBlueprint(game, servers);
  const count = instances.length;
  const onlineCount = instances.filter(s => s.status === "online").length;
  const bg = game.cover
    ? `linear-gradient(180deg, transparent 0%, rgba(11,15,20,0.55) 100%), url("${game.cover}")`
    : artBg(game.hero, null);

  const now = addedNow || libraryNow([game]);
  const addedMs = game.addedAt ? +new Date(game.addedAt) : 0;
  const isNew = !count && addedMs && (+now - addedMs) <= NEW_WINDOW_DAYS * 86400000;
  const installed = count > 0;
  const hostLabel = hostAvailabilityLabel(game, allHosts);
  const canDeploy = !installed && !!onDeploy && can("server.create");
  // What this card can say in its one status slot, in precedence order.
  // `steamAccountRequired` is a real boolean from the blueprint, so an unknown (null) is NOT a gate —
  // only an explicit true is, and the card stays quiet rather than warning about a requirement nobody
  // stated.
  const gate = game.steamAccountRequired === true
    ? { label: "Steam account", title: "Installing " + game.name + " needs Steam credentials on this host" }
    : null;
  const fit = installed || gate ? null : blueprintFit(game, headroom);
  const fitTitle = !fit ? undefined
    : "Recommends " + fit.needGb.toFixed(fit.needGb < 10 ? 1 : 0) + " GB"
      + (fit.hostName ? " · " + fit.hostName : "") + " has " + fit.freeGb + " GB free right now"
      + " — a comparison of two measured figures, not a guarantee";

  return (
    <article
      className={"bp-card" + (installed ? " bp-card--installed" : "")}
      onClick={() => onPick(game)}
      role="button" tabIndex={0}
      onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); onPick(game); } }}
    >
      <div className="bp-card__art" style={{ backgroundImage: bg, backgroundSize: "cover", backgroundPosition: "center" }}>
        {hostLabel && (
          <span className="bp-card__host" title={"Only available on " + hostLabel.replace(/ only$/, "")}>
            <Icon name="server" size={11} strokeWidth={2.1} /> {hostLabel}
          </span>
        )}
        {installed ? (
          <span className="bp-card__run" title={count + " server" + (count === 1 ? "" : "s") + " from this blueprint"}>
            <span className={"bp-card__rundot" + (onlineCount ? " is-live" : "")}></span>
            {count} {count === 1 ? "server" : "servers"}
          </span>
        ) : isNew ? (
          <span className="bp-card__new">New</span>
        ) : null}
        <div className="bp-card__veil"></div>
        <h3 className="bp-card__name">{game.name}</h3>
      </div>

      <div className="bp-card__specs">
        <div className={"bp-spec" + (game.players == null ? " bp-spec--unknown" : "")}>
          {/* A blueprint that declares no capacity says so. Rendering the null left an icon with
              nothing beside it, which reads as a broken card rather than an unknown figure. */}
          <span className="bp-spec__val"><Icon name="users" size={12} strokeWidth={2} /> {game.players ?? "—"}</span>
          <span className="bp-spec__lbl">Players</span>
        </div>
        <div className="bp-spec">
          <span className="bp-spec__val"><Icon name="memory-stick" size={12} strokeWidth={2} /> {fmtFootprintMb(game.specs && game.specs.recommendedRamMb)}</span>
          <span className="bp-spec__lbl">RAM</span>
        </div>
        <div className="bp-spec">
          <span className="bp-spec__val"><Icon name="hard-drive" size={12} strokeWidth={2} /> {fmtFootprintMb(game.specs && game.specs.baseDiskMb)}</span>
          <span className="bp-spec__lbl">Disk</span>
        </div>
      </div>

      <div className="bp-card__foot">
        {installed ? (
          <span className="bp-card__status bp-card__status--on">
            {onlineCount > 0
              ? <><span className="bp-card__livedot"></span>{onlineCount} online</>
              : <>Idle · not running</>}
          </span>
        ) : (
          /* One slot, one precedence: a GATE outranks a fit, because a blueprint you cannot install
             without credentials is a different kind of answer from one that would be a squeeze.
             An installed card never shows a fit at all — the question is already settled. */
          gate ? (
            <span className="bp-card__status bp-card__status--gate" title={gate.title}>
              <Icon name="lock" size={11} /> {gate.label}
            </span>
          ) : fit ? (
            <span className={"bp-card__status bp-card__status--" + (fit.tight ? "tight" : "fits")}
              title={fitTitle}>
              <Icon name={fit.tight ? "triangle-alert" : "circle-check"} size={11} />
              {fit.tight ? "Tight fit" : "Room for this"}
            </span>
          ) : <span className="bp-card__status"></span>
        )}
        {canDeploy ? (
          <button
            type="button"
            className="bp-card__cta bp-card__cta--act"
            title={"Deploy a new " + game.name + " server"}
            onClick={e => { e.stopPropagation(); onDeploy(game); }}
          >
            Deploy <Icon name="arrow-right" size={13} strokeWidth={2.2} />
          </button>
        ) : (
          <span className="bp-card__cta">
            {(installed
              ? (can("server.operate") ? "Manage" : "View")
              : "View")} <Icon name="arrow-right" size={13} strokeWidth={2.2} />
          </span>
        )}
      </div>
    </article>
  );
}

export { GameCard, libraryNow, NEW_WINDOW_DAYS, RECENT_WINDOW_DAYS };
