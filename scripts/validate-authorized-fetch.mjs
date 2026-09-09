// The egress seam — every property a caller is entitled to assume, in the real module.
//
// This is the module that makes "a call forgot to renew its token" unwritable, so its own behaviour
// is the one thing nothing else can catch: the lint rules police who may attach a bearer, and this
// polices what happens once one is attached. Every request and every rotation is COUNTED, so "it did
// not spend a second refresh" is a measured number rather than an assertion about an absence.
//
//   node scripts/validate-authorized-fetch.mjs

import { authorized } from "../src/lib/authorizedFetch.js";

let fail = 0;
const check = (c, label, extra = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};

// A JWT carrying nothing but an `exp`, which is all the seam reads one for.
const jwt = (secondsFromNow) =>
  "h." + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow }))
    .toString("base64url") + ".s";

const LIVE = jwt(3600);
const LAPSED = jwt(-60);
const FRESH = jwt(3600) + ".fresh";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// A credential that counts its rotations and can be told to fail, standing in for the session stores.
function credential({ start, rotatesTo = FRESH, refuseRotation = false } = {}) {
  let held = start;
  const c = {
    rotations: 0,
    get: () => held,
    rotate: async () => {
      c.rotations++;
      if (refuseRotation) { held = null; return null; }
      held = rotatesTo;
      return held;
    },
  };
  return c;
}

// A transport that records what it was asked and answers from a queue.
function transport(answers) {
  const calls = [];
  const impl = async (url, init) => {
    const bearer = ((init && init.headers) || {}).Authorization || null;
    calls.push({ url, method: (init && init.method) || "GET", bearer });
    const next = answers.shift();
    if (typeof next === "function") return next();
    return next;
  };
  return { impl, calls, bearers: () => calls.map((c) => c.bearer) };
}

// 1. A bearer that is good is spent as it stands. Nothing is renewed, because nothing said to.
{
  const cred = credential({ start: LIVE });
  const t = transport([json({ ok: 1 })]);
  const res = await authorized(cred, { fetchImpl: t.impl }).json("https://x/one");
  check(res.ok && res.body.ok === 1, "a good bearer is spent as it stands");
  check(t.calls.length === 1 && cred.rotations === 0, "one request, no rotation", `${t.calls.length}/${cred.rotations}`);
  check(t.bearers()[0] === "Bearer " + LIVE, "and it is the bearer that was held");
}

// 2. A bearer whose own `exp` has passed is not worth a request. The renewal happens FIRST, so the
//    round trip that could not have succeeded is never made — this is the whole boot case.
{
  const cred = credential({ start: LAPSED });
  const t = transport([json({ ok: 1 })]);
  const res = await authorized(cred, { fetchImpl: t.impl }).json("https://x/two");
  check(res.ok, "a lapsed bearer renews before the call");
  check(t.calls.length === 1 && cred.rotations === 1, "which costs one rotation and ONE request", `${t.calls.length}/${cred.rotations}`);
  check(t.bearers()[0] === "Bearer " + FRESH, "the refused one is never sent");
}

// 3. A refusal `exp` could not predict — revoked elsewhere, a key rotated — is renewed and replayed.
{
  const cred = credential({ start: LIVE });
  const t = transport([json({ error: 1 }, 401), json({ ok: 2 })]);
  const res = await authorized(cred, { fetchImpl: t.impl }).json("https://x/three");
  check(res.ok && res.body.ok === 2, "a 401 renews and replays");
  check(t.calls.length === 2 && cred.rotations === 1, "exactly twice, on one rotation", `${t.calls.length}/${cred.rotations}`);
  check(t.bearers()[1] === "Bearer " + FRESH, "the replay carries the NEW bearer");
}

// 4. Once only. A member still refusing a fresh session is not describing the bearer, and asking a
//    third time is a loop that ends where the second one did.
{
  const cred = credential({ start: LIVE });
  const t = transport([json({}, 401), json({}, 401)]);
  const res = await authorized(cred, { fetchImpl: t.impl }).json("https://x/four");
  check(!res.ok && res.status === 401, "a second refusal stands", String(res.status));
  check(t.calls.length === 2 && cred.rotations === 1, "and is not renewed again", `${t.calls.length}/${cred.rotations}`);
}

// 5. The method carries through a replay unchanged — a PUT replayed as a GET would report success
//    for a change that never happened.
{
  const cred = credential({ start: LIVE });
  const t = transport([json({}, 401), json({ ok: 5 })]);
  await authorized(cred, { fetchImpl: t.impl }).json("https://x/five", { method: "PUT", body: "{}" });
  check(t.calls.every((c) => c.method === "PUT"), "a replay repeats the same method",
    t.calls.map((c) => c.method).join(","));
}

