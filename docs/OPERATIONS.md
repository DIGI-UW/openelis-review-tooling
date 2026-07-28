# Review Tooling Operations

This is the operator contract for the self-hosted OpenELIS review loop. It
describes the current system, including state intentionally kept outside Git.

## Runtime Components

| Compose project | Component | Purpose | Durable state |
|---|---|---|---|
| `oe-edge` | `oe-edge-router` | TLS, host routing, widget injection, live checklist proxy | Let's Encrypt files and self-signed fallback volume |
| `oe-grist` | `oe-edge-grist` | Human checklist authoring and native MCP at `/api/mcp` | `oe-grist_grist-data` |
| `oe-grist` | `oe-edge-dex` | Grist sign-in | Configuration in Git; secrets supplied at runtime |
| `oe-grist` | `oe-edge-redis` | Native MCP OAuth token state | None; users reauthenticate after loss |
| `oe-grist` | `oe-edge-grist-uat-read` | Public, read-only Grist-to-widget adapter | Server-side Grist API key mounted read-only |
| `amr` | OpenELIS AMR stack | Microbiology review target | OpenELIS database and application volumes |
| `analyzers` | OpenELIS analyzer stack | Analyzer review target | OpenELIS database and application volumes |

Grist is the checklist source of truth. The read adapter reshapes rows into
`/uat/<instance>.json`; router caches are limited to about 30 seconds. There is
no publish step and no generated checklist file in the live path.

## Configuration Inventory

The operator has two untracked environment files:

- A local `.env`, copied from `.env.example`, for AWS coordinates, branches,
  domains, and host paths used by `deploy.sh`.
- `${EDGE_DIR}/.env` on the host, provisioned from `grist/.env.example`, for the
  Grist/Dex runtime and its two secret values.

The deploy command never embeds the host-side secret values in an SSM command
body. Provision `${EDGE_DIR}/.env` through an approved operator channel before
the first deployment.

| Value | Used for | Secret |
|---|---|---|
| `AMR_DOMAIN`, `ANALYZERS_DOMAIN`, `GRIST_DOMAIN` | Router hosts and certificates | No |
| `LETSENCRYPT_EMAIL`, `LETSENCRYPT_STAGING` | ACME registration | No |
| `AMR_BRANCH`, `ANALYZERS_BRANCH` | Current full-stack deployment inputs | No |
| `REGION`, `INSTANCE_ID`, `EIP`, `SG_ID`, `OS_USER`, `SSH_KEY` | AWS/SSM host access | `SSH_KEY` is a local path; do not commit the key |
| `EDGE_DIR`, `AMR_DIR`, `ANALYZERS_DIR` | Host checkout layout | No |
| `GRIST_STATE_DIR` | Server-side API-key mount | No |
| `DEX_GRIST_CLIENT_SECRET` | Dex-to-Grist OIDC client | Yes |
| `DEX_REVIEWER_PASSWORD_HASH` | Demo reviewer login hash | Yes |

AWS credentials remain in the operator's normal AWS CLI session. They are
never copied into `.env`, Grist, the widget, or MCP.

## Protected State

The Git checkout is replaceable. These paths are not:

- `${EDGE_DIR}/.env`: host-side Grist/Dex runtime configuration and secrets;
- `${GRIST_STATE_DIR}/.api-key`: full-access Grist API key used only by the
  server-side read adapter;
- Docker volume `oe-grist_grist-data`: Grist documents and full-edition marker;
- `router/letsencrypt/`: certificate lineages;
- OpenELIS database volumes for `amr` and `analyzers`.

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
```

`up` activates the full edition in its persistent volume, starts
Grist/Dex/Redis, preserves or creates the server-side API key, migrates missing
columns, seeds only instances absent from Grist, and starts the read adapter.
Routine runs do not clear authored rows.

For a deliberate replacement of the committed example instances:

```bash
./grist/bootstrap.sh seed-examples --replace-all
```

This explicit command replaces rows for the committed example instances.
Humans normally edit Grist directly and agents use native MCP; both paths become
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
OpenELIS stack, router, Grist, databases, FHIR, and analyzer harness services
untouched:

```text
./deploy.sh infra bootstrap|status|upgrade
./deploy.sh app deploy <instance> --ref <sha> --scope frontend|backend|app
./deploy.sh app status <instance> [--deployment <id>]
./deploy.sh app verify <instance>
./deploy.sh app rollback <instance>
./deploy.sh review deploy --ref <sha> --scope widget
./deploy.sh data seed <instance> --fixture <name>
```

Targeted delivery supports `instance=amr` and `instance=analyzers`. It tags the
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
