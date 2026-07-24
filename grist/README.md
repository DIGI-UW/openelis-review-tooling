# Grist authoring layer for the UAT checklists

Light self-hosted [Grist](https://www.getgrist.com/) that owns the **authoring**
side of the reviewer overlay: people edit UAT steps in the spreadsheet UI and
agents edit the same rows through Grist's native `/api/mcp`.

Feedback remains client-side download → Claude. The public read transformer
serves schema-v2 checklist JSON with a deterministic revision.

## Flow

```
widget/examples/uat-*.json ──initial seed──▶ Grist ──live read──▶ review overlay
                                            ▲
                                     UI or native MCP
```

Grist is the source of truth once seeded; `generate` is the only writer of the
served JSON thereafter. The overlay picks up changes immediately (`no-store`).

## Schema

| Table | Columns | Role |
|---|---|---|
| `UAT_Meta` | instance, title, intro, jira | per-module header |
| `UAT_Steps` | instance, step_key, required, section, section_order, step_order, do, expect, route | the checklist |
| `UAT_Results` | reviewer, instance, step_key, mark, note, page_url, at | **future** aggregation target |

## Run (on the box, as `ubuntu`)

```bash
bash bootstrap.sh             # up + migrate + seed only missing instances
bash bootstrap.sh generate    # optional export to widget/examples
bash bootstrap.sh seed-force  # destructive replacement; explicit use only
```

`grist-sync.mjs` (`migrate` | `seed` | `generate`) does the API work; `bootstrap.sh` wraps it
with the container lifecycle + the headless API-key step.

## The headless API-key step (why bootstrap injects it)

Self-hosted Grist has **no env-var path to an API key** — normally you click
through the UI. `bootstrap.sh` mints one non-interactively by writing
`users.api_key` in `home.sqlite3` for the admin user (`GRIST_DEFAULT_EMAIL`), then
uses it as the bearer token. The key is stored box-side in `~/oe-grist/.api-key`
(never committed).

## Public UI access (grist.openelis-global.org)

The container binds no host ports; humans reach the Grist UI through the
umbrella router vhost and Grist/Dex OIDC. Requires:
1. DNS: `grist.openelis-global.org` → the host EIP.
2. `./deploy.sh certs` (issues the third LE cert alongside amr/analyzers).
3. Box-side Dex client secret and reviewer password hash in `.env`.

Until DNS is up, the authoring pipeline still works headlessly via `bootstrap.sh`
(it reaches Grist over the internal network).

## Light-mode caveats

`GRIST_SANDBOX_FLAVOR=unsandboxed` — fine for an internal, single-tenant,
OIDC-gated authoring instance; do not expose formula editing to untrusted
users this way. Data lives in the `oe-grist_grist-data` volume (built-in SQLite,
no external DB).
