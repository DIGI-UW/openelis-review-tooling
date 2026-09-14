# UAT reviewer experience remediation

Accepted scope: September 14, 2026. Audience: nontechnical reviewers unfamiliar
with OpenELIS. Reporting implementation and PR packaging are paused while this
work proceeds. Desktop use is the priority.

## Experience contract

- Open a short chooser with deployment-specific Suggested reviews, prominent
  Continue and Browse/search by title or ticket. Each review has a brief purpose.
- Offer Left, Right, Bottom and Open in separate window. Default to Right when
  both panes fit, otherwise Bottom; preserve the reviewer's choice during use.
- Reserve application space when docking. Bottom uses a vertically resizable
  split view, with the application above and independent scrolling in both panes.
- Show the current checkpoint's action, expected result and response controls.
  Optional help expands separately; resizing never expands all checkpoints.
- Worked as expected saves and advances. A problem or inability to try keeps the
  checkpoint open for an explanation, followed by Continue. Answers stay editable.
- Present a compact submission summary with reviewer name and an optional note;
  partial feedback is allowed and unanswered checks remain visible.
- Preserve story, checkpoint, answers, name, saved notes and note drafts across
  docking, resizing, popout, return, reload and submission failure.

## Implementation contracts

Extend the existing widget and submission flow with a shared placement/state
mechanism and a small OpenELIS layout adapter. Keep the application integration
separate from review-tooling changes. Add existing purpose/instruction identity
to the catalog and an ordered list of suggested story IDs to deployment config.
Suggestions invite review; they do not assert feature completeness. Calendar
recency remains deferred without trustworthy metadata.

Add `blocked` for Couldn't try throughout the real widget, submission handling
and Grist summaries, retaining historical `na` as Not applicable. Preserve earlier
instruction/build evidence without presenting it as current acceptance.

Update the authoring skill to require short purpose, starting conditions,
outcome-sized checkpoints, observable expectations and optional help. Original
`openelis-work` stories/designs and explicitly accepted MVP changes govern UAT.
Correct stale live Reporting instructions, including Referrals availability.
OpenELIS-QA synchronization remains separate work.

## Delivery checklist

### Iteration 1: interaction prototype

- [x] Isolated prototype using the pinned approved Reporting mock.
- [x] Chooser, realistic walkthroughs, outcome flow and partial-feedback summary.
- [x] Left/right docking, resizable bottom split, popout and local state continuity.
- [x] Complete focused automated and rendered validation; record video/screenshots.
- [x] Publish to a versioned public preview and verify identical source bytes.
- [ ] Obtain the user's design acceptance before changing the shared renderer.

Prototype source: `prototypes/uat-review/`. Its demo responses never go to Grist.
An iframe demonstrates the proposed layout only; it is not the production adapter.
Artifact `a35ee6d420b9` passed nine focused browser checks with no retries, skipped
tests or browser exceptions. Its provenance records the exact runtime-source hashes.

[Public prototype](https://grist.openelis-global.org/docs/prototypes/uat-reviewer-experience/iteration-1/a35ee6d420b9/)
and [screenshots/video evidence](https://grist.openelis-global.org/docs/prototypes/uat-reviewer-experience/iteration-1/a35ee6d420b9/evidence/).
Publication verified all manifest files on the host and all 20 requested public
responses against their local hashes. The shared widget checksum was unchanged.

### Iteration 2: working increments

- [ ] Implement accepted chooser and focused checkpoint/feedback behavior.
- [ ] Add the catalog/config and distinct blocked-outcome contracts.
- [ ] Implement the OpenELIS docking adapter and all state transitions.
- [ ] Update authoring guidance and representative walkthroughs alongside the UI.
- [ ] Publish each usable increment to an isolated public candidate; retain the
      last working preview and record exact app/widget/checklist identities.
- [ ] Run affected browser checks and review screenshots/video after each change.

### Iteration 3: integrated UAT

- [ ] Publish accepted widget, host integration and corrected walkthroughs to
      Reporting UAT using the existing backend Grist workflow.
- [ ] Verify actual deployed versions and repeat critical browser workflows.
- [ ] Observe a newcomer choose, perform, explain, resume and submit without
      developer coaching; record confusion and remediate it.
- [ ] Record explicit human acceptance separately from automated evidence.

## Validation and stopping rules

Each working iteration must pass affected tests and rendered review, with no lost
or misattributed answers/drafts, inaccessible application actions, hidden criteria
or misleading submission status. Include long content, normal laptop dimensions,
keyboard resizing, real drawers/dialogs, separate scrolling, popout, failed-send
retry and changed-instruction handling. Videos demonstrate implementation behavior;
they do not establish human acceptance.

Stop the affected path immediately for lost work, misleading status or conflicting
requirements. After two attempts without verified progress or new evidence,
diagnose and ask a focused question. Do not expand into navigation redesign, a
replacement review platform, synchronization infrastructure or a separate
small-screen workflow.
