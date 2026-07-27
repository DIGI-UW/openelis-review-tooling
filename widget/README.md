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
  `/__review/target.json`. Deployments that predate the target contract are still
  served at `/__review/build.json`, which the router keeps as an alias for the
  same document — point this attribute there if you need that URL.

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

Every step is listed so the scope of the review is visible, but only the step being
worked spells out its expected result, its route link and its **pass / fail / n-a**
buttons; the rest collapse to a line and a status chip. Answering a step opens the
next unanswered one, and clicking any line goes back to it. Marking never scrolls
the checklist away from where the reviewer is.

Reordering keeps the answer; changed instructions mark the answer stale until it is
reviewed again. Answers never carry into a different deployment, and old
position-based state is not reused.

The panel floats over the application rather than reflowing it — a host app's fixed
header and side nav do not move for an injected margin. It steps aside from fixed
application furniture it would otherwise cover, sits below the host's modals so a
dialog a step asks for can come over the top, and **Move panel** cycles it between
the right, centre and left; a side chosen by hand is remembered and never
overridden. Below 640px the open panel becomes a bottom sheet.

**Expand panel** widens it and opens every step at once, laying the expected result
down the left and the answer on the right so more of the checklist fits. **All / To
do / Failed** narrows the list once there is something to narrow, and each section
heading carries its own count. How the panel is arranged — side, expanded, filter,
and which story was open — is remembered per deployment, so it survives a reload
and a story switch.

## Several stories on one deployment

A deployment usually hosts more than one story. If the checklist URL follows either
`…/uat-<story>.json` or `…/uat/<story>.json`, the widget looks for a catalog beside
it at `uat-index.json` and offers a **Story** picker, grouped into *On this page*
and *Other stories* by matching each story's step routes against the current path.
Point `data-index` somewhere else to override that, and any other `data-src` shape
simply gets no picker. The catalog is optional in the strongest sense: if it is
missing, malformed or unreachable, the checklist still loads.

Each story keeps its own answers, so switching never shows one story's marks
against another's steps. A story that disappears from the catalog between visits
falls back to the one the deployment injects rather than stranding the reviewer.

**Copy report** puts the whole review on the clipboard, which is what the reviewer
is asked to paste into Claude. **Download** writes the same thing as a single
`oe-review-<instance>-<timestamp>.md`:

- a readable checklist with `[PASS]/[FAIL]/[N/A]/[----]` boxes, a summary line, and
  the freeform notes;
- any console errors the page reported, attached to the step that was failed;
- a fenced `json` block carrying the same review structured — checklist revision,
  verified deployment provenance, stable key, required flag, marked time, actual
  URL, status and note.

It is one file on purpose. A second programmatic download from the same click asks
for Chrome's automatic-downloads permission, and a reviewer who dismisses that
prompt silently loses half of their review.

## Authoring checklists (optional)

The widget doesn't care how the checklist is produced — any JSON matching the schema
works. In this repo, the `grist/` tooling is one way to author them collaboratively
(humans in a Grist spreadsheet, or agents via Grist's native MCP) and serve them live;
see the repo root README. But the widget stands on its own with a static or inline
checklist.
