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
import { PAGES } from "../grist/schema.mjs";
import { fakeGristDoc, startFakeGrist } from "./helpers/fake-grist.mjs";

const run = promisify(execFile);
const SYNC = new URL("../grist/grist-sync.mjs", import.meta.url).pathname;

async function apply(doc, args = [], env = {}) {
  const grist = await startFakeGrist(doc);
  try {
    return await run("node", [SYNC, "apply", ...args], {
      env: {
        ...process.env,
        GRIST_URL: grist.url,
        GRIST_KEY: "test-key",
        ...env,
      },
    });
  } finally {
    await grist.stop();
  }
}

async function checkAccess(doc) {
  const grist = await startFakeGrist(doc);
  try {
    return await run("node", [SYNC, "check-access"], {
      env: {
        ...process.env,
        GRIST_URL: grist.url,
        GRIST_KEY: "test-key",
      },
    });
  } finally {
    await grist.stop();
  }
}

test("check-access requires the server authoring identity to own the document", async () => {
  const owner = fakeGristDoc({ access: "owners" });
  const { stdout } = await checkAccess(owner);
  assert.match(stdout, /UAT Checklists.*owners/);

  const viewer = fakeGristDoc({ access: "viewers" });
  await assert.rejects(checkAccess(viewer), /expected owners, received viewers/);
});

// A document as it was before stories existed: steps carrying their group as a
// repeated title, which is the only state the migration has to work from.
function legacyDoc() {
  const col = (id, fields = {}) => ({
    id,
    fields: { type: "Text", label: id, ...fields },
  });
  return fakeGristDoc({
    tables: {
      UAT_Meta: {
        columns: [
          col("instance"),
          col("title"),
          col("intro"),
          col("jira"),
          col("published", { type: "Bool" }),
        ],
        records: [
          {
            id: 1,
            fields: { instance: "amr", title: "Microbiology", published: true },
          },
        ],
      },
      UAT_Steps: {
        columns: [
          col("instance"),
          col("step_key"),
          col("required", { type: "Bool" }),
          col("section"),
          col("section_order", { type: "Int" }),
          col("step_order", { type: "Int" }),
          col("do"),
          col("expect"),
          col("route"),
        ],
        records: [
          {
            id: 1,
            fields: {
              instance: "amr",
              step_key: "AMR-1",
              required: true,
              section: "Open the worklist",
              section_order: 0,
              step_order: 0,
              do: "Sign in",
            },
          },
          {
            id: 2,
            fields: {
              instance: "amr",
              step_key: "AMR-2",
              required: true,
              section: "Open the worklist",
              section_order: 0,
              step_order: 1,
              do: "Open Microbiology",
            },
          },
          {
            id: 3,
            fields: {
              instance: "amr",
              step_key: "AMR-3",
              required: true,
              section: "Enter results",
              section_order: 1,
              step_order: 0,
              do: "Enter an AST result",
            },
          },
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
    [
      ["Open the worklist", 0],
      ["Enter results", 1],
    ],
    "two sections must become two stories, not one",
  );

  // Every step points at the story it was already in.
  const byKey = Object.fromEntries(
    doc.tables.UAT_Steps.records.map((r) => [
      r.fields.step_key,
      r.fields.story,
    ]),
  );
  assert.equal(
    byKey["AMR-1"],
    byKey["AMR-2"],
    "steps that shared a section share a story",
  );
  assert.notEqual(
    byKey["AMR-1"],
    byKey["AMR-3"],
    "steps in different sections do not",
  );
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
  assert.equal(
    columns.includes("section_order"),
    false,
    "section_order is retired",
  );

  // By action, not by endpoint: /apply carries every user action there is, so
  // matching the URL alone found whichever one happened to come first.
  const removedAt = doc.calls.findIndex((call) =>
    call.includes("RemoveColumn"),
  );
  const migratedAt = doc.calls.findIndex(
    (call) => call === "POST /api/docs/docFAKE/tables/UAT_Stories/records",
  );
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
    assert.equal(
      story.fields.instance,
      review.id,
      "instance is the review's row id",
    );
  }
});

test("apply is idempotent — a second run changes nothing", async () => {
  const doc = legacyDoc();
  await apply(doc);
  const after = JSON.stringify(doc.tables);
  doc.calls.length = 0;
  const { stdout } = await apply(doc);
  assert.equal(
    JSON.stringify(doc.tables),
    after,
    "the document is untouched the second time",
  );
  assert.equal(
    /would |retire |convert |repoint /.test(stdout),
    false,
    `second run reported work: ${stdout}`,
  );
});

test("apply --dry-run reports the work and performs none of it", async () => {
  const doc = legacyDoc();
  // A page it would remove, so "none of it" covers pages too. Snapshotting only
  // the tables let a dry run delete pages and still look like it had changed
  // nothing.
  doc.views = [{ id: 1, fields: { name: "UAT_Steps", type: "raw_data" } }];
  const before = JSON.stringify({ tables: doc.tables, views: doc.views });

  const { stdout } = await apply(doc, ["--dry-run"]);
  assert.match(stdout, /would convert/);
  assert.match(stdout, /would retire/);
  assert.match(stdout, /would remove the raw page/);
  assert.equal(
    JSON.stringify({ tables: doc.tables, views: doc.views }),
    before,
    "a dry run must not touch the document",
  );
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
      env: {
        ...process.env,
        GRIST_URL: grist.url,
        GRIST_KEY: "test-key",
        EXPORT_DIR: out,
      },
    });
  } finally {
    await grist.stop();
  }

  assert.deepEqual(await readdir(out), ["uat-amr.json"]);
  const written = JSON.parse(await readFile(join(out, "uat-amr.json"), "utf8"));
  assert.deepEqual(
    written.sections.map((s) => [s.title, s.steps.length]),
    [
      ["Open the worklist", 2],
      ["Enter results", 1],
    ],
  );
  assert.ok(written.sections[0].key, "each section carries its story key");
});

