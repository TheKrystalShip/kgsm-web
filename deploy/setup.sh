#!/usr/bin/env bash
#
# setup.sh — one-shot host provisioning for kgsm-web. Run it ONCE per host.
#
#   ./deploy/setup.sh
#
# Idempotent: safe to re-run any time.
#
# Creates the directories the SPA and the auth anchor's pages are published into and hands them to
# you, so every deploy after this one is a plain unprivileged file copy. Override the locations with
# KGSM_WEB_ROOT and KGSM_WEB_AUTH_ROOT.
#
# With KGSM_PANEL_HOST set in deploy/deploy.local.env, it also serves the panel at that name through
# nginx: the machine's plain-HTTP surface (the ACME webroot and the https upgrade), the panel's vhost,
# its Let's Encrypt certificate and the hook that reloads nginx on renewal. Without it the panel is a
# static artifact for whatever web server, object store or CDN publishes it.
#
# Where the auth anchor runs on this machine, it points the anchor at the pages published here, and at
# the panel's origin as a client of its sign-in.
#
# Asks for sudo once. Everything it writes comes from this repo and deploy.local.env, so re-running it
# reproduces the host.
#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/deploy-common.sh"

refuse_root

log "checking ${PROJECT} deploy target"

[[ -f "$REPO_DIR/package.json" ]] || { err "must run from the kgsm-web checkout"; exit 1; }
command -v npm    >/dev/null || { err "npm is required to build the SPA"; exit 1; }
command -v rsync  >/dev/null || { err "rsync is required"; exit 1; }

# One directory a deploy publishes into: created, handed to the deploying user, and verified the way
# a deploy will use it rather than assumed from the mode bits.
provision() {
    local root="$1"

    if [[ ! -d "$root" ]]; then
        log "creating ${root} (needs sudo once)"
        $SUDO install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 755 "$root"
    fi

    if [[ ! -w "$root" ]]; then
        log "handing ${root} to ${DEPLOY_USER} (needs sudo once)"
        $SUDO chown -R "$DEPLOY_USER:$DEPLOY_GROUP" "$root"
    fi

    local probe="${root}/.kgsm-web-setup-probe"
    if ! touch "$probe" 2>/dev/null; then
        err "cannot write into ${root} as $(id -un)."
        exit 1
    fi
    rm -f "$probe"
}

# The panel, and the auth anchor's own pages.
provision "$WEBROOT"
provision "$AUTH_UI_ROOT"

# install_root_file <source> <destination> <mode> — returns 1 when the destination already says the same.
install_root_file() {
    local src="$1" dst="$2" mode="$3"
    $SUDO cmp -s "$src" "$dst" 2>/dev/null && return 1
    $SUDO install -D -m "$mode" -o root -g root "$src" "$dst"
}

# nginx loads what it is told to. Arch's stock nginx.conf reads nothing from conf.d, and every KGSM site
# on the machine — this one and each component's generated one — is a file there, so a configuration that
# loads none of them passes `nginx -t` and serves nothing.
ensure_nginx_reads_confd() {
    if $SUDO nginx -T 2>/dev/null | grep -qE '^\s*include\s+(/etc/nginx/)?conf\.d/\*\.conf;'; then
        return 0
    fi
    log "nginx.conf reads nothing from conf.d — adding the include to its http block"
    $SUDO sed -i -E '0,/^\s*http\s*\{/s//&\n    include \/etc\/nginx\/conf.d\/*.conf;/' /etc/nginx/nginx.conf
}

