#!/usr/bin/env bash
#
# deploy.sh — build the SPA and publish it. Fully headless: no sudo, no prompts, NO API restart.
#
#   ./deploy/deploy.sh          # or: npm run deploy:prod
#
# Builds the SPA and syncs dist/ into the directory a web server publishes. The new bundle is LIVE
# THE MOMENT the files land: no systemctl, no service bounce, no sudo.
#
# The build carries NO node address. The panel is a static artifact that belongs to no cluster and
# reaches whichever one it is pointed at; baking a node in would make it that node's panel. It
# carries an anchor only when this host has configured one, which is optional and is a default
# rather than a lock — see deploy-common.sh.
#
# Target defaults to /srv/kgsm-web; override with KGSM_WEB_ROOT.
#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/deploy-common.sh"

trap 'err "deploy failed (line $LINENO)."; exit 1' ERR

# ── Preflight ─────────────────────────────────────────────────────────────────
refuse_root
require_setup
[[ -f "$REPO_DIR/package.json" ]] || { err "must run from the kgsm-web checkout"; exit 1; }

# ── 1. Build ──────────────────────────────────────────────────────────────────
cd "$REPO_DIR"
[[ -d node_modules ]] || npm ci

if [[ -n "$AUTH_ANCHOR" ]]; then
    log "building the SPA (opens on ${AUTH_ANCHOR}) → dist/"
else
    log "building the SPA (no anchor configured — it will ask for an address) → dist/"
fi
VITE_API_BASE= VITE_AUTH_ANCHOR="$AUTH_ANCHOR" npm run build

[[ -f "$REPO_DIR/dist/index.html" ]] || { err "build produced no dist/index.html"; exit 1; }

# ── 2. Publish ────────────────────────────────────────────────────────────────
# --delete-after: transfer everything new FIRST, prune stale files LAST. rsync walks names
# alphabetically, so the content-hashed assets/ land before the new index.html that references
# them, and old assets are removed only once the new tree is fully in place — a client mid-load
# never sees an index.html pointing at an asset that's already gone. Each file is written to a
# temp name + renamed, so updates are atomic per-file. The web root holds only the SPA dist, so
# --delete is safe.
log "syncing dist/ → ${WEBROOT}"
rsync -a --delete-after "$REPO_DIR/dist/" "$WEBROOT/"

log "frontend is live at ${WEBROOT} ✓  (static files — nothing to restart)"
