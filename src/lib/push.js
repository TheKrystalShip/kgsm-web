import { api } from "./apiClient.js";
import { acquire, currentEndpoint, currentSubscription, release, support } from "./pushBrowser.js";

// push.js — the PANEL's Web Push, which is this host's kgsm-api and its fleet events.
//
// The browser mechanics — what this device can do, the permission prompt, getting a subscription
// bound to the right key, giving it up — live in `pushBrowser.js` and are shared with the standalone
// assistant, which pushes about something else entirely from an origin of its own. What stays here
// is everything that is kgsm-api's: its routes, its per-event preferences and its quiet window.

// A subscription belongs to ONE host — it is signed by that host's VAPID key and
// its rows live in that host's DB. In a cluster the panel talks to several, so
// every call here is explicitly scoped rather than aimed at an ambient node.
function push(hostId) {
  return api.host(hostId);
}

/**
 * Subscribe this browser and register it with the host.
 *
 * Must be called from a user gesture — see the permission rule in `pushBrowser.js`.
 */
async function subscribe(hostId) {
  const { publicKey } = await push(hostId).get("/push/key");
  const sub = await acquire(publicKey);
  await register(hostId, sub);
  return sub.endpoint;
}

/**
 * Tell the host what this browser is, for a subscription it already holds.
 *
 * Only ever refreshes an EXISTING row — it is called where the device list has
 * already said this browser is registered here. Re-posting blind would subscribe
 * somebody to a host they never opted into, which is the opposite of what a
 * refresh is for.
 *
 * It exists because a device's row carries facts that arrive with a POST and
 * nowhere else: which account it belongs to, and how many notification buttons
 * it draws. A browser subscribed before those were asked for has neither until it
 * says so once.
 */
async function reassert(hostId) {
  const sub = await currentSubscription();
  if (!sub) return;
  try { await register(hostId, sub); } catch { /* best effort — it heals on the next visit */ }
}

// toJSON() is exactly the shape the endpoint takes, so it forwards unchanged.
// `maxActions` is reported rather than left for the backend to infer: the one
// platform that renders no buttons is also the one whose user-agent is most
// often imitated, and a device that says nothing is treated as rendering none.
async function register(hostId, sub) {
  const json = sub.toJSON();
  await push(hostId).post("/push/subscriptions", {
    endpoint: json.endpoint,
    keys: json.keys,
    maxActions: (typeof Notification !== "undefined" && Notification.maxActions) || 0,
  });
}

/** Unsubscribe this browser, both here and on the host. */
async function unsubscribe(hostId) {
  await release((endpoint) =>
    push(hostId).del("/push/subscriptions?endpoint=" + encodeURIComponent(endpoint)));
}

/** The caller's own event choices on this host, over that host's catalog. */
async function preferences(hostId) {
  return push(hostId).get("/push/preferences");
}

/** Change some of them. Sparse — only the ids passed change; answers with the full new view. */
async function setPreference(hostId, id, enabled) {
  return push(hostId).patch("/push/preferences", { events: [{ id, enabled }] });
}

/**
 * Replace the caller's quiet window on this host.
 *
 * The timezone comes from this browser rather than from a picker: it is the one
 * thing the browser knows for certain about where the person is, and asking them
 * to choose it again is asking them to get it wrong. The host stores the IANA id
 * and reports back whether it could resolve it — a host whose tzdata does not
 * carry the zone applies nothing, and says so rather than silencing the wrong
 * nine hours.
 */
async function setQuietHours(hostId, window) {
  return push(hostId).put("/push/quiet-hours", {
    ...window,
    timeZone: window.timeZone || localZone(),
  });
}

/** This browser's IANA zone, or "" when it will not say — never a guessed offset. */
function localZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; }
  catch { return ""; }
}

/** The caller's registered devices on this host. */
async function devices(hostId) {
  const endpoint = await currentEndpoint();
  const q = endpoint ? "?endpoint=" + encodeURIComponent(endpoint) : "";
  return push(hostId).get("/push/subscriptions" + q);
}

export {
  currentEndpoint, devices, preferences, reassert, setPreference, setQuietHours,
  subscribe, support, unsubscribe,
};
