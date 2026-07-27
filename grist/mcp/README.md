# Grist UAT public read service

`server.mjs` is a deliberately small, read-only transformer:

- `GET /uat/<instance>.json` reads the Grist `UAT_Meta` and `UAT_Steps` rows.
- It validates stable step keys, ordering, required flags, and same-origin routes.
- It emits schema-v2 widget JSON with a deterministic `checklistRevision`.
- `GET /uat/index.json` is the catalog of stories on the deployment: every
  instance that has steps, with its title, Jira key, step and required counts,
  and the paths its steps point at. The widget uses it for the story switcher and
  to work out which stories are about the page the reviewer is on. It rides the
  same path shape as a checklist so no deployment needs a new proxy rule — which
  means **an instance slugged `index` is unreachable**, because the catalog wins
  that route. A route the service will not accept is left out of the story's
  `routes` and reported in `warnings` rather than failing the catalog: it spans
  every story, and one malformed row in somebody's draft must not take down the
  endpoint `deploy.sh review deploy --scope service` is gated on. The checklist
  document still refuses that route outright, which is where a reviewer would
  actually be sent.
- `GET /healthz` provides liveness.

## What is public

Checklists are served to anonymous callers — the widget has to load for a reviewer
who is not signed in — so a slug is not a secret.

The catalog is what makes slugs discoverable without one, so it lists only stories
whose `UAT_Meta.published` is ticked. A new row is unlisted until someone says
otherwise, and unlisted stories are omitted silently: naming them would put the
slug and title of unreleased work into the very document the flag exists to keep
them out of. Publish one with:

```
./grist/bootstrap.sh publish <instance>         # and --unlist to take it back
```

The router caches checklist reads for 30s, so give it that long before deciding a
publish did not take; `X-UAT-Cache` on the response says whether you are looking
at a cached copy.

Note the boundary: this governs **discovery, not access**. Anyone who knows or
guesses a slug can still read that checklist directly at `/uat/<slug>.json`, as
they always could. Treat unlisted as "not advertised", not as "protected", and
keep genuinely sensitive material out of the document.

This service has no authoring endpoint and no caller tokens. Humans author in the
Grist UI; agents author through Grist's native MCP endpoint:

`https://grist.openelis-global.org/api/mcp`

The Grist API key mounted into this service is server-side read access used only
to transform the document for the anonymous review overlay.
