# OpenELIS UAT Review Harness — agent context

Operating context for an LLM/agent asked to **author UAT checklists** or reason
about the **reviewer feedback loop** for the OpenELIS demo instances. Everything
below is the live contract, not aspiration.

## What this is

A self-hosted authoring + feedback loop that lets stakeholders review in-progress
OpenELIS features against a structured checklist, and lets humans _or_ agents
author those checklists from one source of truth.

- **Source of truth:** a Grist document ("UAT Checklists"). Humans edit it in the
  Grist UI; agents edit it over Grist's REST API. Neither clobbers the other
  (edits target specific rows).
- **Delivery:** a reviewer overlay injected into each demo site reads the
  checklist live from Grist and captures pass/fail/na + freeform feedback.
- **Return path:** the reviewer downloads a Markdown+JSON report and pastes it
  into Claude, which triages it into Jira/GitHub items.

Three instances today: `amr` (Microbiology MVP, OGC-782), `analyzers` (Analyzer
Types & Mapping, OGC-1054), and `phrases` (Macro Library, OGC-788). Each has its
own application session-verification backend and review identity.

## Authoring — Grist REST API

- **Endpoint root:** `https://grist.openelis-global.org/api/docs/hvZ4rzsyGJuqggkZBko8gc`
- **Auth:** a Grist API key as `Authorization: Bearer <key>`. The key is box-side
  at `/home/ubuntu/oe-grist/.api-key` (admin user; full access — treat as secret).
- **Boundary:** the key belongs only in an approved agent/operator environment.
  Never put it in a browser, checklist row, committed file, log, or command output.
- **Operations:** use `GET`, `POST`, `PATCH`, and `DELETE` on
  `/tables/<table>/records`. Reads and writes target the same rows the Grist UI
  displays; there is no second authoring store or publish step.

### The data model

- Document **"UAT Checklists"**, id `hvZ4rzsyGJuqggkZBko8gc`.
- Table **`UAT_Meta`** — one row per review: `instance, title, intro, jira,
published`.
- Table **`UAT_Stories`** — one row per story: `instance` (ref → `UAT_Meta`),
  `story_key, title, story_order`, plus where it came from — `jira, pr, mock`
  (one link each), `user_story` (prose) and `hosts` (deployments it applies to,
  blank for all).
- Table **`UAT_Steps`** — one row per step:
  `instance, step_key, required, story` (ref → `UAT_Stories`), `step_order (int),
do, expect, route`.
- Reviewers select one `UAT_Stories` row at a time; only that story's steps and
  progress are rendered. The picker is ordered by `story_order`, and steps by
  `step_order`. A deployed review showing one option with the aggregate step
  count is a failed validation even when the JSON still contains story sections.
  `route` is the app path a reviewer opens for that step (for example,
  `/Microbiology/worklist`).
- The deployed story checklist is scoped to the injected review/server first and
  to stories matching the current URL by default. If the URL has no matching
  story, it explicitly falls back to all stories on that server. Reviewers can
  expand to all server stories themselves; an explicit choice must survive a
  refresh, while real navigation resets the route-relevant default.
- Both story and step tables carry a computed `problems` column: empty means the
  row is publishable.
- `step_key` is immutable and unique within an instance. Reordering a row must
  not change it. Changing `do`, `expect`, `route`, or `required` invalidates a
  prior reviewer mark until the reviewer confirms that step again.
- Grist's UI may apply default story and step keys, but REST creates must send
  explicit unused `story_key` and `step_key` values. Read the current rows first
  and verify the public checklist after writing; a computed `problems` cell may
  lag the create that should have populated a key.

### REST operations

Read before you write so you append or update instead of duplicating a row:

```bash
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $GRIST_API_KEY" \
  "$GRIST_API_ROOT/tables/UAT_Stories/records"
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $GRIST_API_KEY" \
  "$GRIST_API_ROOT/tables/UAT_Steps/records"
```

Filter the returned records by the `instance`, `story_key`, and `step_key`
fields in a structured JSON parser. Never scrape the Grist UI or infer a row id
from its position.

