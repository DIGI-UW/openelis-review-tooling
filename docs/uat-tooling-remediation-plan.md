# UAT tooling remediation and OpenELIS integration contract

**Status:** Accepted direction, implementation in progress
**Updated:** 2026-09-14
**Owners:** OpenELIS review tooling for the widget, Grist adapter and integration
bundle; OpenELIS Global 2 for inert proxy extension points only

This is the durable plan for the UAT reviewer experience and its attachment to
OpenELIS sites. It records the decisions that govern implementation, review and
deployment. The live operating contract remains in [AGENTS.md](AGENTS.md); when
this plan is implemented and verified, that file must be updated to describe the
new live state.

## Outcome

A nontechnical reviewer can open an optional guide beside an OpenELIS site,
choose a relevant review, follow one manageable checkpoint at a time, explain a
problem, resume later and submit feedback without developer coaching.

An operator can attach or remove the guide from an existing OpenELIS development
or production site quickly. Enabling or disabling Review must not rebuild,
replace or restart the OpenELIS application, frontend, database or FHIR services.

## Accepted decisions

### Reviewer experience

- Open with deployment-specific **Suggested reviews**, a prominent **Continue**
  action for unfinished work, and Browse/search for all reviews applicable to
  that deployment.
- Suggested reviews and applicable reviews are different concepts. A suggestion
  is a priority for this deployment; it is not evidence that the feature is
  complete.
- Search includes review names and ticket numbers. Page relevance may highlight
  a review but must not hide other applicable reviews.
- “Browse all” means all reviews applicable to this site. UI copy must make that
  scope clear. A site-scoped deployment does not expose an unconditional
  reviewer-controlled global-scope override.
- A general-purpose validation deployment may use the complete published
  catalog. Testing is the current example.
- Desktop is the priority. Offer **Left**, **Right**, **Bottom** and **Open in a
  separate window**. Start on the right when both panes fit; otherwise use the
  resizable bottom split. Remember the reviewer’s chosen placement and size.
- Docking reserves space for OpenELIS. Each pane scrolls independently, and app
  navigation, dialogs, drawers and action buttons remain usable.
- The active checkpoint shows actions, expected outcomes and response controls.
  Several actions or outcomes are stored as ordinary newline-separated text with
  short labels; the widget renders a compact list with bold labels. Grist stores
  no HTML, Markdown or widget-specific rich text.
- **Worked as expected** saves and advances. **There was a problem** and **I
  couldn’t try this** keep the checkpoint active until the reviewer adds an
  explanation and continues. Previous answers remain editable.
- Completion shows answered and unanswered checkpoints, reviewer name, an
  optional overall note and **Submit feedback**. Partial feedback is allowed and
  identified as partial.
- Current story, checkpoint, answers, reviewer name, notes and unfinished note
  drafts survive reload, resizing, docking, popout and return. A failed
  submission keeps all work and reports failure accurately.

### Validation ownership

- Original `openelis-work` user stories and approved designs govern UAT, with
  explicit approved MVP deltas.
- Application-specific automated end-to-end checks and video proof remain in the
  OpenELIS implementation repository and run before merge.
- Grist presents human walkthroughs and records feedback. UAT is useful during
  development and after merge; a public candidate is not held until the MVP is
  complete.
- Eventual synchronization with OpenELIS-QA is separate work and must retain
  stable story, checkpoint and evidence identities.
- Automated checks, a deployed candidate and human acceptance are separate
  claims. None substitutes for another.

### Source of truth and trust boundary

Grist is the source of truth for everything a review coordinator should be able
to edit manually:

- review title, purpose and published state;
- stories, checkpoints, instructions, expected outcomes and order;
- story provenance and application paths;
- whether the deployment shows its own reviews or the complete catalog; and
- the ordered suggested-story selection for that deployment.

The target OpenELIS site supplies only its stable instance identifier and the
minimum connection information needed to reach Review. Scope, suggestions and
review content must not be duplicated in its injected script tag.

