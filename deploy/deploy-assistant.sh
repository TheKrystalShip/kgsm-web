#!/usr/bin/env bash
#
# deploy-assistant.sh — build the STANDALONE ASSISTANT surface and publish it to the leaf.
#
#   ./deploy/deploy-assistant.sh      # or: npm run deploy:assistant
#
# This repo builds two surfaces from one source tree: the Control Panel (deploy/deploy.sh → the
# kgsm-api wwwroot) and the standalone assistant, here. The chat itself is the same code in both
# (src/chat/) — a divergence between the dock and this page would be a bug, not a variant — and
# each surface is its own Vite build, so each host serves only its own bundle.
#
# kgsm-assistant-service serves its wwwroot via ASP.NET UseStaticFiles (PhysicalFileProvider —
# read from disk per request, no content cache), so the new bundle is LIVE THE MOMENT the files
# land: no systemctl, no service bounce, no sudo. The prefix is owned by the deploying user, which
# is what makes that true.
#
# Target wwwroot defaults to the live install; override with KGSM_ASSISTANT_WWWROOT.
#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/deploy-common.sh"

trap 'err "assistant deploy failed (line $LINENO)."; exit 1' ERR

# ── Preflight ─────────────────────────────────────────────────────────────────
refuse_root
[[ -f "$REPO_DIR/package.json" ]] || { err "must run from the kgsm-web checkout"; exit 1; }

# The leaf's own prefix must already exist — kgsm-llm's setup.sh creates and chowns it. Publishing
# a UI is not a reason to provision someone else's service, so this refuses rather than creating it.
ASSISTANT_PREFIX="$(dirname "$ASSISTANT_WWWROOT")"
[[ -d "$ASSISTANT_PREFIX" ]] || {
    err "${ASSISTANT_PREFIX} does not exist — run kgsm-llm/deploy/setup.sh on this host first."
    exit 1
}
[[ -w "$ASSISTANT_PREFIX" ]] || {
    err "${ASSISTANT_PREFIX} is not writable by $(id -un) — kgsm-llm/deploy/setup.sh chowns the prefix."
    exit 1
}

# ── 1. Build ──────────────────────────────────────────────────────────────────
cd "$REPO_DIR"
[[ -d node_modules ]] || npm ci

log "building the standalone assistant → dist-assistant/"
npm run build:assistant

[[ -f "$REPO_DIR/dist-assistant/assistant.html" ]] || {
    err "build produced no dist-assistant/assistant.html"; exit 1; }

# The entry is assistant.html in the source tree (one repo, two entries), but the leaf serves a
# directory: UseDefaultFiles looks for index.html. Renamed in a staging copy rather than in
# dist-assistant/, so a rebuild never has to undo it and the build output stays what Vite wrote.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -a "$REPO_DIR/dist-assistant/." "$STAGE/"
mv "$STAGE/assistant.html" "$STAGE/index.html"

# ── 2. Publish ────────────────────────────────────────────────────────────────
mkdir -p "$ASSISTANT_WWWROOT"

# --delete-after: transfer everything new FIRST, prune stale files LAST. rsync walks names
# alphabetically, so the content-hashed assets/ land before the index.html that references them,
# and old assets are removed only once the new tree is fully in place — a client mid-load never
# sees an index.html pointing at an asset that is already gone. Each file is written to a temp
# name + renamed, so updates are atomic per-file. The wwwroot holds only this dist, so --delete
# is safe.
log "syncing dist-assistant/ → ${ASSISTANT_WWWROOT}"
rsync -a --delete-after "$STAGE/" "$ASSISTANT_WWWROOT/"

log "the standalone assistant is live at ${ASSISTANT_WWWROOT} ✓  (the leaf serves it from disk — no restart)"