Add a step — `story` is the `UAT_Stories` **row id** the records above returned,
not its title:

```json
{
  "records": [{
    "fields": {
      "instance": "amr",
      "story": 3,
      "step_key": "AMR-008",
      "required": true,
      "step_order": 2,
      "do": "...the action the reviewer performs...",
      "expect": "...the expected result / what to flag if wrong...",
      "route": "/Microbiology/worklist"
    }
  }]
}
```

Send that body with `POST` to
`$GRIST_API_ROOT/tables/UAT_Steps/records`. Updates use `PATCH` and include each
record's numeric `id`; deletes use `DELETE` with `records: [<id>]`.

From an authorized review-tooling checkout, prefer the scoped wrapper for a
complete story. It uses the server-side API key, applies the story and its exact
step set by stable keys, and leaves every sibling story alone:

```bash
./deploy.sh grist apply-story --file story.json
```

The JSON file has `instance`, one `story` object, and a non-empty `steps` array.
The story requires `story_key`, `title`, and `story_order`; every step requires
`step_key`, `required`, `step_order`, and `do`. Include `expect` and `route` when
the reviewer needs them.

Write UAT steps as **verifiable checks** — a `do` a reviewer performs and an
`expect` they judge against. A missing feature is a legitimate step: the reviewer
marks it Fail, which is useful signal.

Before publishing, dry-run the exact prose on the deployed target without test
helpers or fixture APIs. The story must name the starting surface, full nav path,
stable human-visible fixture data, record-reuse/reset rules, and the part of a
complex screen that is in scope. Each step must disambiguate repeated controls.
A state-changing story gets a story-specific fixture; independently selectable
stories must never silently share one mutable case. Consume-once fixtures name
their required starting state and reseed boundary.
A valid JSON endpoint proves only that the checklist can load; the live overlay
and reviewer-executable walkthrough prove that it can be used.

## Delivery — how a checklist reaches reviewers

The reviewer overlay on each demo site fetches
`/__review/uat-<instance>.json`. The umbrella router proxies that to a small
box-side read service that reshapes live Grist rows into the widget's JSON
(30-second serve-stale cache). So an edit in Grist or via REST shows up in the
overlay within ~30s — no publish step.
The panel also refreshes whenever it opens and has an explicit refresh action.

## Feedback — the report

The reviewer marks each step (pass/fail/na) + optional notes, then downloads
`oe-review-<instance>-<timestamp>.md` and `.json`. The Markdown carries a
per-section checklist with `[PASS]/[FAIL]/[N/A]/[----]` boxes, a summary line,
and freeform feedback. Both formats include the checklist revision, verified
deployment ID, application and harness SHAs, stable step keys, marked
timestamps, and actual page URLs.
The footer instructs the reviewer to paste it into Claude to triage into
Jira/GitHub.

**Your job on the return trip:** turn a pasted report into ranked, actionable
items — group by severity, map each FAIL / critical note to a concrete
story/task under the instance's Jira epic, and confirm what passed. Draft the
issues; don't file them unless asked.

## Gotchas

- The REST API is **authed with a full-access key** — never expose it to a browser
  or an untrusted client. The widget read path is the only anonymous surface, and
  it is read-only. Verify the server-side identity with
  `./deploy.sh grist check-access`; `viewers` is not ready for authoring.
- Grist runs the exclusively open-source `gristlabs/grist-oss` image. Human OIDC
  sign-in and the REST API are Community features; no activation, enterprise
  edition marker, proprietary OAuth server, or Redis sidecar is part of this
  deployment.
- Runtime secrets live in the untracked `${EDGE_DIR}/.env`; never put their
  values in Git or an SSM command body.
- `bootstrap.sh up` migrates schema and seeds only missing instances. Never use
  `seed-examples --replace-all` unless replacement is the explicit intent.
- The widget never reuses old position-based answers. Review state is keyed by
  deployment, checklist revision, and immutable `step_key`; changed step
  instructions require review again.
- `/__review/target.json` is published only after health verification. A failed
  candidate must not replace the last ready target.
