# Backend Grist authoring from an agent or operator machine

Use the same Grist REST client locally, in an agent runtime or in CI. Routine
checklist work needs Node.js 22 and a configured API credential. It does not need
browser sign-in, Docker, AWS, or SSH access to the Grist host.

## Configure once

Place a client profile outside the checkout:

```bash
mkdir -p "$HOME/.config/openelis-review"
cp grist/client.example.json "$HOME/.config/openelis-review/grist.json"
chmod 700 "$HOME/.config/openelis-review"
```

Provision the existing authorized Grist API credential into
`$HOME/.config/openelis-review/grist.api-key` through the operator's credential
channel, with file mode `600`. Do not put the key in a command argument, committed
file, browser or chat. The profile contains only the service URL, explicit
document ID and credential-file path. A relative `keyFile` resolves beside the
profile, so moving to another checkout needs no setup change.

For another environment, set `GRIST_CONFIG_FILE` to its profile. CI can supply
`GRIST_URL`, `GRIST_DOC_ID`, and `GRIST_KEY_FILE` through its normal configuration
and secret-file mechanism. Existing `GRIST_KEY` environment injection remains
supported. Environment variables override profile values. The default profile
uses `XDG_CONFIG_HOME` when configured, otherwise `$HOME/.config`.

One-time provisioning is still required. A missing credential reports that exact
setup problem; the client does not open a login page or attempt a different
identity. The existing host-side key remains at
`${GRIST_STATE_DIR}/.api-key`. The host lifecycle and its access requirements
remain separate from this direct authoring client.

## Read, preview, apply and verify

Run from the review-tooling checkout:

```bash
npm run --silent grist -- check-access
npm run --silent grist -- read-story reporting RPT-S04 > story.json
# Edit the story and its steps in story.json.
npm run --silent grist -- apply-story story.json --dry-run
npm run --silent grist -- apply-story story.json
npm run --silent grist -- verify reporting
```

`check-access` verifies the document's existing owner requirement. It reads only;
it does not create a missing document. Bootstrap explicitly uses `--create` when
initializing a new deployment.

`read-story` reads the raw authored fields and stable keys, retaining actual
ordering, optional metadata and a checklist revision precondition. `apply-story`
refuses a payload read against an older checklist revision. Read again and
reconcile intervening edits instead of removing the precondition blindly.
This detects changes since the prior read; it is not a transaction lock against
an edit that races the subsequent write requests.

The dry run reports creates, updates and removals without mutating Grist.
A story payload describes its complete step set: omitted steps are removed.
Keep the stable keys of steps you retain. The client validates the whole affected
instance before writing, including sibling key collisions and invalid routes.
Routine authoring does not create documents, migrate schema or modify the review
answer tables. Schema maintenance remains a separate host operation.

After applying, the client reads back exact authored fields, retained row IDs,
computed row problems and the resulting checklist revision. It never retries a
write automatically. If a multi-request update fails, read the current rows and
reconcile the partial result before applying again. It does not automatically
roll back over somebody else's edits.

`verify` reads the authored revision and compares it with the public read adapter.
It observes the adapter's short cache for up to eight attempts and never repeats
writes. Public verification sends no author credential. A mismatch remains an
error requiring inspection; a successful REST edit alone is not proof that the
review overlay sees the new revision. The reviewer walkthrough and live overlay
validation described in [the authoring contract](../docs/AGENTS.md) still apply.

## Host lifecycle remains available

`./deploy.sh grist apply-story --file story.json` remains the managed host path,
and `grist/bootstrap.sh` owns container lifecycle and schema initialization.
Use those for host operations. The direct client above is the normal workflow
for checklist authoring from a configured agent/operator machine.

Deployment presentation is a separate, narrow host operation. It keeps Grist as
the editable source of truth and does not revise checklist evidence:

```bash
./deploy.sh grist set-presentation reporting \
  --scope site --suggested RPT-S01,RPT-S03,RPT-S04,RPT-S06 --dry-run
./deploy.sh grist set-presentation reporting \
  --scope site --suggested RPT-S01,RPT-S03,RPT-S04,RPT-S06
```

The non-dry run updates only `UAT_Meta.story_scope` and
`UAT_Meta.suggested_stories`, then verifies their exact stored values.

Validation uses the local fake Grist HTTP server. The tests never contact the
public authoring service or mutate its checklists:

```bash
node --test tests/grist-client.test.mjs tests/grist-apply.test.mjs
```
