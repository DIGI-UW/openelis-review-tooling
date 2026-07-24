# OpenELIS Review Tooling

A home for the tooling behind the OpenELIS UAT review loop — a standalone reviewer
widget, a Grist-backed authoring layer (with native MCP), and the demo deployment
that ties them together. It **targets** OpenELIS-Global-2 demo builds but is not part
of that repo, so it can iterate on its own.

## The loop, in three lines
- **Author** — humans edit checklists in a Grist spreadsheet, or agents author them
  over Grist's native MCP. See [`docs/AGENTS.md`](docs/AGENTS.md).
- **Review** — a lightweight overlay on each demo site loads the checklist and
  captures pass / fail / n-a + notes.
- **Feedback** — the reviewer downloads a Markdown + JSON report and pastes it into
  Claude, which triages it into Jira/GitHub items.

## Add it to a deployment you already have

Two URLs, no build, no redeploy — a script tag or one nginx line:

```html
<script src="https://grist.openelis-global.org/oe-review-widget.js"
        data-instance="my-feature"
        data-label="My Feature (OGC-1234)"
        data-src="https://grist.openelis-global.org/uat/my-feature.json"></script>
```

→ **[Integration options](integration/README.md)** (script tag · nginx snippet · bookmarklet)
→ **[Tutorial: set up a review for a branch, PR, or ticket](docs/TUTORIAL.md)** · [interactive version](docs/tutorial.html)

## What's here

| Path | What it is |
|---|---|
| [`widget/`](widget/) | The reviewer overlay as a **standalone, backend-free drop-in plugin**. Grab-and-go — no OE2, no build, no server needed. |
| [`integration/`](integration/) | Copy-paste ways to attach the overlay to an **existing** deployment (config, not code). |
| `grist/` | The authoring backend: Grist as source of truth + native MCP, plus the slim read-only `/uat` transformer. |
| `router/`, `amr/`, `analyzers/`, `scripts/`, `deploy.sh` | The demo deployment: an umbrella nginx router splitting subdomains, additive Compose overlays on the OE2 app builds, and Let's Encrypt certs. |
| `docs/` | [`AGENTS.md`](docs/AGENTS.md) (context for agents) and `overview.html` (a collaborator overview page). |

**Just want the widget?** It stands entirely on its own — see
[`widget/README.md`](widget/README.md). The rest is optional backend + demo infra.

## Demo deployment

Two isolated OpenELIS stacks on one host, split by subdomain through one umbrella
reverse proxy, each with its own Let's Encrypt cert, plus the Grist authoring stack.

| Subdomain | Stack |
|---|---|
| `amr.openelis-global.org` | Microbiology MVP (OGC-782) + review overlay |
| `analyzers.openelis-global.org` | Analyzer Types & Mapping + harness (OGC-1054) + review overlay |
| `grist.openelis-global.org` | Grist authoring (native MCP at `/api/mcp`) |

The two OpenELIS stacks bind **no host ports** — the router reaches them only by
Docker-network alias. Isolation is by Compose **project name** (`-p`), explicit
**`container_name`** overrides, **remapped subnets**, and **per-instance image tags**.

```bash
cp .env.example .env      # fill in your host, domains, email, repos/branches
./deploy.sh configure     # install Docker/git + the cert-renew cron (idempotent)
./deploy.sh deploy --yes  # build + bring up the router + both OE2 stacks (self-signed, ~20-40 min)
# → point DNS: amr, analyzers, grist A-records → the host EIP (all share one IP)
./deploy.sh certs         # issue Let's Encrypt once DNS resolves
./deploy.sh seed          # seed reviewable demo data on both instances
./deploy.sh status        # instance + HTTPS codes + container states
```

`configure` + `deploy` need no DNS (stacks come up on self-signed, verifiable via
Host-header curl); only `certs` needs DNS (ACME HTTP-01). Commands run over **SSM**
(`aws ssm send-command`), not SSH — no inbound SSH rule required, only a live `aws`
session. `./deploy.sh connect` is the one SSH command (interactive shell), and adds
your current IP to the security group automatically.

Config lives in `.env` (copy from `.env.example`), which is **git-ignored** — real
host values and all secrets stay out of the repo (this repo is public).

### Repos it orchestrates
`deploy.sh` clones **this** repo (`HARNESS_REPO`) for the orchestration and the OE2
app repo (`APP_REPO`) for the stacks it builds — two separate checkouts on the host.
Each app exposes `/__review/build.json`; downloaded reports pair that build
provenance with the live checklist revision.

### Seed data
Fresh instances come up with zero demo data. `./deploy.sh seed`:
- **analyzers** — the harness's own `seed-analyzers.sh`: a 9-analyzer fleet
  (ASTM + HL7/MLLP + FILE) with mock networks wired to the bridge.
- **amr** — `scripts/seed-microbiology.sh`: a bacteriology case + a sibling TB case
  sharing one specimen, plus AST reference data, left at `stage=RECEIVED` so a
  reviewer drives the isolate/AST steps.

> **Known product gap:** on the OGC-782 branch, `/MicrobiologyWorklist` and the case
> view are real, working, but **unlinked** routes (no sidenav entry). `seed` prints
> the direct URL — reviewers need it.

> The demo admin login is the standard OpenELIS default (`admin` / `adminADMIN!`) —
> a well-known demo credential, not a secret.

## Deployment gotchas (learned the hard way)
- **Overlay loads last** — each `docker-compose.override.yml` must be the final `-f`,
  or a base file re-clobbers the `ports`/`container_name` overrides.
- **Subnet remap is mandatory** — two projects can't both create the same
  `172.20.x` network.
- **Renaming harness containers** requires updating `astm-simulator`'s
  `BRIDGE_CONTAINER_NAME` / `MOCK_CONTAINER_NAME`.
- **Two separate LE certs**, not one multi-SAN — renewals/failures stay decoupled.
- **Enterprise Grist** is activated by `/persist/config.json`
  (`{"version":"1","edition":"enterprise"}`); delete it to revert to community.

## License
MIT — see [LICENSE](LICENSE).
