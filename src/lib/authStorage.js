// authStorage — pure auth persistence helpers. No React, no component deps.

const AUTH_LS_KEY = "krystal:auth";
const AUTH_SS_KEY = "krystal:auth:session";
// One-shots carried across a navigation, in this tab only: what the provider said when it sent the
// browser back without a session, and that a session ended while the panel was open.
const REFUSAL_KEY = "krystal:signin:refused";
const ENDED_KEY = "krystal:signin:ended";

function readStoredUser() {
  try {
    const persisted = localStorage.getItem(AUTH_LS_KEY);
    if (persisted) return JSON.parse(persisted);
    const sessioned = sessionStorage.getItem(AUTH_SS_KEY);
    if (sessioned) return JSON.parse(sessioned);
  } catch {}
  return null;
}

function writeStoredUser(user) {
  try {
    localStorage.removeItem(AUTH_LS_KEY);
    sessionStorage.removeItem(AUTH_SS_KEY);
    if (!user) return;
    const target = user.stay ? localStorage : sessionStorage;
    target.setItem(user.stay ? AUTH_LS_KEY : AUTH_SS_KEY, JSON.stringify(user));
  } catch {}
}

function take(key) {
  try { const v = sessionStorage.getItem(key); if (v) sessionStorage.removeItem(key); return v; }
  catch { return null; }
}
function put(key, value) { try { sessionStorage.setItem(key, value); } catch { /* private mode */ } }

const noteSignInRefusal = (error) => put(REFUSAL_KEY, error || "sign_in_failed");
const takeSignInRefusal = () => take(REFUSAL_KEY);
const noteSessionEnded = () => put(ENDED_KEY, "1");
const takeSessionEnded = () => !!take(ENDED_KEY);

export {
  noteSessionEnded, noteSignInRefusal, readStoredUser, takeSessionEnded, takeSignInRefusal, writeStoredUser,
};
