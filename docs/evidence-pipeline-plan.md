# Evidence video pipeline: plan and status

## Goal

Record narrated, paced evidence videos of OpenELIS workflows from the existing
OpenELIS-Global-2 Playwright tests, package them with one reusable packager in
this repository, and publish them to the demo sites. The first use is the AMR
microbiology workflow on amr.openelis-global.org.

## Ownership

| Repository | Owns |
|---|---|
| openelis-review-tooling (this repo) | The evidence packager, one filing configuration per site, the publishing script and the `/evidence` route |
| OpenELIS-Global-2 | The Playwright stories, their `@evidence` tags and narration, and the `evidence-video` project that records them. No packaging code. |
| code-qa | Unchanged. Its `evidence-bundle` skill has a different scope. |

The OpenELIS tests depend on nothing here. They carry tags that a site's filing
configuration lists.

## Acceptance criteria

1. One packager in this repository turns a Playwright JSON report into one
   H.264 MP4 per story, with still stretches trimmed, filed by the lane and
   stage the site configuration lists, plus an index and a gallery page.
2. The packager stops and lists every story that is untagged, failed, missing
   its video, or tagged with a lane or stage the site does not list.
3. `scripts/publish-evidence.sh` publishes a package as a versioned folder with
   `release.json` and rebuilds the site's evidence index; the `/evidence` route
   is on `main`.
4. OpenELIS-Global-2 has one `evidence-video` project that records every
   `@evidence` story from the core and harness specs, and no packaging script.
   Every reference to `harness-demo-video` and `pw-evidence-videos.mjs` is
   updated or removed in the same PR.
5. Each AMR story listed below carries `@evidence @microbiology @<stage>`, an
   intro, captions for off-screen setup and each screen step, highlights on
   outcomes, and a verified card. Narration changes nothing outside video runs:
   `pw:guard` and the normal project pass.
6. A new story proves the organism-default panel and disk-content zone
   interpretation, seeding its own data through APIs, not SQL.
7. Every published video was reviewed along its full length: cards and
   captions readable, no caption over the wrong screen, a verified outcome at
   the end.
8. The AMR videos are published on amr.openelis-global.org, with the page
   stating they were recorded on a local stack built from the named OpenELIS
   commit.

## Plan

| # | Step | Repository | Status |
|---|---|---|---|
| 1 | Resync the OpenELIS checkout to the restacked #4819, add a head-of-stack branch, start the full local stack | OpenELIS-Global-2 | Done; the local database needed the #4793 secrets upgrade |
| 2 | Packager: report reader, site filing configurations (`amr`, `analyzers`), still trimming, index and gallery, unit tests, one ffmpeg test on a generated clip | review-tooling | Done |
| 3 | Publishing: `/evidence` route and operations doc onto `main`, `scripts/publish-evidence.sh` with `release.json` and index rebuild, tests | review-tooling | Done |
| 4 | Rename `harness-demo-video` to `evidence-video` covering core and harness specs; update all references; delete `pw-evidence-videos.mjs` | OpenELIS-Global-2 | Done; `dev-stack` now names the stack's database container for test seeding |
| 5 | Tag and narrate the AMR stories; add the disk-zone story | OpenELIS-Global-2 | Done; 34 stories narrated, reagent-lots no longer depends on catalog order or the site default standard |
| 6 | `pw:guard`, microbiology specs in the normal project, lint, format, push | OpenELIS-Global-2 | Done; the normal run found a breakpoint list crash after a page change, fixed with a regression test |
| 7 | Record the microbiology lane locally; fix and re-record failures from their traces; package | both | Done; scanning under slowMo and a caption matched by a text assertion only failed on video, both fixed |
| 8 | Review every video along its full length; fix specs and re-record as needed | OpenELIS-Global-2 | Done; captions now precede the navigation they describe, stay off highlights and never call on-screen work off screen, the verified card ends each video, and the gallery names each video by its intro |
| 9 | Publish to amr.openelis-global.org, link from the index, post links on both PRs | review-tooling | Published as `2026-10-26-narrated-amr` from c944bfd289; PR links pending |

## AMR stories by stage

| Stage | Stories |
|---|---|
| Admin | Patient origins listing; vocabulary edit and deactivation; immutable AST panel version; activating a loaded standard; mixed CSV import; reference navigation |
| Case | Case access; initial testing; culture purpose correction; missing clinical context; two laboratory units; two-pass identification with critical communication; NCE and lost specimen |
| Culture | Culture workspace; reagent lots; environmental certificate |
| Isolates | Growth isolate and referral; received isolate mismatch; original-specimen referral |
| AST and reporting | AST reporting with repeat selection; repeat AST; amendment; no-growth release; default panel with disk-zone interpretation (new) |
| Worklist | Incoming result placement; worklist inoculation and label scan; critical worklist reload and focus; critical communication priority; culture, AST and reviewed AST worklist grains |
| Exports | R9 population filters; mapped AST preview and CSV; first-isolate policy; worklist handoff to reports |

Left out: the two narrow-screen layout checks, and the demo specs that repeat a
foundational story or only take mobile screenshots.

## Rejected alternatives

- **Extending `pw-evidence-videos.mjs` in OpenELIS-Global-2.** It hard-codes
  the harness project and lanes; extending it in place would add another
  one-off, and packaging is not the application's concern.
- **Putting the packager in code-qa.** code-qa holds review procedures and
  skills; evidence production for the demo sites belongs with the deployment
  and hosting that already live here.
- **Recording against amr.openelis-global.org.** Recording needs a sign-in the
  agent may not perform on the hosted demo; the local stack runs the same
  commit.
