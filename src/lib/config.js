// config.js — runtime wiring config, read once from Vite env.
//
// VITE_API_BASE  — base URL of a kgsm-api host (no trailing slash, no /api/v1).
//                  Blank → run against the bundled fixtures (offline demo).
// VITE_WS_BASE   — base URL of the realtime WebSocket (optional; defaults to
//                  API_BASE with ws(s):// scheme + /api/v1/stream).
//
// kgsm-api is PER-HOST: one base URL == one host's aggregator. The SPA is the
// multi-host client. Today a single base wires one host; the multi-host host
// registry (per-host base URLs) is a later slice — see WIRING.md §1/§7.

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};

function clean(u) { return (u || "").trim().replace(/\/+$/, ""); }

export const API_BASE = clean(env.VITE_API_BASE);
export const API_V1 = API_BASE ? API_BASE + "/api/v1" : "";
export const LIVE = !!API_BASE;

// Derive the WS origin from API_BASE when VITE_WS_BASE isn't set.
function deriveWs() {
  const explicit = clean(env.VITE_WS_BASE);
  if (explicit) return explicit;
  if (!API_BASE) return "";
  return API_BASE.replace(/^http/i, "ws") + "/api/v1/stream";
}
export const WS_URL = deriveWs();
