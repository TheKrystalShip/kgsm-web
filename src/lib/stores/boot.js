// stores/boot.js — Boot hydrate block. Runs once at import time.

import { serversStore } from "./servers.js";
import { libraryStore } from "./library.js";
import { hostsStore, syncCapabilitySubscriptions } from "./hosts.js";
import { auditStore } from "./audit.js";
import { startPingLoop } from "./ui.js";

try {
  const swallow = () => {};
  serversStore.refresh().catch(swallow);
  libraryStore.refresh().catch(swallow);
  hostsStore.refresh().catch(swallow);
  auditStore.refresh().catch(swallow);
  startPingLoop();
  syncCapabilitySubscriptions();
} catch {}
