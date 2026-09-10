# Review on testing

Testing uses the same [installation procedure](../integration/README.md) as any
existing OpenELIS server. Its application stays on the current deployment.

On the central Review host, append this entry to the runtime
`REVIEW_EXTRA_BACKENDS` list:

```text
testing=https://testing.openelis-global.org
```

Reload only the checklist service using its existing Compose project and the
runtime `.env`. The generic `/uat/<instance>/submissions` route is installed
once and requires no testing-specific source change.

Read Grist's current rows, reuse or create the `testing` metadata row, and
apply the two scoped stories through authenticated REST:

```bash
./deploy.sh grist apply-story --file docs/testing-smoke.story.json
./deploy.sh grist apply-story --file docs/testing-review.story.json
```

These files are authoring inputs. Grist remains the live source of truth, and
neither a merge nor a code deployment is required to author the checklist.
Read back both stories and their five stable steps. Verify the public checklist
and catalog, dry-run the instructions, then publish the testing metadata row.

On testing, generate the layer from:

```json
{
  "instance": "testing",
  "label": "OpenELIS Testing",
  "review_origin": "https://grist.openelis-global.org",
  "session_path": "/api/OpenELIS-Global/session"
}
```

Install the generated HTML directives and submission route into testing's
existing persistent Nginx template, validate, and reload only Nginx. Preserve
these directives on normal application updates. No alternative Compose stack
or infrastructure-repository PR is required.

Open the live Review panel, select both stories, download the report, and
submit one review labelled `Testing deployment validation`. Verify the stored
testing login, reviewer name, host, and answers. A JSON response alone does not
prove the integration works.
