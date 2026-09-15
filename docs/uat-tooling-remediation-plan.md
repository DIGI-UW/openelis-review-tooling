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

The shared filesystem contract is:

- `REVIEW_CONFIG_DIR` supplies the host directory mounted at
  `/etc/nginx/review:ro`.
- `/etc/nginx/review/active/server/*.conf` supplies the server-level directives.
- `/etc/nginx/review/active/html/*.conf` supplies the frontend directives.
- Review tooling owns versioned directories below that mounted parent and
  switches a relative `active` symlink. Mounting the parent allows changes to
  reach the running proxy without recreating its container.

Installing these extension points on an older site requires a one-time proxy
configuration and mount update. Subsequent Review toggles must use the command
and reload contract below; the initial migration is not proof of that lifecycle.

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

### Reopened acceptance gap: review entry

The September 14 live audit found that the story chooser was still a disclosure
above an automatically selected checklist. Its initial-open test checked that
the disclosure appeared, not that the reviewer saw an overview before any
checkpoint. Reset also reopened the same story. The opening-experience criterion
is therefore **not accepted**, despite the chooser components being deployed.

The current correction takes priority over the installation command:

- Opening Review presents the overview with suggestions, Browse/search and
  progress, including a prominent Continue action for saved unfinished work.
- The overview occupies the guide pane; checkpoint instructions and submission
  controls are shown only after the reviewer chooses or continues a review.
- Returning to all reviews preserves answers and unfinished explanations.
  Reset still requires confirmation, clears only the current story, then returns
  to the overview. Returning to the overview never requires resetting answers.
- Application navigation updates suggested reviews without replacing the chosen
  story. Reload and popout/return preserve whether the reviewer was in the
  overview or a checklist; another application tab keeps its own navigation.
- Saved answers for a story not yet checked against its current instructions
  must not be presented as fresh acceptance.

Branch `codex/review-overview-entry` / review tooling PR #29 is a release
candidate. The initial overview (`e357b06`) was published on Reporting and the
central widget host. Its CI exposed a popout-return race and a compact-panel
test that conflated seeing a story's purpose with focusing its checkpoint.
The follow-up waits for the opener to confirm the selected view before closing,
keeps work available when return fails, and tests checkpoint focus explicitly
without reducing the visibility assertion. A reported application-action
obstruction also adds scroll handling to the existing launcher placement logic.

The follow-up passes 119 browser checks and 218 tooling checks locally; the
previously intermittent return workflow also passes 20 repetitions. Focused
workflow recordings cover first open, draft/resume/reload, reset, navigation,
popout/return (including delayed and unavailable openers), and all three docks.
Screenshots and return-recording frames have been inspected. The launcher
regression uses ordinary clicks on a bottom-page action at narrow and desktop
widths. CI retains evidence with its tested commit. Replacement rollout, CI and
newcomer acceptance must be recorded separately; local checks are not acceptance.

### Verified public checkpoint — September 14

- Widget `2048bc3cfd038e42d0fcb92412d4ce5c79fbc090` is deployed on Reporting,
  AMR and Analyzers and served by the central script used by Testing. Public
  SHA256: `69e9eb0de3e3cd691ca154a6fa1feb434036c836af1c0511bff09ec22b8fdc14`.
  Review-tooling CI run `34918052381` passed. Testing's live overview was inspected.
