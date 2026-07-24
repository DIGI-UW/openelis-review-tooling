# Grist UAT Read Adapter

`server.mjs` keeps the reviewer overlay independent of Grist's internal record
shape:

- GET `/uat/<instance>.json` is the public, read-only live checklist endpoint.
- POST `/mcp` is a deprecated compatibility authoring endpoint for older CLI
  clients.
- GET `/healthz` is the container liveness endpoint.

The service holds a Grist API key in a read-only runtime mount. That key is
never returned to widget callers. Router cache policy limits checklist staleness
to about 30 seconds, and there is no publish step.

## Authoritative Authoring Surface

New agent integrations use Grist's native MCP:

```text
https://grist.openelis-global.org/api/mcp
```

See [`../../docs/AGENTS.md`](../../docs/AGENTS.md) for CLI and OAuth connection
instructions. Native MCP and the Grist UI target the same row IDs and are the
supported authoring paths.

## Deprecated Compatibility Surface

The custom `/mcp` tools remain temporarily available:

| Tool | Purpose |
|---|---|
| `uat_list_instances` | List instance metadata |
| `uat_get` | Read one checklist with Grist row IDs |
| `uat_upsert_step` | Create or update one step |
| `uat_delete_step` | Delete one step |
| `uat_set_meta` | Create or update instance metadata |

Compatibility tokens are stored outside Git in
`${GRIST_STATE_DIR}/mcp-tokens.json`. `mcp-token.sh` may manage those tokens for
an existing legacy client, but no new client should be connected to this
surface.

Removal criteria:

1. inventory existing `/mcp` clients;
2. migrate each to native `/api/mcp`;
3. verify the public `/uat` adapter independently;
4. remove the compatibility route, token script, and write tools in one change.
