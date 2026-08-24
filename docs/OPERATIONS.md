# Review Tooling Operations

This is the operator contract for the self-hosted OpenELIS review loop. It
describes the current system, including state intentionally kept outside Git.

## Runtime Components

| Compose project | Component                | Purpose                                                   | Durable state                                       |
| --------------- | ------------------------ | --------------------------------------------------------- | --------------------------------------------------- |
| `oe-edge`       | `oe-edge-router`         | TLS, host routing, widget injection, live checklist proxy | Let's Encrypt files and self-signed fallback volume |
| `oe-grist`      | `oe-edge-grist`          | Human checklist authoring and authenticated REST API      | `oe-grist_grist-data`                               |
| `oe-grist`      | `oe-edge-dex`            | Grist sign-in                                             | Configuration in Git; secrets supplied at runtime   |
| `oe-grist`      | `oe-edge-grist-uat-read` | Public, read-only Grist-to-widget adapter                 | Server-side Grist API key mounted read-only         |
| `amr`           | OpenELIS AMR stack       | Microbiology review target                                | OpenELIS database and application volumes           |
| `analyzers`     | OpenELIS analyzer stack  | Analyzer review target                                    | OpenELIS database and application volumes           |
| `phrases`       | OpenELIS phrases stack   | Macro Library review target                               | OpenELIS database and application volumes           |

Grist is the checklist source of truth. The read adapter reshapes rows into
`/uat/<instance>.json`; router caches are limited to about 30 seconds. There is
no publish step and no generated checklist file in the live path.

## Configuration Inventory

The operator has two untracked environment files:

- A local `.env`, copied from `.env.example`, for AWS coordinates, branches,
  domains, and host paths used by `deploy.sh`.
- `${EDGE_DIR}/.env` on the host, provisioned from `grist/.env.example`, for the
  Grist/Dex runtime and its credentials.

The deploy command never embeds the host-side secret values in an SSM command
body. Provision `${EDGE_DIR}/.env` through an approved operator channel before
the first deployment.

| Value                                                         | Used for                             | Secret                                           |
| ------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------ |
| `AMR_DOMAIN`, `ANALYZERS_DOMAIN`, `PHRASES_DOMAIN`, `GRIST_DOMAIN` | Router hosts and certificates     | No                                               |
| `LETSENCRYPT_EMAIL`, `LETSENCRYPT_STAGING`                    | ACME registration                    | No                                               |
| `AMR_BRANCH`, `ANALYZERS_BRANCH`, `PHRASES_BRANCH`            | Application deployment inputs        | No                                               |
| `REGION`, `INSTANCE_ID`, `EIP`, `SG_ID`, `OS_USER`, `SSH_KEY` | AWS/SSM host access                  | `SSH_KEY` is a local path; do not commit the key |
| `EDGE_DIR`, `AMR_DIR`, `ANALYZERS_DIR`, `PHRASES_DIR`         | Host checkout layout                 | No                                               |
| `GRIST_STATE_DIR`                                             | Server-side API-key mount            | No                                               |
| `DEX_GRIST_CLIENT_SECRET`                                     | Dex-to-Grist OIDC client             | Yes                                              |
| `DEX_REVIEWER_PASSWORD_HASH`                                  | Demo reviewer login hash             | Yes                                              |

AWS credentials remain in the operator's normal AWS CLI session. They are
never copied into `.env`, Grist, the widget, or the authoring API.

The configured `AWS_PROFILE` region must match `REGION`. Console-login
credentials are short-lived and the CLI refreshes them through the regional
AWS Sign-In endpoint that issued the session. Before the first deployment, or
after changing regions, configure and log in once with matching values:

```bash
aws configure set region us-west-2 --profile default
aws login --profile default --region us-west-2
```

`deploy.sh` rejects a mismatched profile before making a deployment request so
an initially valid 15-minute credential cannot fail later during a long build.

## Protected State

The Git checkout is replaceable. These paths are not:

- `${EDGE_DIR}/.env`: host-side Grist/Dex runtime configuration and secrets;
- `${GRIST_STATE_DIR}/.api-key`: full-access Grist API key used only by the
  server-side read adapter;
- Docker volume `oe-grist_grist-data`: Grist documents and account data;
- `router/letsencrypt/`: certificate lineages;
- OpenELIS database volumes for `amr`, `analyzers`, and `phrases`.

Deployment sync refuses to overwrite tracked changes and preserves untracked
files. Persistent values still belong in the paths above, never in tracked
files.

## Grist Lifecycle

Validate a checkout without contacting the live system:

```bash
ENV_FILE=.env.example ./grist/bootstrap.sh validate
```

Start or reconcile Grist on the host:

```bash
cp grist/.env.example .env
# Replace every placeholder before provisioning this file to ${EDGE_DIR}/.env.
./grist/bootstrap.sh up
./grist/bootstrap.sh status
./grist/bootstrap.sh check-access
```

`check-access` fails unless the server-side Grist identity owns the UAT
document. Run it before relying on REST authoring; a read-only server identity
is not a healthy authoring setup.

