# Troubleshooting

Every entry here is a failure that actually happened. The pattern worth
internalising: **the checklist endpoint is the only honest signal.** Containers
stay healthy and pages keep loading while a checklist is broken or frozen, so
"it looks fine" is not evidence.

## `502` with `{"error":"step row 35 is missing step_key"}`

One row has a blank `step_key`. The whole instance fails, not that row.

The row id in the message is the Grist row id — find it directly:

```sql
SELECT id, step_key, "do" FROM UAT_Steps WHERE step_key = ''
```

Give it a key in the instance's existing scheme and re-run the check. This is
the single most common breakage, and it is usually caused by following older
documentation that predates `step_key`.

## `502` mentioning a duplicate key or ordering

Two rows share a `step_key`, or two steps in one story share a `step_order`
pair. Both are rejected because the reviewer's answers would be ambiguous.

```sql
SELECT step_key, COUNT(*) c FROM UAT_Steps
GROUP BY step_key HAVING c > 1
```

## `502` saying a step has no story

`story` is empty on that row. A step with no story has no heading to appear
under, so the checklist is refused rather than the step being shown loose or
silently dropped. Pick the story it belongs to — by row id, not by title:

```sql
SELECT s.id, s.step_key FROM UAT_Steps s WHERE s.story = 0 OR s.story IS NULL
SELECT y.id, y.story_key, y.title FROM UAT_Stories y
JOIN UAT_Meta m ON m.id = y.instance WHERE m.instance = '<slug>'
```

## A story exists but none of its steps appear

Either it has no steps, or its `hosts` limits it to deployments this one is not.
A story with `hosts` set is dropped where it does not apply — deliberately, so its
steps do not sit in the total as answers nobody here can give. Blank means
everywhere.

```sql
SELECT story_key, title, hosts, problems FROM UAT_Stories
```

## `404` for the instance

No `UAT_Meta` row with that slug, or none of its stories have steps. A story
names its review by reference now, so a misspelling cannot create a second empty
checklist — but a review with no stories still has nothing to serve.

```sql
SELECT m.instance, COUNT(y.id) stories FROM UAT_Meta m
LEFT JOIN UAT_Stories y ON y.instance = m.id GROUP BY m.instance
```

## Every step shows "(optional)" / nothing can fail the review

`required` is unset. Grist's Bool column writes `false` for rows that were never
explicitly touched, so steps default to optional — which means the review can
report success without any step having to pass.

```sql
SELECT id, step_key FROM UAT_Steps WHERE required IS NOT TRUE
```

Set those rows to `required: true` unless a step genuinely is optional.

## The edit doesn't show up for reviewers

The router caches checklist reads briefly and will serve the **last good copy**
if the read service is failing. That resilience can hide a broken edit.

Check the cache status header — `STALE` means you are looking at a frozen copy,
not a live read:

```bash
curl -sSI https://grist.openelis-global.org/uat/<instance>.json | grep -i x-uat-
```

`X-UAT-Cache: HIT` or `MISS` is a live read. `STALE` means the upstream is
failing — fix the underlying error rather than waiting.

## A reviewer says their answers disappeared

Answers are keyed by instance → app build → checklist revision → step key. They
move buckets when the app build under review changes (deliberate — a pass
against different code isn't evidence about this one) and are carried forward
across a checklist edit, with edited steps flagged "Review again".

They are genuinely lost only if a `step_key` was renamed. Don't rename keys once
reviewers have started; reorder instead.

## The route link goes nowhere / is refused

`route` must be a same-origin path beginning with `/`. Full URLs and anything
that resolves to another origin are rejected — including strings that look
relative but escape via a backslash. Use `/Microbiology/worklist`.
