# oe-review-widget

A drop-in reviewer **checklist + feedback overlay** for reviewing an in-progress web
app. One framework-free file, no build, no dependencies, no backend required. Runs in
an isolated Shadow DOM so it cannot collide with the host page's styles.

Open `index.html` for a live, backend-free demo.

## Embed it

```html
<script
  src="oe-review-widget.js"
  data-instance="amr"
  data-label="Microbiology MVP"
  data-src="https://example.org/uat-amr.json"
></script>
```

- `data-instance` — a slug used with deployment identity and checklist revision
  to isolate the reviewer's saved answers in `localStorage`.
- `data-label` — human title shown in the panel and the report.
- `data-src` — URL of the checklist JSON (see schema below). **Optional.**
- `data-build-src` — URL of verified deployment metadata. Defaults to
  `/__review/target.json`. Deployments that predate the target contract are still
  served at `/__review/build.json`, which the router keeps as an alias for the
  same document — point this attribute there if you need that URL.
- `data-identity-src` — URL of the application's session endpoint. Defaults to
  `/api/OpenELIS-Global/session`. Absent is fine: the reviewer types their name
  as they always did.
- `data-submit-src` — where a finished review is handed in. Defaults to
  `/__review/uat-<instance>/submissions`.

## Who the reviewer is

If the application has a session endpoint, whoever is signed in there is the
reviewer: the panel says "Reviewing as …" and the "Your name" box goes away,
because a name nobody typed is the only kind worth attributing a review to.

Somebody who is not signed in is asked to, and otherwise left alone — the prompt
is about submitting, not about reviewing, and their answers count either way.
Answers are keyed by the build under review, never by who is signed in, so
signing in half way through never orphans the work done before it.

Where the application cannot supply a signed-in identity, **Your name** is
required before the reviewer can copy, download, or submit the report. Steps can
still be worked first; the widget focuses the missing field and keeps every answer
in place when the reviewer tries to hand off an unnamed report.

## Handing a review in

**Submit review** posts what was answered to `data-submit-src`. The service
verifies the reviewer's session itself and records the identity it gets back,
ignoring anything the submission claims about its author; the timestamp is the
server's for the same reason.

Each answer is pinned to the story's version and content revision **as they were
served**, so a review still says what it was answered against after the story
moves on. Only answered steps are sent: an untouched step is not a "not yet" to
record.

The endpoint must be same-origin, because the session cookie belongs to the
application's host — a submission from anywhere else arrives without the one
credential being checked. A deployment that serves no such endpoint answers 501,
and the panel says so and points at the downloadable report instead. Nothing is
ever cleared by submitting, failed or not.

## Open, close or hide it from the URL

Add `?oe-review=` to any page the widget is on:

| Value                           | Effect                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `open` (or a bare `?oe-review`) | The panel is open when the page loads — this is how you hand someone a link that lands them straight in the review. |
| `closed`                        | Mounted but collapsed to its launcher.                                                                              |
| `off`                           | Not mounted at all, for a clean screenshot or a demo.                                                               |

The parameter is **consumed**: it is applied once and then removed from the address
bar, so it cannot keep reopening a panel the reviewer has closed, and it does not
end up in the page URLs the report records as evidence. `off` persists across
navigation — otherwise the checklist's own "Go to …" links would undo it on the
next page — so `?oe-review=on` is the way back, and the widget logs that reminder
when it stands down.

### Where the checklist comes from (priority order)

1. **Inline** (fully backend-free): a `window.OE_REVIEW_CHECKLIST` object, or
   ```html
   <script type="application/json" id="oe-review-checklist">
     …checklist…
   </script>
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
      "title": "A story heading",
      "key": "AMR-S01",
      "links": {
        "jira": "OGC-782",
        "pr": "https://github.com/…/pull/3195",
        "mock": "https://figma…",
        "userStory": "As a … I want …"
      },
      "hosts": ["amr.openelis-global.org"],
      "steps": [
        {
          "key": "AMR-001",
          "required": true,
          "do": "The action the reviewer performs.",
          "expect": "What they should see (optional).",
          "route": "/some/path (optional deep-link hint)"
        }
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

### Popping it out

**Pop out** moves the review into a window of its own, so it sits beside the
application — on a second monitor, say — instead of over it, and nothing the
application paints can reach it. ⌘/Ctrl-click opens a tab instead of a window.

The popped-out panel is a second view of one review rather than a copy of it. Both
windows share the reviewer's saved answers, so a mark made in either shows up in the
other straight away; the page keeps its launcher, which turns dark and raises the
review window rather than opening a second panel. Because the application is in the
window the panel came from, that is where a step's **Go to …** link navigates, and
that page — wherever the reviewer has since got to — is what a mark records as
evidence. **Return the checklist to the page** hands it back and closes the window.

Pop-out needs the widget to have been loaded from a URL; a copy pasted inline has no
address to give the second window, and simply offers no button. A browser that
blocks the window says so in the panel rather than doing nothing.

## Several stories on one deployment

A deployment review usually contains several independently reviewable stories.
The schema-v2 catalog names each real story and its parent review instance. The
widget limits the story checklist to the instance injected on that deployment,
then renders only the selected story from the instance's aggregate checklist.
By default, the checklist offers only stories whose step routes match the current
path. **Show all server stories** deliberately expands that set; when no story has
a route for the page, all server stories are shown automatically and the widget
says why. A route change resets the default, while an explicit story choice
survives refresh on the same page.

The story control is an in-panel disclosure and listbox rather than a native
select. It shows each story's saved progress, supports arrow-key navigation, and
keeps Escape local to the disclosure instead of minimizing the whole review.
This keeps a milestone or project from appearing as one giant story while
preserving one Grist source and one checklist endpoint.

The older schema-v1 catalog remains supported: its entries identify separate
checklist endpoints using either `…/uat-<instance>.json` or
`…/uat/<instance>.json`. Point `data-index` somewhere else to override discovery.
The catalog is optional in the strongest sense: if it is missing, malformed or
unreachable, the injected checklist still loads.

Each story keeps its own answers, so switching never shows one story's marks
against another's steps. A schema-v2 story switch reuses the parent checklist
document but filters by stable story key; sharing a checklist revision must never
leave the previous story's rows mounted. A story that disappears from the catalog
between visits falls back to a current story from the injected review.

Story prose is presented as a labeled, full-size description above the steps. It
is not squeezed into the link metadata or pinned with the section heading, so it
remains readable and scrolls away naturally when work begins.

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
