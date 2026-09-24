# Madagascar analyzer review site

`analyzers.openelis-global.org` is served by the shared `oe-edge` router. The
Madagascar distro, Bridge, and Mock run in a separate `madagascar-analyzers`
Compose project. The adjacent Compose overlay pins every running image by
digest and removes all host port bindings. Its header records the exact source
commits used to select those images. Bridge forwarding and health checks both
use the private `oe.openelis.org` service name; the default distro container
name does not apply after this overlay renames the webapp container.

On the host, place exact Git checkouts in `/opt/madagascar-analyzers/{distro,harness,bridge}`
and copy the overlay and `madagascar-compose.sh` to
`/opt/madagascar-analyzers/{docker-compose.site.yml,compose.sh}`.
Create `distro/.env` with mode `0600`, setting unique `OE_DB_PASSWORD`,
`ADMIN_PASSWORD`, and `OE_ADMIN_PASSWORD`. Do not commit or print its values.
Use the Bridge checkout named in the overlay for the Mock's profile mount.
The published OE2 image has its initial admin password baked in at build time;
`OE_ADMIN_PASSWORD` does not change that account at container startup. For a
unique site password, change the fresh admin account through OE2's supported
`ChangePasswordLogin?apiCall=true` endpoint, then recreate both OE2 and Bridge
so their runtime integration credentials match the account. Verify that the
Bridge health and OE2 analyzer-type catalog both respond successfully.

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

As of 2026-09-24, the server pins OE2 develop `305f2cbb`, which includes
merged PR #4407, distro `5f8cd424`, Bridge 3.2.1, and Mock `6df78911`.
The server admin password was explicitly reset to the demo default
`adminADMIN!`; both OE2 and Bridge integration credentials use that value.
The previous configuration and database backup are retained under
`/opt/madagascar-analyzers/backups/before-develop-305f2cbb`.

The public-site recovery check passed on the preceding OE2 build: a synthetic
GeneXpert result remained in Bridge's durable outbox across an outage and
Bridge restart, then reached OE2 once. After this upgrade, exact image checks,
the OE2 delivery-issues API, and a fresh Mock-to-Bridge-to-OE2 delivery passed;
the queue had no pending or dead-lettered messages. Browser login with the
reset demo password and the full guided setup/activate/deactivate flow also
passed on this build (2 Playwright tests, 23 seconds).

Use OE2's current Playwright journeys for this site. The separate Madagascar
harness still expects the removed setup modal. The OE2 result-review demo needs
the INDETERMINATE dictionary and test-result rows from its own catalog fixtures.
Only those two rows were loaded through the supported configuration loader;
Madagascar's existing catalog files were preserved. The site labels differ from
the generic fixture in capitalization and spacing, so the site test accepts
`Not Detected` and `HIVVIRALLOAD(Serum)`. Before repeating the review story,
reset only its synthetic REVIEW REQUIRED mapping and send a fresh known result;
accepted results are consumed by review. The setup and result-review videos
passed before the upgrade and are retained with their test artifacts.

Recreating Bridge removes Docker network attachments added dynamically by Mock.
Restore its attachment to each still-active Mock analyzer network before testing
traffic. For the existing GeneXpert fixture, the preserved network is
`mock-analyzer-genexpert`, with Mock at `10.42.140.10` and Bridge at `10.42.140.2`.
Check membership first; when absent, restore it with:

```sh
docker network connect --ip 10.42.140.2 --alias openelis-analyzer-bridge \
  mock-analyzer-genexpert madagascar-openelis-analyzer-bridge
```

For rollback, stop the `madagascar-analyzers` project without removing its
volumes and restart the preserved old `analyzers` project. The router resumes
using the old services under the same aliases. The existing
`deploy.sh app deploy analyzers` command targets that old project; do not use it
to maintain this Madagascar deployment.