// 6. `once` renews ahead of the call like everything else — that spends no request — and then stands
//    on the answer. The difference between the modes is the REPLAY, never the preflight.
{
  const cred = credential({ start: LAPSED });
  const t = transport([json({ ok: 6 })]);
  const res = await authorized(cred, { fetchImpl: t.impl }).once("https://x/six");
  check(res.ok && cred.rotations === 1 && t.calls.length === 1,
    "`once` still renews a lapsed bearer ahead of the call", `${t.calls.length}/${cred.rotations}`);
}

// 7. …and a refusal it gets is reported, not replayed. A call that may not be sent twice may not be
//    sent twice to heal itself either.
{
  const cred = credential({ start: LIVE });
  const t = transport([json({}, 401)]);
  const res = await authorized(cred, { fetchImpl: t.impl }).once("https://x/seven");
  check(!res.ok && res.status === 401, "`once` reports a 401");
  check(t.calls.length === 1 && cred.rotations === 0, "and never replays it", `${t.calls.length}/${cred.rotations}`);
}

// 8. A session that cannot be renewed makes NO request. Spending a bearer known to be dead would put
//    a 401 in a log for a call nobody could have expected to work.
{
  const cred = credential({ start: null, refuseRotation: true });
  const t = transport([json({ ok: 8 })]);
  const res = await authorized(cred, { fetchImpl: t.impl }).json("https://x/eight");
  check(!res.ok && res.unauthenticated && res.status === 401, "a dead session answers unauthenticated");
  check(t.calls.length === 0, "with no request made", String(t.calls.length));
}

// 9. A transport failure is its own answer. An anchor this browser cannot reach and a session that
//    has ended are different sentences, and a surface that showed one for the other would send
//    somebody to sign in over a network blip.
{
  const cred = credential({ start: LIVE });
  const t = transport([() => { throw new TypeError("Failed to fetch"); }]);
  const res = await authorized(cred, { fetchImpl: t.impl }).json("https://x/nine");
  check(!res.ok && res.unreachable && res.status === 0, "an unreachable host is not a refusal",
    `${res.status}/${!!res.unreachable}`);
  check(cred.rotations === 0, "and spends no rotation", String(cred.rotations));
}

// 10. A stream dial refused with 401 renews and re-dials, so a follow opened on a bearer that died
//     while a page sat idle recovers rather than reporting the daemon as unreadable.
{
  const cred = credential({ start: LIVE });
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('data: {"line":"one"}\n\ndata: {"line":"two"}\n\n'));
      c.close();
    },
  });
  const t = transport([
    new Response("", { status: 401 }),
    new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
  ]);
  const seen = [];
  const follow = authorized(cred, { fetchImpl: t.impl })
    .stream("https://x/ten", { onEvent: (e) => seen.push(e.line) });
  const res = await follow.stopped;
  check(res.ok, "a refused dial renews and re-dials");
  check(t.calls.length === 2 && cred.rotations === 1, "once", `${t.calls.length}/${cred.rotations}`);
  check(seen.join(",") === "one,two", "and the frames arrive", seen.join(","));
}

// 11. Concurrent refusals share ONE spend of the refresh token. The collapsing belongs to the
//     credential — a refresh token spent twice is a replay, and the anchor refuses a replay for the
//     same reason it refuses a stolen one — so what is asserted here is that this module asks
//     through `rotate()` and holds no rotation of its own beside it.
{
  let inflight = null;
  let spends = 0;
  const cred = {
    get: () => LIVE,
    rotate: () => {
      if (inflight) return inflight;
      inflight = (async () => { spends++; return FRESH; })().finally(() => { inflight = null; });
      return inflight;
    },
  };
  const t = transport([json({}, 401), json({}, 401), json({ ok: 1 }), json({ ok: 1 })]);
  const api = authorized(cred, { fetchImpl: t.impl });
  await Promise.all([api.json("https://x/a"), api.json("https://x/b")]);
  check(spends === 1, "two refusals collapse onto one spend of the refresh token", String(spends));
}

// 12. The seam refuses to be built on a token. This is the constraint the whole design rests on:
//     a function handed a string can only spend it, so the type is what stops the shape existing.
{
  let threw = false;
  try { authorized("a-token-string"); } catch { threw = true; }
  check(threw, "a token is not a credential and is refused at construction");
}

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);
