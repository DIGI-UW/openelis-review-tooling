# User-story UAT and implementation E2E

This is the cross-project validation contract agreed on September 14, 2026.
The original user stories and design define the intended experience. Working
implementation, automated proof and human acceptance are separate evidence.

## Ownership

| Location | Owns | Relationship |
| --- | --- | --- |
| [openelis-work](https://github.com/DIGI-UW/openelis-work) | Original user stories, functional expectations and approved designs | UAT starts here, with the source revision and story/requirement identifiers. |
| [OpenELIS-Global-2](https://github.com/DIGI-UW/OpenELIS-Global-2) | Scoped implementation specifications, code, implementation-specific automated E2E and video proof | Tests prove the actual implementation against the original stories and explicit scope decisions. |
| Grist and this review tooling | Live story-based UAT walkthroughs and reviewer feedback | Present the original user intent on a deployed build. Do not derive acceptance solely from what the code or automated tests already do. |
| [OpenELIS-QA](https://github.com/DIGI-UW/OpenELIS-QA) | Cross-feature acceptance/regression coverage and QA findings | Eventually synchronize story coverage and findings with Grist using stable identifiers and source revisions. This synchronization is not implemented by this policy. |

Grist is authoritative for the **live checklist and submitted review records**;
it does not replace the original stories as product authority. Implementation
specifications scope which parts are connected in an increment. They do not
authorize changing the design or silently redefining a story to fit the code.
Explicit user-approved changes take precedence and must be recorded as deltas
from the source. Unresolved conflicts remain visible.

## One story, complementary evidence

Keep the original story/requirement identity throughout. Grist's `story_key` and
`step_key` are stable walkthrough identifiers; they are not substitutes for the
upstream story IDs. Several walkthroughs or automated cases may map to one
original story. Each scoped criterion needs a visible disposition: implemented
and verified, pending human review, failed, or explicitly deferred.

The implementation E2E suite owns exact assertions: values and record identities,
ordering, errors, state/routing, persistence and integration. Its video proof
shows the real application completing the affected workflow on the tested build.
Use existing Playwright planning, auditing and recording conventions. Keep
assertions in recorded flows; a video of clicks alone does not prove correctness.
Do not record every unit case or duplicate the whole suite to produce videos.

UAT asks whether the original user can achieve the intended outcome and whether
the experience matches the approved design. Preserve functional expectations,
including the meaning of downloaded output; UAT is not limited to visual polish.
Make the human journey concise. Link detailed automated evidence rather than
asking every reviewer to reproduce every edge case or count a large workload.

Video proof and passing E2E establish implementation evidence. Neither is a human
acceptance decision. Do not submit automated results as a human review or change
a person's answers. If an agent performs a review, identify it as such.

## Iteration cycle

1. Identify the changed original stories/criteria, mock states and approved scope
   deltas before implementation. Map the affected tests and UAT journey to them.
2. Run affected unit/component/database tests and implementation E2E before
   merge. Capture or refresh video proof for the changed complete workflow;
   record the application and test revisions and inspect the output.
3. Publish each usable stage, including PR previews before merge. On that exact
   deployment, run a small selection of the existing E2E tests plus the changed
   critical workflow. Record deployment/configuration identity before and after.
4. Use Grist to review the original stories against the deployed increment,
   primarily for integrated/post-merge acceptance while permitting earlier
   feedback. Update walkthroughs when the story, scope or journey changes;
   a new commit alone does not require rewriting or repeating all UAT steps.
5. Link feedback to a concrete fix or scope decision. Re-run affected automated
   checks and video proof, deploy the fix and request the affected review again.

Run workload, restart, worker-isolation and migration qualification when related
behavior/configuration changes and at the applicable release checkpoint. Keep
these out of the routine human checklist. A selected smoke run is not full
regression; a skipped required check remains open. Stop and reassess after two
attempts without verified progress or new evidence. Pause affected work when an
unresolved product decision changes expected behavior.

## Future Grist / OpenELIS-QA synchronization

Start with an explicit crosswalk and evidence links, using existing fields.
Retain the source repository/path/revision, original story and criterion IDs,
approved scope delta, Grist story/step keys, QA case IDs, implementation test/video
links and the build/checklist identity of each result. Record absent mappings as
pending; do not invent equivalence between similarly named tests.

Definitions and review outcomes have different ownership. Preserve stable keys
and prior submissions when reconciling definitions. A changed requirement needs
review; it must not silently carry forward a previous Pass. QA findings should
link to their existing issue and resolution rather than create a second tracker.
Resolve the exact synchronization format/direction in that integration's scope;
do not introduce a service, schema change or copy of the test suite now.

## Reporting example and inspected references

The pinned [Custom Data Export & My Report Queue specification](https://github.com/DIGI-UW/openelis-work/blob/5b2df7e34ff5ad1f983f24c0e9e0ba4db5e8697f/designs/reports/custom-data-export.md)
identifies OGC-479 (builder), OGC-481 (queue) and OGC-483 (saved configurations).
Its [companion mock](https://github.com/DIGI-UW/openelis-work/blob/5b2df7e34ff5ad1f983f24c0e9e0ba4db5e8697f/designs/reports/custom-data-export.html)
defines the approved interface. The implementation's RPT walkthroughs map back
to those stories plus explicitly approved MVP decisions such as shared reports,
both layouts and preservation of every repeated result. Navigation additions
need their own source mapping; do not assign them an invented original story ID.

The QA repository already describes [specification-to-deployment comparison](https://github.com/DIGI-UW/OpenELIS-QA/blob/28aa76b3f38eff149ee29c2a76c1a3d7cbdebd31/references/spec-delta-run.md)
and [in-app review](https://github.com/DIGI-UW/OpenELIS-QA/blob/28aa76b3f38eff149ee29c2a76c1a3d7cbdebd31/references/in-app-review-widget.md).
Its existing `tests/data-export.spec.ts` covers legacy exports and is not proof
of coverage for the configurable reporting MVP. These are inspected references,
not a claim that the repositories already synchronize.
