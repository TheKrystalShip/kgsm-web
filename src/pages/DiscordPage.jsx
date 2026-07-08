import React from "react";
import { Icon } from "../components/Icon.jsx";
import { SettingsRow, SettingsSection, Toggle } from "../components/settings-primitives.jsx";
import { api } from "../lib/apiClient.js";
import { sessionStore } from "../lib/sessionStore.js";

// Discord integration — webhook config + per-event notification toggles + a real
// test send, wired to the host's kgsm-api /integrations/discord
// (admin-gated): the server defines the event catalog, the webhook is a write-only
// secret (GET returns only a masked hint), and toggles/test hit the backend. The
// slash-command list + message preview below stay illustrative (the control bot is
// kgsm-bot's surface, honestly null here).
//
// SettingsSection / SettingsRow / Toggle are re-used from ServerSettings.jsx.

const CADENCE_LABEL = { every: "every time", once: "once", digest: "daily digest" };

// Pure: build the sparse PATCH body for an integration "Save". CRITICAL — the
// webhook is a WRITE-ONLY secret. GET returns only a masked hint (…/webhooks/{id}/
// {tok}***), never the URL, so the input can never be prefilled; the body must
// therefore include `webhook` ONLY when the user typed a new non-empty value
// (webhookDirty). The masked hint must NEVER round-trip — sent as "" it would
// silently CLEAR the secret, sent as the masked string it would 400 on normalize.
// Clearing is its own explicit affordance (clearWebhook → ""). channelLabel is not
// a secret, so it's included whenever the caller passes it (only when changed).
function buildIntegrationPatch({ webhook, webhookDirty, clearWebhook, channelLabel } = {}) {
  const body = {};
  if (clearWebhook) body.webhook = "";
  else if (webhookDirty) {
    const wh = (webhook || "").trim();
    if (wh) body.webhook = wh;   // dirty-but-empty → omit (never an accidental clear)
  }
  if (channelLabel !== undefined && channelLabel !== null) body.channelLabel = channelLabel;
  return body;
}

