import { api } from "./apiClient.js";

// push.js — the browser half of Web Push.
//
// What the PWA work bought us: on iPhone, `Notification.requestPermission` and
// `pushManager.subscribe` only work when the panel is INSTALLED to the Home
// Screen. In a Safari tab they are absent or refuse. That is why `support()`
// reports "install first" as its own state rather than a flat "unsupported" —
// on iOS the feature isn't missing, it's one step away.
//
// Two rules the platform imposes, both load-bearing:
//   - Permission must be requested from a real user gesture. A prompt on load
//     gets denied, and a denied permission is close to unrecoverable: the browser
//     stops asking and the user has to dig through site settings.
//   - Chrome requires `userVisibleOnly: true`, so every push shows a
//     notification. Push cannot be used here as a quiet data channel.

const VAPID_UNAVAILABLE = "no-key";

// A subscription belongs to ONE host — it is signed by that host's VAPID key and
// its rows live in that host's DB. In a cluster the panel talks to several, so
// every call here is explicitly scoped rather than aimed at an ambient node.
function push(hostId) {
  return api.host(hostId);
}

/**
 * What this browser can do, without asking it for anything.
 * `state` is one of:
 *   "unsupported"  — no service worker or no Push API at all
 *   "needs-install" — iOS Safari in a tab: supported once added to the Home Screen
 *   "denied"        — permission was refused; we cannot re-prompt
 *   "ready"         — can subscribe (permission granted or still default)
 */
function support() {
  if (typeof window === "undefined") return { state: "unsupported", canPrompt: false };

  const hasSW = "serviceWorker" in navigator;
  const hasPush = "PushManager" in window;
  const hasNotif = "Notification" in window;

  if (!hasSW || !hasPush || !hasNotif) {
    // iOS exposes PushManager only to an installed web app. `standalone` is the
    // iOS-specific signal for "launched from the Home Screen"; display-mode
    // covers the installed case on every other engine.
    const installed = window.navigator.standalone === true
      || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent || "");
    if (iOS && !installed) return { state: "needs-install", canPrompt: false };
    return { state: "unsupported", canPrompt: false };
  }

  if (Notification.permission === "denied") return { state: "denied", canPrompt: false };
  return { state: "ready", canPrompt: Notification.permission !== "granted" };
}

/**
 * The registered service worker, or null when there is none.
 *
 * ⚠ `navigator.serviceWorker.ready` NEVER SETTLES when nothing is registered — it does not reject,
 * it hangs forever waiting for a registration that is not coming. Awaiting it directly leaves every
 * caller pending: the device list sits on "Checking…" for the life of the page. Dev builds register
 * no worker at all (registerSW is production-only) and a failed registration in production looks
 * exactly the same, so this asks `getRegistration()` — which resolves either way — first.
 */
async function worker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return await navigator.serviceWorker.ready;
  } catch { return null; }
}

/** This browser's existing subscription for this origin, if it already has one. */
async function currentSubscription() {
  const reg = await worker();
  if (!reg) return null;
  try { return await reg.pushManager.getSubscription(); } catch { return null; }
}

/** The endpoint identifying this browser to the backend, or null. */
async function currentEndpoint() {
  const sub = await currentSubscription();
  return sub ? sub.endpoint : null;
}

/**
 * Subscribe this browser and register it with the host.
 *
 * Must be called from a user gesture — see the permission rule above. Throws with
 * a readable message rather than resolving false, so a caller can surface the
 * reason (which is the whole point of the toast layer).
 */
async function subscribe(hostId) {
  const reg = await worker();
  if (!reg) throw new Error("This build has no service worker, so push can't be set up here.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "Notifications are blocked for this site. You'll have to re-allow them in your browser settings."
      : "Notification permission wasn't granted.");
  }

  const { publicKey } = await push(hostId).get("/push/key");
  if (!publicKey) throw new Error(VAPID_UNAVAILABLE);

  // An existing subscription made against a DIFFERENT application server key is
  // useless to us and cannot be reused — the browser bakes the key in at
  // subscribe time. Drop it and make a new one rather than registering a
  // subscription this host can never sign for.
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, publicKey)) {
    try { await sub.unsubscribe(); } catch { /* it is going away regardless */ }
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

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
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  // Tell the host FIRST: if the browser-side unsubscribe succeeded and the
  // delete then failed, the host would keep pushing to a dead endpoint until it
  // collected enough 410s to retire it.
  try {
    await push(hostId).del("/push/subscriptions?endpoint=" + encodeURIComponent(endpoint));
  } finally {
    try { await sub.unsubscribe(); } catch { /* already gone */ }
  }
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

function sameKey(sub, publicKey) {
  const key = sub.options && sub.options.applicationServerKey;
  if (!key) return false;
  const a = new Uint8Array(key);
  const b = urlBase64ToUint8Array(publicKey);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// `applicationServerKey` takes bytes, and the key travels as base64url — which
// atob does not accept, hence the re-padding rather than a direct decode.
function urlBase64ToUint8Array(base64Url) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export {
  currentEndpoint, devices, preferences, reassert, setPreference, setQuietHours,
  subscribe, support, unsubscribe,
};
