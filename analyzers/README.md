# analyzers.openelis-global.org

The analyzer review site runs OpenELIS-Global-2's own published-image stack:
`docker-compose.yml` plus `docker-compose.analyzers.yml` of one commit, with
the images CI built and tested for that commit, behind the shared `oe-edge`
router. It is the deployment mode labs install, not a source build and not a
distro, so what reviewers see is what a release ships.

## Goal

A clean analyzer setup for manual testing of the analyzer baseline
(OpenELIS-Global-2 stack #4588, top PR #4663): the shipped analyzer types, one
analyzer of each protocol set up as an operator would and receiving results
from the mock (GeneXpert over ASTM, Mindray BC-5380 over HL7, FluoroCycler XT
by file), and the setup screens free for reviewers to configure others.

## What runs

- Compose project `oe-analyzers`, site directory `/opt/oe-analyzers-site`:
  `releases/<sha>/` (the commit's deployment files), `release` (the deployed
  one), `docker-compose.site.yml`, `compose.sh`, `.env` (private: the Bridge
  pairing code), `configuration/backend` (the catalog, seeded once from the
  harness dictionary; Catalog Import writes there), `lucene/`.
- `docker-compose.site.yml` pins every image by digest to one tested build of
  the commit and removes every host port except the mock's simulate API on
  `127.0.0.1:8085`. Its header records the commit, the build and the Bridge and
  mock pins.
- The router reaches the stack by the aliases `analyzers-frontend` and
  `analyzers-oe` on `oe-edge`. The same aliases belong to the older projects on
  this host (`analyzers`, from source; `madagascar-analyzers`, the pinned
  Madagascar distro). Only one project may publish them at a time.
- OpenELIS and the Bridge pair by certificate with the code in `.env`
  (`ANALYZER_BRIDGE_PAIRING_CODE`); the Bridge's key pair and pairing record
  live on the `bridge-state` volume with its outbox.

## Deploy

On a machine with an OpenELIS-Global-2 clone holding the commit:

```sh
./analyzers/make-bundle.sh ~/code/OpenELIS-Global-2 <sha> /tmp/oe2-<sha>.tgz
scp /tmp/oe2-<sha>.tgz analyzers/docker-compose.site.yml analyzers/compose.sh \
    analyzers/site-deploy.sh amr:/opt/oe-analyzers-site/
```

On the host:

```sh
cd /opt/oe-analyzers-site
./site-deploy.sh <sha> oe2-<sha>.tgz
```

`site-deploy.sh` unpacks the release, seeds the catalog and the pairing code
on first use, refuses to start while another project publishes the aliases,
pulls and starts the stack, waits for OpenELIS through the public URL, runs
the harness seed (`seed-analyzers.sh --ensure-connections --no-mock-network`),
sends one result per protocol through the mock and requires each in review,
then publishes the ready target the review widget pins answers to
(`/__review/target.json`).

## Cutover from another project

1. Back up the running project's database and keep its volumes:
   `docker exec <db> pg_dump -U clinlims clinlims > backups/<project>-<date>.dump`,
   then stop it without `-v` (`docker compose -p <project> stop`).
2. Run `site-deploy.sh`. It starts only once the aliases are free.
3. Roll back by stopping `oe-analyzers` (`./compose.sh stop`) and starting
   the previous project again; its database and Bridge state are untouched.

## Operating

- `./compose.sh ps`, `./compose.sh logs -f openelis-analyzer-bridge`.
- Send a result: `curl -s -X POST http://127.0.0.1:8085/simulate/fixture/genexpert_astm/hivvl/quantified -H 'Content-Type: application/json' -d '{"destination":"tcp://openelis-analyzer-bridge:12001","sample_id":"<accession>","sender_id":"OE2-TEST-GENEXPERT"}'`;
  the BC-5380 is `/simulate/fixture/mindray_bc5380_hl7/cbc/analysis-result` to
  `mllp://openelis-analyzer-bridge:2575` with sender `OE2-TEST-BC5380`; the
  FluoroCycler is `/simulate/file/hain_fluorocycler` with
  `{"target_dir":"/data/analyzer-imports/fluorocycler-xt/incoming"}`.
- A fresh start: `./compose.sh down -v` and `rm -rf configuration/backend/*`,
  then `site-deploy.sh` again. The pairing code in `.env` is reused; a Bridge
  whose state volume was removed accepts it again.
- A new commit: build its bundle, update the digests in
  `docker-compose.site.yml` from that commit's `e2e-image-map` artifact, and
  run `site-deploy.sh` with the new sha. The database and catalog carry over.

`deploy.sh app deploy analyzers` and `deploy.sh analyzer-runtime` target the
retired from-source `analyzers` project; do not use them for this stack.
