import React from "react";
import { Icon } from "./Icon.jsx";
import { serverJoin } from "../lib/persona.js";

// ServerConnect — the "join the game" surface. Steam games get a one-click
// launch (steam://connect) that hands the address to the Steam client; every
// game also gets a copy-connect fallback, because the protocol launch has no
// success callback (the browser just fires the steam:// handler and we can't
// tell if it worked). We NEVER claim "joinable" — the button launches Steam
// optimistically; the address underneath is the honest backstop. Join is gated
// on the server being online.
//
// variant "tile"  → compact button for a server card.
// variant "hero"  → full row + address + honest note for the server detail page.

function ServerConnect({ server, variant }) {
  const join = serverJoin
    ? serverJoin(server)
    : { isSteam: false, address: server.ip, online: server.status === "online", steamUrl: null };
  const [copied, setCopied] = React.useState(false);
  const online = join.online;

  const copy = (e) => {
    if (e) e.stopPropagation();
    const text = join.address;
    if (!text) return;              // no known address → never copy a literal "null"
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(text);
    } catch (err) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  // ---- compact tile variant ----
  if (variant === "tile") {
    if (join.isSteam) {
      return (
        <a
          className={"connect-tile" + (online ? "" : " connect-tile--off")}
          href={online ? join.steamUrl : undefined}
          onClick={(e) => { e.stopPropagation(); if (!online) e.preventDefault(); }}
          title={online ? "Launch Steam and join" : "Server is offline"}>
          <Icon name="play" size={13} strokeWidth={2.4} />
          {online ? "Join" : "Offline"}
        </a>
      );
    }
    return (
      <button
        className={"connect-tile connect-tile--copy" + (online ? "" : " connect-tile--off")}
        onClick={online ? copy : (e) => e.stopPropagation()}
        disabled={!online}
        title={online ? "Copy the connect address" : "Server is offline"}>
        <Icon name={copied ? "check" : "copy"} size={13} />
        {copied ? "Copied" : (online ? "Copy IP" : "Offline")}
      </button>
    );
  }

  // ---- hero variant ----
  return (
    <div className="connect">
      <div className="connect__row">
        {join.isSteam && (
          <a
            className={"connect__join" + (online ? "" : " is-disabled")}
            href={online ? join.steamUrl : undefined}
            onClick={(e) => { if (!online) e.preventDefault(); }}
            title={online ? "Launch Steam and connect to this server" : "Start the server to join"}>
            <Icon name="play" size={16} strokeWidth={2.4} />
            {online ? "Join via Steam" : "Server offline"}
          </a>
        )}
        <code className="connect__addr">{join.address || "—"}</code>
        <button
          className="connect__copy"
          onClick={copy}
          disabled={!join.address}
          title={join.address ? "Copy connect address" : "The connect address isn’t available yet"}>
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : (join.isSteam ? "Copy connect info" : "Copy IP : port")}
        </button>
      </div>
      <div className="connect__note">
        <Icon name="info" size={12} />
        {join.isSteam
          ? <span>Opens Steam and asks {server.game} to connect. If it doesn’t join on its own, paste the address into the game’s server browser.</span>
          : <span>{server.game} isn’t on Steam — copy the address and connect from the game’s own menu.</span>}
      </div>
    </div>
  );
}

export { ServerConnect };
