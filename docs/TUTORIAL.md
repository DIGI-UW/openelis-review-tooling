# Tutorial — set up a review for a branch, PR, or ticket

End to end: write a checklist, put it in front of reviewers, collect feedback, turn
it into issues. The worked example is the real `amr` review (Microbiology MVP,
OGC-782) running on this project's demo box.

**The order matters.** Author the checklist *first* — a reviewer who lands on an
empty overlay has nothing to do. Deploy second.

---

## Step 1 — Author the checklist (prerequisite)

Checklists live in one central Grist document; each review is a set of rows keyed by
an **instance slug** (`amr`, `analyzers`, `my-feature-1234`). Pick a slug now — it
ties the checklist, the widget, and the reviewer's saved answers together.

### As a person
Sign in at `https://grist.openelis-global.org`, open **UAT Checklists**, and add rows:

- **`UAT_Meta`** — one row: `instance`, `title`, `intro`, `jira`.
- **`UAT_Steps`** — one row per step: `instance`, `section`, `section_order`,
  `step_order`, `do`, `expect`, `route`.

Reviewers see steps grouped by `section`, ordered by `section_order` then
`step_order`.

### As an agent (Claude)
Connect the authoring MCP once, then ask in plain language — *"add a checklist for
OGC-1234 covering the new sample-storage screens"*.

```bash
# Claude Code CLI
claude mcp add --transport http grist https://grist.openelis-global.org/api/mcp \
  --header "Authorization: Bearer <grist-api-key>"
```

On claude.ai (web), add `https://grist.openelis-global.org/api/mcp` as a custom
connector and sign in — no key to paste.

Agent context, tools, and the data model: [`AGENTS.md`](AGENTS.md).

### What makes a good step
A `do` the reviewer performs and an `expect` they judge against. Write the check for
the thing you're unsure about — a missing feature is a legitimate step, because the
reviewer marking it **Fail** is exactly the signal you want.

> Real example from the amr checklist: *"After entering AST results, check whether the
> S/I/R interpretation is carried onto the patient's result/report output."* It came
> back **FAIL** — and became the highest-value gap for the next iteration.

### Check it
```bash
curl https://grist.openelis-global.org/uat/<instance>.json
```
That is exactly what reviewers' browsers will load.

---

## Step 2 — Put it in front of reviewers

### Option A — the app is already deployed (most cases)
Point the existing deployment at your checklist with **one script tag or one nginx
line** — no frontend build, no redeploy: [`../integration/README.md`](../integration/README.md).

### Option B — stand up a stack for the branch/PR
When there's nothing deployed yet, this repo's demo deployment is the reference: an
umbrella nginx router terminating TLS per subdomain, with isolated OpenELIS stacks
built from a branch behind it.

```bash
cp .env.example .env      # host, domains, and the branch to build
./deploy.sh configure     # Docker + cert-renew cron (idempotent)
./deploy.sh deploy --yes  # build + bring up the stacks (~20-40 min)
# point DNS at the host, then:
./deploy.sh certs         # Let's Encrypt
./deploy.sh seed          # demo data so reviewers have something to work on
```

To review a different branch, change `AMR_BRANCH` / `ANALYZERS_BRANCH` in `.env` and
re-run `deploy` — the branch under review is config, not code.

The router injects the widget for you (see the `sub_filter` lines in
`router/nginx.conf.template`), so a stack deployed this way arrives review-ready.

> Full deployment details, isolation model, and gotchas: the [repo README](../README.md).

### Option C — no deployment at all
For a design or copy review, the widget runs standalone with an inline checklist —
open `widget/index.html` and adapt it. See [`../widget/README.md`](../widget/README.md).

---

## Step 3 — Review

The reviewer opens the site and clicks **Review** in the corner. For each step they
mark **pass / fail / n-a** and can leave a note; freeform page-level notes capture
anything the checklist didn't ask about. Answers persist in their browser, so they
can stop and come back.

Nothing is transmitted anywhere — the reviewer's answers stay local until they
export them.

## Step 4 — Collect and triage

**Download review report** produces two files: a readable `.md` and a structured
`.json`. The reviewer sends you the Markdown (or pastes it into Claude themselves)
and asks for triage. Claude reads the marks and notes and drafts issues — grouping
failures by severity, mapping each to a story or task under the ticket, and
confirming what passed.

From the real amr review, an 8-step checklist produced: one story (carry AST
interpretation through to the patient report), one task (add the worklist to the
sidenav), and seven confirmed-working steps — from a reviewer who wrote no issue
text at all.

## Step 5 — Iterate

Checklists are live: edit rows in Grist (or ask an agent) and reviewers pick up the
change within ~30 seconds. No redeploy, no re-integration. As a review surfaces new
questions, add steps and send the same link again.

---

## Recap

| | |
|---|---|
| **Instance slug** | ties checklist ↔ widget ↔ reviewer answers. One per feature/ticket. |
| **Author first** | reviewers need something to do; deployment comes second. |
| **Integration is config** | a script tag or an nginx line — never a frontend build. |
| **Checklists are live** | edit anytime; no redeploy. |
| **Reports are the handoff** | Markdown + JSON → Claude → issues. |
