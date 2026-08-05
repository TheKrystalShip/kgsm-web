// LeafOverview — the Overview any leaf gets for free. Built only from the service row and the leaf's
// own config descriptor, both of which every leaf already publishes, so a leaf with no bespoke body
// still has a useful page.
//
// A leaf that has more to say (the assistant's corpus roll-up) replaces this via LEAF_OVERVIEW in
// LeafPage; it does not extend it, because "what is worth showing" is exactly the per-leaf part.

import React from "react";

import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { fetchLeafConfig } from "../../lib/stores.js";

// Which knobs are worth surfacing without being asked. Everything else is one click away in Settings;
// this is the "what is this leaf configured to be" glance, not a second config page.
const HIGHLIGHT_LIMIT = 8;

function LeafOverview({ hostId, leafId, svc }) {
  const [config, setConfig] = React.useState(null);
  const [state, setState] = React.useState("loading");

  React.useEffect(() => {
    if (!hostId || !leafId) return undefined;
    let cancelled = false;
    setState("loading");
    fetchLeafConfig(hostId, leafId).then(
      (cfg) => { if (!cancelled) { setConfig(cfg); setState("ready"); } },
      () => { if (!cancelled) setState("error"); },
    );
    return () => { cancelled = true; };
  }, [hostId, leafId]);

  const fields = (config && config.fields) || [];
  // Secrets never carry a value on the wire and must never be echoed — show that one is set, not what
  // it is. Everything else shows its effective value.
  const highlights = fields
    .filter(f => f && f.effective != null && !f.secret)
    .slice(0, HIGHLIGHT_LIMIT);

  return (
    <div className="dash-feed">
      <BriefCard icon="sliders-horizontal" title="Configuration"
        count={fields.length || null} countTone="neutral"
        meta="The values this leaf is running with. Every knob it declares is in Settings.">
        {state === "loading" && <div className="chat-brief__empty">Reading the leaf’s configuration…</div>}
        {state === "error" && (
          <div className="chat-brief__empty chat-brief__empty--neutral">
            <div className="chat-brief__empty-title">Configuration unavailable</div>
            <div className="chat-brief__empty-sub">This host didn’t answer for {leafId}.</div>
          </div>
        )}
        {state === "ready" && highlights.length === 0 && (
          <div className="chat-brief__empty chat-brief__empty--neutral">
            <div className="chat-brief__empty-title">Nothing to show</div>
            <div className="chat-brief__empty-sub">This leaf declares no readable settings.</div>
          </div>
        )}
        {state === "ready" && highlights.length > 0 && (
          <div className="chat-brief__list">
            {highlights.map(f => (
              <div key={f.key} className="chat-brief__item chat-brief__item--info">
                <span className="chat-brief__icon"><Icon name="dot" size={14} /></span>
                <div className="chat-brief__body">
                  <span className="chat-brief__item-title">
                    <span className="chat-brief__titletext">{f.label || f.key}</span>
                  </span>
                  <span className="chat-brief__detail">{String(f.effective)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </BriefCard>

      <BriefCard icon="server-cog" title="Service"
        meta="What systemd reports for this unit right now.">
        <div className="chat-brief__list">
          {[
            ["Unit", svc && svc.unit],
            ["State", svc && (svc.state + (svc.subState ? " (" + svc.subState + ")" : ""))],
            ["Enabled at boot", svc && svc.enabled == null ? null : svc && (svc.enabled ? "yes" : "no")],
            ["Health", svc && svc.health ? svc.health.status : null],
            ["Reachable from this API", svc && svc.provisioned == null ? null : svc && (svc.provisioned ? "yes" : "no")],
          ].map(([label, value]) => (
            <div key={label} className="chat-brief__item chat-brief__item--info">
              <span className="chat-brief__icon"><Icon name="dot" size={14} /></span>
              <div className="chat-brief__body">
                <span className="chat-brief__item-title">
                  <span className="chat-brief__titletext">{label}</span>
                </span>
                {/* An absent fact says so. It is never filled in with a plausible-looking default. */}
                <span className="chat-brief__detail">{value == null ? "unknown" : value}</span>
              </div>
            </div>
          ))}
        </div>
      </BriefCard>
    </div>
  );
}

export { LeafOverview };
