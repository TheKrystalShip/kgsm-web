import React from "react";
import { Icon } from "../components/Icon.jsx";
import { SettingsRow, SettingsSection, Toggle } from "../components/settings-primitives.jsx";
import { fmtRelative, parseTs } from "../lib/formatting.js";
import { hostsStore } from "../lib/stores.js";
import { useStore } from "../lib/store.js";
import { toast } from "../lib/toasts.js";
import {
  devices as fetchDevices, preferences as fetchPreferences,
  reassert, setPreference, subscribe, support, unsubscribe,
} from "../lib/push.js";

// SettingsNotifications.jsx — "Notifications": how this account gets told things.
//
// One tab for the whole answer, which is why the device switch lives here rather than under Devices:
// turning push on and choosing what it carries are one decision split in two, and putting them on
// different tabs made the second half unreachable from the first.
//
// It is deliberately NOT about the in-app notifications. Those report what YOU did in an open
// browser and are not configurable on purpose — a toast you can suppress is the silent-failure bug
// this all started with. This tab is about what reaches you when nothing is open.
//
// TWO GATES decide whether a notification arrives, and the UI shows both:
//   the host's rule  — an admin decides what the push channel carries at all
//   your choice      — which of those you want
// A row the host is not carrying renders its switch inert and says so, rather than letting somebody
// turn something on and then hear nothing with no explanation.
//
// Everything here is per HOST: a subscription is signed by that host's key and the catalog is the
// host's own, so the cluster gets one card per node rather than one merged list that would have to
// invent a shared truth.

function SettingsNotifications() {
  const hosts = useStore(hostsStore, s => s.list);
  const [cap] = React.useState(() => support());

  if (cap.state !== "ready") return <UnavailableCard state={cap.state} />;
  if (hosts.length === 0) {
    return (
      <SettingsSection icon="bell" title="Notifications">
        <SettingsRow icon="server-off" title="No hosts connected" sub="Connect a host to set up notifications." />
      </SettingsSection>
    );
  }
  return hosts.map(h => <HostNotifications key={h.id} host={h} />);
}

/** The three honest not-here states, each saying which it is rather than a flat "unavailable". */
function UnavailableCard({ state }) {
  if (state === "needs-install") {
    return (
      <SettingsSection icon="bell" title="Notifications">
        {/* One step away, not a dead end: iOS delivers push only to an installed web app. */}
        <SettingsRow icon="square-arrow-out-up-right" title="Install the app first"
          sub="On iPhone and iPad, notifications work once you add Krystal Ship to your Home Screen — Share → Add to Home Screen — then come back here." />
      </SettingsSection>
    );
  }
  if (state === "denied") {
    return (
      <SettingsSection icon="bell-off" title="Notifications">
        <SettingsRow icon="ban" title="Blocked by your browser" tone="warn"
          sub="Notifications are blocked for this site. Re-allow them in your browser's site settings, then reload this page." />
      </SettingsSection>
    );
  }
  return (
    <SettingsSection icon="bell-off" title="Notifications">
      <SettingsRow icon="bell-off" title="Not available in this browser"
        sub="This browser doesn't support push notifications." />
    </SettingsSection>
  );
}

