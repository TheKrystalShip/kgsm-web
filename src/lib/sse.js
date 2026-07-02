// sse.js — shared SSE parsing + streaming helpers (leaf util, imports nothing).
//
// Used by both the assistant turn relay (liveTurn in apiClient.js) and the new
// per-host realtime SSE stream (createSseStream). Keeps the ESM graph acyclic.

/// Parse one SSE event block → its in-band JSON payload.
/// Each frame carries a `data:` line with JSON; `:`-comment lines yield no data
/// → returns null (heartbeats are ignored for free).
/// Per the SSE spec, multiple `data:` lines concatenate with "\n" (the writer emits one).
export function parseSseEvent(block) {
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!data.length) return null;
  try { return JSON.parse(data.join("\n")); } catch (e) { return null; }
}

/// Read an SSE response body stream, calling `onEvent` for each parsed event.
/// Uses `getReader()` + `TextDecoder` + split-on-`\n\n` loop. Stops on stream
/// end, abort, or transport error. Returns when the stream is fully consumed.
export async function readSseStream(res, onEvent, signal) {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    let chunk;
    try { chunk = await reader.read(); }
    catch (e) { if (e && e.name === "AbortError") throw e; break; }
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const evt = parseSseEvent(block);
      if (evt) onEvent(evt);
    }
  }
  // Flush a trailing complete block with no terminating blank line (defensive).
  const tail = buf.trim();
  if (tail) { const evt = parseSseEvent(tail); if (evt) onEvent(evt); }
}
