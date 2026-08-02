import React from "react";
import { Icon } from "./Icon.jsx";
import { serverJoin } from "../lib/persona.js";

// ServerConnect — the "go play on this server" surface. It does two things, and
// the split is deliberate: a Steam title gets a one-click LAUNCH
// (steam://run/<appid>, which every Steam game a player owns supports), and every
// game gets the connect address to copy, because joining happens in the game's own
// server browser. The panel never claims to have connected anyone — launching is
// fire-and-forget (the browser hands the steam:// handler off with no callback),
// and the address is the honest instruction underneath it. Both are gated on the
// server being online: there is nothing to join otherwise.
//
// variant "tile"      → compact launch + copy pair for a server card.
// variant "hero-bar"  → address pill + copy + Play CTA for the server detail hero.

function ServerConnect({ server, variant }) {
  const join = serverJoin(server);
  const [copied, setCopied] = React.useState(false);
  const online = join.online;
  // Launched but not yet joinable — only a truly "online" (finished booting)
  // server can be joined, so this stays gated the same as offline; only the
  // copy changes so it doesn't misreport a booting server as "Offline".
  const starting = server && server.status === "starting";

  const copy = (e) => {
    if (e) e.stopPropagation();
    const text = join.address;
    if (!text) return;              // no known address → never copy a literal "null"
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(text);
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  // The copy button's tooltip carries the whole instruction, since "Play" alone
  // doesn't tell you how you actually get in.
  const copyHint = !join.address
    ? "The connect address isn’t available yet"
    : copied ? "Copied"
    : join.isSteam
      ? `Copy ${join.address} — paste it into ${server.game}’s server browser once it opens`
      : `Copy ${join.address} — connect from ${server.game}’s own menu`;

  // ---- compact tile variant ----
  // Steam titles get Play + an icon-only copy beside it; everything else gets the
  // full-width copy button. The address resolves from the server row itself
  // (connectPort), so this works on the servers list with no detail fetch.
  if (variant === "tile") {
    const copyBtn = (compact) => (
      <button
        className={"connect-tile connect-tile--copy" + (compact ? " connect-tile--icon" : "") + (online && join.address ? "" : " connect-tile--off")}
        onClick={online ? copy : (e) => e.stopPropagation()}
        disabled={!online || !join.address}
        title={online ? copyHint : (starting ? "Server is starting…" : "Server is offline")}>
        <Icon name={copied ? "check" : "copy"} size={13} />
        {compact ? null : (copied ? "Copied" : (online ? "Copy IP" : (starting ? "Starting…" : "Offline")))}
      </button>
    );
    if (join.isSteam) {
      return (
        <>
          <a
            className={"connect-tile" + (online ? "" : " connect-tile--off")}
            href={online ? join.launchUrl : undefined}
            onClick={(e) => { e.stopPropagation(); if (!online) e.preventDefault(); }}
            title={online ? `Launch ${server.game} in Steam` : (starting ? "Server is starting…" : "Server is offline")}>
            <Icon name="play" size={13} strokeWidth={2.4} />
            {online ? "Play" : (starting ? "Starting…" : "Offline")}
          </a>
          {copyBtn(true)}
        </>
      );
    }
    return copyBtn(false);
  }

  // ---- cinematic hero bar variant ----
  // Compact single row for the server-detail hero's frosted control bar: the connect
  // address as a glass mono pill, an icon-only copy, then the Play CTA pinned to the
  // FAR RIGHT (the bar's primary action, hard against the hero's right edge). No
  // always-visible note — the "this launches the game, then you connect" explanation
  // lives in the two tooltips so the bar stays clean. Non-Steam games drop the Play
  // button (address + copy only) and carry the hint on the pill.
  const launchHint = online
    ? `Open ${server.game} in Steam. It won’t join on its own — paste the address into the game’s server browser.`
    : starting ? "Server is starting up — hang tight, it’ll be joinable shortly."
    : "Start the server to join";
  if (variant === "hero-bar") {
    return (
      <div className="connect connect--bar">
        <code
          className="connect__addr connect__addr--glass"
          title={join.isSteam ? undefined : `${server.game} isn’t on Steam — copy the address and connect from the game’s own menu.`}>
          {join.address || "—"}
        </code>
        <button
          className="connect__copy connect__copy--icon"
          onClick={copy}
          disabled={!join.address}
          title={copyHint}>
          <Icon name={copied ? "check" : "copy"} size={15} />
        </button>
        {join.isSteam && (
          <a
            className={"connect__join connect__join--sm" + (online ? "" : " is-disabled")}
            href={online ? join.launchUrl : undefined}
            onClick={(e) => { if (!online) e.preventDefault(); }}
            title={launchHint}>
            <Icon name="play" size={15} strokeWidth={2.4} />
            {online ? "Play" : (starting ? "Starting…" : "Offline")}
          </a>
        )}
      </div>
    );
  }

  // ---- full row variant ----
  return (
    <div className="connect">
      <div className="connect__row">
        {join.isSteam && (
          <a
            className={"connect__join" + (online ? "" : " is-disabled")}
            href={online ? join.launchUrl : undefined}
            onClick={(e) => { if (!online) e.preventDefault(); }}
            title={launchHint}>
            <Icon name="play" size={16} strokeWidth={2.4} />
            {online ? "Play on Steam" : (starting ? "Server starting…" : "Server offline")}
          </a>
        )}
        <code className="connect__addr">{join.address || "—"}</code>
        <button
          className="connect__copy"
          onClick={copy}
          disabled={!join.address}
          title={copyHint}>
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy IP : port"}
        </button>
      </div>
      <div className="connect__note">
        <Icon name="info" size={12} />
        {join.isSteam
          ? <span>Opens {server.game} in Steam. Paste the address into the game’s server browser to join.</span>
          : <span>{server.game} isn’t on Steam — copy the address and connect from the game’s own menu.</span>}
      </div>
    </div>
  );
}

export { ServerConnect };
