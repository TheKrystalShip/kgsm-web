// Where a surface signs in, and who it signs in as.
//
// A surface asks the origin that served it where its cluster's sign-in provider is. A member names it
// at `/.well-known/oauth-protected-resource`; the provider itself answers at its own discovery
// document; a member that knows of no provider yet says so with a 503; anything else answers nothing
// usable. Whichever answers, the surface's client id is its own origin's host, with `-<port>` when
// the origin names one — derived, never configured.
//
// Every fetch is recorded, so "an address was asked exactly what it needed to be asked" is measured.
//
//   node scripts/validate-entry-paths.mjs
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://panel.test/" });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.location = dom.window.location;

const ISSUER = "https://auth.test";
const MEMBER = "https://member.test";
const SETTLING = "https://new-member.test";
const STRANGER = "https://nginx.test";
const DEAD = "https://gone.test";

const calls = [];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  const at = (o, p) => u === o + p;

  if (at(MEMBER, "/.well-known/oauth-protected-resource"))
    return json({ resource: MEMBER, authorization_servers: [ISSUER], bearer_methods_supported: ["header"] });
  if (at(SETTLING, "/.well-known/oauth-protected-resource"))
    return json({ error: { code: "no_issuer" } }, 503);
  if (at(ISSUER, "/.well-known/openid-configuration")) return json({ issuer: ISSUER });
  if (u.startsWith(DEAD)) throw new TypeError("Failed to fetch");
  return new Response("<html>not here</html>", { status: 404 });
};

const { clientIdFor, discoverProvider } = await import("../src/lib/oidc.js");

let fail = 0;
const check = (c, label, extra = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};
const asked = (origin, from) => calls.slice(from).filter(u => u.startsWith(origin));

let mark = calls.length;
let found = await discoverProvider(MEMBER);
check(found.ok && found.issuer === ISSUER && found.via === MEMBER, "a member names its provider", JSON.stringify(found));
check(asked(MEMBER, mark).length === 1, "in one request", String(asked(MEMBER, mark).length));

found = await discoverProvider("member.test");
check(found.ok && found.issuer === ISSUER, "a bare host is read as https");

mark = calls.length;
found = await discoverProvider(ISSUER);
check(found.ok && found.issuer === ISSUER && found.via === ISSUER, "the provider itself is its own answer", JSON.stringify(found));
check(asked(ISSUER, mark).length === 2, "asked as a member first, then as the provider");

found = await discoverProvider(SETTLING);
check(!found.ok && found.reason === "no_provider", "a member that knows of no provider says so", JSON.stringify(found));

found = await discoverProvider(STRANGER);
check(!found.ok && found.reason === "unreachable", "something that is neither answers nothing usable", JSON.stringify(found));

found = await discoverProvider(DEAD);
check(!found.ok && found.reason === "unreachable", "and nothing answering is the same answer", JSON.stringify(found));

found = await discoverProvider("   ");
check(!found.ok && found.reason === "invalid", "a blank address is not one");

check(clientIdFor("https://kgsm.example.com") === "kgsm.example.com", "a client id is the origin's host");
check(clientIdFor("https://KGSM.Example.com") === "kgsm.example.com", "lowercased");
check(clientIdFor("http://192.168.1.10:8097") === "192.168.1.10-8097", "with the port the origin names");
check(clientIdFor("https://kgsm.example.com:443") === "kgsm.example.com", "and none for the scheme's own");
check(clientIdFor("http://[::1]:8097") === null, "an IPv6 literal names no client");
check(clientIdFor("ftp://kgsm.example.com") === null, "and neither does anything that is not http(s)");

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);
