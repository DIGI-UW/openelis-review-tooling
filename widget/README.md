# oe-review-widget

A drop-in reviewer **checklist + feedback overlay** for reviewing an in-progress web
app. One framework-free file, no build, no dependencies, no backend required. Runs in
a closed Shadow DOM so it can't collide with the host page's styles or scripts.

Open `index.html` for a live, backend-free demo.

## Embed it

```html
<script src="oe-review-widget.js"
        data-instance="amr"
        data-label="Microbiology MVP"
        data-src="https://example.org/uat-amr.json"></script>
```

- `data-instance` — a slug; namespaces the reviewer's saved answers in `localStorage`.
- `data-label` — human title shown in the panel and the report.
- `data-src` — URL of the checklist JSON (see schema below). **Optional.**

### Where the checklist comes from (priority order)
1. **Inline** (fully backend-free): a `window.OE_REVIEW_CHECKLIST` object, or
   ```html
   <script type="application/json" id="oe-review-checklist"> …checklist… </script>
   ```
2. **`data-src`** URL.
3. Default `"/__review/uat-<instance>.json"` (back-compat with a server that serves it).

## Checklist schema

```json
{
  "title": "Microbiology MVP — review",
  "instance": "amr",
  "jira": "OGC-782",
  "intro": "Optional preamble shown at the top of the panel.",
  "sections": [
    {
      "title": "A section heading",
      "steps": [
        { "do": "The action the reviewer performs.",
          "expect": "What they should see (optional).",
          "route": "/some/path (optional deep-link hint)" }
      ]
    }
  ]
}
```

## What the reviewer gets

Each step can be marked **pass / fail / n-a** with an optional note, plus freeform
page-level notes. **Download review report** produces two files:

- `oe-review-<instance>-<timestamp>.md` — a readable checklist with `[PASS]/[FAIL]/
  [N/A]/[----]` boxes, a summary line, and the freeform notes. Its footer says to
  paste it into Claude to triage into Jira/GitHub.
- `.json` — the same data structured: `{ instance, label, reviewer, summary, checklist:
  [{ section, steps:[{ do, expect, route, mark, note }] }], feedback }`.

## Authoring checklists (optional)

The widget doesn't care how the checklist is produced — any JSON matching the schema
works. In this repo, the `grist/` tooling is one way to author them collaboratively
(humans in a Grist spreadsheet, or agents via Grist's native MCP) and serve them live;
see the repo root README. But the widget stands on its own with a static or inline
checklist.
