# OpenELIS Review Tooling Agent Entry Point

Read [docs/AGENTS.md](docs/AGENTS.md) before changing checklists, review
reports, or deployment behavior. It is the authoritative operating contract for
this repository.

Repository-wide rules:

- Grist `UAT_Meta` and `UAT_Steps` are the checklist source of truth.
- Use Grist's native MCP at `/api/mcp` for agent authoring. The custom `/mcp`
  endpoint is deprecated compatibility only.
- The public `/uat/<instance>.json` surface is anonymous and read-only.
- Validation commands must not contact or mutate the live demo host.
- Persistent data and secrets live outside the Git checkout. See
  [docs/OPERATIONS.md](docs/OPERATIONS.md) before changing bootstrap or sync
  behavior.
- Do not file Jira or GitHub items from a review report unless the user
  explicitly asks; draft the proposed items first.
