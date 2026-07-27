---
name: uat-authoring
description: Author and edit UAT review checklists for OpenELIS in the central Grist document, over Grist's native MCP. Use this skill whenever the user wants to create, add to, reorder, fix, or review a UAT checklist, acceptance checklist, review script, test script, or reviewer walkthrough — including phrasings like "add a step for X", "set up a review for OGC-1234", "write UAT for this PR", "what should reviewers check", or "the checklist is broken". Also use it when a reviewer's downloaded review report needs triaging into issues. Reach for it even if Grist is never mentioned by name: this is the system of record for OpenELIS review checklists, and hand-editing rows without these rules produces checklists that silently break for every reviewer.
---

# Authoring UAT checklists

UAT checklists tell a reviewer what to try in a running OpenELIS deployment and
what should happen. They live in one central Grist document; a reviewer overlay
on each demo site reads them live and captures pass/fail plus notes.

Your job is usually one of three things: **write a new checklist**, **change an
existing one**, or **triage a report** a reviewer sent back.

## Connect

Authoring goes through Grist's native MCP at
`https://grist.openelis-global.org/api/mcp`. If those tools are not already
available in the session, tell the user how to connect rather than guessing:

```bash
claude mcp add --transport http grist https://grist.openelis-global.org/api/mcp \
  --header "Authorization: Bearer <grist-api-key>"
```

On claude.ai, the same URL added as a custom connector signs in through the
browser — no key to paste.

Note that `claude mcp add` writes persistent config for *future* sessions; it does
not give you tools mid-conversation. If you need to author right now and the MCP
tools are absent, use Grist's REST API with the same key — it is the same data and
the same rules:

```
GET|POST|PATCH https://grist.openelis-global.org/api/docs/hvZ4rzsyGJuqggkZBko8gc/tables/UAT_Steps/records
Authorization: Bearer <grist-api-key>
```

**If you cannot get a key, stop and say so.** There is no anonymous write path (the
API returns 403), so there is nothing to fall back on. Draft the rows you would
have created and hand them to the user with what you need to proceed — a fabricated
"done" is far worse than a blocked one, because nobody discovers the checklist is
missing until a reviewer opens an empty panel.

The document is **"UAT Checklists"** (`hvZ4rzsyGJuqggkZBko8gc`). Tools you'll
use: `grist_query_document` (SQL SELECT), `grist_add_records`,
`grist_update_records`, `grist_remove_records`.

## Read before you write

Always pull the current rows first. Checklists are edited by people too, and
appending blindly duplicates steps or collides with a key someone else added:

```sql
SELECT id, step_key, required, section, section_order, step_order, "do", expect, route
FROM UAT_Steps WHERE instance='amr' ORDER BY section_order, step_order
```

Reading first also tells you the section names and ordering already in use, so a
new step lands where a reviewer expects it rather than in a section of one.

## The rules that actually bite

These are not style preferences — each one has broken a live checklist.

**`step_key` is mandatory and a blank one takes down the whole instance.** The
read service fails the entire checklist, not just the bad row, so one empty key
means every reviewer of that instance sees an error instead of any steps. Use a
short stable id in the instance's existing scheme (`AMR-009`, `AN-QC-009`) and
never reuse one. A brand-new instance has no scheme yet, so invent a short prefix
from the feature and number from 001 (`SKT-001`), matching the shape of the
existing instances rather than their letters.

**`step_key` is immutable once reviewers have seen it.** Reviewer answers are
keyed by it. Reordering rows is free — change `section_order`/`step_order` all
you like — but editing a key orphans that reviewer's answer.

**`required` defaults to false in Grist, which is backwards.** Grist's Bool
column writes `false` for rows that were never touched, so a step you forget to
set is silently optional and cannot fail the review. Set `required: true`
explicitly unless the step genuinely is optional. (A whole 10-step checklist was
silently all-optional this way.)

**`route` must be a same-origin path** — `/Microbiology/worklist`, not a full
URL. Anything that resolves off-origin is rejected, and the row is refused.

**A section's title and its `section_order` must agree across every row in it.**
Two rows claiming `section_order: 1` with different titles is an error. Reuse the
exact title string of the section you're appending to.

## Write steps a reviewer can actually judge

A step is a `do` the reviewer performs and an `expect` they measure against. The
`expect` is what makes a Fail meaningful — without it, a reviewer can only report
that they were confused.

Aim the checklist at what you are unsure about. A missing feature is a
legitimate step: the reviewer marking it **Fail** is exactly the signal worth
having, and it is far more useful than a checklist that only confirms what you
already know works.

**Good:**
> **do:** After entering AST results, check whether the S/I/R interpretation is
> carried onto the patient's result/report output — not only shown on the
> AST-entry surface.
> **expect:** The final report reflects the AST interpretation. If it stops at
> data entry and never reaches a report, flag that as the highest-value gap.

That step came back FAIL and became the top finding of the review.

**Weak:** *"Check the microbiology module works."* — nothing to perform, nothing
to measure, and a Fail tells you nothing about where it broke.

Keep a step to one observation. If the `expect` needs "and", it is two steps.

Group steps into sections that match how a reviewer moves through the app. A short
checklist is legitimately one section — the thing to avoid is fragmenting six steps
into six sections of one, not having a single well-named section.

`route` is optional and only worth setting when you know the real path. Guessing
sends reviewers to a 404, which is worse than making them navigate; omit it and let
the `do` describe where to go.

## Adding a step

Append to an existing section by reusing its `section_order` and taking the next
`step_order`:

```
grist_add_records(doc_id, "UAT_Steps", [{
  instance: "amr",
  step_key: "AMR-009",
  required: true,
  section: "Drive the workflow (reviewer-performed)",
  section_order: 2,
  step_order: 3,
  do: "…what the reviewer performs…",
  expect: "…what should happen, and what to flag if it doesn't…",
  route: "/Microbiology/worklist"
}])
```

A brand-new checklist also needs one `UAT_Meta` row: `instance`, `title`,
`intro`, `jira`.

## Always verify — the edit is not done until this passes

The endpoint is the only thing that tells you the checklist is publishable:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://grist.openelis-global.org/uat/<instance>.json
```

`200` means reviewers get exactly this. Anything else means they get an error,
and the body names the offending row:

```
{"error":"step row 35 is missing step_key"}
```

Fix and re-check. Skipping this is how a broken checklist reaches reviewers —
and a cached copy can keep serving the old version for a while, so a page that
still looks fine is not evidence.

Report the result to the user plainly: the instance, how many steps, and the
check status.

## Triaging a returned report

A reviewer's report arrives as Markdown (with a JSON twin) listing each step as
`[PASS]`/`[FAIL]`/`[N/A]`/`[----]` plus freeform notes. Turn it into ranked,
actionable items: group by severity, map each FAIL and each critical note to a
concrete story or task under the instance's Jira epic, and say plainly what
passed so the reader knows the scope of what was confirmed.

Draft the issues — don't file them unless asked.

## More detail

- `references/schema.md` — full column reference, the document shape reviewers
  receive, and how revisions and answer-keying work.
- `references/troubleshooting.md` — what each failure looks like and its cause.
