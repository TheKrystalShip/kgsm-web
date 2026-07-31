#!/usr/bin/env bash
#
# setup.sh — one-shot host provisioning for kgsm-web. Run it ONCE per host.
#
#   ./deploy/setup.sh
#
# Idempotent: safe to re-run any time.
#
# kgsm-web is the one project in the ecosystem that needs NO privilege at all — not even here.
# The SPA is static files served by kgsm-api out of its wwwroot, which the API's service user
# already owns, so there is no install prefix to chown, no systemd unit to link, and no polkit
# grant to install. This script exists so every repo answers `deploy/setup.sh` the same way; all
# it does is verify the target is present and yours, and tell you exactly what to fix if not.
#
# Its one prerequisite is that kgsm-api has been deployed (that is what creates wwwroot). If the
# API lives somewhere else, point this at it:  KGSM_API_WWWROOT=/path ./deploy/setup.sh
#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/deploy-common.sh"

refuse_root

log "checking ${PROJECT} deploy target"

[[ -f "$REPO_DIR/package.json" ]] || { err "must run from the kgsm-web checkout"; exit 1; }
command -v npm    >/dev/null || { err "npm is required to build the SPA"; exit 1; }
command -v rsync  >/dev/null || { err "rsync is required"; exit 1; }

if [[ ! -d "$WWWROOT" ]]; then
    err "wwwroot not found: ${WWWROOT}"
    err ""
    err "this is created by the API deploy. Run, in the kgsm-api checkout:"
    err "    ./deploy/setup.sh && ./deploy/deploy.sh"
    err "or point this project at an API installed elsewhere:"
    err "    KGSM_API_WWWROOT=/path/to/wwwroot ./deploy/setup.sh"
    exit 1
fi

if [[ ! -w "$WWWROOT" ]]; then
    err "${WWWROOT} exists but is not writable by $(id -un)."
    err "it should be owned by the kgsm-api service user — the same user you deploy as."
    err "fix once:  sudo chown -R $(id -un) $(dirname "$WWWROOT")"
    exit 1
fi

log "${PROJECT} is ready ✓  — deploys need no privilege"
printf '   wwwroot: %s (writable by %s)\n' "$WWWROOT" "$DEPLOY_USER"
printf '\n   deploy with:  %s/deploy/deploy.sh   (no sudo, no prompts, no API restart)\n' "$REPO_DIR"