test("apply builds the tables a submitted review lands in", async () => {
  const doc = legacyDoc();
  await apply(doc);

  for (const table of ["UAT_Submissions", "UAT_Answers"]) {
    assert.ok(doc.tables[table], `${table} must exist after apply`);
  }
  const answers = doc.tables.UAT_Answers.columns.map((c) => c.id);
  for (const col of [
    "review",
    "step_key",
    "story_version",
    "story_revision",
    "mark",
  ]) {
    assert.ok(
      answers.includes(col),
      `UAT_Answers.${col} must exist after apply`,
    );
  }
});

test("the newest submission is the one at the top", async () => {
  // Grist says descending with a negative column ref. The tool used to drop any
  // sort entry it could not resolve, so "-submitted_at" would have left the page
  // unsorted while the run still reported the page created.
  const doc = legacyDoc();
  await apply(doc);

  // Sections carry a tableRef, and the fake numbers tables the way Grist does.
  const tableIds = Object.keys(doc.tables);
  const submissions = doc.sections.filter(
    (section) => tableIds[section.tableRef - 1] === "UAT_Submissions",
  );
  assert.equal(
    submissions.length,
    1,
    "the Results page lists submissions once",
  );
  assert.deepEqual(
    JSON.parse(submissions[0].fields.sortColRefs).map(Math.sign),
    [-1],
    "submitted_at sorts descending, so the newest is read first",
  );
});

test("apply does not leave behind the pages Grist makes for the tables it creates", async () => {
  // Creating a table through the API gives it a primary view, which shows up in
  // the left-hand nav as a raw dump of that table. Two of those appeared beside
  // the Results page that presents the same rows properly, and nothing removed
  // them: planPages ignores raw_data views when deciding what to create, so they
  // were invisible to the only code that looks at pages.
  //
  // Cleaning up a side effect of its own create is not the same as owning the
  // document — a page somebody authored is still left alone.
  const doc = legacyDoc();
  await apply(doc);

  const named = (doc.views || []).map((view) => view.fields.name);
  for (const table of ["UAT_Submissions", "UAT_Answers"]) {
    assert.equal(
      named.includes(table),
      false,
      `${table}'s auto-created page must be removed, leaving: ${named.join(", ")}`,
    );
  }
  // The declared ones are still there. Read off the declaration rather than
  // listed here, so renaming a page cannot quietly stop this checking it.
  for (const page of PAGES.map((declared) => declared.name)) {
    assert.ok(named.includes(page), `${page} must survive`);
  }
});

test("leaves alone a page it did not create, raw or authored", async () => {
  // The other half of the cleanup above, and the more important half. Removing
  // its own side effect is fine; removing a page because of what type it is
  // would take out the raw view of a table that was already here, and a page
  // somebody made for themselves.
  const doc = legacyDoc();
  doc.views = [
    { id: 1, fields: { name: "Legacy_Notes", type: "raw_data" } },
    { id: 2, fields: { name: "Scratch", type: "empty" } },
  ];
  await apply(doc);

  const named = doc.views.map((view) => view.fields.name);
  assert.ok(
    named.includes("Legacy_Notes"),
    "the raw view of a table this declaration says nothing about is not ours",
  );
  assert.ok(
    named.includes("Scratch"),
    "a page somebody authored is left alone",
  );
});

test("clears a raw page that a previous run already left behind", async () => {
  // The version of this that only cleaned up tables it had just created would
  // have tidied a fresh document and never touched one that had already run —
  // which is every document that matters, including the live one.
  const doc = legacyDoc();
  doc.views = [{ id: 1, fields: { name: "UAT_Steps", type: "raw_data" } }];
  await apply(doc);
  assert.equal(
    doc.views.some((view) => view.fields.name === "UAT_Steps"),
    false,
    "a leftover raw page for a declared table goes on the next run",
  );
});

test("apply renames a page rather than building its new name beside the old one", async () => {
  // The page is its widgets, their links and whatever layout somebody dragged
  // into place. Creating "Checklists" and leaving "Reviews" behind would double
  // the nav and lose none of the ambiguity the rename exists to remove.
  const doc = legacyDoc();
  doc.views = [
    { id: 1, fields: { name: "Reviews", type: "" } },
    { id: 2, fields: { name: "Results", type: "" } },
  ];
  await apply(doc);

  const named = doc.views.map((view) => view.fields.name);
  assert.ok(named.includes("Checklists"), `renamed, got: ${named.join(", ")}`);
  assert.ok(named.includes("Submitted reviews"));
  assert.equal(named.includes("Reviews"), false, "the old name is gone");
  assert.equal(named.includes("Results"), false);

  // The same view, renamed — not a replacement built alongside it.
  assert.equal(doc.views.find((v) => v.fields.name === "Checklists").id, 1);
  assert.equal(
    doc.views.find((v) => v.fields.name === "Submitted reviews").id,
    2,
  );
});

test("a second run has nothing left to rename", async () => {
  const doc = legacyDoc();
  doc.views = [{ id: 1, fields: { name: "Reviews", type: "" } }];
  await apply(doc);
  doc.calls.length = 0;
  const { stdout } = await apply(doc);
  assert.equal(
    /rename/.test(stdout),
    false,
    `second run renamed something: ${stdout}`,
  );
});
