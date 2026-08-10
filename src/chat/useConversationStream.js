import React from "react";

import { assistant } from "../lib/assistantClient.js";

// useConversationStream — hold the leaf's `GET /events` open for one host, so a conversation open on
// two surfaces agrees with itself without either polling the other.
//
// Two things this owns that the seam deliberately does not:
//
//  - **Reconnection.** A stream ends for ordinary reasons (a proxy idle timeout, a sleeping laptop, a
//    dropped network) and the fix is always to open another. Backoff is exponential and capped, so a
//    leaf that is down is retried patiently rather than hammered.
//  - **The resync after a gap.** Nothing was buffered while the stream was down, so a reopened stream
//    knows nothing about what it missed. `onResync` fires on every reconnection — never on the first
//    connection, where the caller has just read the list anyway — and re-reading the listing is what
//    closes the gap. This is why the events themselves need no delivery guarantee.
//
// A surface skips its OWN echoes here rather than in the reducer: the leaf stamps each event with the
// stream whose caller caused it, so an event carrying this stream's id is something this surface has
// already applied, and applying it twice is at best a wasted render.

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

function useConversationStream({ hostId, enabled, conversationId, onEvent, onResync }) {
  // Held in refs so a changed callback never tears the stream down and reconnects: the identity of
  // `onEvent` changes on most renders, and a reconnect per render would be a reconnect storm.
  const eventRef = React.useRef(onEvent);
  const resyncRef = React.useRef(onResync);
  const watchingRef = React.useRef(conversationId);
  eventRef.current = onEvent;
  resyncRef.current = onResync;

  // Re-point the open stream when the person opens a different conversation. Held in a ref as well so
  // a stream that reconnects attaches to what is on screen NOW rather than to whatever was open when
  // it was first established.
  React.useEffect(() => {
    watchingRef.current = conversationId;
    if (!hostId || !enabled) return;
    // Only an OPEN stream can be re-pointed: an attach names a stream, and this surface has no name
    // until the leaf's `hello` frame has arrived. With no stream there is nothing to say — the open
    // handler below attaches to whatever this ref holds, so a conversation selected before the stream
    // is running, or during a reconnect gap, is picked up the moment one is.
    if (!assistant.host(hostId).streamId()) return;
    assistant.host(hostId).attach(conversationId).catch(() => {});
  }, [hostId, enabled, conversationId]);

  React.useEffect(() => {
    if (!hostId || !enabled) return undefined;

    let stopped = false;
    let timer = null;
    let controller = null;
    let attempt = 0;
    let connected = false;   // has a stream carried anything on this host yet?

    const run = async () => {
      while (!stopped) {
        controller = new AbortController();
        let opened = false;
        try {
          await assistant.host(hostId).events({
            signal: controller.signal,
            onEvent: (evt) => {
              if (!evt || !evt.type) return;
              if (!opened) {
                opened = true;
                attempt = 0;                       // a stream that spoke is a stream that works
                // A stream carries turn frames only for the conversation it is pointed at, so say
                // which one before anything can be missed. The leaf answers on the stream itself.
                assistant.host(hostId).attach(watchingRef.current).catch(() => {});
                if (connected && resyncRef.current) resyncRef.current();
                connected = true;
              }
              // The leaf's opening frame is plumbing; the seam has already recorded the id from it.
              if (evt.type === "hello") return;
              if (evt.origin && evt.origin === assistant.host(hostId).streamId()) return;
              if (eventRef.current) eventRef.current(evt);
            },
          });
        } catch {
          // An abort is this effect being cleaned up; anything else is a leaf we could not reach.
          // Both end the same way — the loop below decides whether to try again.
        }
        if (stopped) return;

        // Ending is not a failure, so a stream that ran and stopped retries promptly; one that never
        // opened backs off, because the leaf is the thing that is not answering.
        const wait = opened ? FIRST_RETRY_MS : Math.min(FIRST_RETRY_MS * 2 ** attempt++, MAX_RETRY_MS);
        await new Promise((resolve) => { timer = setTimeout(resolve, wait); });
      }
    };

    run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (controller) controller.abort();
    };
  }, [hostId, enabled]);
}

export { useConversationStream };