The central Review service retains one operator-controlled allowlist mapping an
instance identifier to the trusted OpenELIS origin used to verify the reviewer’s
session. This mapping must not come from Grist or from a request because it is an
authentication trust decision. New sites are allowlisted; there is no blacklist
or caller-selected backend.

Every story belongs to one Grist review instance. Hostname filtering is retained
only for migration compatibility, then removed from normal selection once
legacy stories such as Phrases have their own correct review instance. Do not
add a new many-to-many targeting model for this MVP.

## Target architecture

```text
Grist “UAT Checklists”
  ├─ UAT_Meta: instance, title, publish, site/all scope, suggested story order
  ├─ UAT_Stories: one owning review, provenance and stable story key
  └─ UAT_Steps: actions, expectations, routes and stable step keys
             │
             ▼ anonymous read-only JSON
Central Review service
  ├─ serves catalog/checklists/widget
  ├─ maps allowlisted instance → trusted OpenELIS session origin
  └─ writes version-pinned submissions back to Grist
             ▲ same-origin submission proxy
             │
Optional OpenELIS proxy hook
  ├─ enabled: injects the central widget and exposes one submission route
  └─ disabled: no directive, route, request, DOM or layout effect
```

The widget remains separately deployable and centrally hosted. A widget update
does not require an OpenELIS application deployment. The public checklist
response carries the Grist-owned presentation settings so the widget can build
the right chooser from only the site instance.

## OpenELIS enable/disable contract

OpenELIS development and production proxy configurations gain two empty,
stable include points:

1. a server-level include for the same-origin submission route; and
2. an include inside the frontend location for HTML injection directives.

The corresponding review directory is mounted read-only from a persistent host
directory. An empty directory is the disabled state and must produce the same
effective proxy behavior as an installation without Review.

Review tooling supplies an idempotent site command with these operations:

```text
review-site enable  --instance <slug> --review-origin <https-origin>
review-site disable
review-site status
review-site verify
```

`enable` must:

1. validate the instance and HTTPS origin;
2. generate only review-owned files in a staging directory;
3. verify that the OpenELIS proxy has the supported include points;
4. install the files atomically into the persistent review directory;
5. run `nginx -t` in the active proxy container;
6. reload only Nginx; and
7. verify the widget, checklist and submission route before reporting success.

If validation or verification fails, it restores the previous review-owned files
and reloads the previous valid proxy configuration. It never edits the main
Nginx configuration in place.

`disable` atomically removes the active review directives, validates and reloads
only Nginx. It retains the generated site definition and Grist data so the
operator can re-enable the same review without reauthoring it. Disabled means:

- no widget script is injected;
- no Review submission route exists;
- no network request is made to the Review service;
- no OpenELIS layout or browser state is changed; and
- no OpenELIS service other than Nginx is reloaded.

`status` reports enabled/disabled, instance, central origin, active widget
revision and checklist revision. `verify` checks the rendered public site and
does not infer success from files alone.

The first supported targets are the standard OpenELIS development Compose
deployment and production installer deployment. A custom deployment such as
Reporting may provide explicit proxy container and persistent-path overrides,
but uses the same generated files and lifecycle.

## Low-friction site onboarding

The operator workflow is deliberately split at the trust boundary:

1. In Grist, create or select the site’s `UAT_Meta` row, choose site/all scope,
   order suggested stories and publish when ready.
2. Register `instance=https://site.example.org` once in the central trusted
   backend allowlist and reload only the checklist service.
3. Run `review-site enable --instance <instance> --review-origin
   https://grist.openelis-global.org` on the OpenELIS host, or run the equivalent
   SSH orchestration from an authorized review-tooling checkout.
4. Run `review-site verify`, perform one authenticated submission and confirm in
   Grist that source review, deployment host, application version and instruction
   revision are correct.

No Grist API key is copied to the OpenELIS site. No application image, database
migration, frontend build or alternate checklist store is introduced.

## Evidence semantics

- A saved answer is keyed by stable checkpoint key, story key, deployment
  identity, application version, story version and computed instruction revision.
