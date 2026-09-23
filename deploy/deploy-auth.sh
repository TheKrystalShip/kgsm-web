#!/usr/bin/env bash
#
# deploy-auth.sh — build the auth anchor's own pages and publish them. No sudo, no prompts, nothing
# restarts.
#
#   ./deploy/deploy-auth.sh      # or: npm run deploy:auth
#
# The pages the auth anchor serves at /ui/ — sign-in, registration, the wait for approval and the
# account page — built from this tree under `base: "/ui/"`. A package installs them at
# /usr/share/kgsm-web-auth; this is the development host's delivery of the same artifact, into a
# directory it owns, which the anchor is pointed at with Anchor__UiPath.
#
# The anchor reads the documents from disk on every request, so the new pages are LIVE THE MOMENT the
# files land.
#
# Target defaults to /srv/kgsm-web-auth; override with KGSM_WEB_AUTH_ROOT.
#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/deploy-common.sh"

trap 'err "auth pages deploy failed (line $LINENO)."; exit 1' ERR

# ── Preflight ─────────────────────────────────────────────────────────────────
refuse_root
require_setup "$AUTH_UI_ROOT"
[[ -f "$REPO_DIR/package.json" ]] || { err "must run from the kgsm-web checkout"; exit 1; }

# ── 1. Build and check ────────────────────────────────────────────────────────
cd "$REPO_DIR"
[[ -d node_modules ]] || npm ci

log "building the auth anchor's pages → dist-auth/"
npm run build:auth

# Refused rather than published: a page carrying an inline script renders broken under the anchor's
# policy, and one reaching the panel's session layer is a credential where none belongs.
npm run check:auth

# ── 2. Publish ────────────────────────────────────────────────────────────────
# --delete-after, as the panel's deploy: the hashed assets land before the documents that reference
# them, and the old ones go only once the new tree is in place.
log "syncing dist-auth/ → ${AUTH_UI_ROOT}"
rsync -a --delete-after "$REPO_DIR/dist-auth/" "$AUTH_UI_ROOT/"

log "the auth pages are live at ${AUTH_UI_ROOT} ✓  (read from disk by the anchor — nothing to restart)"
