Testing integrates the hosted Review widget through the optional proxy overlay
in `DIGI-UW/openelis-docker`. Its application remains on the published develop
images; this repository uses `main`.

The central router accepts `/uat/testing/submissions` and forwards the existing
OpenELIS session cookie to the checklist service. The service verifies that
session against `https://testing.openelis-global.org/api/OpenELIS-Global/session`
with normal TLS certificate verification. A configured `REVIEW_BACKENDS`
override must include `testing=https://testing.openelis-global.org` as well as
the existing instances. No Grist authoring key reaches the testing VM or browser.

Deploy the committed change using the existing narrow commands:

```sh
./deploy.sh review deploy --ref <full-commit-sha> --scope all
./deploy.sh review reload-router
```

These update the widget/checklist service and router. Review deployment now
compares the publicly served widget bytes with the clean checkout before
publishing `/__review/tooling.json`. That descriptor carries `harnessSha` and
`widgetSha256`; testing deployment verifies both before enabling its widget.
Existing application target metadata is updated only after the Review checks
pass. Python 3 is required on the Review host for this identity check.

Create the dedicated checklist through Grist REST using the host-side authoring
key. Read `UAT_Meta` first and reuse the row whose instance is `testing`; if
absent, create just that row with title `OpenELIS Testing`, an introduction
explaining these deployment checks, and `published: false`. Do not replace
other instances. Apply the two scoped story files:

```sh
./deploy.sh grist apply-story --file docs/testing-smoke.story.json
./deploy.sh grist apply-story --file docs/testing-review.story.json
```

Read back both stories and their five stable steps. Validate the application
startup story on the restored server, then publish this instance's metadata row.
The Review story is validated after enabling the widget below. Verify `/uat/testing.json` and `/uat/index.json` show both testing
stories restricted to `testing.openelis-global.org`.

Enable Review in testing's deployment and verify the live panel, both story
choices, application and tooling identity, downloaded report, and one clearly
labelled validation submission. JSON availability alone is not sufficient to
declare the integration working. The story files are tested authoring inputs;
Grist remains the source of truth after they are applied.
