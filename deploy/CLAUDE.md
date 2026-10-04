# Deploying the web surfaces

This repo follows the same `setup.sh`-once / `deploy.sh`-forever pattern every `kgsm-*` repo uses. It
owns no systemd unit and runs no process of its own.

## The panel is served by no node

It is a static artifact that belongs to no cluster: it holds no cluster state, depends on no node, and
reaches whichever cluster it is pointed at over that cluster's public addresses. `npm run deploy:prod`
(`deploy.sh`) builds and `rsync`s `dist/` into the directory a web server publishes (`/srv/kgsm-web`,
yours → no sudo; override with `KGSM_WEB_ROOT`). The bundle is live the moment the files land, because
nothing is running to restart. Which server publishes it — nginx, an object store, a CDN — is a
deployment choice this repo does not make.

The build carries **no node address**. Baking one in would make this that node's panel.

It carries a cluster address only when the host has configured one: `KGSM_AUTH_ANCHOR` in the
untracked `deploy.local.env`, or the environment — any member, or the sign-in provider itself.
**Blank by default, and blank is the interesting case** — a panel served by a member asks that member
where to sign in, and an unconfigured static build asks the person for an address, which is what lets
one deployment serve any cluster. Configured, a static build signs in without asking. The value is
asked like any other address rather than trusted.

## `setup.sh` and `deploy.sh`

`setup.sh` creates the web roots and hands them to you, verifying each is writable the way `deploy.sh`
will use it, since a mode bit is not a guarantee. **Everything the host needs to serve the panel is
produced by it, from this repo and the operator's values in the untracked `deploy.local.env`** — never
written by hand: with `KGSM_PANEL_HOST` set it installs `packaging/static/`'s `:80` ACME server and
the panel's rendered vhost, issues the certificate over the webroot, installs the renewal hook, and
makes sure `nginx.conf` reads `conf.d`. Where the anchor runs here it writes
`tks-auth.service.d/50-kgsm-web.conf` with `Anchor__UiPath` and `Anchor__PanelOrigins`, the
way this repo's package tells kgsm-api where the panel is. Every file is compared before it is
written, so a re-run changes nothing that already matches.

`deploy.sh` then builds and `rsync`s with **no sudo and no prompts**, and refuses up front with
*"run `deploy/setup.sh`"* when the target isn't there. `deploy-assistant.sh` publishes the standalone
assistant into the leaf's wwwroot and `deploy-auth.sh` the anchor's pages where its `Anchor__UiPath`
points. The files here are self-contained, so a standalone clone deploys.
