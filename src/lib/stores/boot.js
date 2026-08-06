// stores/boot.js — Boot hydrate block. Runs once at import time.

import { serversStore } from "./servers.js";
import { libraryStore } from "./library.js";
import { hostsStore, syncCapabilitySubscriptions } from "./hosts.js";
import { auditStore } from "./audit.js";
import { startDiscovery } from "./cluster.js";
import { startPingLoop } from "./ui.js";
import { assistantSession } from "../assistantSession.js";

// Tell the assistant session layer how THIS surface finds a leaf: by discovery, off the node's
// assistant capability. The session module holds no opinion, so it can also serve the standalone
// assistant — which has one leaf at a known address and no host store to read.
assistantSession.setOriginResolver((hostId) => {
  const host = hostsStore.find(hostId);
  const cap = host && host.capabilities && host.capabilities.assistant;
  if (!cap || cap.provisioned === false) return null;
  return (cap.info && cap.info.url) || null;
});

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
