// assistantReview — the admin-only read path onto one host's assistant corpus: the roll-up behind the
// leaf page's Overview, and the who → which-conversation → transcript walk behind its Conversations
// tab.
//
// Deliberately plain fetchers rather than a reactive store. Every one of these is scoped to a host
// AND to a user the reviewer picked, so there is no single "current" value for a store to hold, and
// nothing here arrives over the realtime stream — the corpus only changes when someone talks to the
// assistant, which no admin surface needs to watch live. The pages own the request state, exactly as
// the leaf-config page owns its own (fetchLeafConfig, same shape).
//
// Everything is admin-gated by the leaf itself: its /admin group is fail-closed on the tier it
// derives from the caller's own session, so a non-admin never gets a row.

import * as adapt from "../adapters.js";
import { assistant } from "../assistantClient.js";

/// The whole-corpus roll-up for one host. A host with no assistant, or one with no browser route to
/// it, rejects here — the caller renders that as "no assistant here", never as zeroes.
function fetchAssistantStats(hostId) {
  if (!hostId) return Promise.resolve(null);
  return assistant.host(hostId).reviewStats().then(adapt.adaptAssistantStats);
}

/// Everyone who has talked to this host's assistant.
function fetchAssistantReviewUsers(hostId) {
  if (!hostId) return Promise.resolve([]);
  return assistant.host(hostId).reviewUsers().then(adapt.adaptAssistantReviewUsers);
}

/// One person's conversations, soft-deleted ones included and flagged by the leaf.
function fetchAssistantConversations(hostId, userId) {
  if (!hostId || !userId) return Promise.resolve([]);
  return assistant.host(hostId).reviewConversations(userId).then(adapt.adaptAssistantConversations);
}

/// One transcript, addressed by the opaque handle the listing minted. The response is the SAME shape
/// the caller's own history returns, which is what lets the dock replay someone else's conversation
/// through the existing render path instead of a second one built to drift from it.
function fetchAssistantTranscript(hostId, handle) {
  if (!hostId || !handle) return Promise.resolve(null);
  return assistant.host(hostId).reviewConversation(handle);
}

export {
  fetchAssistantStats, fetchAssistantReviewUsers, fetchAssistantConversations, fetchAssistantTranscript,
};
