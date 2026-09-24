// provider.js — the one stored fact about where this panel signs in.
//
// The cluster's sign-in provider, as the issuer a member named, and the address that named it when
// that was not the page's own origin. Not a credential: a stale one costs a sign-in that fails and is
// asked again, never a wrong session, because a token is only ever accepted on its signature.
//
// It is also what says the cluster names the fleet. With a provider known, the panel keeps no list
// of nodes between loads — the anchor is asked on every load and its answer is the whole of it, so a
// node the cluster no longer names cannot outlive the roster that named it. A host run with auth
// switched off has no provider, and keeps the one address somebody typed exactly as it always did.
//
// Imports nothing, so the modules that persist connections can read it without importing the
// session layer that sits above them.

const PROVIDER_KEY = "krystal:provider";   // localStorage: {issuer, via}

function readProvider() {
  try {
    const raw = localStorage.getItem(PROVIDER_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p.issuer === "string" && p.issuer ? { issuer: p.issuer, via: p.via || null } : null;
  } catch { return null; }
}

function writeProvider(p) {
  try {
    if (p && p.issuer) localStorage.setItem(PROVIDER_KEY, JSON.stringify({ issuer: p.issuer, via: p.via || null }));
    else localStorage.removeItem(PROVIDER_KEY);
  } catch { /* private mode */ }
}

function providerNamesTheFleet() { return !!readProvider(); }

export { PROVIDER_KEY, providerNamesTheFleet, readProvider, writeProvider };
