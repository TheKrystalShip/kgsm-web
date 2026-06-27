#!/usr/bin/env bash
#
# Frontend-only production deploy — NO API restart, NO sudo.
#
#   npm run deploy:prod          # or: bash scripts/deploy-prod.sh
#
# Builds the SPA for same-origin (VITE_API_BASE=self) and syncs dist/ straight
# into the kgsm-api wwwroot. kgsm-api serves wwwroot via ASP.NET's UseStaticFiles
# (PhysicalFileProvider — read from disk per request, no in-memory content
# cache), so the new bundle is LIVE THE MOMENT the files land: no `systemctl`,
# no service bounce, no sudo (wwwroot is owned by the service user).
#
# Use this for pure frontend changes. For an API code change use the full
# kgsm-api/deploy/deploy.sh instead — that one publishes the API AND re-bundles
# the SPA (this script is the fast path that skips the API entirely).
#
# Target wwwroot defaults to the live install; override with KGSM_API_WWWROOT.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WWWROOT="${KGSM_API_WWWROOT:-/opt/kgsm-api/wwwroot}"

log() { printf '\033[1;34m>> %s\033[0m\n' "$*"; }
err() { printf '\033[1;31m!! %s\033[0m\n' "$*" >&2; }

[[ -f "$REPO_DIR/package.json" ]] || { err "must run from the kgsm-web checkout"; exit 1; }
command -v rsync >/dev/null || { err "rsync is required"; exit 1; }

# wwwroot must already exist and be ours. If it's missing, the API hasn't been
# deployed yet — there's nothing to drop files into. We never sudo or create it
# here: a frontend deploy must never need privilege.
if [[ ! -d "$WWWROOT" ]]; then
    err "wwwroot not found: $WWWROOT"
    err "deploy the API first (kgsm-api/deploy/deploy.sh), or set KGSM_API_WWWROOT=/path."
    exit 1
fi
if [[ ! -w "$WWWROOT" ]]; then
    err "$WWWROOT is not writable by $(id -un) (expected it owned by the service user)."
    err "fix once: sudo chown -R $(id -un) $(dirname "$WWWROOT")"
    exit 1
fi

cd "$REPO_DIR"
[[ -d node_modules ]] || npm ci

log "building the SPA (VITE_API_BASE=self) → dist/"
VITE_API_BASE=self npm run build

# --delete-after: transfer everything new FIRST, prune stale files LAST. rsync
# walks names alphabetically, so the content-hashed assets/ land before the new
# index.html that references them, and old assets are removed only once the new
# tree is fully in place — a client mid-load never sees an index.html pointing at
# an asset that's already gone. Each file is written to a temp name + renamed, so
# updates are atomic per-file. wwwroot holds only the SPA dist, so --delete is safe.
log "syncing dist/ → ${WWWROOT}"
rsync -a --delete-after "$REPO_DIR/dist/" "$WWWROOT/"

log "frontend is live at ${WWWROOT} ✓  (kgsm-api serves it from disk — no restart)"
