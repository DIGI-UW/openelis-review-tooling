# Add Review to an existing OpenELIS deployment

The accepted target lifecycle and its enable/disable requirements are recorded
in the [UAT tooling remediation and OpenELIS integration
contract](../docs/uat-tooling-remediation-plan.md). This page describes the
currently deployed manual integration until that lifecycle is implemented and
verified.

The widget runs on an existing site. It needs no OpenELIS rebuild, replacement
Compose stack, or dependency on an infrastructure repository.

Each site has an instance slug and a configured OpenELIS session backend. It can
show its own Grist checklist or the full published catalog. After the generic central route is installed once, adding a site
requires configuration and Grist data only.

## 1. Register the site and author its checklist

On the central Review host, append the site to `REVIEW_EXTRA_BACKENDS` in its
untracked runtime `.env`, preserving existing entries:

```dotenv
REVIEW_EXTRA_BACKENDS=lab-one=https://lab-one.example.org,clinic_42=https://clinic.example.org
```

The existing `REVIEW_BACKENDS` override and bundled instance mappings remain
effective. Use each site's public HTTPS origin; the service verifies its TLS
certificate and checks the forwarded session against that site's
`/api/OpenELIS-Global/session`. A request cannot choose its own authentication
backend. Each separate deployment needs its own slug.

Recreate only the checklist service to load the changed configuration. From an
operator shell **on the Review host**, with the existing runtime environment:

```bash
sudo env REMOTE_USER=ubuntu GRIST_DOMAIN=grist.openelis-global.org \
  ENV_FILE=/path/to/review-runtime/.env \
  bash scripts/rebuild-checklist-service.sh
```

This retains the running service's Compose project and files and reads the named
environment file. It leaves Grist, Dex, and application containers running.

For a site-specific checklist, create/reuse the site's `UAT_Meta` row and its stories/steps through Grist's UI
or authenticated REST API. Follow [the authoring instructions](../docs/AGENTS.md).
Keep stable story/step keys. The authoring key stays on the central host.
Grist edits do not require a merge or code deployment. Verify
`https://grist.openelis-global.org/uat/<instance>.json`, then publish the
metadata row when the walkthrough is ready for discovery in the catalog.

Set `story_scope` and `suggested_stories` on the site's published `UAT_Meta` row
in Grist. The widget reads those values from the public catalog. `all` lists
every published story regardless of its review, host, or page filters; `site`
keeps the review and host filtering behavior. Suggestions are ordered, one stable
story id per line. No duplicate stories are needed.

The same fields in the target-side JSON remain a migration fallback for a site
whose Grist row has not been configured yet. Once Grist has either field, Grist
wins and later presentation changes need no proxy reload.
Submissions still authenticate against the current site's configured session
backend; `reviewInstance` identifies the source checklist and its story/step
references. Grist records the source review and the actual testing host.

## 2. Generate the target-side layer

Check out this repository anywhere on the application server:

```bash
cp integration/site.example.json /tmp/review-site.json
# Set instance, label, review_origin, and the site's session_path in this file.
python3 integration/configure.py /tmp/review-site.json --output /tmp/review-layer
```

The generator writes files only to the output directory. It does not change the
web server, start containers, contact Grist, or handle credentials.

| File          | Where to use it                                                         |
| ------------- | ----------------------------------------------------------------------- |
| `html.conf`   | Inside the existing Nginx location that proxies OpenELIS HTML           |
| `routes.conf` | Inside that site's existing HTTPS server block                          |
| `embed.html`  | Alternative script tag for a server where you control the HTML template |

For an Nginx installation, copy the generated files to a persistent directory
visible to Nginx and add these two includes to the existing configuration:

```nginx
server {
    # Keep the existing listeners, certificates and application routes.
    include /etc/nginx/review/routes.conf;
    location / {
        # Keep this location's existing proxy_pass and headers.
        include /etc/nginx/review/html.conf;
    }
}
```

These are insertion points, not a replacement server configuration. For a
containerized proxy, use its existing configuration mount or mount the generated
directory read-only. Pasting the generated directives into an already mounted
configuration is also supported and needs no Compose change. Nginx needs its
standard HTTP substitution module and the CA bundle at the configured
`ca_bundle` path (default `/etc/ssl/certs/ca-certificates.crt`).

Validate the effective configuration with `nginx -t`, then reload Nginx. If the
container renders a template at startup, render that template before validating
and reloading. Editing the template alone does not update the running proxy.

The submission route is under the application's session-cookie path. It forwards
the cookie over verified TLS to `/uat/<instance>/submissions` on Review; a direct
browser POST to the central hostname would not carry the OpenELIS session cookie.
The central service attributes the review to the configured site's verified
login and host. Unknown sites and unauthenticated sessions are rejected.

If you supply `build_path`, point it at the site's existing live, verified JSON
deployment metadata. The default is `/__review/target.json`. When no such
metadata is served, set `"build_path": null` to disable the optional request.
Unavailable or malformed metadata also leaves checklists and saved answers usable; do not insert
a static commit that becomes false on the next application deployment.

For Apache or another web server, use `embed.html` and configure the equivalent
fixed same-origin POST proxy. The server-side requirements are the same.

## 3. Verify and retain the installation

- Open the actual site, open Review, and select each intended story.
- Mark a step and export a report; check the instance, story, mark, and note.
- Sign into that OpenELIS site, submit one labelled validation review, and verify
  its login, reviewer name, instance, host, and answers in Grist.
- Check that other registered sites still submit with their own sessions.
- Recreate/redeploy the application through its normal process and confirm the
  widget and submission route remain present.

Keep the two includes/directive blocks in the deployment's persistent web-server
configuration and retain any required mounts. Changing an ephemeral container
file alone will not survive recreation. An updater that replaces the entire
web-server configuration must retain these insertion points. The application
image and CI do not need to know about Review.

See [testing's installation](../docs/testing-review.md) for a concrete example.

## One-time central upgrade

When installing this version of Review for the first time, deploy the service
code and generic router route together. From an authorized operator checkout:

```bash
./deploy.sh review deploy --ref <full-review-commit> --scope service
./deploy.sh review reload-router --instance lab-one --external
```

The external probe targets the central hostname and accepts arbitrary slugs.
Subsequent sites use the existing route: update runtime configuration, reload
the checklist service, and author Grist data. No router code change is needed.