- Editing an action, expectation, route or required flag creates a new computed
  revision. Older evidence remains visible but is never presented as current
  acceptance.
- “I couldn’t try this” is stored as `blocked`; historical `na` remains “not
  applicable.”
- The submission route records the allowlisted host that authenticated the
  reviewer. Selecting a story never changes the trusted authentication backend.
- Enabling Review or suggesting a story does not claim implementation
  completeness.

## Delivery plan

### Completed reviewer-experience increments

- Chooser with deployment suggestions, Continue, Browse/search and progress.
- Reserved left/right docking, resizable bottom split and popout.
- Focused checkpoint responses, blocked outcome, draft preservation, versioned
  evidence and completion summary.
- Plain-text labelled instruction lists for scannability.
- Grist-backed site/all scope and ordered suggestions in the public catalog,
  with a narrow dry-run/write/readback operator command.
- Public widget revision `7e45214eaf0be66b899807c60e61840f3efe284e`
  deployed to Reporting, AMR and Analyzers; Testing consumes the same exact
  central widget bytes. All four serve SHA-256
  `78d205c43fe95d4b3cc54ebcde0d0acc1ec20415b73053ac7c9d617b45b7eb8e`.
- Reporting now reads `site` scope and ordered suggestions `RPT-S01`, `RPT-S03`,
  `RPT-S04`, `RPT-S06` from Grist. Its injected tag and target identity no
  longer duplicate those values. Checklist revision
  `4bdd608102e5144ea109b5972df480207d2be3d9067552f3d35545cdcb668d4a`
  remained unchanged during the migration.

Human newcomer acceptance remains open.

### Next implementation increments

1. **Remaining Grist ownership cleanup**
   - Move Phrases stories to their correct review instance and remove normal
     dependence on hostname targeting.
   - Remove injected presentation fallbacks after remaining deployments have
     migrated to Grist-owned settings.

2. **Inert OpenELIS extension points**
   - Add empty review includes and a persistent read-only review directory mount
     to current development, production and installer proxy definitions.
   - Prove that disabled effective configuration and page bytes are unchanged.
   - Deliver this as a separate OpenELIS integration PR.

3. **Review-site lifecycle**
   - Implement enable, disable, status and verify in review tooling.
   - Support local execution and authorized SSH orchestration with the same
     generated artifact.
   - Preserve previous review files and roll back on invalid configuration or a
     failed reload.

4. **Migration and integrated validation**
   - Migrate Reporting, AMR, Analyzers and Testing without changing their
     application revisions or data.
   - Toggle each site off and on, proving the disabled and enabled contracts.
   - Verify a version-pinned submission and Grist readback on each supported
     deployment type.

## Required validation

- Unit tests for Grist configuration parsing, invalid story references and
  deterministic ordered suggestions.
- Integration tests proving the generated disabled configuration is inert and
  the enabled configuration has exactly one script and one submission route.
- Proxy tests against development and production fixtures for `nginx -t`, reload,
  failed-install rollback and repeated enable/disable idempotence.
- Browser checks for suggested/Browse scope, readable long instructions, every
  dock, popout/return, application dialogs and independent scrolling.
- State checks across reload and placement changes, including unfinished problem
  notes and a simulated failed submission.
- Public checksum and identity checks for every deployed widget candidate.
- One newcomer cognitive walkthrough: choose, perform, explain, resume and
  submit without developer coaching. Record confusion and fixes separately from
  automated evidence.

Stop the affected path immediately for lost reviewer work, misleading submission
status, an invalid proxy reload, an authentication backend selected by caller
data, or conflicting requirements. After two implementation attempts without
new verified evidence, diagnose and seek focused clarification.

## Out of scope

- A second review platform or checklist database.
- A rich-text authoring model in Grist.
- Automatic production enablement.
- Calendar-derived “recently updated” ordering without a trustworthy timestamp.
- OpenELIS-QA synchronization.
- A separate small-screen experience.
- Navigation redesign or Reporting feature implementation.
