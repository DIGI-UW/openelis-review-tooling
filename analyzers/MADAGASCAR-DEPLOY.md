# Madagascar analyzer review site

`analyzers.openelis-global.org` is served by the shared `oe-edge` router. The
Madagascar distro, Bridge, and Mock run in a separate `madagascar-analyzers`
Compose project. The adjacent Compose overlay pins every running image by
digest and removes all host port bindings. Its header records the exact source
commits used to select those images.

On the host, place exact Git checkouts in `/opt/madagascar-analyzers/{distro,harness,bridge}`
and copy the overlay and `madagascar-compose.sh` to
`/opt/madagascar-analyzers/{docker-compose.site.yml,compose.sh}`.
Create `distro/.env` with mode `0600`, setting unique `OE_DB_PASSWORD`,
`ADMIN_PASSWORD`, and `OE_ADMIN_PASSWORD`. Do not commit or print its values.
Use the Bridge checkout named in the overlay for the Mock's profile mount.

`compose.sh` enforces the checkout SHAs, loads the private environment, sets the
Mock's profile source and Playwright paths, and uses this file chain and project
name:

```text
/opt/madagascar-analyzers/compose.sh config
/opt/madagascar-analyzers/compose.sh pull
/opt/madagascar-analyzers/compose.sh up -d --no-build
```

Before a cutover, confirm the three checkout SHAs, render `config`, check that
every runtime image contains `@sha256:` and no service publishes a host port,
and pull the images. Snapshot the host and back up the existing analyzer
database. Stop the **old `analyzers` project** before starting this project:
both projects deliberately use the router aliases `analyzers-oe` and
`analyzers-frontend`. Never let both publish those aliases at once. Stop
without `-v`; its database and Bridge state are rollback data. Start the new
project with `up -d --no-build`, including the Mock, and keep its volumes.

The acceptance gate is public UI/API health, a Mock result received once in
OpenELIS, and a Bridge-to-OpenELIS outage test in which the outbox retains a
complete result across a Bridge restart and delivers it once after recovery.
Run the harness `harness-demo-video` Playwright project against the public URL
and retain its video artifacts. Only then update the review target's ready
metadata and, if the reviewer journey changed, its Grist checklist rows.

For rollback, stop the `madagascar-analyzers` project without removing its
volumes and restart the preserved old `analyzers` project. The router resumes
using the old services under the same aliases. The existing
`deploy.sh app deploy analyzers` command targets that old project; do not use it
to maintain this Madagascar deployment.
