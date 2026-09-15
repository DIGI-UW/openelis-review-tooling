# Add Review to an existing OpenELIS deployment

The accepted target lifecycle and its enable/disable requirements are recorded
in the [UAT tooling remediation and OpenELIS integration
contract](../docs/uat-tooling-remediation-plan.md). This page describes the
operator command and the one-time manual migration for older deployments.

## Enable or disable on a prepared OpenELIS proxy

Install the optional OpenELIS hooks from
[OpenELIS PR #4317](https://github.com/DIGI-UW/OpenELIS-Global-2/pull/4317)
through the site's normal proxy configuration update. The standard proxy mounts
a persistent `REVIEW_CONFIG_DIR` at `/etc/nginx/review:ro`, with these includes:

```nginx
# Inside the OpenELIS HTTPS server:
include /etc/nginx/review/active/server/*.conf;
# Inside its frontend location:
include /etc/nginx/review/active/html/*.conf;
```

Register the instance and publish its Grist checklist using section 1 below.
Then, from a checkout of Review tooling on the application host:

```sh
sudo python3 integration/review-site.py enable \
  --instance lab-one \
  --review-origin https://grist.openelis-global.org \
  --site-origin https://lab-one.example.org
sudo python3 integration/review-site.py status
sudo python3 integration/review-site.py disable
sudo python3 integration/review-site.py enable
sudo python3 integration/review-site.py verify
```

The first enable records the connection settings. Later enable/disable commands
reuse them. The site origin is used for public verification. The default
container is `openelisglobal-proxy`; use `--container` for a custom deployment.
For a proxy shared by several sites, mount a separate persistent directory for
each site, use that directory in its two includes, and pass its container path
with `--mount-path /etc/nginx/review-sites/lab-one`.

The bundled AMR/Analyzers router uses separate persistent directories at
`runtime/review-sites/amr` and `runtime/review-sites/analyzers`, mounted at
`/etc/nginx/review-sites/<instance>`. Its template has the same optional hooks.
Use `--container oe-edge-router --mount-path /etc/nginx/review-sites/amr` (or
`analyzers`) with the command. Neither site has hardcoded injection or an
always-on submission route. Empty configuration disables Review on that site.
When upgrading an existing shared router, stage each site's enabled configuration
before the one-time proxy recreation so its existing Review availability is
preserved. Keep its widget asset mounts for already-open review windows.
The shared-router migration must carry forward its running `AMR_DOMAIN`,
`ANALYZERS_DOMAIN`, `PHRASES_DOMAIN` and `GRIST_DOMAIN` values explicitly; its
Grist runtime environment file alone does not supply all of them. Check the
effective Compose environment before recreation and during rollback.
For centralized submission routing, register the public application origins in
the operator-owned backend map, so stored feedback names the public site.

Use `--build-path none` if the site does not serve deployment identity JSON.
Use `--session-path` for a nonstandard OpenELIS context path. Scope, suggested
reviews and instructions come from Grist and are not copied into these files.

The same command can run over an existing SSH connection without installing a
checkout or authoring credentials on the application host:

```sh
python3 integration/review-site.py enable --ssh lab-host --sudo \
  --instance lab-one \
  --review-origin https://grist.openelis-global.org \
  --site-origin https://lab-one.example.org
```

SSH carries the same two Python files used locally. `--sudo` uses the host's
existing passwordless sudo configuration; it does not prompt for credentials.
Omit it when the SSH account already owns the mounted directory and can use
Docker. No Grist key travels with the bundle.

The command discovers the persistent host directory from the running proxy's
read-only mount. It writes versioned Review files there and switches an `active`
symlink, checks `nginx -t`, and reloads Nginx. It does not change the main Nginx
configuration, recreate containers, or restart OpenELIS services. Invalid
configuration or failed public verification restores the previous files and
reloads the previous valid configuration. Existing releases are retained.

Verification checks the live page for exactly one configured script, the central
widget checksum and instruction revision, and the same-origin submission proxy.
An empty submission with no credentials must receive the service's expected
validation error; it creates no feedback. Disabled verification checks that the
script and submission route are absent. A successful authenticated submission
and Grist readback remain a separate UAT check.

Older manual installations must first remove their old injection and submission
directives when installing the hooks; otherwise enable refuses a duplicate
script. This one-time proxy mount/configuration migration is distinct from the
subsequent reload-only toggle. Public sites already serving the widget are not
automatically migrated by publishing this command.

Local validation uses disposable fixtures, never a live deployment:

```sh
python3 -m unittest discover -s tests -p '*_test.py' -v
python3 tests/review-site-smoke.py
```

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

An operator can make and verify the same narrow edit from this checkout. Always
preview it first:

```bash
./deploy.sh grist set-presentation lab-one \
  --scope site --suggested LAB-S01,LAB-S03 --dry-run
./deploy.sh grist set-presentation lab-one \
  --scope site --suggested LAB-S01,LAB-S03
```

This command changes only the two presentation cells and reads them back after
the write. Checklist wording, evidence revisions and reviewer answers remain
untouched. Passing an explicit empty `--suggested ''` clears the suggestion list.

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
