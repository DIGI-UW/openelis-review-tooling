// The layer nothing exercised.
//
// Everything else in this suite tests pure functions or the widget. `apply` and
// `generate` mutate a live document, and every bug found in them so far — a
// migration reading columns that had already been dropped, a call site left on an
// old signature, a batch the API refuses — was found by running against
// production, because that was the only way to run them at all.
//
// These run the real script, unmodified, over real HTTP, against a fake Grist
// that refuses what the real one refuses.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fakeGristDoc, startFakeGrist } from "./helpers/fake-grist.mjs";

const run = promisify(execFile);
const SYNC = new URL("../grist/grist-sync.mjs", import.meta.url).pathname;

async function apply(doc, args = [], env = {}) {
  const grist = await startFakeGrist(doc);
  try {
    return await run("node", [SYNC, "apply", ...args], {
      env: { ...process.env, GRIST_URL: grist.url, GRIST_KEY: "test-key", ...env },
    });
  } finally {
    await grist.stop();
  }
}

// A document as it was before stories existed: steps carrying their group as a
// repeated title, which is the only state the migration has to work from.
function legacyDoc() {
  const col = (id, fields = {}) => ({ id, fields: { type: "Text", label: id, ...fields } });
  return fakeGristDoc({
    tables: {
      UAT_Meta: {
        columns: [col("instance"), col("title"), col("intro"), col("jira"), col("published", { type: "Bool" })],
        records: [{ id: 1, fields: { instance: "amr", title: "Microbiology", published: true } }],
      },
      UAT_Steps: {
        columns: [
          col("instance"), col("step_key"), col("required", { type: "Bool" }),
          col("section"), col("section_order", { type: "Int" }), col("step_order", { type: "Int" }),
          col("do"), col("expect"), col("route"),
        ],
        records: [
          { id: 1, fields: { instance: "amr", step_key: "AMR-1", required: true, section: "Open the worklist", section_order: 0, step_order: 0, do: "Sign in" } },
          { id: 2, fields: { instance: "amr", step_key: "AMR-2", required: true, section: "Open the worklist", section_order: 0, step_order: 1, do: "Open Microbiology" } },
          { id: 3, fields: { instance: "amr", step_key: "AMR-3", required: true, section: "Enter results", section_order: 1, step_order: 0, do: "Enter an AST result" } },
        ],
      },
    },
  });
}

test("apply migrates a legacy document into stories without losing the grouping", async () => {
  const doc = legacyDoc();
  await apply(doc);

  const stories = doc.tables.UAT_Stories.records;
  assert.deepEqual(
    stories.map((s) => [s.fields.title, s.fields.story_order]),
    [["Open the worklist", 0], ["Enter results", 1]],
    "two sections must become two stories, not one",
  );

  // Every step points at the story it was already in.
  const byKey = Object.fromEntries(doc.tables.UAT_Steps.records.map((r) => [r.fields.step_key, r.fields.story]));
  assert.equal(byKey["AMR-1"], byKey["AMR-2"], "steps that shared a section share a story");
  assert.notEqual(byKey["AMR-1"], byKey["AMR-3"], "steps in different sections do not");
  assert.ok(byKey["AMR-3"], "every step ends up in a story");
});

test("apply retires the old columns only after the migration that reads them", async () => {
  // The bug this exists for: retirement ran while reconciling the schema, and the
  // migration ran after it. On a document that still needed migrating, the
  // grouping was dropped before anything had used it and every step collapsed
  // into one story. It survived review because the document it was tried on had
  // already been migrated by an earlier run.
  const doc = legacyDoc();
  await apply(doc);

  const columns = doc.tables.UAT_Steps.columns.map((c) => c.id);
  assert.equal(columns.includes("section"), false, "section is retired");
  assert.equal(columns.includes("section_order"), false, "section_order is retired");

  const removedAt = doc.calls.findIndex((call) => call.startsWith("POST /api/docs/docFAKE/apply"));
  const migratedAt = doc.calls.findIndex((call) => call === "POST /api/docs/docFAKE/tables/UAT_Stories/records");
  assert.ok(migratedAt >= 0, "the migration created stories");
  assert.ok(
    migratedAt < removedAt,
    "stories must be built before anything the migration reads is removed",
  );
});

test("a story ends up pointing at its review, not at the name it was typed as", async () => {
  const doc = legacyDoc();
  await apply(doc);
  const review = doc.tables.UAT_Meta.records[0];
  for (const story of doc.tables.UAT_Stories.records) {
    assert.equal(story.fields.instance, review.id, "instance is the review's row id");
  }
});

test("apply is idempotent — a second run changes nothing", async () => {
  const doc = legacyDoc();
  await apply(doc);
  const after = JSON.stringify(doc.tables);
  doc.calls.length = 0;
  const { stdout } = await apply(doc);
  assert.equal(JSON.stringify(doc.tables), after, "the document is untouched the second time");
  assert.equal(/would |retire |convert |repoint /.test(stdout), false, `second run reported work: ${stdout}`);
});

test("apply --dry-run reports the work and performs none of it", async () => {
  const doc = legacyDoc();
  const before = JSON.stringify(doc.tables);
  const { stdout } = await apply(doc, ["--dry-run"]);
  assert.match(stdout, /would convert/);
  assert.match(stdout, /would retire/);
  assert.equal(JSON.stringify(doc.tables), before, "a dry run must not touch the document");
});

test("apply splits column patches the API refuses to take together", async () => {
  // Grist rejects a PATCH whose records do not all carry the same fields, and a
  // plan is by definition a set of different drifts — one description here, one
  // formula there. The fake refuses it exactly as the real one did.
  const doc = legacyDoc();
  await assert.doesNotReject(() => apply(doc));
});

test("generate exports every review, nesting steps under their story", async () => {
  // This call site kept the old three-argument signature after the builder
  // started requiring stories, so the export threw on every step. Nothing ran it.
  const doc = legacyDoc();
  await apply(doc);

  const out = await mkdtemp(join(tmpdir(), "uat-export-"));
  const grist = await startFakeGrist(doc);
  try {
    await run("node", [SYNC, "generate"], {
      env: { ...process.env, GRIST_URL: grist.url, GRIST_KEY: "test-key", EXPORT_DIR: out },
    });
  } finally {
    await grist.stop();
  }

  assert.deepEqual(await readdir(out), ["uat-amr.json"]);
  const written = JSON.parse(await readFile(join(out, "uat-amr.json"), "utf8"));
  assert.deepEqual(
    written.sections.map((s) => [s.title, s.steps.length]),
    [["Open the worklist", 2], ["Enter results", 1]],
  );
  assert.ok(written.sections[0].key, "each section carries its story key");
});
