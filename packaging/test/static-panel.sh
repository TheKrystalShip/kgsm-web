#!/usr/bin/env bash
#
# static-panel.sh — install kgsm-web-static into a booted Arch container and drive it through a blank
# name, a name with a certificate, a name that is not one, a blank name again, and its removal.
#
#   cd packaging && makepkg --nodeps -f && ./test/static-panel.sh
#   ./test/static-panel.sh path/to/kgsm-web-static-<ver>-any.pkg.tar.zst
#
# Needs docker. No certificate is issued: the name's lineage is a self-signed pair placed where certbot
# keeps one, so everything after issuance is exercised offline. kgsm-base is stood in for by the one
# thing this package needs from it, nginx reading conf.d, and the auth anchor by a unit that records the
# environment it was started with.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="${1:-}"
if [[ -z "$PKG" ]]; then
    PKG="$(find "${HERE}/.." -maxdepth 1 -name 'kgsm-web-static-*.pkg.tar.zst' -printf '%T@ %p\n' 2>/dev/null |
        sort -rn | head -n1 | cut -d' ' -f2-)"
fi
[[ -f "$PKG" ]] || { printf 'no kgsm-web-static package: build one with makepkg first\n' >&2; exit 1; }

IMAGE="${IMAGE:-archlinux:base}"
NAME="kgsm-web-static-test-$$"
WORK="$(mktemp -d)"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

cp "$PKG" "${WORK}/kgsm-web-static.pkg.tar.zst"

cat > "${WORK}/inside.sh" <<'INSIDE'
#!/usr/bin/env bash
set -uo pipefail
pass=0; fail=0
ok()  { printf '  ✓ %s\n' "$*"; pass=$((pass+1)); }
bad() { printf '  ✗ %s\n' "$*"; fail=$((fail+1)); }
check() { local d="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$d"; else bad "$d"; fi; }
served() { curl -sk "${R[@]}" https://panel.test/"${1:-}" | grep -q '<div id="root"'; }
status() { curl -sk -o /dev/null -w '%{http_code}' "${R[@]}" "$1"; }
R=(--resolve panel.test:443:127.0.0.1 --resolve panel.test:80:127.0.0.1)
set_host() { sed -i "s/^KGSM_PANEL_HOST=.*/KGSM_PANEL_HOST=$1/" /etc/kgsm-web/panel.env; }

pacman -Sy --noconfirm --needed nginx certbot openssl curl diffutils >/dev/null 2>&1 || { echo "!! no packages"; exit 1; }
pacman -U --noconfirm -dd /t/kgsm-web-static.pkg.tar.zst >/dev/null 2>&1 || { echo "!! install failed"; exit 1; }
sed -i -E '0,/^[[:space:]]*http[[:space:]]*\{/s//&\n    include \/etc\/nginx\/conf.d\/*.conf;/' /etc/nginx/nginx.conf
printf '[Service]\nExecStart=/bin/sh -c "env > /run/anchor-env; exec sleep infinity"\n' \
    > /etc/systemd/system/kgsm-auth-anchor.service
systemctl daemon-reload
systemctl start nginx kgsm-auth-anchor

echo "a blank name"
check "serve-panel succeeds" systemctl start kgsm-web-static
check "renders no site" bash -c '! ls /var/lib/kgsm-web-static/*.conf'
check "declares no panel to the anchor" bash -c '! test -s /var/lib/kgsm-web-static/anchor.env'
check "nginx accepts the configuration" nginx -t

echo "a name with a certificate"
mkdir -p /etc/letsencrypt/live/panel.test
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=panel.test \
    -keyout /etc/letsencrypt/live/panel.test/privkey.pem \
    -out /etc/letsencrypt/live/panel.test/fullchain.pem >/dev/null 2>&1
set_host panel.test
check "serve-panel succeeds" systemctl restart kgsm-web-static
check "renders the :80 surface" test -f /var/lib/kgsm-web-static/acme.conf
check "renders the vhost over the packaged bundle" grep -q 'root  /usr/share/kgsm-web-static;' /var/lib/kgsm-web-static/panel.conf
sleep 1
check "https serves the bundle" served
check "a deep path falls back to the entry point" served signed-in
check "/api/ answers 404" test "$(status https://panel.test/api/v1/hosts)" = 404
check "/.well-known/ answers 404" test "$(status https://panel.test/.well-known/oauth-protected-resource)" = 404
check "http upgrades with 308" test "$(status http://panel.test/x)" = 308
mkdir -p /var/lib/letsencrypt/.well-known/acme-challenge
echo tok > /var/lib/letsencrypt/.well-known/acme-challenge/t1
check "http serves the ACME webroot" test "$(curl -s "${R[@]}" http://panel.test/.well-known/acme-challenge/t1)" = tok
check "declares the origin to the anchor" grep -qx 'Anchor__PanelOrigins=https://panel.test' /var/lib/kgsm-web-static/anchor.env
sleep 2
check "the anchor restarted with the origin" grep -qx 'Anchor__PanelOrigins=https://panel.test' /run/anchor-env
before="$(systemctl show -p InvocationID --value kgsm-auth-anchor)"
systemctl restart kgsm-web-static; sleep 2
check "a run that changes nothing restarts nothing" test "$before" = "$(systemctl show -p InvocationID --value kgsm-auth-anchor)"

echo "a name that is not one"
set_host 'bad;name'
check "serve-panel refuses it" bash -c '! systemctl restart kgsm-web-static'
check "the site stays served" served

echo "a blank name again"
set_host ''
check "serve-panel succeeds" systemctl restart kgsm-web-static
check "withdraws both sites" bash -c '! ls /var/lib/kgsm-web-static/*.conf'
sleep 2
check "the panel is no longer served" bash -c '! curl -sk --resolve panel.test:443:127.0.0.1 https://panel.test/ | grep -q "<div id=\"root\""'
check "the anchor declares no panel" bash -c '! grep -q PanelOrigins /run/anchor-env'
check "certbot's renewal timer is wanted" bash -c 'systemctl list-dependencies timers.target | grep -q certbot-renew'

echo "removal"
pacman -R --noconfirm kgsm-web-static >/dev/null 2>&1
check "the conf.d include goes with the package" test ! -e /etc/nginx/conf.d/00-kgsm-web-static-sites.conf
check "nginx still accepts the configuration" nginx -t

printf '%s passed, %s failed\n' "$pass" "$fail"
(( fail == 0 ))
INSIDE
chmod +x "${WORK}/inside.sh"

docker run -d --name "$NAME" \
    --privileged --cgroupns=private --stop-signal SIGRTMIN+3 \
    --tmpfs /tmp --tmpfs /run --tmpfs /run/lock \
    -v "${WORK}:/t:ro" \
    "$IMAGE" /usr/lib/systemd/systemd >/dev/null

for _ in $(seq 1 60); do
    state="$(docker exec "$NAME" systemctl is-system-running 2>/dev/null || true)"
    [[ "$state" == running || "$state" == degraded ]] && break
    sleep 1
done

docker exec "$NAME" /t/inside.sh
