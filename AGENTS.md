# OpenELIS Review Tooling Agent Entry Point

Read [docs/AGENTS.md](docs/AGENTS.md) before changing checklists, review
reports, or deployment behavior. It is the authoritative operating contract for
this repository.

Repository-wide rules:

- Grist `UAT_Meta` and `UAT_Steps` are the checklist source of truth.
- Agents author through the authenticated Grist REST API. There is no custom
  checklist write service.
- The public `/uat/<instance>.json` surface is anonymous and read-only.
- Validation commands must not contact or mutate the live demo host.
- Persistent data and secrets live outside the Git checkout. Read
  [docs/OPERATIONS.md](docs/OPERATIONS.md) before changing bootstrap or
  deployment behavior.
- Never map a saved review answer by checklist position. Stable `step_key`,
  deployment identity, and checklist revision define the review context.
- Do not file Jira or GitHub items from a report unless the user explicitly
  asks; draft the proposed items first.