function HostNotifications({ host }) {
  const [devices, setDevices] = React.useState(null);
  const [prefs, setPrefs] = React.useState(null);
  const [channelOn, setChannelOn] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [saving, setSaving] = React.useState(null);

  const load = React.useCallback(() => {
    setError(null);
    Promise.all([fetchDevices(host.id), fetchPreferences(host.id)]).then(
      ([d, p]) => {
        setDevices(d.devices || []);
        setChannelOn(!!p.enabled);
        setPrefs(p.events || []);
        // A device registered before the host asked what it can render carries neither
        // its account handle nor a button count, and gets no action buttons until it
        // says so once. Only for a browser already registered here — re-posting blind
        // would subscribe somebody to a host they never chose.
        if ((d.devices || []).some(x => x.current)) reassert(host.id);
      },
      // A node that can't answer says so in place; it never blanks the tab.
      (err) => setError((err && (err.userMessage || err.message)) || "This host didn't answer."),
    );
  }, [host.id]);

  React.useEffect(load, [load]);

  const here = devices && devices.find(d => d.current);
  const others = (devices || []).filter(d => !d.current);
  const name = host.name || host.id;

  const toggleDevice = async () => {
    setBusy(true);
    try {
      if (here) { await unsubscribe(host.id); toast.success("Notifications off for " + name); }
      else { await subscribe(host.id); toast.success("Notifications on for " + name, { detail: "This device will be notified." }); }
      load();
    } catch (err) {
      toast.fromError(err, (here ? "Couldn't turn off notifications on " : "Couldn't turn on notifications on ") + name);
    } finally { setBusy(false); }
  };

  const toggleEvent = async (ev) => {
    setSaving(ev.id);
    // Optimistic: a switch that waits for a round trip feels broken. Rolled back from the server's
    // own answer, which is the full view, so a rejected change cannot leave the UI lying.
    setPrefs(list => list.map(e => (e.id === ev.id ? { ...e, enabled: !e.enabled } : e)));
    try {
      const next = await setPreference(host.id, ev.id, !ev.enabled);
      setPrefs(next.events || []);
    } catch (err) {
      setPrefs(list => list.map(e => (e.id === ev.id ? { ...e, enabled: ev.enabled } : e)));
      toast.fromError(err, "Couldn't save that preference");
    } finally { setSaving(null); }
  };

  return (
    <SettingsSection icon="bell" title={name}>
      {error && <SettingsRow icon="triangle-alert" title="Couldn't load notifications" sub={error} tone="danger" />}

      {!error && (
        <SettingsRow
          icon={here ? "bell-ring" : "bell"}
          title="Notify this device"
          sub={
            devices === null ? "Checking…"
            : here ? (channelOn
                ? "On. Choose what you'd like to hear about below."
                // Subscribed, but nothing will arrive — say so rather than implying it works.
                : "On for this device, but notifications are switched off for this host by an admin.")
            : (others.length
                ? `Off on this device. ${others.length} of your other device${others.length === 1 ? " is" : "s are"} on.`
                : "Off. Turn on to get notified with the panel closed.")
          }
        >
          <button type="button" className="settings-btn-ghost" disabled={busy || devices === null} onClick={toggleDevice}>
            {busy ? <Icon name="loader-2" size={14} /> : null}
            {here ? "Turn off" : "Turn on"}
          </button>
        </SettingsRow>
      )}

      {/* The choices apply to the ACCOUNT, so they are worth setting even before this particular
          browser is subscribed — hence shown whether or not `here`. */}
      {!error && prefs && prefs.map(ev => (
        <SettingsRow
          key={ev.id}
          icon={EVENT_ICON[ev.id] || "bell"}
          title={ev.title}
          sub={ev.availableOnHost
            ? ev.description
            : "Switched off for this host by an admin — you won't get this one even with it on."}
          tone={ev.availableOnHost ? undefined : "muted"}
        >
          <Toggle
            on={ev.enabled}
            disabled={!ev.availableOnHost || saving === ev.id}
            label={ev.title}
            onChange={() => toggleEvent(ev)}
          />
        </SettingsRow>
      ))}

      {/* Your other devices, so a phone you no longer carry can be recognised (and retired from it). */}
      {!error && others.map(d => (
        <SettingsRow
          key={d.id}
          icon="smartphone"
          title={deviceLabel(d)}
          sub={"Added " + fmtRelative(parseTs(d.createdAt))
            + (d.lastSeenAt ? " · last notified " + fmtRelative(parseTs(d.lastSeenAt)) : " · never notified yet")}
        />
      ))}
    </SettingsSection>
  );
}

// One glyph per catalog event, so the list scans. Falls back to the bell for an event added to the
// catalog later — the server owns that list, not this file.
const EVENT_ICON = {
  online: "circle-play",
  offline: "circle-stop",
  crash: "server-crash",
  crash_loop: "server-off",
  update: "circle-arrow-up",
  update_available: "download",
  installed: "package-plus",
  backup: "database-backup",
  threshold_breach: "gauge",
  threshold_clear: "circle-check",
  player_join: "user-plus",
  server_empty: "moon",
};

// A readable name from the user-agent — enough to tell a phone from a laptop, and nothing guessed
// beyond what the string actually says.
function deviceLabel(d) {
  const ua = d.userAgent || "";
  const os = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Mac OS X/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux"
    : null;
  const browser = /Firefox\//.test(ua) ? "Firefox"
    : /Edg\//.test(ua) ? "Edge"
    : /SamsungBrowser\//.test(ua) ? "Samsung Internet"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : null;
  if (os && browser) return `${browser} on ${os}`;
  return os || browser || "Another device";
}

export { SettingsNotifications };
export default SettingsNotifications;
