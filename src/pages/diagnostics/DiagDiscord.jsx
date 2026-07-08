// DiagDiscord — the Discord sub-tab: per-host webhook config + notification
// event toggles, live-wired to the host's kgsm-api /integrations/discord.

import React from "react";
import { SettingsSection } from "../../components/settings-primitives.jsx";
import { DiscordLiveConfig } from "../DiscordPage.jsx";

function DiagDiscord({ host }) {
  const hostId = host && host.id;
  return (
    <div className="settings-discord-page">
      <DiscordLiveConfig hostId={hostId} />

      {/* Slash commands preview — illustrative; control commands are kgsm-bot's
          surface, not this webhook (the integration's `bot` block is honestly null). */}
      <SettingsSection title="Slash commands (preview)">
        <div className="settings-cmd-label">Read-only</div>
        <div className="settings-cmd-grid">
          {[
            { c: "/krystal status",       d: "Lists every server, online state, player count, uptime." },
            { c: "/krystal players <id>", d: "Names + join times for a given server." },
            { c: "/krystal logs <id>",    d: "Last 20 lines of the live console — useful for triage." },
            { c: "/krystal info <id>",    d: "Game, version, IP:port, install dir, autostart status." },
          ].map(s => (
            <div key={s.c} className="settings-cmd-entry">
              <code>{s.c}</code>
              <span>{s.d}</span>
            </div>
          ))}
        </div>

        <div className="settings-cmd-label">
          Control
          <span className="chat-brief__count">OPS ROLE</span>
        </div>
        <div className="settings-cmd-grid">
          {[
            { c: "/krystal start <id>",   d: "Bring a server online — same as the Start button on the site." },
            { c: "/krystal stop <id>",    d: "Graceful shutdown. Warns players first if warnings are on." },
            { c: "/krystal restart <id>", d: "Cycle the server. Accepts an optional `delay:5m` flag for a countdown." },
            { c: "/krystal update <id>",  d: "Check for and install pending updates, then restart." },
            { c: "/krystal backup <id>",  d: "Trigger a manual snapshot from chat." },
            { c: "/krystal restore <id> <backup>", d: "Roll a server back to a specific backup. Confirms in-channel." },
            { c: "/krystal install <game>", d: "Open an install flow — Krystal DMs the requester to fill in name + ports." },
            { c: "/krystal kick <id> <player>", d: "Boot a player. Reason is optional but appended to the audit log." },
          ].map(s => (
            <div key={s.c} className="settings-cmd-entry">
              <code>{s.c}</code>
              <span>{s.d}</span>
            </div>
          ))}
        </div>
      </SettingsSection>

      {/* Preview card — what a message looks like */}
      <SettingsSection title="Preview">
          <div className="settings-discord-msg">
            <img src="/assets/tks-mark.png" width="40" height="40" alt="" className="settings-discord-msg__avatar" />
            <div className="settings-discord-msg__body">
              <div className="settings-discord-msg__header">
                Krystal <span className="settings-discord-msg__badge">BOT</span>
                <span className="settings-discord-msg__time">Today at 07:35</span>
              </div>
              <div className="settings-discord-msg__embed">
                <div className="settings-discord-msg__embed-title">MyValheimServer is online</div>
                <div>4 of 10 slots · uptime <code>0h 0m 12s</code></div>
                <div className="settings-discord-msg__embed-detail">Connect: <code>50.20.248.138:2456</code></div>
              </div>
            </div>
          </div>
      </SettingsSection>
    </div>
  );
}

export { DiagDiscord };
