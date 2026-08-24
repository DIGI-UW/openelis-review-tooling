import assert from "node:assert/strict";
import test from "node:test";
import { buildUatDocument } from "../grist/uat-read/uat-document.mjs";

const meta = {
  title: "Analyzer review",
  jira: "OGC-1054",
  intro: "Review the analyzer workflow.",
};

const stories = [
  { id: 1, fields: { instance: "analyzers", story_key: "AN-PROFILES", title: "Profiles", story_order: 0 } },
  { id: 2, fields: { instance: "analyzers", story_key: "AN-SETUP", title: "Setup", story_order: 1 } },
];

const rows = [
  {
    id: 42,
    fields: {
      instance: "analyzers",
      step_key: "AN-QC-001",
      required: true,
      story: 1,
      step_order: 0,
      do: "Find a shipped profile",
      expect: "Protocol and readiness are visible",
      route: "/analyzers/types",
    },
  },
  {
    id: 43,
    fields: {
      instance: "analyzers",
      step_key: "AN-QC-002",
      required: false,
      story: 2,
      step_order: 0,
      do: "Create an analyzer",
      expect: "Setup opens inline",
      route: "/analyzers?add=1",
    },
  },
];

test("emits schema v2, stable step keys, required flags, and a revision", () => {
  const document = buildUatDocument("analyzers", meta, rows, stories);

  assert.equal(document.schemaVersion, 2);
  assert.match(document.checklistRevision, /^[a-f0-9]{64}$/);
  assert.equal(document.sections[0].steps[0].key, "AN-QC-001");
  assert.equal(document.sections[0].steps[0].required, true);
  assert.equal(document.sections[1].steps[0].required, false);
});

test("revision is deterministic and changes when reviewed content changes", () => {
  const first = buildUatDocument("analyzers", meta, rows, stories);
  const same = buildUatDocument("analyzers", { ...meta }, structuredClone(rows), stories);
  const changedRows = structuredClone(rows);
  changedRows[0].fields.expect = "Updated expectation";
  const changed = buildUatDocument("analyzers", meta, changedRows, stories);

  assert.equal(first.checklistRevision, same.checklistRevision);
  assert.notEqual(first.checklistRevision, changed.checklistRevision);
});

test("rejects duplicate or missing stable step keys", () => {
  const duplicate = structuredClone(rows);
  duplicate[1].fields.step_key = "AN-QC-001";
  assert.throws(
    () => buildUatDocument("analyzers", meta, duplicate, stories),
    /duplicate step_key AN-QC-001/,
  );

  const missing = structuredClone(rows);
  missing[0].fields.step_key = "";
  assert.throws(
    () => buildUatDocument("analyzers", meta, missing, stories),
    /missing step_key/,
  );
});

test("rejects two steps claiming the same place in a story", () => {
  const duplicateOrder = structuredClone(rows);
  duplicateOrder[1].fields.story = 1;
  duplicateOrder[1].fields.step_order = 0;

  assert.throws(
    () => buildUatDocument("analyzers", meta, duplicateOrder, stories),
    /duplicate step order 0 in story AN-PROFILES/,
  );
});

// ---------------------------------------------------------------------------
// Behavioural coverage for the checklist builder.
//
// These exist because a mutation study found the previous suite green against
// seven separate breakages — a pass-through route validator, a deleted sort, a
// swapped field, a leaked internal key. Each test below fails against one of
// those mutations rather than asserting on the shape of the source.
// ---------------------------------------------------------------------------

function row(id, fields) {
  return {
    id,
    fields: {
      instance: "analyzers",
      story: 2,
      step_order: 0,
      do: "do it",
      expect: "it happened",
      ...fields,
    },
  };
}
const build = (rows, m = meta) => buildUatDocument("analyzers", m, rows, stories);
const allSteps = (doc) => doc.sections.flatMap((section) => section.steps);

