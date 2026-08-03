// stores/boot.js — Boot hydrate block. Runs once at import time.

import { serversStore } from "./servers.js";
import { libraryStore } from "./library.js";
import { hostsStore, syncCapabilitySubscriptions } from "./hosts.js";
import { auditStore } from "./audit.js";
import { startDiscovery } from "./cluster.js";
import { startPingLoop } from "./ui.js";

try {
  const swallow = () => {};
  serversStore.refresh().catch(swallow);
  libraryStore.refresh().catch(swallow);
  hostsStore.refresh().catch(swallow);
  auditStore.refresh().catch(swallow);
  startPingLoop();
  // Resolve the cluster's node set, not just the addresses this browser holds.
  // A peer it registers joins the fan-out live; apiClient re-hydrates the stores
  // above when that happens, so the order here doesn't matter.
  startDiscovery();
  syncCapabilitySubscriptions();
} catch {}
