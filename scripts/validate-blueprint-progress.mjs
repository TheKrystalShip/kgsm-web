// Frame-sequence unit check for the assistant-blueprint-authoring P4 UI (progress
// stepper + terminal outcome card). No live backend needed — this drives the SPA's OWN
// pure §5·a reducer (chatUtils.reduceTurnFrame) with SYNTHETIC SSE frames and asserts on
// the resulting messages array. This repo has no jest/vitest (CLAUDE.md forbids the
// LIVE/MOCK duality + there's no test runner) — `reduceTurnFrame` is the de-facto unit
// seam, same pattern as scripts/validate-chat-live.mjs's reducer-level assertions, just
// without the network leg.
//
//   Usage: node scripts/validate-blueprint-progress.mjs
import { createServer } from "vite";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost:5173/", pretendToBeVisual: true,
});
const w = dom.window;
globalThis.window = w;
for (const k of ["document", "localStorage", "sessionStorage", "HTMLElement", "Node", "getComputedStyle", "DOMParser", "Event", "CustomEvent", "navigator", "location", "history"]) {
  try { if (!globalThis[k]) globalThis[k] = w[k]; } catch {}
}
w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let fail = 0;
const assert = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) fail++; };

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { reduceTurnFrame, adaptResultCard } = await vite.ssrLoadModule("/src/pages/chat/chatUtils.jsx");

  const feed = (messages, frames) => frames.reduce((m, ev) => reduceTurnFrame(m, ev), messages);
  const seed = (prompt) => [{ role: "user", content: prompt }, { role: "assistant", content: "" }];

  // ---------- 1) success: research → feasibility → draft → install → verify → teardown → verified ----------
  console.log("\n→ create_blueprint success sequence\n");
  const successFrames = [
    { type: "tool.start",  id: "tc_1", tool: "create_blueprint" },
    { type: "progress", id: "tc_1", tool: "create_blueprint", key: "research",    label: "Looking it up online…",       status: "active" },
    { type: "progress", id: "tc_1", tool: "create_blueprint", key: "feasibility", label: "Checking if it can run natively…", status: "active" },
    { type: "progress", id: "tc_1", tool: "create_blueprint", key: "draft",       label: "Building a config…",          status: "active" },
    { type: "progress", id: "tc_1", tool: "create_blueprint", key: "install",     label: "Test-installing it…",         status: "active" },
    { type: "progress", id: "tc_1", tool: "create_blueprint", key: "verify",      label: "Booting it up…",              status: "active" },
    { type: "progress", id: "tc_1", tool: "create_blueprint", key: "teardown",    label: "Cleaning up…",                status: "active" },
    { type: "tool.result", id: "tc_1", tool: "create_blueprint", summary: "verified", result: {
      tool: "create_blueprint", confidence: "confirmed",
      subject: { kind: "blueprint", id: "palworld" },
      data: { outcome: "verified", displayName: "Palworld", proof: "booted and answered on port 8211" },
    } },
    { type: "text.delta", text: "I didn’t have Palworld, so I " },
    { type: "text.delta", text: "researched it, built a config, and test-ran it." },
    { type: "done", text: "I didn’t have Palworld, so I researched it, built a config, and test-ran it — it booted and answered on port 8211. Palworld is now in the catalog. Want me to make you a server?" },
  ];
  const successMsgs = feed(seed("Can you add Palworld?"), successFrames);
  const successBubble = successMsgs[successMsgs.length - 1];

  assert(successBubble.role === "assistant", "success: last message is the assistant bubble");
  assert(Array.isArray(successBubble.steps) && successBubble.steps.length === 6,
    `success: bubble carries all 6 steps (got ${successBubble.steps && successBubble.steps.length})`);
  assert(successBubble.steps.every(s => s.status === "done"),
    "success: tool.result checked off the last still-active step — every step is done");
  assert(successBubble.steps.map(s => s.key).join(",") === "research,feasibility,draft,install,verify,teardown",
    "success: step order preserved (research→feasibility→draft→install→verify→teardown)");
  assert(!successBubble.pendingCards, "success: pendingCards promoted away by done (no leftover staging array)");
  assert(Array.isArray(successBubble.cards) && successBubble.cards.length === 1,
    `success: exactly one promoted card (got ${successBubble.cards && successBubble.cards.length})`);
  const outcomeCard = successBubble.cards && successBubble.cards[0];
  assert(outcomeCard && outcomeCard.kind === "blueprintOutcome", "success: card kind is blueprintOutcome");
  assert(outcomeCard && outcomeCard.ok === true, "success: ok === true");
  assert(outcomeCard && outcomeCard.slug === "palworld", `success: slug from subject.id (got ${outcomeCard && outcomeCard.slug})`);
  assert(outcomeCard && outcomeCard.displayName === "Palworld", "success: displayName carried through");
  assert(outcomeCard && outcomeCard.proof === "booted and answered on port 8211", "success: proof carried through");
  assert(outcomeCard && outcomeCard.reason == null, "success: reason stays null (never fabricated) on a verified outcome");

  // ---------- 2) failure: research → feasibility → honest stop ----------
  console.log("\n→ create_blueprint failure sequence\n");
  const failFrames = [
    { type: "tool.start",  id: "tc_2", tool: "create_blueprint" },
    { type: "progress", id: "tc_2", tool: "create_blueprint", key: "research",    label: "Looking it up online…",           status: "active" },
    { type: "progress", id: "tc_2", tool: "create_blueprint", key: "feasibility", label: "Checking if it can run natively…", status: "active" },
    { type: "tool.result", id: "tc_2", tool: "create_blueprint", summary: "not feasible", result: {
      tool: "create_blueprint", confidence: "confirmed",
      subject: { kind: "blueprint", id: "some-windows-only-game" },
      data: { outcome: "failed", displayName: "Some Windows-Only Game", reason: "needs Wine — beyond what I can set up automatically" },
    } },
    { type: "done", text: "I couldn’t add Some Windows-Only Game — it needs Wine, which is beyond what I can set up automatically." },
  ];
  const failMsgs = feed(seed("Can you add SomeWindowsOnlyGame?"), failFrames);
  const failBubble = failMsgs[failMsgs.length - 1];

  assert(Array.isArray(failBubble.steps) && failBubble.steps.length === 2,
    `failure: bubble carries both attempted steps (got ${failBubble.steps && failBubble.steps.length})`);
  assert(failBubble.steps.every(s => s.status === "done"), "failure: tool.result checked off the stranded active step");
  assert(Array.isArray(failBubble.cards) && failBubble.cards.length === 1, "failure: exactly one promoted card");
  const failCard = failBubble.cards && failBubble.cards[0];
  assert(failCard && failCard.kind === "blueprintOutcome", "failure: card kind is blueprintOutcome");
  assert(failCard && failCard.ok === false, "failure: ok === false");
  assert(failCard && failCard.slug === "some-windows-only-game", "failure: slug carried through on failure too");
  assert(failCard && failCard.reason === "needs Wine — beyond what I can set up automatically", "failure: reason carried through verbatim");
  assert(failCard && failCard.proof == null, "failure: proof stays null (never fabricated) on a failed outcome");

  // ---------- 3) an unrecognized outcome/ok never reads as success ----------
  const unknownFrames = [
    { type: "tool.start",  id: "tc_3", tool: "create_blueprint" },
    { type: "tool.result", id: "tc_3", tool: "create_blueprint", summary: "?", result: {
      tool: "create_blueprint", subject: { kind: "blueprint", id: "mystery" }, data: { displayName: "Mystery" },
    } },
    { type: "done", text: "." },
  ];
  const unknownMsgs = feed(seed("Add Mystery?"), unknownFrames);
  const unknownCard = unknownMsgs[unknownMsgs.length - 1].cards[0];
  assert(unknownCard && unknownCard.ok === false, "unknown outcome: falls to the honest ‘couldn’t’ side, never fabricated success");

  // ---------- 4) regression: an ordinary tool call with NO progress frames still works ----------
  console.log("\n→ regression: ordinary get_status turn (no progress frames)\n");
  const plainFrames = [
    { type: "tool.start", id: "tc_4", tool: "get_status" },
    { type: "tool.result", id: "tc_4", tool: "get_status", summary: "1 running", result: {
      tool: "get_status", confidence: "confirmed",
      data: { servers: [{ instance: "palworld-1", state: "running" }], running: 1, stopped: 0 },
    } },
    { type: "text.delta", text: "Palworld is running." },
    { type: "done", text: "Palworld is running." },
  ];
  const plainMsgs = feed(seed("Is Palworld running?"), plainFrames);
  const plainBubble = plainMsgs[plainMsgs.length - 1];
  assert(!plainBubble.steps, "regression: a bubble with no progress frames carries no steps array");
  assert(plainBubble.tools && plainBubble.tools.length === 1 && plainBubble.tools[0].state === "done",
    "regression: the tool pill still resolves to done as before");
  assert(plainBubble.cards && plainBubble.cards.length === 1 && plainBubble.cards[0].kind === "fleet",
    "regression: the ordinary get_status card still promotes as before");
  assert(plainBubble.content === "Palworld is running.", "regression: streamed text still lands in content");

  // Also exercise adaptResultCard directly (the exact seam the team-lead spec calls out).
  const direct = adaptResultCard({ tool: "create_blueprint", confidence: "possible",
    subject: { kind: "blueprint", id: "direct-check" }, data: { ok: true, proof: "up on port 1234" } });
  assert(direct && direct.kind === "blueprintOutcome" && direct.ok === true && direct.slug === "direct-check",
    "adaptResultCard: also tolerates the plain-bool `ok` wire shape (not just `outcome`)");
} catch (e) {
  console.error("✗ harness error:", e && (e.stack || e.message));
  fail++;
} finally {
  await vite.close();
}

console.log(`\n${fail === 0 ? "✅ blueprint progress + outcome card reduce correctly" : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
