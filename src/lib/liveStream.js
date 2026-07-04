// liveStream.js — the real per-host realtime transport.
//
// A self-contained fetch-based SSE lifecycle wrapped behind a tiny seam so
// apiClient can wire it without an import cycle: this module imports NOTHING
// from apiClient (it only takes callbacks).
//
// Protocol (kgsm-api StreamProtocol / architecture.html §3·b):
//   server → client : data: { topic, type, data }\n\n
//   no initial snapshot — the client REST-hydrates on (re)connect and the stream
//   carries deltas (§3·j). So on every (re)open we call onOpen so the owner can
//   re-hydrate the stores.
//
// One SSE stream to one host's `/api/v1/stream`. Topics are fixed at connect
// via ?topics=. Changing topics = open another stream / close this one.

import { readSseStream } from "./sse.js";

const RECONNECT_BASE = 2500, RECONNECT_CAP = 12000;
const backoff = (n) => Math.min(RECONNECT_BASE * Math.pow(2, n), RECONNECT_CAP);

// createSseStream({ url, bearer, onOpen, onMessage, onMode, onUnauthorized })
//   url           — the full SSE URL with ?topics=... already baked in
//   bearer        — () => Promise<token|null>|token|null, AWAITED at each connect
//   onOpen        — () => void, fired after the connected comment arrives (mode→live)
//   onMessage     — (msg:{topic,type,data}) => void, one parsed server frame
//   onMode        — (mode:"live"|"connecting"|"reconnecting"|"offline") => void, for realtimeStore
//   onUnauthorized— () => void, called on a 401 response (→ sessionStore.expire)
// Returns { reconnect(), close(), mode() }.
export function createSseStream({ url, bearer, onOpen, onMessage, onMode, onUnauthorized }) {
  let controller = null;
  let attempts = 0;
  let mode = "connecting";
  let reconnectTimer = null;
  let closed = false;

  const setMode = (m) => { if (m !== mode) { mode = m; try { onMode && onMode(m); } catch {} } };

  function clearTimer() { if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } }

  function scheduleReconnect() {
    if (closed) return;
    clearTimer();
    setMode(attempts > 0 ? "reconnecting" : "connecting");
    const wait = backoff(attempts++);
    reconnectTimer = setTimeout(connect, wait);
  }

  async function connect() {
    if (closed || !url) { setMode("reconnecting"); return; }
    clearTimer();

    // Resolve the bearer through the egress AUTH FUNNEL. It may REJECT when the
    // session is truly dead — then we back off until a re-auth heals.
    let tok = null;
    try { tok = bearer ? await bearer() : null; } catch { scheduleReconnect(); return; }
    if (closed) return;

    const headers = { Accept: "text/event-stream" };
    if (tok) headers.Authorization = "Bearer " + tok;

    controller = new AbortController();
    let res;
    try {
      res = await fetch(url, { headers, signal: controller.signal });
    } catch (e) {
      if (e && e.name === "AbortError") return;
      scheduleReconnect();
      return;
    }

    if (res.status === 401) {
      try { onUnauthorized && onUnauthorized(); } catch {}
      scheduleReconnect();
      return;
    }

    if (!res.ok) {
      scheduleReconnect();
      return;
    }

    // Stream is open — mark live.
    attempts = 0;
    setMode("live");
    try { onOpen && onOpen(); } catch {}

    // Pump SSE frames until the stream ends.
    try {
      await readSseStream(res, (evt) => {
        if (evt && evt.topic && evt.type) {
          try { onMessage && onMessage(evt); } catch {}
        }
      }, controller.signal);
    } catch (e) {
      if (e && e.name === "AbortError") return; // we closed it
    }

    // Stream ended (server closed, network drop, etc.) → reconnect.
    if (!closed) {
      scheduleReconnect();
    }
  }

  // User-driven "reconnect now": drop the backoff and re-open immediately.
  function reconnect() {
    if (closed) return;
    clearTimer();
    attempts = 0;
    if (controller) { try { controller.abort(); } catch {} controller = null; }
    connect();
  }
  function close() {
    closed = true;
    clearTimer();
    if (controller) { try { controller.abort(); } catch {} controller = null; }
    setMode("offline");
  }

  connect();
  return { reconnect, close, mode: () => mode };
}