`up` starts the exclusively open-source `gristlabs/grist-oss` image and Dex,
reuses the named persistent volume, preserves or creates the server-side API
key, and verifies document ownership before changing the UAT document. It then
migrates missing columns, seeds only instances absent from Grist, and starts the
read adapter. Routine runs do not clear authored rows.

For a deliberate replacement of the committed example instances:

```bash
./grist/bootstrap.sh seed-examples --replace-all
```

This explicit command replaces rows for the committed example instances.
Humans normally edit Grist directly and agents use REST; both paths become
live without a publish step.

## Review Identity

`/__review/target.json` is the ready deployment contract. It is atomically
published only after both application health checks pass and includes the
deployment ID, application ref/SHA, harness SHA, timestamp, scope, and
verification state. `/__review/build.json` is a compatibility alias.

Browser answers are isolated by instance, deployment ID, and checklist
revision. Within the same deployment, a stable semantic `step_key` can carry an
answer across reordering. Changed instructions are marked stale. Answers from
before stable keys were keyed by position, so none can be matched to a step;
they are never mapped, and the pre-v2 key holding them is discarded on sight
rather than reported.

## Deployment Boundary

`./deploy.sh deploy --yes` remains the current full-environment path: it
reconciles Grist and rebuilds both OpenELIS review targets plus the router. It
must not be presented as a single-instance or low-risk application deployment.

Targeted application delivery uses an exact pushed SHA and leaves the other
OpenELIS stacks, router, Grist, databases, and FHIR services untouched:

```text
./deploy.sh infra bootstrap|status|upgrade
./deploy.sh app deploy <instance> --ref <sha> --scope frontend|backend|app
./deploy.sh app status <instance> [--deployment <id>]
./deploy.sh app logs <instance> [--since <duration>] [--tail <lines>] [--errors]
./deploy.sh app verify <instance>
./deploy.sh app rollback <instance>
./deploy.sh review deploy --ref <sha> --scope widget
./deploy.sh review reload-router [--instance amr] [--domain <host>]
./deploy.sh grist up
./deploy.sh data seed <instance> --fixture <name>
```

For `analyzers`, app scope also rebuilds and verifies the Analyzer Bridge and
analyzer mock revisions pinned by the selected OpenELIS commit. It does not
restart AMR, phrases, the router, Grist, or their data services.

For a targeted app deployment, `target.json` records the branch only when one
remote branch head exactly matches the deployed SHA. If that association is
absent or ambiguous, `appBranch` is intentionally blank and `appSha` remains
the authoritative provenance. This prevents a configured base branch from
being falsely shown for a higher stacked-PR deployment.

`review deploy` ships the widget and rebuilds the checklist service. It does not
touch the router, so a change to `router/nginx.conf.template` is still inert
after it: the template becomes `nginx.conf` in the container's entrypoint, and
until the container is recreated the old routes keep serving.
`grist apply` runs from the checkout **on the host**, not from yours, so it must
come after `review deploy` has moved that checkout. Run it first against a box
still on the old commit and it reconciles the document to the old schema — which
reports "nothing to do" and looks like the change was already applied.

`review reload-router` is that recreate, and only that one — `--no-deps` keeps
it off both application stacks, so nobody mid-review is interrupted. It forces
the recreate, because a template-only change leaves the image identical and
Compose would otherwise find nothing to do and report success. It then probes
the submissions route and fails on a 404, which is the state it exists to
prevent: routes that were never rendered, reported as deployed.

Deploying a change that touches all three therefore goes:

```text
./deploy.sh review deploy --ref <sha> --scope all   # moves the checkout, then the widget + service
./deploy.sh grist up                                # reconciles Grist/Dex from that checkout
./deploy.sh grist apply --dry-run                   # read the plan against the moved checkout
./deploy.sh grist apply
./deploy.sh review reload-router                    # last: the route needs the service behind it
```

The router goes last because its probe expects the checklist service to answer
the submissions route; against an older service the probe sees a 404 and
correctly refuses.

Targeted delivery supports `instance=amr`, `instance=analyzers`, and
`instance=phrases`. The first `phrases --scope app` deployment creates its
isolated checkout, Compose project, database, and FHIR services; later deploys
use the same narrow application-only replacement path. It tags the
current frontend/backend images before replacement, publishes target metadata
only after instance-specific health and route smoke checks pass, and
automatically restores those images if candidate verification fails. Automatic
rollback is intentionally disabled for schema-affecting deployments; those
require a separate data rollback plan. The targeted runner resolves the active
working directory and complete Compose file chain from the running container's
labels, so a stale local checkout path cannot redirect an in-place deployment
and analyzer-only delivery retains its harness overlays. Full, targeted, and
rollback runners share a host lock and refuse to start concurrently.

The review-widget scope checks out an exact harness SHA under the same lock.
Because the widget is a read-only router bind mount, no application or router
container restart is required. The command verifies the live script before
updating each ready target's `harnessSha`.

The Macro Library review is a dedicated `phrases` Grist instance. Do not place
its stories under `amr` with a host filter: submissions are authenticated against
the backend mapped to the checklist instance, so sharing the AMR slug would
verify the wrong application session.
