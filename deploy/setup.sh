#!/usr/bin/env bash
#
# setup.sh — one-shot host provisioning for kgsm-web. Run it ONCE per host.
#
#   ./deploy/setup.sh
#
# Idempotent: safe to re-run any time.
#
# Creates the directory a web server publishes the SPA from and hands it to you, so every deploy
# after this one is a plain unprivileged file copy. That is the whole of it: static files, no
# daemon, no unit, no polkit grant, nothing to restart.
#
# Asks for sudo ONCE, to create the directory and chown it. Override the location with
# KGSM_WEB_ROOT=/path ./deploy/setup.sh — pointing it at somewhere you already own needs no sudo
# at all.
#
# Serving it is the web server's business and deliberately not this script's: the panel is a static
# artifact with no dependency on any cluster, and which server publishes it — nginx, an object
# store, a CDN — is a deployment choice this repo does not make.
#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/deploy-common.sh"

refuse_root

log "checking ${PROJECT} deploy target"

[[ -f "$REPO_DIR/package.json" ]] || { err "must run from the kgsm-web checkout"; exit 1; }
command -v npm    >/dev/null || { err "npm is required to build the SPA"; exit 1; }
command -v rsync  >/dev/null || { err "rsync is required"; exit 1; }

if [[ ! -d "$WEBROOT" ]]; then
    log "creating ${WEBROOT} (needs sudo once)"
    $SUDO install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 755 "$WEBROOT"
fi

if [[ ! -w "$WEBROOT" ]]; then
    log "handing ${WEBROOT} to ${DEPLOY_USER} (needs sudo once)"
    $SUDO chown -R "$DEPLOY_USER:$DEPLOY_GROUP" "$WEBROOT"
fi

if [[ ! -w "$WEBROOT" ]]; then
    err "${WEBROOT} is still not writable by $(id -un)."
    exit 1
fi

# Verified the way deploy.sh will use it, rather than assumed from the mode bits.
probe="${WEBROOT}/.kgsm-web-setup-probe"
if ! touch "$probe" 2>/dev/null; then
    err "cannot write into ${WEBROOT} as $(id -un)."
    exit 1
fi
rm -f "$probe"

printf '\n\033[1;32m✓ %s is provisioned\033[0m\n' "$PROJECT"
printf '   web root: %s (writable by %s)\n' "$WEBROOT" "$DEPLOY_USER"
if [[ -n "$AUTH_ANCHOR" ]]; then
    printf '   opens on: %s\n' "$AUTH_ANCHOR"
else
    printf '   opens on: no anchor configured — the panel will ask for an address\n'
    printf '             set one with: echo KGSM_AUTH_ANCHOR=https://auth.example.com > deploy/deploy.local.env\n'
fi
printf '\n   deploy with:  ./deploy/deploy.sh\n\n'
