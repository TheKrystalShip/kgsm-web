import React from "react";
import { api } from "../apiClient.js";
import { serversStore } from "../stores/servers.js";

// useRosterMetrics — keep every server card's CPU / memory / network / disk live.
//
// Why a subscription at all: the `servers` topic carries status and roster ONLY, by design — a
// per-second resource delta must never republish the whole roster there. So a card that reads
// `server.cpu` off that topic shows whatever number the last STATUS change happened to carry, which on
// a quiet fleet is minutes old. The live figures ride `servers/metrics`, one frame for the whole
// roster (see adapters.adaptServerMetricsRoster).
//
// Why one topic and not one per card: a resource-scoped topic gets its OWN SSE connection per host
// (apiClient's dynamic-stream registry), and a browser allows only a handful per origin. A grid of
// twelve cards subscribing to twelve `servers/{id}/metrics` topics would exhaust that on its own.
//
// The subscription is shared and demand-driven: every mounted card holds a reference, the first opens
// the stream and the last closes it, so a route with no cards on it costs nothing. The close is
// deferred by LINGER_MS because React unmounts the outgoing page's cards before mounting the incoming
// page's — navigating between two grids would otherwise tear the stream down and immediately reopen it.
const LINGER_MS = 15000;

let refs = 0;
let unsubscribe = null;
let closeTimer = null;

function open() {
  if (unsubscribe) return;
  unsubscribe = api.stream.subscribe(["servers/metrics"], (m) => {
    if (m.type === "metrics.roster" && Array.isArray(m.data))
      serversStore.mergeRosterMetrics(m.data, m.hostId);
  });
}

function acquire() {
  refs++;
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  open();
}

function release() {
  refs = Math.max(0, refs - 1);
  if (refs > 0 || closeTimer) return;
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (refs > 0) return;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  }, LINGER_MS);
}

export function useRosterMetrics() {
  React.useEffect(() => {
    acquire();
    return release;
  }, []);
}
