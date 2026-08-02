// stores/index.js — Barrel re-export. Maintains the same public API as the
// original monolithic stores.js. Import from here or from individual modules.

import { adaptServerMetrics } from "../adapters.js";

export { adaptServerMetrics };

export { __setJobTiming, serversStore, jobsStore, resolveGameNames, commandServer, sendConsoleInput, awaitJob, confirmCommand, installServer, confirmInstall, confirmUninstall, fetchSettings, patchSettings, deleteServer, saveServerNote } from "./servers.js";
export { hostsStore, syncCapabilitySubscriptions, subscribeHostMetrics, subscribeServerMetrics, fetchServerMetricsHistory, fetchServerEvents } from "./hosts.js";
export { filesKey, filesStore } from "./files.js";
export { selectedHostStore, useSelectedHostId, scopeServers, serverHostId, auditEventHost, auditInScope, auditStore } from "./audit.js";
export { libraryStore } from "./library.js";
export { blueprintFileStore } from "./blueprintFile.js";
export { logsStore, logSourcesStore, servicesStore, subscribeHostLogs, subscribeHostServices, setLeafProvisioned, fetchLeafConfig, applyLeafConfig } from "./diagnostics.js";
export { favoritesStore, useIsFavorite, pingStore, startPingLoop } from "./ui.js";
export { clusterStore } from "./cluster.js";

// Boot hydrate — side effect on import
import "./boot.js";
