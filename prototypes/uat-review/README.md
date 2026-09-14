# Review guide interaction prototype

Iteration 1 of the accepted UAT tooling remediation plan. This is an isolated
design preview; it does not import or replace the shared review widget, submit to
Grist, or establish acceptance of OpenELIS reporting behavior.

## Preview

From the repository root:

```sh
npm ci
node prototypes/uat-review/serve.mjs
```

Open http://127.0.0.1:4189. Choose a review, try a checkpoint, record a problem,
and switch between Left, Right, Bottom and Open in separate window. The bottom
divider moves with dragging or Up/Down keys. Home/End set its size limits.

The guide has its own browser storage namespace. Preview tools can simulate a
submission failure and clear only demo answers. Submission remains local and
clearly reports that nothing was sent to Grist.

## Source and design boundaries

- `reporting-reference.html` and `custom-data-export-example.js` are unchanged
  copies of the approved `openelis-work` reference at
  `5b2df7e34ff5ad1f983f24c0e9e0ba4db5e8697f`.
- `stories.json` contains prototype-only walkthroughs for that reference's
  August 2026 examples. Its instruction revisions differ from the live stories.
- `content-map.md` preserves the original live acceptance mapping and identifies
  checks deferred to integrated UAT. The prototype does not validate the live
  reporting implementation or its navigation.
- `provenance.json` records the design, observed deployment and tooling sources.
  Observed deployment revisions are context, not a claim that their code runs
  inside this preview.
- The application is framed only for this isolated prototype. Production docking
  requires the planned OpenELIS layout adapter; this prototype does not establish
  that adapter's correctness.

## Validation

```sh
npx playwright test --config prototypes/uat-review/playwright.config.mjs
```

Tests use the existing Playwright dependency, an isolated fixture server, realistic
content and the actual reference application. Browser exceptions fail the run.
Videos and screenshots are written under `test-results/uat-prototype`; the HTML
report is under `playwright-report/uat-prototype`. Those artifacts demonstrate
prototype behavior, not human acceptance.

## Delivery and acceptance

Publish the static files to a new versioned path under the existing public docs
host. Verify uploaded hashes and the public response; no widget deployment,
router reload or Grist write is needed. Keep the previous working preview.

Design acceptance of this iteration is required before changing the shared
renderer. The next iterations implement the accepted experience in the existing
widget, update the authoring guidance, publish each usable increment and validate
the integrated deployment with a non-expert reviewer. Reporting PR packaging
remains paused.
