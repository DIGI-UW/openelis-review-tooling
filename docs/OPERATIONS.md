# Review Tooling Operations

This is the operator contract for the self-hosted OpenELIS review loop. It
describes the current system, including the state that is intentionally not in
Git.

## Runtime Components

| Compose project | Component | Purpose | Durable state |
|---|---|---|---|
| `oe-edge` | `oe-edge-router` | TLS, host routing, widget injection, live checklist proxy | Let's Encrypt files and self-signed fallback volume |
| `oe-grist` | `oe-edge-grist` | Human checklist authoring and native MCP at `/api/mcp` | `oe-grist_grist-data` |
| `oe-grist` | `oe-edge-dex` | Grist sign-in | None; configuration is in Git and secrets are supplied at runtime |
| `oe-grist` | `oe-edge-redis` | Native MCP OAuth token state | None; users reauthenticate after loss |
| `oe-grist` | `oe-edge-grist-mcp` | Public, read-only Grist-to-widget adapter; deprecated custom MCP compatibility | Grist API key and compatibility tokens are mounted read-only |
| `amr` | OpenELIS AMR stack | Microbiology review target | OpenELIS database and application volumes |
| `analyzers` | OpenELIS analyzer stack | Analyzer review target | OpenELIS database and application volumes |

Grist is the checklist source of truth. The read adapter reshapes rows into
`/uat/<instance>.json`; router caches are limited to about 30 seconds. There is
no publish step and no generated checklist file in the live path.

## Configuration Inventory

Copy `.env.example` to `.env`. The file is ignored by Git.

| Value | Used for | Secret |
|---|---|---|
| `AMR_DOMAIN`, `ANALYZERS_DOMAIN`, `GRIST_DOMAIN` | Router hosts and certificates | No |
| `LETSENCRYPT_EMAIL`, `LETSENCRYPT_STAGING` | ACME registration | No |
| `AMR_BRANCH`, `ANALYZERS_BRANCH` | Current full-stack deployment inputs | No |
| `REGION`, `INSTANCE_ID`, `EIP`, `SG_ID`, `OS_USER`, `SSH_KEY` | AWS/SSM host access | `SSH_KEY` is a local path; do not commit the key |
| `EDGE_DIR`, `AMR_DIR`, `ANALYZERS_DIR` | Host checkout layout | No |
| `GRIST_STATE_DIR` | API-key and deprecated bridge-token mount | No |
| `DEX_GRIST_CLIENT_SECRET` | Dex-to-Grist OIDC client | Yes |
| `DEX_REVIEWER_PASSWORD_HASH` | Demo reviewer login hash | Yes |

The AWS session is obtained from the operator's normal AWS CLI login. AWS
credentials are never copied into `.env`, Grist, the widget, or either MCP
surface.

`GRIST_DOMAIN` must match the issuer and redirect URI in
`grist/dex/config.yaml`. That file currently carries the live
`grist.openelis-global.org` value; changing the domain is a coordinated OIDC
configuration change, not an `.env`-only operation.

## Protected State

The Git checkout is disposable. These paths are not:

- `${GRIST_STATE_DIR}/.api-key`: full-access Grist API key used server-side by
  the read adapter;
- `${GRIST_STATE_DIR}/mcp-tokens.json`: deprecated custom-MCP compatibility
  tokens;
- Docker volume `oe-grist_grist-data`: the Grist document and enterprise
  activation marker;
- `router/letsencrypt/`: certificate lineages;
- OpenELIS database volumes for `amr` and `analyzers`.

No current secret is committed to Git. A forced checkout does not reveal these
values, but it can discard uncommitted operator changes and is not a substitute
for an explicit deployment sync. Runtime configuration must stay in `.env`,
the state directory, or Docker volumes.

## Grist Lifecycle

Validate a checkout without contacting the live system:

```bash
ENV_FILE=.env.example ./grist/bootstrap.sh validate
```

Start or reconcile Grist **on the host, from the harness checkout**:

```bash
cp .env.example .env
# Replace every placeholder, including the two Dex secret values.
./grist/bootstrap.sh up
./grist/bootstrap.sh status
```

`up` creates the external network and required state files, activates the Grist
full edition in its persistent volume, starts Grist/Dex/Redis, mints the
server-side Grist API key if absent, and then starts the read adapter.

`deploy.sh` does not currently transport the private Grist `.env` to a fresh
host. Provision that file through an approved operator channel before `up`.
Do not put its values in Git, Grist, the widget, or an SSM command body. Fully
automated secret delivery is intentionally deferred to the infrastructure
bootstrap slice.

For a brand-new disposable installation only, example checklists can initialize
the Grist document:

```bash
./grist/bootstrap.sh seed-examples --replace-all
```

This command replaces every row in `UAT_Meta` and `UAT_Steps`; it deliberately
requires `--replace-all`. Never use it to publish routine edits. Humans edit
Grist directly, and agents use native MCP. Those row-level edits are live
without a publish step.

## Current Deployment Boundary

The current `deploy.sh deploy --yes` path rebuilds both OpenELIS review targets
and the router. It is retained as the existing full-environment path while the
targeted deployment spike is implemented. It must not be presented as a
single-instance or low-risk application deployment.

The approved target interface is:

```text
./deploy.sh infra bootstrap|status|upgrade
./deploy.sh app deploy <instance> --ref <sha> --scope frontend|backend|app
./deploy.sh app status <instance> [--deployment <id>]
./deploy.sh app verify <instance>
./deploy.sh app rollback <instance>
./deploy.sh data seed <instance> --fixture <name>
```

Until those commands exist, use the current commands exactly as documented in
`./deploy.sh help`; do not infer targeted behavior from the target interface.
