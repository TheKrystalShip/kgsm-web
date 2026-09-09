import { readSseStream } from "./sse.js";

// authorizedFetch.js — the ONE place a bearer is attached to a request.
//
// ── A credential, never a token ─────────────────────────────────────────────
// A call is authorized by a CREDENTIAL. The difference from a token is the whole point of this
// module: a token is a string obtained at some past moment and cannot be replaced, so a function
// handed one can only spend it and report what came back. A credential can produce a fresh one, so a
// refusal is something answered here rather than something every caller has to notice.
//
//   cred.get()     → the bearer currently held, or null
//   cred.rotate()  → a Promise of a fresh bearer, or null once the session has ended
//
// Both halves belong to whoever owns the session. Nothing here knows which session it is holding, so
// a cluster session and an assistant leaf's are the same shape and this module imports neither —
// which is also what lets the standalone assistant bundle use it, since it may not reach the panel's
// data layer at all.
//
// **Rotation collapses in the credential, not here.** Several calls refused at once each ask for a
// rotation, and the refresh token may be spent exactly once — a second spend of one already rotated
// away is a replay, and the anchor refuses it. So `rotate()` must return the one in-flight rotation
// to every caller that asks while it runs.
//
// ── Expiry is checked, and a refusal is still the authority ─────────────────
// A bearer whose own `exp` has passed is not worth a request: the server will refuse it, and the
// refusal would rotate anyway — so the rotation happens first and the round trip that could not have
// succeeded is never made. An `exp` that cannot be read says nothing, so that token is sent and the
// answer decides. Neither replaces the reactive path: a token can be refused for reasons its `exp`
// knows nothing about — a session revoked elsewhere, a key rotated — and those heal on the 401.
//
// ── Three modes, and the choice is about the REQUEST ────────────────────────
//   json    a call that may be sent twice. A 401 rotates once and replays it.
//   once    a call that may not. The refusal is reported as it stands.
//   stream  a long read. The bearer resolves at each dial; a 401 rotates once and re-dials.
//
// `json` is the ordinary answer, because a 401 means the server did nothing: the request was refused
// before it was handled, so sending it again is the first time it happens. `once` is for a call
// whose cost is in the SENDING rather than in the handling — an upload replayed costs the upload
// again, a prompt spent client-side cannot be un-spent — and there the caller would rather see the
// refusal than pay twice.
//
// Every mode answers `{ ok, status, body }` and throws nothing. A transport failure is `status: 0`
// with `unreachable`, and a session that could not be made live at all is `status: 401` with
// `unauthenticated` and no request made — three outcomes a caller tells apart, rather than one
// exception carrying a code.

// A JWT's `exp` in milliseconds, or null when the token is not a readable JWT. Library-free, and
// deliberately tolerant: this decides whether to spend a round trip, never whether to trust anyone.
function expiryOf(token) {
  try {
    const seg = String(token).split(".")[1];
    const claims = JSON.parse(atob(seg.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch { return null; }
}

// Thirty seconds of headroom, so a token that dies mid-flight is treated as already dead.
function lapsed(token) {
  const exp = expiryOf(token);
  return exp != null && Date.now() >= exp - 30000;
}

const netResult = () => ({ ok: false, status: 0, body: null, unreachable: true });
const noSession = () => ({ ok: false, status: 401, body: null, unauthenticated: true });

/**
 * The authorized surface for one credential. Bind it once beside the session it spends.
 *
 * `fetchImpl` exists for the offline checks, which drive this module against a counted stub; it is
 * the browser's `fetch` everywhere else.
 */
export function authorized(cred, { fetchImpl = fetch } = {}) {
  if (!cred || typeof cred.get !== "function" || typeof cred.rotate !== "function")
    throw new TypeError("authorized() takes a credential: { get, rotate }");

  // The bearer to spend on the next request: the one held, or a rotation when there is none or the
  // one held says it has already died.
  async function resolve() {
    const held = cred.get();
    if (held && !lapsed(held)) return held;
    return (await cred.rotate()) || null;
  }

  async function send(url, init, token) {
    const headers = { ...((init && init.headers) || {}) };
    headers.Authorization = "Bearer " + token;
    try {
      return await fetchImpl(url, { ...init, headers });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      return null;   // a transport failure, told apart from any answer a server gave
    }
  }

  // The parsed body, or null. A body that is not JSON is not an error here — an empty 204 and an
  // error page are both "nothing to read", and the status already says which.
  async function bodyOf(res) {
    if (res.status === 204) return null;
    try { return await res.json(); } catch { return null; }
  }

  const result = async (res) => ({ ok: res.ok, status: res.status, body: await bodyOf(res) });

  // A call that may be sent twice: spend what is held, and a 401 rotates once and replays.
  async function json(url, init) {
    const token = await resolve();
    if (!token) return noSession();

    let res = await send(url, init, token);
    if (!res) return netResult();

    if (res.status === 401) {
      const fresh = await cred.rotate();
      if (!fresh) return noSession();
      res = await send(url, init, fresh);
      if (!res) return netResult();
    }
    return result(res);
  }

  // A call that may not be sent twice. The rotation ahead of it still happens — that costs nothing
  // and spends no request — and the answer, whatever it is, stands.
  async function once(url, init) {
    const token = await resolve();
    if (!token) return noSession();

    const res = await send(url, init, token);
    if (!res) return netResult();
    return result(res);
  }

  /**
   * A long read over SSE. `onEvent` takes each parsed frame; `stop()` ends it.
   *
   * `fetch` rather than `EventSource` for the ordinary reason: `EventSource` sends no `Authorization`
   * header, and a token does not belong in a query string. A dial refused with 401 rotates once and
   * re-dials, so a stream opened on a bearer that died while the page sat idle recovers by itself.
   * A stream that ENDS is the caller's to reopen — the reasons a read stops are the caller's
   * business, and reconnecting here would put a second policy under one that already has one.
   */
  function stream(url, { accept = "text/event-stream", onEvent, signal } = {}) {
    const control = new AbortController();
    if (signal) signal.addEventListener("abort", () => control.abort(), { once: true });

    const dial = async (token) => {
      const headers = { Accept: accept, Authorization: "Bearer " + token };
      return fetchImpl(url, { headers, signal: control.signal });
    };

    const run = async () => {
      const token = await resolve();
      if (!token) return noSession();

      let res;
      try {
        res = await dial(token);
        if (res.status === 401) {
          const fresh = await cred.rotate();
          if (!fresh) return noSession();
          res = await dial(fresh);
        }
      } catch (e) {
        if (e && e.name === "AbortError") return { ok: true, status: 0, body: null };
        return netResult();
      }

      if (!res.ok) return { ok: false, status: res.status, body: null };

      try {
        await readSseStream(res, (evt) => { if (evt) onEvent && onEvent(evt); }, control.signal);
      } catch (e) {
        if (!(e && e.name === "AbortError")) return netResult();
      }
      return { ok: true, status: res.status, body: null };
    };

    return { stopped: run(), stop: () => control.abort() };
  }

  return { json, once, stream };
}
