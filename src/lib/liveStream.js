// liveStream.js — the real per-host realtime transport (slice 5).
//
// A self-contained WebSocket lifecycle wrapped behind a tiny seam so apiClient
// can wire it without an import cycle: this module imports NOTHING from apiClient
// (it only takes callbacks). The mock simulated channel (apiClient `chans`/`emit`)
// is a different thing for a different mode and stays entirely separate — this is
// the LIVE path only, picked when `LIVE` is set (see apiClient).
//
// Protocol (kgsm-api StreamProtocol / architecture.html §3·b):
//   client → server : { type: "subscribe"|"unsubscribe", topics: [...] }
//   server → client : { topic, type, data }
//   no initial snapshot — the client REST-hydrates on (re)connect and the socket
//   carries deltas (§3·j). So on every (re)open we re-send the full subscription
//   set and call onOpen so the owner can re-hydrate the stores.
//
// One socket to one host's `/api/v1/stream`. Multi-host fan-out (one socket per
// host base URL) is a later slice; this drives the single live host.

// Bare global WebSocket — present in the browser (window.WebSocket) and in Node
// 18+/our jsdom smoke harness (global undici WebSocket). Guarded so a runtime
// without one degrades to "never connects" (the REST + poll path still works)
// instead of throwing at construction.
const WS = (typeof WebSocket !== "undefined") ? WebSocket : null;

const RECONNECT_BASE = 2500, RECONNECT_CAP = 12000;
const backoff = (n) => Math.min(RECONNECT_BASE * Math.pow(2, n), RECONNECT_CAP);

// createLiveStream({ url, bearer, onOpen, onMessage, onMode })
//   url      — ws(s):// …/api/v1/stream (no query; the bearer is appended here)
//   bearer   — () => token|null, read at each connect (null under auth-disabled)
//   onOpen   — () => void, fired after the socket opens + subs are flushed
//              (the owner re-hydrates the REST stores here to catch missed deltas)
//   onMessage— (msg:{topic,type,data}) => void, one parsed server frame
//   onMode   — (mode:"live"|"reconnecting"|"offline") => void, for realtimeStore
// Returns { subscribe(topics), unsubscribe(topics), close(), mode() }.
export function createLiveStream({ url, bearer, onOpen, onMessage, onMode }) {
  const topics = new Set();
  let socket = null;
  let attempts = 0;
  let mode = "reconnecting";
  let reconnectTimer = null;
  let closed = false;

  const setMode = (m) => { if (m !== mode) { mode = m; try { onMode && onMode(m); } catch (e) {} } };

  function send(obj) {
    if (socket && socket.readyState === 1) {
      try { socket.send(JSON.stringify(obj)); return true; } catch (e) {}
    }
    return false;
  }

  function flushSubscriptions() {
    if (topics.size) send({ type: "subscribe", topics: [...topics] });
  }

  function clearTimer() { if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } }

  function scheduleReconnect() {
    if (closed) return;
    clearTimer();
    setMode("reconnecting");
    const wait = backoff(attempts++);
    reconnectTimer = setTimeout(connect, wait);
  }

  function connect() {
    if (closed || !WS || !url) { setMode(WS ? "reconnecting" : "offline"); return; }
    clearTimer();
    let s;
    const tok = (() => { try { return bearer && bearer(); } catch (e) { return null; } })();
    const full = tok ? url + (url.includes("?") ? "&" : "?") + "access_token=" + encodeURIComponent(tok) : url;
    try { s = new WS(full); } catch (e) { scheduleReconnect(); return; }
    socket = s;
    s.addEventListener("open", () => {
      if (socket !== s) { try { s.close(); } catch (e) {} return; }   // superseded
      attempts = 0;
      flushSubscriptions();
      setMode("live");
      try { onOpen && onOpen(); } catch (e) {}
    });
    s.addEventListener("message", (ev) => {
      if (socket !== s) return;
      let msg = null;
      try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString()); } catch (e) { return; }
      if (msg && msg.topic && msg.type) { try { onMessage && onMessage(msg); } catch (e) {} }
    });
    const onDrop = () => { if (socket === s) { socket = null; scheduleReconnect(); } };
    s.addEventListener("close", onDrop);
    s.addEventListener("error", onDrop);
  }

  function subscribe(list) {
    let added = false;
    (list || []).forEach((t) => { if (!topics.has(t)) { topics.add(t); added = true; } });
    if (added) send({ type: "subscribe", topics: list });   // no-op if not open; flushed on next open
  }
  function unsubscribe(list) {
    (list || []).forEach((t) => topics.delete(t));
    send({ type: "unsubscribe", topics: list });
  }
  function close() {
    closed = true;
    clearTimer();
    if (socket) { try { socket.close(); } catch (e) {} socket = null; }
    setMode("offline");
  }

  connect();
  return { subscribe, unsubscribe, close, mode: () => mode };
}
