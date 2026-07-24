# oe-review-widget

A drop-in reviewer **checklist + feedback overlay** for reviewing an in-progress web
app. One framework-free file, no build, no dependencies, no backend required. Runs in
an isolated Shadow DOM so it cannot collide with the host page's styles.

Open `index.html` for a live, backend-free demo.

## Embed it

```html
<script src="oe-review-widget.js"
        data-instance="amr"
        data-label="Microbiology MVP"
        data-src="https://example.org/uat-amr.json"></script>
```

- `data-instance` — a slug used with deployment identity and checklist revision
  to isolate the reviewer's saved answers in `localStorage`.
- `data-label` — human title shown in the panel and the report.
- `data-src` — URL of the checklist JSON (see schema below). **Optional.**
- `data-build-src` — URL of verified deployment metadata. Defaults to
  `/__review/target.json`; the historical attribute name is retained for
  compatibility.

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
  "schemaVersion": 2,
  "checklistRevision": "server-computed-sha256",
  "title": "Microbiology MVP — review",
  "instance": "amr",
  "jira": "OGC-782",
  "intro": "Optional preamble shown at the top of the panel.",
  "sections": [
    {
      "title": "A section heading",
      "steps": [
        { "key": "AMR-001",
          "required": true,
          "do": "The action the reviewer performs.",
          "expect": "What they should see (optional).",
          "route": "/some/path (optional deep-link hint)" }
      ]
    }
  ]
}
```

## What the reviewer gets

Each stable step can be marked **pass / fail / n-a** with an optional note, plus
freeform page-level notes. Reordering keeps the answer; changed instructions mark
the answer stale until it is reviewed again. Answers never carry into a different
deployment, and old position-based state is not reused. **Download review report**
produces:

- `oe-review-<instance>-<timestamp>.md` — a readable checklist with `[PASS]/[FAIL]/
  [N/A]/[----]` boxes, a summary line, and the freeform notes. Its footer says to
  paste it into Claude to triage into Jira/GitHub.
- `.json` — the same data structured, including checklist revision, verified
  deployment provenance, stable key, required flag, marked time, actual URL,
  status, and note.

## Authoring checklists (optional)

The widget doesn't care how the checklist is produced — any JSON matching the schema
works. In this repo, the `grist/` tooling is one way to author them collaboratively
(humans in a Grist spreadsheet, or agents via Grist's native MCP) and serve them live;
see the repo root README. But the widget stands on its own with a static or inline
checklist.
