#!/usr/bin/env bash
#
# deploy-common.sh — the shared parameter block + helpers for kgsm-web's deploy scripts.
#
# Sourced by BOTH deploy/setup.sh and deploy/deploy.sh, so the two entry points can never
# disagree about where the SPA lands.
#
# The canonical source of this pattern is tks/scripts/deploy-template/ — see its README for the
# contract. kgsm-web is the one project that needed no privilege to begin with: the SPA is static
# files served by kgsm-api out of its wwwroot, which the API's service user already owns. There
# is no unit, no daemon, and no polkit grant here — setup.sh only checks that the target exists
# and is yours.
#
# Not executable on its own.

# This file only DEFINES things; every variable below is consumed by the two scripts that
# source it, which shellcheck cannot see from here.
# shellcheck disable=SC2034

set -euo pipefail

# ── Identity ──────────────────────────────────────────────────────────────────
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEPLOY_USER="${KGSM_DEPLOY_USER:-$(id -un)}"
DEPLOY_GROUP="${KGSM_DEPLOY_GROUP:-$(id -gn)}"

# ── PROJECT BLOCK ─────────────────────────────────────────────────────────────
PROJECT="kgsm-web"

# kgsm-api serves this SPA same-origin from its wwwroot via ASP.NET UseStaticFiles
# (PhysicalFileProvider — read from disk per request, no content cache), so a new bundle is LIVE
# THE MOMENT the files land: no systemctl, no service bounce, no sudo.
WWWROOT="${KGSM_API_WWWROOT:-/opt/kgsm-api/wwwroot}"
# ── END PROJECT BLOCK ─────────────────────────────────────────────────────────

SUDO="${SUDO:-sudo}"

# ── Output helpers ────────────────────────────────────────────────────────────
log()  { printf '\033[1;34m>> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m** %s\033[0m\n' "$*" >&2; }
err()  { printf '\033[1;31m!! %s\033[0m\n' "$*" >&2; }

refuse_root() {
    if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
        err "do NOT run this as root — run it as the user that owns the kgsm-api install."
        exit 1
    fi
}

# The contract deploy.sh enforces. wwwroot missing means kgsm-api has not been deployed yet —
# there is nothing to drop files into, and creating it here would just hide that.
require_setup() {
    local problem=0

    if [[ ! -d "$WWWROOT" ]]; then
        err "wwwroot not found: ${WWWROOT}"
        err "deploy the API first (kgsm-api/deploy/setup.sh then deploy.sh), or set KGSM_API_WWWROOT=/path."
        problem=1
    elif [[ ! -w "$WWWROOT" ]]; then
        err "${WWWROOT} is not writable by $(id -un) (expected it owned by the API service user)."
        problem=1
    fi

    if [[ "$problem" -ne 0 ]]; then
        err ""
        err "this host is not provisioned for headless deploys of ${PROJECT}."
        err "run ONCE:   ${REPO_DIR}/deploy/setup.sh"
        exit 1
    fi
}
