// authStorage — pure auth persistence helpers. No React, no component deps.

const AUTH_LS_KEY = "krystal:auth";
const AUTH_SS_KEY = "krystal:auth:session";

function readStoredUser() {
  try {
    const persisted = localStorage.getItem(AUTH_LS_KEY);
    if (persisted) return JSON.parse(persisted);
    const sessioned = sessionStorage.getItem(AUTH_SS_KEY);
    if (sessioned) return JSON.parse(sessioned);
  } catch (e) {}
  return null;
}

function writeStoredUser(user) {
  try {
    localStorage.removeItem(AUTH_LS_KEY);
    sessionStorage.removeItem(AUTH_SS_KEY);
    if (!user) return;
    const target = user.stay ? localStorage : sessionStorage;
    target.setItem(user.stay ? AUTH_LS_KEY : AUTH_SS_KEY, JSON.stringify(user));
  } catch (e) {}
}

export { readStoredUser, writeStoredUser };
