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

Testing is a general server: use the full published Grist catalog rather than
restricting its widget to the `testing` review. The two testing smoke stories can
also be maintained through authenticated REST:

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
  "session_path": "/api/OpenELIS-Global/session",
  "story_scope": "all",
  "build_path": null
}
```

Install the generated HTML directives and submission route into testing's
existing persistent Nginx template, validate, and reload only Nginx. Preserve
these directives on normal application updates. No alternative Compose stack
or infrastructure-repository PR is required.

`build_path: null` disables the optional metadata request because this site's
proxy does not serve the deployment metadata file. It must not request an SPA
fallback as if it were JSON. Point this setting at live verified metadata if a
metadata endpoint is added later.

Open the live Review panel, verify every published catalog story is selectable,
switch between reviews, download the report, and
submit one review labelled `Testing deployment validation`. Verify the stored
testing login, reviewer name, host, source story, and answers. A JSON response alone does not
prove the integration works.
