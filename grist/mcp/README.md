# Grist UAT public read service

`server.mjs` is a deliberately small, read-only transformer:

- `GET /uat/<instance>.json` reads the Grist `UAT_Meta` and `UAT_Steps` rows.
- It validates stable step keys, ordering, required flags, and same-origin routes.
- It emits schema-v2 widget JSON with a deterministic `checklistRevision`.
- `GET /healthz` provides liveness.

This service has no authoring endpoint and no caller tokens. Humans author in the
Grist UI; agents author through Grist's native MCP endpoint:

`https://grist.openelis-global.org/api/mcp`

The Grist API key mounted into this service is server-side read access used only
to transform the document for the anonymous review overlay.
