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

Grist is the source of truth once seeded. The read-only adapter builds served
JSON directly from current rows; `generate` is an optional diagnostic export,
not a publish step. The overlay sees changes within the router's short cache.

## Schema

| Table             | Columns                                                                                         | Role                         |
| ----------------- | ----------------------------------------------------------------------------------------------- | ---------------------------- |
| `UAT_Meta`        | instance, title, intro, jira                                                                    | per-module header            |
| `UAT_Stories`     | instance, story_key, title, story_order, version, jira, pr, mock, user_story, hosts             | one row per story            |
| `UAT_Steps`       | instance, step_key, required, story, step_order, do, expect, route                              | the checklist                |
| `UAT_Submissions` | instance, login, reviewer, submitted_at, host, app_sha, checklist_revision                      | one row per review handed in |
| `UAT_Answers`     | review, step_key, story_key, story_title, story_version, story_revision, mark, note, actual_url | one row per step answered    |

The first three are authored. The last two are written by a submission and are
not edited by hand.

### What an answer pins, and why none of it is a formula

Every field on `UAT_Answers` except the two references is a copy taken at the
moment the review was handed in. A formula would follow the story forward: edit a
step tomorrow and every review ever given would start claiming it was answered
against the new wording. These copies are meant to go stale — that is what makes
them evidence.

A story carries two versions, because they answer different questions:

- **`version`** — `major.minor`, set by a person. Raise the major when a change
  means answers already given no longer count; raise the minor for a
  clarification they survive. Whether an edit invalidates a review is a
  judgement, so nothing computes this.
- **`revision`** — a content hash, computed. Catches the edit nobody thought to
  raise a version for.

## Run (on the box, as `ubuntu`)

```bash
bash bootstrap.sh validate
bash bootstrap.sh up
bash bootstrap.sh status
bash bootstrap.sh generate
bash bootstrap.sh seed-examples --replace-all
```

`grist-sync.mjs` (`apply` | `migrate` | `seed` | `generate` | `publish`) does the API
work; `bootstrap.sh` wraps it with the container lifecycle + the headless API-key
step.

## The schema is declared, not remembered

[`schema.mjs`](schema.mjs) holds the tables, their columns, every column
description an author reads while writing a checklist, and the defaults that fire
when a row is created. `apply` reconciles a document to it:

```bash
node grist-sync.mjs apply --dry-run   # name the drift, change nothing
node grist-sync.mjs apply             # close it
```

All of that used to exist only in the running document, where nothing could tell
you whether it still matched what this repository expected — and losing the
document lost the authoring experience with it.

Reconciling is not owning. A column the declaration says nothing about is left
alone: Grist keeps its own bookkeeping columns in these tables, and people add
their own. Only the fields that have drifted are patched, so a label or a
description set in the document survives unless the declaration speaks to it.

`up` reads Dex secrets from the untracked `${EDGE_DIR}/.env` on the host,
migrates without clearing rows, and seeds only instances not yet present.
`seed-examples --replace-all` is the explicit destructive path for replacing
the committed example instances.

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
