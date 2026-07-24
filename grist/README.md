# Grist Authoring And Live Read

Grist is the source of truth for OpenELIS UAT checklists. Humans edit
`UAT_Meta` and `UAT_Steps` in the Grist UI; agents author the same rows through
Grist's native MCP at `/api/mcp`.

The `mcp` container is primarily a public, read-only adapter. It reads current
Grist rows and returns the widget shape from `GET /uat/<instance>.json`. Router
caching is limited to about 30 seconds, so row edits appear in the overlay
without a publish step.

## Authoring

Use the native endpoint:

```text
https://grist.openelis-global.org/api/mcp
```

- CLI clients authenticate with a Grist API key in the Authorization header.
- OAuth-capable web clients use Grist's OIDC flow through Dex.
- Read current rows before updating specific row IDs.

See [`../docs/AGENTS.md`](../docs/AGENTS.md) for the complete authoring
contract.

The custom `POST /mcp` endpoint implemented by `mcp/server.mjs` is deprecated
compatibility for older CLI clients. It has a separate token file and must not
be used for new connections. The `GET /uat/<instance>.json` route in the same
process remains the live delivery adapter.

## Data Model

| Table | Columns | Role |
|---|---|---|
| `UAT_Meta` | `instance`, `title`, `intro`, `jira` | Per-instance header |
| `UAT_Steps` | `instance`, `section`, `section_order`, `step_order`, `do`, `expect`, `route` | Ordered review checks |
| `UAT_Results` | `reviewer`, `instance`, `step_key`, `mark`, `note`, `page_url`, `at` | Reserved; downloaded reports remain client-side today |

## Lifecycle

On the deployment host, from the repository root:

```bash
cp .env.example .env
# Replace all host placeholders and Dex secrets.
./grist/bootstrap.sh validate
./grist/bootstrap.sh up
./grist/bootstrap.sh status
```

`validate` renders the Compose model and performs no remote or production
mutation. `up` creates/reuses the external network and persistent state, starts
Grist/Dex/Redis, mints the server-side API key if absent, and starts the read
adapter. The current `deploy.sh` does not copy a private `.env` to a fresh host;
provision it through an approved operator channel first.

On a new disposable installation only:

```bash
./grist/bootstrap.sh seed-examples --replace-all
```

This destructive initialization replaces all checklist rows from
`widget/examples/`. It is not a publish command and must not be used for routine
updates.

Persistent paths, secret sources, and the current deployment boundary are
documented in [`../docs/OPERATIONS.md`](../docs/OPERATIONS.md).