// ---------- config (wired to kgsm-api /integrations/discord) ----------
function DiscordLiveConfig({ hostId }) {
  // Tier is read once (non-reactive) — fine because Settings is opened well after the
  // session resolves. Edge: a deep-link straight to settings before /me lands reads
  // tier:null → controls stay disabled until an unrelated re-render. Acceptable.
  const tier = hostId ? sessionStore.tierOf(hostId) : null;
  const canEdit = tier === "admin";
  const client = () => api.host(hostId);

  const [view, setView] = React.useState(null);          // the DiscordIntegrationView
  const [loadErr, setLoadErr] = React.useState(null);
  const [webhookInput, setWebhookInput] = React.useState("");
  const [channelInput, setChannelInput] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [test, setTest] = React.useState(null);          // { pending } | { ok, msg }

  React.useEffect(() => {
    if (!hostId) { setLoadErr("No host is connected."); return; }
    let live = true;
    client().get("/integrations/discord").then(
      v => { if (!live) return; setView(v); setChannelInput((v && v.channelLabel) || ""); },
      err => { if (live) setLoadErr((err && err.userMessage) || "Couldn't load the Discord integration."); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on hostId change; client is derived from hostId
  }, [hostId]);

  if (loadErr) return <SettingsSection title="Webhook"><div className="settings-notice settings-notice--danger"><Icon name="alert-triangle" size={13} /> {loadErr}</div></SettingsSection>;
  if (!view) return <SettingsSection title="Webhook"><div className="settings-notice">Loading…</div></SettingsSection>;

  const webhookDirty = webhookInput.trim().length > 0;
  const channelDirty = channelInput !== (view.channelLabel || "");
  const patch = (body) => client().patch("/integrations/discord", body);

  const save = () => {
    const body = buildIntegrationPatch({ webhook: webhookInput, webhookDirty, channelLabel: channelDirty ? channelInput : undefined });
    if (Object.keys(body).length === 0) return;
    setSaving(true);
    patch(body).then(
      v => { setView(v); setWebhookInput(""); setChannelInput((v && v.channelLabel) || ""); setSaving(false); },
      () => setSaving(false));
  };
  const clear = () => {
    setSaving(true);
    patch(buildIntegrationPatch({ clearWebhook: true })).then(
      v => { setView(v); setWebhookInput(""); setSaving(false); },
      () => setSaving(false));
  };
  const toggleEnabled = () => patch({ enabled: !view.enabled }).then(v => setView(v), () => {});
  const toggleEvent = (e) => {
    const next = !e.enabled;
    setView(prev => ({ ...prev, events: prev.events.map(x => x.id === e.id ? { ...x, enabled: next } : x) }));   // optimistic
    patch({ events: [{ id: e.id, enabled: next }] }).then(
      v => setView(v),
      () => setView(prev => ({ ...prev, events: prev.events.map(x => x.id === e.id ? { ...x, enabled: e.enabled } : x) })));   // revert
  };
  const runTest = () => {
    setTest({ pending: true });
    client().post("/integrations/discord/test").then(
      r => setTest({ ok: true, msg: "Test message sent" + (r && r.channelLabel ? " to " + r.channelLabel : "") + "." }),
      err => setTest({ ok: false, msg: (err && err.envCode === "not_configured") ? "Configure a webhook first." : (err && err.userMessage) || "The test message failed." }));
  };

  return (
    <>
      <SettingsSection title="Webhook">
        {!canEdit && (
          <div className="settings-notice">
            <Icon name="lock" size={13} /> Read-only — managing integrations is an admin action.
          </div>
        )}
        <SettingsRow icon="webhook" title="Discord webhook URL"
          sub={view.webhook.configured ? "A webhook is configured — paste a new URL to replace it (the current one is never shown)." : "Paste a channel webhook. Server > Settings > Integrations > Webhooks > New Webhook in Discord."}>
          <input value={webhookInput} onChange={e => setWebhookInput(e.target.value)} disabled={!canEdit}
            placeholder={view.webhook.configured ? (view.webhook.hint || "configured") : "https://discord.com/api/webhooks/…"}
            spellCheck="false" className="settings-input settings-input--mono" style={{ width: 340 }} />
          <button className="fb-editor__btn" onClick={save} disabled={!canEdit || saving || (!webhookDirty && !channelDirty)}>Save</button>
          <button className="fb-editor__btn" onClick={runTest} disabled={!canEdit || !view.webhook.configured}>Test</button>
        </SettingsRow>
        {view.webhook.configured && (
          <SettingsRow icon="shield-check" title="Configured" sub="The webhook secret is stored on the host and never sent back to the browser.">
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--fg-2)" }}>{view.webhook.hint || "configured"}</code>
            {canEdit && <button className="fb-editor__btn" onClick={clear} disabled={saving}>Clear</button>}
          </SettingsRow>
        )}
        <SettingsRow icon="hash" title="Posting as"
          sub="Channel label surfaced in alerts (cosmetic — Discord controls the real channel).">
          <input value={channelInput} onChange={e => setChannelInput(e.target.value)} disabled={!canEdit}
            placeholder="#krystal-ops" spellCheck="false" className="settings-input settings-input--mono" style={{ fontSize: 13, width: 200 }} />
        </SettingsRow>
        <SettingsRow icon="power" title="Enabled" sub="Master switch for outbound Discord notifications on this host.">
          <Toggle on={view.enabled} onChange={canEdit ? toggleEnabled : () => {}} />
        </SettingsRow>
        {test && (
          <div className={`settings-notice ${test.pending ? "" : test.ok ? "settings-notice--ok" : "settings-notice--danger"}`}>
            {test.pending ? <><span className="oauth-spinner"></span> Sending test…</> : <><Icon name={test.ok ? "circle-check-big" : "alert-triangle"} size={13} /> {test.msg}</>}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="What to announce">
        {view.events.length === 0 && (
          <div className="settings-notice">No notification events are available on this host yet.</div>
        )}
        {view.events.map(e => (
          <SettingsRow key={e.id} icon="bell" title={e.title} sub={e.description}>
            <span className="chat-brief__detail" style={{ fontFamily: "var(--font-mono)" }}>{CADENCE_LABEL[e.cadence] || e.cadence}{e.ping ? " · pings" : ""}</span>
            <Toggle on={e.enabled} onChange={canEdit ? () => toggleEvent(e) : () => {}} />
          </SettingsRow>
        ))}
      </SettingsSection>
    </>
  );
}

function DiscordPage({ hostId }) {
  return (
    <div className="settings-discord-page">
      <div className="settings-discord-header">
        <h1>Discord integration</h1>
        <p>
          One webhook. The crew finds out when something happens — without anyone tabbing back to Krystal.
        </p>
      </div>

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

export { DiscordPage, DiscordLiveConfig, buildIntegrationPatch };
export default DiscordPage;
