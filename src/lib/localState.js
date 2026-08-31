// localState.js — everything this browser remembers, and the one way to forget it.
//
// The app's own keys all carry one prefix, so a reset is exact: it never touches anything else
// served from this origin. Kept out of the component that offers it because what gets cleared is a
// fact about the storage layer rather than about a button, and because a list of keys enumerated at
// a call site is a list that goes stale the first time somebody adds one.

const PREFIX = "krystal:";

// Read the keys out BEFORE removing any: a live index shifts under a loop that deletes as it walks,
// which silently leaves every other key behind.
function forgetPrefixed(store) {
  if (!store) return 0;
  const keys = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => store.removeItem(k));
  } catch { /* private mode, or storage disabled — nothing to forget */ }
  return keys.length;
}

// Caches and the service worker are the other half of what an installed app holds, and the half
// somebody cannot get at: a browser's site-data controls are not reachable from a standalone window,
// which is the whole reason this exists. Unregistering is safe — the next load registers again — and
// it is what makes a stale bundle recoverable without uninstalling the app.
async function forgetInstalled() {
  try {
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch { /* not available, or blocked */ }
  try {
    if (typeof navigator !== "undefined" && navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch { /* not available, or blocked */ }
}

// Forget everything this browser holds about the app. Returns how many stored values went, so a
// caller can say what happened rather than assert it.
async function clearLocalState({ installed = true } = {}) {
  const local = forgetPrefixed(typeof localStorage !== "undefined" ? localStorage : null);
  const session = forgetPrefixed(typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (installed) await forgetInstalled();
  return { local, session, total: local + session };
}

export { PREFIX, clearLocalState, forgetPrefixed };
