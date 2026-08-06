// public-overlay.js — the per-surface half of the static assets, for both Vite builds.
//
// This repo builds two installable apps over one source tree, and static files divide the same way
// the styles do: a shared floor plus a per-surface list.
//
//   public/            SHARED — fonts, the brand mark. Copied into both bundles by Vite itself.
//   public-panel/      the Control Panel's manifest, service worker, icons and launch images.
//   public-assistant/  the standalone assistant's.
//
// The per-surface half cannot live in public/, because each surface installs as its OWN app: two
// manifests, two service workers with different caching rules, and two sets of artwork so the two
// icons are told apart on one home screen. Sharing that directory would put each app's artwork in
// the other's deploy, and — worse — leave the assistant's origin serving a service worker written
// for kgsm-api's route layout, which is the one file whose rules are actively wrong there.
//
// Shared-by-default is deliberate: a new asset dropped in public/ reaches both surfaces with no
// edit here, and only a difference has to be declared. That is the same arrangement as the style
// barrels (src/styles/CLAUDE.md) — one set of shared parts, a short per-surface list.

import { createReadStream, existsSync, cpSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const TYPES = {
  ".png": "image/png",
  ".js": "text/javascript",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * Lay `dir` over the build output, on top of whatever Vite copied from publicDir.
 * @param {string} dir absolute path to the surface's own public directory
 */
export function publicOverlay(dir) {
  let outDir;
  return {
    name: "public-overlay",

    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },

    // `npm run dev` / `dev:assistant` never run a build, so the overlay is served straight from
    // disk — otherwise the dev surface would be the one place with no manifest and no icons.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url || "").split("?")[0]);
        // Confine to the overlay directory: a served path is only ever one that resolves inside
        // it, so a traversal attempt lands outside and falls through to Vite.
        const file = join(dir, path);
        if (!file.startsWith(dir + "/") || !existsSync(file) || !statSync(file).isFile()) {
          return next();
        }
        res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
        return createReadStream(file).pipe(res);
      });
    },

    // After Vite has written the bundle AND copied publicDir, so the overlay lands on top.
    closeBundle() {
      cpSync(dir, outDir, { recursive: true });
    },
  };
}
