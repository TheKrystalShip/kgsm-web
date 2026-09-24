#!/usr/bin/env bash
#
# deploy-common.sh — the shared parameter block + helpers for kgsm-web's deploy scripts.
#
# Sourced by BOTH deploy/setup.sh and deploy/deploy.sh, so the two entry points can never
# disagree about where the SPA lands.
#
# The canonical source of this pattern is tks/scripts/deploy-template/ — see its README for the
# contract. The SPA is static files with no daemon, no unit and no polkit grant: setup.sh creates
# the directory a web server publishes and hands it to the deploy user, and deploy.sh writes files
# into it. Nothing restarts, because nothing is running.
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

# Where the built SPA lands, for whatever serves static files on this host to publish. A new bundle
# is LIVE THE MOMENT the files land: no systemctl, no service bounce, no sudo.
#
# The panel is NOT served by a node. It is a static artifact with no dependency on any cluster —
# deployable to a web server, an object store or a CDN — and it reaches whichever cluster it is
# pointed at over that cluster's public addresses. A node serving it was convenience, and
# convenience that made it look like part of the cluster.
WEBROOT="${KGSM_WEB_ROOT:-/srv/kgsm-web}"

# OPTIONAL, and blank by default: the auth anchor this build opens on. Blank means the panel points
# at no cluster and asks for an address, which is what makes one deployment usable against any of
# them. Kept in an untracked file beside these scripts so a host does not have to remember it on
# every deploy, and so the repo carries no deployment's address.
[[ -f "${REPO_DIR}/deploy/deploy.local.env" ]] && source "${REPO_DIR}/deploy/deploy.local.env"
AUTH_ANCHOR="${KGSM_AUTH_ANCHOR:-}"

# The standalone assistant's wwwroot, served the same way by kgsm-assistant-service out of its own
# content root. This repo builds BOTH surfaces from one source tree (src/chat/ is shared), so it
# publishes to both; they are separate builds, and each host gets only its own bundle.
ASSISTANT_WWWROOT="${KGSM_ASSISTANT_WWWROOT:-/opt/kgsm-assistant/service/wwwroot}"

# The auth anchor's own pages — sign-in, registration, the wait and the account page. The anchor
# serves them from wherever its Anchor__UiPath names; a package installs them at
# /usr/share/kgsm-web-auth, and a development host publishes them here and points the anchor at it.
# Outside every other deploy's prefix, because each of those syncs with --delete.
AUTH_UI_ROOT="${KGSM_WEB_AUTH_ROOT:-/srv/kgsm-web-auth}"

# OPTIONAL: the public name this host serves the panel at, e.g. kgsm.example.com. Set, setup.sh serves
# the web root there through nginx on a Let's Encrypt certificate and tells the auth anchor on this
# machine that a panel lives at that origin. A name only the operator can choose, so it lives in
# deploy.local.env with the anchor's address and never in the repo; blank serves nothing.
PANEL_HOST="${KGSM_PANEL_HOST:-}"
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

# The contract deploy.sh enforces. The web root missing means setup.sh has not run — creating it
# here would need privilege deploy.sh must never ask for, and would hide that the host is not
# provisioned.
require_setup() {
    local root="${1:-$WEBROOT}"
    local problem=0

    if [[ ! -d "$root" ]]; then
        err "web root not found: ${root}"
        problem=1
    elif [[ ! -w "$root" ]]; then
        err "${root} is not writable by $(id -un)."
        problem=1
    fi

    if [[ "$problem" -ne 0 ]]; then
        err ""
        err "this host is not provisioned for headless deploys of ${PROJECT}."
        err "run ONCE:   ${REPO_DIR}/deploy/setup.sh"
        exit 1
    fi
}