test("rejects routes that resolve off-origin", () => {
  for (const route of [
    "https://evil.example/x",
    "//evil.example",
    "/\\evil.example",
    "/\\/evil.example",
    "javascript:alert(1)",
    "../escape",
  ]) {
    assert.throws(
      () => build([row(1, { step_key: "K1", route })]),
      /same-origin/,
      `expected ${JSON.stringify(route)} to be rejected`,
    );
  }
});

test("accepts an ordinary same-origin path", () => {
  const doc = build([row(1, { step_key: "K1", route: "/Microbiology/worklist" })]);
  assert.equal(allSteps(doc)[0].route, "/Microbiology/worklist");
});

test("orders sections and steps by their order columns, not input order", () => {
  const doc = build([
    row(1, { step_key: "B2", story: 2, step_order: 1, do: "b2" }),
    row(2, { step_key: "A2", story: 1, step_order: 1, do: "a2" }),
    row(3, { step_key: "B1", story: 2, step_order: 0, do: "b1" }),
    row(4, { step_key: "A1", story: 1, step_order: 0, do: "a1" }),
  ]);
  // Story order, then step order — not the order the rows came back in.
  assert.deepEqual(
    doc.sections.map((s) => s.title),
    ["Profiles", "Setup"],
  );
  assert.deepEqual(
    allSteps(doc).map((s) => s.key),
    ["A1", "A2", "B1", "B2"],
  );
});

test("maps each column to its own field", () => {
  const doc = build([
    row(1, {
      step_key: "K1",
      story: 1,
      do: "the action",
      expect: "the expectation",
      route: "/the/route",
    }),
  ]);
  assert.equal(doc.sections[0].title, "Profiles");
  const step = allSteps(doc)[0];
  assert.equal(step.do, "the action");
  assert.equal(step.expect, "the expectation");
  assert.equal(step.route, "/the/route");
  assert.equal(step.key, "K1");
});

test("a step is required unless it says otherwise", () => {
  const cases = [
    [undefined, true],
    [null, true],
    ["", true],
    [true, true],
    [1, true],
    ["true", true],
    ["TRUE", true],
    ["yes", true],
    [false, false],
    [0, false],
    ["false", false],
    ["FALSE", false],
    ["no", false],
    ["0", false],
  ];
  for (const [value, expected] of cases) {
    const doc = build([row(1, { step_key: "K1", required: value })]);
    assert.equal(
      allSteps(doc)[0].required,
      expected,
      `required=${JSON.stringify(value)} should be ${expected}`,
    );
  }
});

test("does not leak internal ordering keys into the document", () => {
  const doc = build([row(1, { step_key: "K1" })]);
  const serialized = JSON.stringify(doc);
  assert.equal(serialized.includes("_order"), false);
  // A story carries bookkeeping while the document is being built — the orders it
  // has already seen — and none of it belongs on the wire.
  assert.equal(serialized.includes("_seen"), false);
  assert.deepEqual(Object.keys(doc.sections[0]).sort(), ["key", "revision", "steps", "title", "version"]);
});

test("the revision is content identity: stable under reorder, changed by edits", () => {
  const ordered = [
    row(1, { step_key: "K1", section_order: 0, step_order: 0, do: "first" }),
    row(2, { step_key: "K2", section_order: 0, step_order: 1, do: "second" }),
  ];
  const shuffled = [ordered[1], ordered[0]];
  assert.equal(
    build(ordered).checklistRevision,
    build(shuffled).checklistRevision,
    "reordering the same rows must not change the revision",
  );

  const edited = [ordered[0], row(2, { step_key: "K2", section_order: 0, step_order: 1, do: "changed" })];
  assert.notEqual(
    build(ordered).checklistRevision,
    build(edited).checklistRevision,
    "changing a step's instructions must change the revision",
  );
  assert.match(build(ordered).checklistRevision, /^[0-9a-f]{64}$/);
});
