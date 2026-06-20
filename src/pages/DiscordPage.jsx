import React from "react";
import { Icon } from "../components/Icon.jsx";
import { SettingsRow, SettingsSection, Toggle } from "./ServerSettings.jsx";

// Discord integration — webhook config + per-server notification toggles +
// (mocked) slash command list. The whole thing is intentionally one screen so
// folks don't hunt across tabs to wire a webhook.
//
// SettingsSection / SettingsRow / Toggle are re-used from ServerSettings.jsx
// (loaded earlier and exported to window).


function DiscordPage() {
  const [webhook, setWebhook] = React.useState("https://discord.com/api/webhooks/1234567890/abc-def-***");
  const [channel, setChannel] = React.useState("#krystal-ops");
  const events = [
    { id: "online",    title: "Server online",         desc: "Posted when a server comes online — includes IP and player slot count.",            on: true,  noise: "every time" },
    { id: "offline",   title: "Server offline",        desc: "Posted on graceful shutdown.",                                                       on: true,  noise: "every time" },
    { id: "crash",     title: "Crash / restart",       desc: "Posted when the watchdog kicks. Pings @ops if max-crash limit is hit.",              on: true,  noise: "with ping" },
    { id: "update",    title: "Update available",      desc: "Posted once per new game build detected on the upstream channel.",                  on: true,  noise: "once per build" },
    { id: "backup",    title: "Backup snapshot",       desc: "Daily success summary with file size & retention status.",                          on: false, noise: "daily digest" },
    { id: "join",      title: "Player joins / leaves", desc: "Useful for small communities; can get noisy on busy servers.",                      on: false, noise: "muted by default" },
    { id: "installed", title: "Game installed",        desc: "Heads-up when someone in the crew adds a new game from the library.",               on: true,  noise: "once" },
    { id: "lowdisk",   title: "Resource alerts",       desc: "CPU > 90% for 5min, RAM > cap, free disk < 5 GB.",                                   on: true,  noise: "with ping" },
  ];
  const [state, setState] = React.useState(Object.fromEntries(events.map(e => [e.id, e.on])));
  const flip = (id) => setState(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--fg-1)", letterSpacing: "-0.01em", margin: 0 }}>Discord integration</h1>
        <div style={{ color: "var(--fg-3)", fontSize: 14, marginTop: 4 }}>
          One webhook. The crew finds out when something happens — without anyone tabbing back to Krystal.
        </div>
      </div>

      {/* Webhook config */}
      <SettingsSection title="Webhook">
        <SettingsRow icon="webhook" title="Discord webhook URL"
          sub="Paste a channel webhook. Server > Settings > Integrations > Webhooks > New Webhook in Discord.">
          <input value={webhook} onChange={e => setWebhook(e.target.value)}
            style={{ background: "var(--surface-3)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-md)", height: 32, padding: "0 10px", color: "var(--fg-1)", fontFamily: "var(--font-mono)", fontSize: 12.5, width: 340, outline: "none" }} />
          <button className="fb-editor__btn">Test</button>
        </SettingsRow>
        <SettingsRow icon="hash" title="Posting as"
          sub="Channel name surfaced in alerts (cosmetic — Discord controls the real channel).">
          <input value={channel} onChange={e => setChannel(e.target.value)}
            style={{ background: "var(--surface-3)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-md)", height: 32, padding: "0 10px", color: "var(--fg-1)", fontFamily: "var(--font-mono)", fontSize: 13, width: 200, outline: "none" }} />
        </SettingsRow>
      </SettingsSection>

      {/* Event toggles */}
      <SettingsSection title="What to announce">
        {events.map(e => (
          <SettingsRow key={e.id} icon="bell" title={e.title} sub={e.desc}>
            <span style={{ fontSize: 11.5, color: "var(--fg-3)", fontFamily: "var(--font-mono)" }}>{e.noise}</span>
            <Toggle on={state[e.id]} onChange={() => flip(e.id)} />
          </SettingsRow>
        ))}
      </SettingsSection>

      {/* Slash commands preview */}
      <SettingsSection title="Slash commands (preview)">
        <div style={{ padding: "12px 0 4px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>Read-only</div>
        <div style={{ padding: "8px 0 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px" }}>
          {[
            { c: "/krystal status",       d: "Lists every server, online state, player count, uptime." },
            { c: "/krystal players <id>", d: "Names + join times for a given server." },
            { c: "/krystal logs <id>",    d: "Last 20 lines of the live console — useful for triage." },
            { c: "/krystal info <id>",    d: "Game, version, IP:port, install dir, autostart status." },
          ].map(s => (
            <div key={s.c} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <code style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--krystal-teal)" }}>{s.c}</code>
              <span style={{ color: "var(--fg-3)", fontSize: 12.5 }}>{s.d}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: "8px 0 4px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 8 }}>
          Control
          <span style={{ background: "var(--warning-bg)", color: "var(--warning-fg)", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.04em" }}>OPS ROLE</span>
        </div>
        <div style={{ padding: "8px 0 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px" }}>
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
            <div key={s.c} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <code style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--krystal-teal)" }}>{s.c}</code>
              <span style={{ color: "var(--fg-3)", fontSize: 12.5 }}>{s.d}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: "10px 0 16px", color: "var(--fg-3)", fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="info" size={14} />
          Control commands require the Krystal Bot installed (not just a webhook), and a Discord role mapped to "Ops" in <code style={{ fontFamily: "var(--font-mono)", color: "var(--fg-2)" }}>discord.toml</code>.
        </div>
      </SettingsSection>

      {/* Preview card — what a message looks like */}
      <SettingsSection title="Preview">
        <div style={{ padding: "16px 0" }}>
          <div style={{
            background: "#313338", borderRadius: "var(--r-md)", padding: "12px 16px",
            display: "flex", gap: 12, alignItems: "flex-start",
            fontFamily: "var(--font-ui)", border: "1px solid var(--border-subtle)",
          }}>
            <img src="/assets/tks-mark.png" width="40" height="40" alt="" style={{ objectFit: "contain", borderRadius: 999, background: "#1e1f22" }} />
            <div style={{ flex: 1 }}>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "baseline", gap: 8 }}>
                Krystal <span style={{ background: "var(--krystal-teal)", color: "var(--fg-inverse)", fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 4, letterSpacing: "0.04em" }}>BOT</span>
                <span style={{ color: "#949ba4", fontSize: 11, fontWeight: 400 }}>Today at 07:35</span>
              </div>
              <div style={{
                marginTop: 8, padding: "8px 12px",
                borderLeft: "4px solid var(--krystal-teal)", background: "#2b2d31",
                borderRadius: "0 4px 4px 0", color: "#dbdee1", fontSize: 14, lineHeight: 1.4,
              }}>
                <div style={{ fontWeight: 600, color: "#fff", marginBottom: 2 }}>MyValheimServer is online</div>
                <div>4 of 10 slots · uptime <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>0h 0m 12s</code></div>
                <div style={{ marginTop: 6, color: "#949ba4", fontSize: 12.5 }}>Connect: <code style={{ fontFamily: "var(--font-mono)", color: "#dbdee1" }}>50.20.248.138:2456</code></div>
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>

      <div style={{ display: "flex", gap: 10, padding: "8px 0" }}>
        <button className="fb-editor__btn">Save & test</button>
        <span style={{ flex: 1 }}></span>
      </div>
    </div>
  );
}

export { DiscordPage };
