import { ShowcaseCard, useStore } from "@thekrystalship/krystal-ui";
import { can } from "../lib/persona.js";
import { hostsStore, serversStore } from "../lib/stores.js";
import { artBg } from "../lib/art.js";
import { fmtFootprintMb } from "../lib/formatting.js";
import { blueprintFit, hostAvailabilityLabel, instancesOfBlueprint } from "../lib/servers.js";

// GameCard.jsx — the catalog game card. One card, wherever a blueprint is shown: the Catalog page's
// grid and the dashboard's catalog rail render the same component with the same props, so a fact
// added to it appears on both and neither can quietly say less than the other. What it says is
// decided here; how it looks is the design system's ShowcaseCard.
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

  // One status slot, one precedence: an installed card reports its servers; otherwise a GATE outranks
  // a fit, because a blueprint you cannot install without credentials is a different kind of answer
  // from one that would be a squeeze. An installed card never shows a fit — the question is settled.
  const status = installed
    ? (onlineCount > 0
        ? { tone: "active", live: true, label: onlineCount + " online" }
        : { tone: "active", label: "Idle · not running" })
    : gate ? { tone: "notice", icon: "lock", label: gate.label, title: gate.title }
    : fit ? { tone: fit.tight ? "warning" : "success", icon: fit.tight ? "triangle-alert" : "circle-check",
              label: fit.tight ? "Tight fit" : "Room for this", title: fitTitle }
    : null;

  return (
    <ShowcaseCard
      name={game.name}
      art={bg}
      onPick={() => onPick(game)}
      corner={hostLabel ? { icon: "server", label: hostLabel, title: "Only available on " + hostLabel.replace(/ only$/, "") } : null}
      badge={installed
        ? { tone: "accent", dot: onlineCount ? "live" : "idle", label: count + " " + (count === 1 ? "server" : "servers"),
            title: count + " server" + (count === 1 ? "" : "s") + " from this blueprint" }
        : isNew ? { tone: "info", label: "New" } : null}
      // A blueprint that declares no capacity says so: a null reads as a muted em-dash.
      specs={[
        { icon: "users", value: game.players, label: "Players" },
        { icon: "memory-stick", value: fmtFootprintMb(game.specs && game.specs.recommendedRamMb), label: "RAM" },
        { icon: "hard-drive", value: fmtFootprintMb(game.specs && game.specs.baseDiskMb), label: "Disk" },
      ]}
      status={status}
      action={canDeploy
        ? { label: "Deploy", title: "Deploy a new " + game.name + " server", onClick: () => onDeploy(game) }
        : { label: installed && can("server.operate") ? "Manage" : "View" }}
    />
  );
}

export { GameCard, libraryNow, NEW_WINDOW_DAYS, RECENT_WINDOW_DAYS };
