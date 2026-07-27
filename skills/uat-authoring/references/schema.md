# Data model reference

## Where things live

One Grist document, **"UAT Checklists"** (`hvZ4rzsyGJuqggkZBko8gc`), holds every
review. A single row set — keyed by an **instance slug** — is one checklist.
Live instances today: `amr` (Microbiology MVP, OGC-782) and `analyzers`
(Analyzer Types & Mapping, OGC-1054).

## `UAT_Meta` — one row per instance

| Column | Type | Notes |
|---|---|---|
| `instance` | Text | The slug. Ties the checklist, the widget, and reviewer answers together. |
| `title` | Text | Shown as the panel header and the report title. |
| `intro` | Text | Orientation text at the top of the panel. Say anything a reviewer needs before starting (credentials, known gaps). |
| `jira` | Text | Epic/ticket key, carried into the report. |

## `UAT_Steps` — one row per step

| Column | Type | Notes |
|---|---|---|
| `instance` | Text | Must match a `UAT_Meta.instance` exactly. A typo produces a checklist nobody can find. |
| `step_key` | Text | **Mandatory, unique within the instance, immutable.** Reviewer answers are keyed by it. |
| `required` | Bool | **Set explicitly.** Grist writes `false` for untouched rows, so an unset step is silently optional. |
| `section` | Text | Group heading. Every row sharing a `section_order` must use the identical title. |
| `section_order` | Int | 0-based. Orders sections. |
| `step_order` | Int | 0-based within the section. |
| `do` | Text | The action the reviewer performs. Required — a step without it is rejected. |
| `expect` | Text | What should happen. This is what makes a Fail meaningful. |
| `route` | Text | Optional same-origin path (`/Microbiology/worklist`). Rendered as a "Go to" link. |

## What reviewers actually receive

`GET https://grist.openelis-global.org/uat/<instance>.json` returns the built
document — this is exactly what a reviewer's browser loads:

```json
{
  "schemaVersion": 2,
  "title": "Analyzer Types & Mapping — review",
  "instance": "analyzers",
  "jira": "OGC-1054",
  "intro": "…",
  "sections": [
    { "title": "Setup", "steps": [
        { "key": "AN-QC-001", "required": true,
          "do": "…", "expect": "…", "route": "/…" } ] }
  ],
  "checklistRevision": "96a1e8b9c801…"
}
```

Note the shape differs from the table: rows are grouped into `sections`, and
`step_key` is emitted as `key`.

## `checklistRevision`

A SHA-256 over the whole document content, computed on read. It is **content
identity**, not a version label you maintain by hand.

It is stable under reordering rows that don't change content, and changes
whenever any step's text, flags, or ordering changes. Because it is part of the
reviewer's storage key, an edit moves answers to a new bucket — the widget
carries them forward, but every step whose instructions changed is flagged
"Review again", which is the intended behaviour: the contract changed, so the
prior judgement is no longer evidence.

## How reviewer answers are keyed

`instance` → deployment identity (the app SHA under review) → `checklistRevision`
→ `step_key`. Consequences worth knowing:

- Reordering steps preserves answers (keys don't move).
- Renaming a `step_key` orphans that answer.
- Editing a step's text marks that step stale, not the whole checklist.
- A different app build starts a fresh set of answers — that is deliberate: a
  pass against other code is not evidence about this one.

## Validation applied on read

Every one of these fails the **entire instance**, not the single row — the read
service refuses to serve a partially valid checklist, because silently dropping a
step could let a report claim completeness over an incomplete checklist:

- missing or blank `step_key`
- duplicate `step_key` within the instance
- duplicate `section_order`/`step_order` pair
- conflicting section titles for one `section_order`
- missing `do`
- `route` that resolves off-origin

## Related surfaces

| | |
|---|---|
| Authoring (people) | `https://grist.openelis-global.org` — sign in, edit the doc |
| Authoring (agents) | `https://grist.openelis-global.org/api/mcp` |
| What reviewers load | `https://grist.openelis-global.org/uat/<instance>.json` |
| The widget itself | `https://grist.openelis-global.org/oe-review-widget.js` |
| Docs | `https://grist.openelis-global.org/docs/` |
