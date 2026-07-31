#!/usr/bin/env bash
#
# deploy.sh — build the SPA and publish it. Fully headless: no sudo, no prompts, NO API restart.
#
#   ./deploy/deploy.sh          # or: npm run deploy:prod
#
# Builds for same-origin (VITE_API_BASE=self) and syncs dist/ straight into the kgsm-api wwwroot.
# kgsm-api serves wwwroot via ASP.NET UseStaticFiles (PhysicalFileProvider — read from disk per
# request, no in-memory content cache), so the new bundle is LIVE THE MOMENT the files land: no
# systemctl, no service bounce, no sudo.
#
# Use this for pure frontend changes. For an API code change use kgsm-api/deploy/deploy.sh — that
# one publishes the API AND re-bundles the SPA; this is the fast path that skips the API entirely.
#
# Target wwwroot defaults to the live install; override with KGSM_API_WWWROOT.
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

log "building the SPA (VITE_API_BASE=self) → dist/"
VITE_API_BASE=self npm run build

[[ -f "$REPO_DIR/dist/index.html" ]] || { err "build produced no dist/index.html"; exit 1; }

# ── 2. Publish ────────────────────────────────────────────────────────────────
# --delete-after: transfer everything new FIRST, prune stale files LAST. rsync walks names
# alphabetically, so the content-hashed assets/ land before the new index.html that references
# them, and old assets are removed only once the new tree is fully in place — a client mid-load
# never sees an index.html pointing at an asset that's already gone. Each file is written to a
# temp name + renamed, so updates are atomic per-file. wwwroot holds only the SPA dist, so
# --delete is safe.
log "syncing dist/ → ${WWWROOT}"
rsync -a --delete-after "$REPO_DIR/dist/" "$WWWROOT/"

log "frontend is live at ${WWWROOT} ✓  (kgsm-api serves it from disk — no restart)"
