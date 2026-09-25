// oidc.js — how a surface finds the cluster's sign-in provider and holds a session from it.
//
// Every browser surface is a public OpenID Connect client of the auth anchor: `authorization_code`
// with PKCE, a refresh token that renews the session without a page, and nothing this surface mints
// or signs itself. The protocol is `oidc-client-ts`'s; what is decided here is only what the library
// cannot know.
//
//   • WHERE the provider is. A surface asks the origin that served it, which names its provider at
//     `/.well-known/oauth-protected-resource`. A surface served by something that answers nothing — a
//     static host — asks the address it is given instead, which may be any member or the provider
//     itself.
//   • WHO this surface is. Its client id is its own origin's host, with `-<port>` when the origin
//     names one — derived here from where the page was loaded, so a surface is told nothing and a
//     panel on a static host signs in through a member that never served it.
//   • WHAT a refusal means. A token endpoint that answers with an OAuth error has ended the session;
//     one that could not be reached has said nothing about it, and the two are reported apart.
//
// Imports nothing but the library, so the standalone assistant — which may reach none of the panel's
// data layer — holds its session through the same code as the panel.

import { ErrorResponse, UserManager, WebStorageStateStore } from "oidc-client-ts";

// Normalize to an http(s) origin with no trailing slash. "" if unusable.
function originOf(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  try { return new URL(/^https?:\/\//i.test(s) ? s : "https://" + s).origin; } catch { return ""; }
}

// The client id an origin signs in as: its host, lowercased, and `-<port>` when the origin names a
// port its scheme would not imply. Null for anything that is not an http(s) origin, or whose host is
// an IPv6 literal, which no client id can spell.
function clientIdFor(origin) {
  let url;
  try { url = new URL(origin); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (!host || host.includes(":") || host.startsWith("[")) return null;
  return url.port ? host + "-" + url.port : host;
}

// The issuer named by a protected-resource document, or "" when it names none usable.
function issuerIn(doc) {
  const servers = doc && Array.isArray(doc.authorization_servers) ? doc.authorization_servers : [];
  const issuer = typeof servers[0] === "string" ? servers[0].trim().replace(/\/+$/, "") : "";
  return originOf(issuer) ? issuer : "";
}

// Which provider signs sessions for whatever answers at `address`.
//
//   { ok: true,  issuer, via }                the provider, and the address that named it
//   { ok: false, reason: "no_provider", via } a member answered and knows of no provider yet
//   { ok: false, reason: "unreachable" }      nothing answered as a member or a provider
//   { ok: false, reason: "invalid" }          not an address
//
// A member is asked first, because that is what any address a person has for a cluster most often
// is. What answers nothing there is asked whether it is the provider itself.
async function discoverProvider(address, { fetchImpl = fetch, signal } = {}) {
  const base = originOf(address);
  if (!base) return { ok: false, reason: "invalid" };
  const read = async (path) => {
    try {
      const res = await fetchImpl(base + path, { headers: { Accept: "application/json" }, signal });
      return { status: res.status, body: res.ok ? await res.json().catch(() => null) : null };
    } catch { return { status: 0, body: null }; }
  };

  const resource = await read("/.well-known/oauth-protected-resource");
  if (resource.status === 200) {
    const issuer = issuerIn(resource.body);
    if (issuer) return { ok: true, issuer, via: base };
  }
  if (resource.status === 503) return { ok: false, reason: "no_provider", via: base };

  const provider = await read("/.well-known/openid-configuration");
  const issuer = provider.body && typeof provider.body.issuer === "string"
    ? provider.body.issuer.trim().replace(/\/+$/, "") : "";
  if (provider.status === 200 && originOf(issuer)) return { ok: true, issuer, via: base };
  return { ok: false, reason: "unreachable" };
}

// A client of `issuer`, signing in as this page's origin.
//
// The session lives in `localStorage` so a tab opened days later renews without a bounce; the
// verifier and `state` of a round trip in flight stay in `sessionStorage`, because they belong to the
// one tab that left. Renewal is the refresh grant alone — no iframe, no silent re-authorization — so
// automatic renewal and session monitoring are off and the callers renew when a call is refused.
//
// Every request to the provider is bounded. Renewals share one in-flight promise that the boot and
// every refused call await, so a token endpoint that accepts the connection and never answers would
// hold all of them forever; a timeout is reported like any provider that could not be asked.
const PROVIDER_TIMEOUT_S = 10;

function createClient({ issuer, redirectPath, postLogoutPath, prefix }) {
  const origin = window.location.origin;
  return new UserManager({
    authority: issuer,
    client_id: clientIdFor(origin) || "",
    redirect_uri: origin + redirectPath,
    post_logout_redirect_uri: origin + postLogoutPath,
    response_type: "code",
    scope: "openid",
    userStore: new WebStorageStateStore({ prefix, store: window.localStorage }),
    stateStore: new WebStorageStateStore({ prefix, store: window.sessionStorage }),
    automaticSilentRenew: false,
    monitorSession: false,
    loadUserInfo: false,
    requestTimeoutInSeconds: PROVIDER_TIMEOUT_S,
  });
}

// The claims an access token carries, read without verifying anything: the members verify it, and
// this is only which tier it was minted with. Null for anything that is not a JWT.
function claimsOf(token) {
  try {
    const seg = String(token).split(".")[1];
    const json = atob(seg.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(Array.from(json, (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")));
  } catch { return null; }
}

// Renew through the refresh grant.
//
//   { ok: true, user }        a fresh session
//   { ok: false, ended: true } the provider refused the refresh token — this session is over
//   { ok: false }             the provider could not be asked, and nothing is known about the session
//
// A refusal is checked against storage once before it is believed. Every tab on this origin shares
// the stored session, so two tabs renewing together present the same refresh token and the provider,
// correctly, rotates it for whichever arrived first; the other is holding a token superseded a moment
// ago rather than a session that has ended.
async function renew(client) {
  const before = await client.getUser().catch(() => null);
  if (!before || !before.refresh_token) return { ok: false, ended: true };
  try {
    // The refresh grant takes its bound from this argument alone: the library spreads an absent one
    // over its own default, so leaving it out leaves the request unbounded.
    const user = await client.signinSilent({ silentRequestTimeoutInSeconds: PROVIDER_TIMEOUT_S });
    return user && user.access_token ? { ok: true, user } : { ok: false };
  } catch (err) {
    if (!(err instanceof ErrorResponse)) return { ok: false };
    const after = await client.getUser().catch(() => null);
    if (after && after.refresh_token && after.refresh_token !== before.refresh_token && !after.expired) {
      return { ok: true, user: after };
    }
    await client.removeUser().catch(() => {});
    return { ok: false, ended: true };
  }
}

export { claimsOf, clientIdFor, createClient, discoverProvider, originOf, renew };
