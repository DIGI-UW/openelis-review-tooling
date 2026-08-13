# Data model reference

## Where things live

One Grist document, **"UAT Checklists"** (`hvZ4rzsyGJuqggkZBko8gc`), holds every
review. A single row set — keyed by an **instance slug** — is one checklist.
Live instances today: `amr` (Microbiology MVP, OGC-782) and `analyzers`
(Analyzer Types & Mapping, OGC-1054).

## `UAT_Meta` — one row per review

| Column | Type | Notes |
|---|---|---|
| `instance` | Text | The slug. Ties the checklist, the widget, and reviewer answers together. |
| `title` | Text | Shown as the panel header and the report title. |
| `intro` | Text | Orientation text at the top of the panel. Say anything a reviewer needs before starting (credentials, known gaps). |
| `jira` | Text | Epic/ticket key, carried into the report. |
| `published` | Bool | Lists the review in the public catalog. Off until someone says otherwise. |

## `UAT_Stories` — one row per story

A story is a thing being reviewed, and the steps that check it.

| Column | Type | Notes |
|---|---|---|
| `instance` | Ref → `UAT_Meta` | The review this belongs to. A **row id**, not the slug — which is why a typo can no longer create a second, empty checklist. |
| `story_key` | Text | **Unique within the review.** The UI may default it (`AMR-S01`); REST creates must send it explicitly. Survives a retitle, so it is what anything pointing at the story uses. |
| `title` | Text | The heading above this story's steps. |
| `story_order` | Int | 0-based position in the checklist. |
| `jira` | Text | The ticket, as a key or URL. One. |
| `pr` | Text | The pull request implementing it, as a URL. One. |
| `mock` | Text | The design it was built against, as a URL. One. |
| `user_story` | Text | The user story in words — prose, not a link. |
| `hosts` | Text | Deployments this story applies to, one per line. Blank shows everywhere. |
| `problems` | Any | Computed. Empty means publishable. |

## `UAT_Steps` — one row per step

| Column | Type | Notes |
|---|---|---|
| `instance` | Text | The review's slug. |
| `step_key` | Text | **Mandatory, unique, immutable.** Reviewer answers are keyed by it; REST creates must send it explicitly. |
| `required` | Bool | **Set explicitly.** Grist writes `false` for untouched rows, so an unset step is silently optional. |
| `story` | Ref → `UAT_Stories` | The story this step is under. A step without one is refused. |
| `step_order` | Int | 0-based within the story. |
| `do` | Text | The action the reviewer performs. Required — a step without it is rejected. |
| `expect` | Text | What should happen. This is what makes a Fail meaningful. |
| `route` | Text | Optional same-origin path (`/Microbiology/worklist`). Rendered as a "Go to" link. |
| `problems` | Any | Computed. Empty means publishable. |

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

`GET /uat/index.json` publishes those story rows separately for the widget picker:

```json
{
  "schemaVersion": 2,
  "stories": [
    {
      "id": "amr--AMR-S01",
      "review": "amr",
      "key": "AMR-S01",
      "title": "Find and route microbiology work",
      "steps": 2,
      "required": 2,
      "routes": ["/Microbiology/worklist"]
    }
  ]
}
```

The checklist endpoint stays aggregate; the widget selects one catalog story and
renders the section with the matching stable key. `review` is the `UAT_Meta`
instance, while `key` is the `UAT_Stories.story_key`. They are not interchangeable.

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
- duplicate `step_order` within one story
- a step with no `story`
- a story with no steps
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