serve_panel() {
    if [[ -z "$PANEL_HOST" ]]; then
        log "no KGSM_PANEL_HOST in deploy/deploy.local.env — the panel is published for another server"
        return 0
    fi
    if ! command -v nginx >/dev/null || ! command -v certbot >/dev/null; then
        err "serving the panel at ${PANEL_HOST} needs nginx and certbot installed"
        exit 1
    fi

    ensure_nginx_reads_confd

    # The plain-HTTP surface first: the certificate below is issued through it.
    $SUDO install -d -m 0755 /var/lib/letsencrypt
    install_root_file "${REPO_DIR}/packaging/static/acme.conf" /etc/nginx/conf.d/00-acme.conf 0644 \
        && log "installed the ACME webroot and https upgrade on :80"
    install_root_file "${REPO_DIR}/packaging/static/reload-nginx.hook" /etc/letsencrypt/renewal-hooks/deploy/reload-nginx 0755 \
        && log "installed the renewal hook that reloads nginx"
    $SUDO nginx -t >/dev/null 2>&1 || { err "nginx refused the configuration; nothing was reloaded"; $SUDO nginx -t; exit 1; }
    $SUDO systemctl reload-or-restart nginx

    if $SUDO test -f "/etc/letsencrypt/live/${PANEL_HOST}/fullchain.pem"; then
        log "the certificate lineage for ${PANEL_HOST} already exists"
    else
        log "asking Let's Encrypt for ${PANEL_HOST}"
        $SUDO certbot certonly --webroot -w /var/lib/letsencrypt -d "$PANEL_HOST" \
            --cert-name "$PANEL_HOST" --non-interactive --agree-tos --keep-until-expiring \
            || { err "certbot could not issue a certificate for ${PANEL_HOST}; the panel's vhost was not installed"; exit 1; }
    fi

    local rendered
    rendered="$(mktemp)"
    sed -e "s|@PANEL_HOST@|${PANEL_HOST}|g" -e "s|@WEBROOT@|${WEBROOT}|g" \
        "${REPO_DIR}/packaging/static/panel.conf.in" > "$rendered"
    install_root_file "$rendered" /etc/nginx/conf.d/kgsm-web.conf 0644 && log "installed the panel's vhost for ${PANEL_HOST}"
    rm -f "$rendered"

    $SUDO nginx -t >/dev/null 2>&1 || { err "nginx refused the configuration; nothing was reloaded"; $SUDO nginx -t; exit 1; }
    $SUDO systemctl reload nginx
}

# The auth anchor on this machine reads its pages from wherever it is told, and issues codes only to
# clients it knows. A package puts the pages where the anchor looks by default; a host publishing them
# from this checkout says where, and a panel on a static host has no member to announce it. So both are
# stated in a drop-in of this project's own beside the anchor's unit — the way the kgsm-web package tells
# kgsm-api where the panel is.
ANCHOR_DROPIN="/etc/systemd/system/kgsm-auth-anchor.service.d/50-kgsm-web.conf"
point_anchor() {
    if ! systemctl cat kgsm-auth-anchor.service >/dev/null 2>&1; then
        log "no auth anchor on this machine — nothing to point at the pages"
        return 0
    fi

    local rendered
    rendered="$(mktemp)"
    {
        printf '# Written by kgsm-web deploy/setup.sh. Re-running it rewrites this file.\n[Service]\n'
        printf 'Environment=Anchor__UiPath=%s\n' "$AUTH_UI_ROOT"
        if [[ -n "$PANEL_HOST" ]]; then
            printf 'Environment=Anchor__PanelOrigins=https://%s\n' "$PANEL_HOST"
        fi
    } > "$rendered"

    if install_root_file "$rendered" "$ANCHOR_DROPIN" 0644; then
        log "pointed the auth anchor at ${AUTH_UI_ROOT}${PANEL_HOST:+ and the panel at https://${PANEL_HOST}}"
        $SUDO systemctl daemon-reload
        $SUDO systemctl try-restart kgsm-auth-anchor.service
    fi
    rm -f "$rendered"
}

serve_panel
point_anchor

printf '\n\033[1;32m✓ %s is provisioned\033[0m\n' "$PROJECT"
printf '   web root:   %s (writable by %s)\n' "$WEBROOT" "$DEPLOY_USER"
printf '   auth pages: %s\n' "$AUTH_UI_ROOT"
if [[ -n "$PANEL_HOST" ]]; then
    printf '   served at:  https://%s\n' "$PANEL_HOST"
fi
if [[ -n "$AUTH_ANCHOR" ]]; then
    printf '   opens on: %s\n' "$AUTH_ANCHOR"
else
    printf '   opens on: no anchor configured — the panel will ask for an address\n'
    printf '             set one with: echo KGSM_AUTH_ANCHOR=https://auth.example.com > deploy/deploy.local.env\n'
fi
printf '\n   deploy with:  ./deploy/deploy.sh\n\n'