- The Reporting implementation thread verified four public checks using ordinary
  clicks, including both CSV layouts at 390px and saved-report rerun at desktop
  width. [Published recordings and CSV evidence](https://reporting.catalyst.openelis-global.org/reporting-evidence/20260914-uat-checkpoint-2048/)
  support a manual-UAT checkpoint, not newcomer acceptance or full MVP acceptance.
- Testing now stores `story_scope=all` and suggested stories `TESTING-STARTUP`,
  `TESTING-REVIEW` in Grist. Its overview shows those two suggestions and Browse
  for all 43 published stories. Its old injected scope fallback still awaits
  removal during the installation migration.
- Reporting checklist publication is verified at revision
  `8b87c62931a32705395fc8be2d5c5aef7195eeb0d6b64a615390cb0a2bda0bd4`:
  six stories, 23 checkpoints. Added only `RPT-303` and `RPT-504`; all 21 existing
  checkpoint objects remain unchanged. The readable Referrals checkpoints were
  already published and were preserved. Story PR links now point to 4310, 4309
  and 4315; the mock pin remains `5b2df7e`. Existing authoring revision guards and
  stable row-ID readback were used. No reviewer-result writes were requested.
  These are published instructions, not human-passed tests.

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
   - Local candidate: branch `feat/479-review-proxy-hooks`, based on OpenELIS
     `0dd6a53fd5ade9ee703c79709c1716f6902ec538`. All three isolated proxy tests
     pass against the actual configuration files using `nginx:1.27-alpine`.
     They compare page, asset, API and submission-path responses with a baseline
     without the hooks; check repeated activation/deactivation and invalid
     configuration rejection; and verify unchanged container identities and
     start times. Effective Compose mounts pass for development, the certificate
     override, production and a rendered installer, with default and custom host
     paths. Production and installer proxy tests also pass against shipped image
     digest `sha256:f838da5e60197b2f4ccaa602e4c80c0831fddb3c387ae9e75356cb6ae9746f0c`.
     The affected deployment suite passes 27 tests and the publication suite
     passes 9. The Maven build passes; the
     frontend formatter could not run because this isolated checkout has no
     frontend dependencies (no frontend files are changed). These are local
     checks only. The operator command, public rollout and human acceptance
     remain open. The candidate is committed as
     `43336e730038e82b6f5c6583cc148d50371cf4df` in separate
     [OpenELIS PR #4317](https://github.com/DIGI-UW/OpenELIS-Global-2/pull/4317).
     Its deployment-contract CI passes. The initial backend check failed on
     Markdown formatting in the new guide; the standard `mvn spotless:apply`
     correction passes `mvn spotless:check` and is pushed for fresh CI. The
     earlier scoped formatter invocation matched no file and did not prove
     compliance. These hooks have not been migrated onto public applications.

3. **Review-site lifecycle**
   - Implement enable, disable, status and verify in review tooling.
   - Support local execution and authorized SSH orchestration with the same
     generated artifact.
   - Preserve previous review files and roll back on invalid configuration or a
     failed reload.
   - Implementation started on `codex/review-site-lifecycle` in
     `integration/review-site.py`, reusing `configure.py`. Thirteen renderer and
     transaction checks pass. The actual Nginx/application fixture verifies
     repeated enable/disable and re-enable, live TLS submission proxy probes,
     invalid-configuration and failed-verification rollback, unchanged app/proxy
     container identities, and unchanged application/API/asset responses when
     disabled. The command waits for the old Nginx workers to stop accepting
     connections before claiming the reloaded configuration is ready; this
     corrects an intermittent race found by the fixture. The SSH bundle is
     checked locally. Published commit
     `03a6ba9a5bd3d8c1ca87a748cb420c309c2772a6` is in
     [review-tooling PR #30](https://github.com/DIGI-UW/openelis-review-tooling/pull/30),
     stacked on the overview PR. CI run `34921233028` passes, including the
     lifecycle fixture.

4. **Migration and integrated validation**
   - Migrate Reporting, AMR, Analyzers and Testing without changing their
     application revisions or data.
   - Toggle each site off and on, proving the disabled and enabled contracts.
   - Verify a version-pinned submission and Grist readback on each supported
     deployment type.
   - Reporting's one-time hook migration and SSH disable/enable/verify passed
     on 2026-09-15 at 02:28–02:30 UTC. Application and database container IDs
     and start times were retained, and the application identity file was
     unchanged. The live overview was inspected after reload: four suggestions,
     six available reviews and independent application/review panes. No reviewer
     answers were submitted by these operational checks. Authenticated feedback
     readback and newcomer acceptance remain separate requirements.
   - Reporting's web mounts now use
     `/home/ubuntu/reporting-uat/releases/review-integration-03a6ba9/nginx.conf`
     and its adjacent `review/` directory, plus
     `/home/ubuntu/reporting-uat/runtime/review-integration:/etc/nginx/review:ro`.
     Subsequent application deployments must preserve these mounts. One-time
     web migrations use the existing `runtime/review-deploy.lock`; the lifecycle
     command locks `runtime/review-integration/.review-site.lock`. The Reporting
     implementation thread received these paths and the preservation contract.
   - The public [Reporting integration receipt](https://reporting.catalyst.openelis-global.org/__review/integration.json)
     records widget `2048bc3`, frontend `7cca586`, backend `8005e4c`, checklist
     `8b87c629…`, the exact widget checksum and Nginx/Compose hashes. AMR,
     Analyzers and Testing already serve the updated widget; their optional
     lifecycle migrations were still open at that Reporting checkpoint.
   - Testing's current deployment owns its proxy through `openelis-docker`.
     Its image override is regenerated by `deploy-published-testing.py` on each
     application update. Do not put the persistent Review mount into that
     generated file. Its one-time hook migration must preserve normal
     infrastructure updates; the existing manual widget remains enabled until
     that integration is ready.
   - Testing's owning deployment repository now has the three persistent hook
     directives in [openelis-docker PR #59](https://github.com/DIGI-UW/openelis-docker/pull/59),
     commit `bac87431213c55b3084e66622314ad77a75c57f5`. Default/custom Compose
     mounts and the actual Nginx template pass the existing isolated proxy
     behavior checks against both stock Nginx and Testing's exact shipped proxy
     digest `f838da5e…`. It is mergeable; that repository has no PR check run
     configured. The user has deferred the shared deployment change for team
     review: do not merge or migrate Testing's installation pending that review.
     This optional persistence improvement does not block widget improvements,
     Grist authoring or UAT. Continue through Testing's existing shared-widget
     injection, with no application image changes or second Compose stack.
     Routine widget publication uses that existing integration. Testing's
     lifecycle command remains unavailable until hooks are adopted; manual
     directives still need preservation during infrastructure updates.
   - The shared AMR/Analyzers router candidate replaces both hardcoded Review
     blocks with independent mounted configuration directories. Its actual
     template passes the disposable shared-router fixture: enabling one host
     leaves the other's HTML unchanged, disabling restores the original HTML,
     central TLS submissions retain their site marker, and neither container
     restarts. Thirty repository/router checks pass. Commit
     `65ee5e2f5a477321fdf417b033dcab92d789cac6` passes CI `34922225626`.
   - AMR and Analyzers migrated successfully at 2026-09-15 02:51 UTC, followed by
     live SSH disable/enable/verify for each host while verifying the other stayed
     enabled. Both remain enabled. Widget bytes remain `69e9eb0d…` (source
     `2048bc3`), application target files are unchanged, and application, Grist
     and Dex containers were retained. The shared router source is `65ee5e2`;
     its receipt is retained under
     `/opt/oe-review-tooling/runtime/review-migration-65ee5e2-retry/receipt.json`.
     The operator-owned backend mappings now use the verified public AMR and
     Analyzers origins so centralized submissions identify the public site.
   - **Migration incident:** the first shared-router attempt omitted the existing
     domain environment variables during recreation; its rollback repeated the
     omission. This temporarily stopped the shared public router. Restoring the
     prior source with the original domain values recovered AMR, Analyzers and
     the Grist catalog, verified with HTTP 200 and the expected widget checksum.
     The corrected wrapper validates the effective Compose domain values before
     both deployment and rollback and verifies public recovery. Its subsequent
     migration and independent toggles passed. This was an operator-wrapper
     failure, not a passing deployment; Reporting was unaffected. Initial and
     retry records are retained separately under `runtime/review-migration-*`.
   - Reporting authenticated feedback is verified through the real widget and
     direct Grist readback: submission `34`, answer `119`, demo login `admin`,
     reviewer `Codex integration verification`, host
     `reporting.catalyst.openelis-global.org`, application `7cca586`, checklist
     `8b87c629…`, story `RPT-S06` / revision `ddf821d1447a`, step `RPT-501`.
     The explanation and reviewer name survived reload before submission, and
     the browser displayed its success message. The stored outcome is `blocked`;
     Grist's tally shows `0 pass · 0 fail · 1 couldn't try · 0 n/a`. The note
     explicitly says desktop navigation was not assessed in that narrow browser
     session and labels this as an automated transport check. This proves the
     feedback path and outcome/version attribution, not functional or human
     acceptance. Shared-router and Testing authenticated readback remain open.
   - The native Reporting thread deployed Non-Conformance application/frontend/
     backend `3de726b8d38ba102ac2fa564c95ac59a2a4e02b7`, retaining the Review
     mounts. Its [public recording and actual four-row CSV](https://reporting.catalyst.openelis-global.org/reporting-evidence/20260914-non-conformance-3de726/)
     qualify the synthetic fixture. The subsequent Grist update is verified by
     exact REST readback and public revision
     `b5c5738b94937e62b8fd5d3401f977695032eb429c0271c1ebf16e931a6953ab`:
     six stories and 25 checkpoints. Live keys corrected the earlier handoff:
     availability wording was in `RPT-001` and `RPT-200`; `RPT-101` is the
     shared-save workflow and is unchanged. Added `RPT-202` and
     `RPT-202-PHONE`, corrected the S03 and deployment introductions, and kept
     all existing keys, 21 other checkpoint objects and presentation settings.
     Submission 34 / answer 119 were re-read unchanged with original versions.
   - The updated live widget displays the seven-step Referral/Non-Conformance
     story with labelled instruction lists. A fresh application tab opens the
     overview with four suggestions, In progress and Browse all six reviews.
     The separate in-app application walkthrough reached the nine NC fields
     but stopped at native date entry; do not count it as a completed workflow.
     The native thread's published CSV/recording remains the qualification
     evidence. A screenshot also exposed limited instruction space with a short
     bottom pane; the correction and its evidence are recorded below. None of
     these checks establishes newcomer acceptance.

### Published reading-space correction — September 15 UTC

- Widget source `bbc3d4783bb1d2e5488c2105c61a6cbfeb573946`, included in runtime
  candidate `d0cfd4202a8351dbdda500db35101a628ad24270`, is published. Its SHA256 is
  `6f208c113fee8f22120fbf2bee0d976a8d089903a681d779d08e625ea070989b`.
  Public bytes match on the shared host, AMR and Analyzers. Reporting and Testing
  each inject that shared script exactly once; their installations needed no
  change. The previous router configuration is retained in the runtime candidate.
- Long checkpoints focus their instruction without scrolling past it to an
  answer button. Reviewer name and page-note controls scroll with the checklist;
  Submit remains fixed. The 340px fixture pane previously left 62px for reading;
  the regression now requires at least 140px and passes. At Reporting's saved
  440px panel size, live inspection found 257px of reading space with the first
  instruction visible and focused.
- Eighteen affected browser checks passed in two focused runs, with recorded
  evidence and inspected screenshots. They cover long-step selection/advance,
  short-step focus, instruction lists, reviewer-name validation, draft reload,
  failed-submit recovery, versioned answers, overview/reset, popout and docking.
  JavaScript syntax and whitespace checks passed. CI run `34926572593` is queued
  as of this publication; it is not recorded as passing.
- The router, Grist, Dex and checklist service retained their container IDs and
  start times. Reporting still runs application `3de726b8d38ba102ac2fa564c95ac59a2a4e02b7`;
  its public target now identifies the new widget/runtime and hash. No shared
  deployment PR was merged. Testing's persistent-hook migration remains deferred
  for team review. Newcomer acceptance and remaining authenticated site checks
  are still open.

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
