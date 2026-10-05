# Packaging

`PKGBUILD` builds two packages: `kgsm-web` (the same-origin bundle kgsm-api serves) and
`kgsm-web-static`, the panel as a static site at one public name. A package never restates a version
number; it asks `deploy/version.sh`. The sign-in provider's own pages are tks-auth's, and ship in its
package.

`kgsm-web-static` carries its own bundle (`npm run build:static`: no host seed, no anchor) and a root
oneshot, `static/serve-panel`, driven by the one admin value `KGSM_PANEL_HOST` in
`/etc/kgsm-web/panel.env`: it renders the `:80` surface and the vhost into `/var/lib/kgsm-web-static`
(included by the package's `conf.d` file), issues the certificate over the webroot, and writes the
panel's origin into `/var/lib/kgsm-web-static/anchor.env`, which the anchor reads through the
package's drop-in. The rendered files are the ones `deploy/setup.sh` installs, from the same sources
in `static/`.

`test/static-panel.sh` installs the built package into a booted Arch container and drives it through a
blank name, a name with a certificate, an invalid name, a blank name again and its removal.
