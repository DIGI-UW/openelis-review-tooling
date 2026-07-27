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

Everything in the Grist document is served to anonymous callers, and the catalog
lists it without being asked for a slug. There is no draft state: a row is public
from the moment it is written.

This service has no authoring endpoint and no caller tokens. Humans author in the
Grist UI; agents author through Grist's native MCP endpoint:

`https://grist.openelis-global.org/api/mcp`

The Grist API key mounted into this service is server-side read access used only
to transform the document for the anonymous review overlay.
