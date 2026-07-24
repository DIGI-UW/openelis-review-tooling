import assert from "node:assert/strict";
import test from "node:test";
import { buildUatDocument } from "../grist/mcp/uat-document.mjs";

const meta = {
  title: "Analyzer review",
  jira: "OGC-1054",
  intro: "Review the analyzer workflow.",
};

const rows = [
  {
    id: 42,
    fields: {
      instance: "analyzers",
      step_key: "AN-QC-001",
      required: true,
      section: "Profiles",
      section_order: 0,
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
      section: "Setup",
      section_order: 1,
      step_order: 0,
      do: "Create an analyzer",
      expect: "Setup opens inline",
      route: "/analyzers?add=1",
    },
  },
];

test("emits schema v2, stable step keys, required flags, and a revision", () => {
  const document = buildUatDocument("analyzers", meta, rows);

  assert.equal(document.schemaVersion, 2);
  assert.match(document.checklistRevision, /^[a-f0-9]{64}$/);
  assert.equal(document.sections[0].steps[0].key, "AN-QC-001");
  assert.equal(document.sections[0].steps[0].required, true);
  assert.equal(document.sections[1].steps[0].required, false);
});

test("revision is deterministic and changes when reviewed content changes", () => {
  const first = buildUatDocument("analyzers", meta, rows);
  const same = buildUatDocument("analyzers", { ...meta }, structuredClone(rows));
  const changedRows = structuredClone(rows);
  changedRows[0].fields.expect = "Updated expectation";
  const changed = buildUatDocument("analyzers", meta, changedRows);

  assert.equal(first.checklistRevision, same.checklistRevision);
  assert.notEqual(first.checklistRevision, changed.checklistRevision);
});

test("rejects duplicate or missing stable step keys", () => {
  const duplicate = structuredClone(rows);
  duplicate[1].fields.step_key = "AN-QC-001";
  assert.throws(
    () => buildUatDocument("analyzers", meta, duplicate),
    /duplicate step_key AN-QC-001/,
  );

  const missing = structuredClone(rows);
  missing[0].fields.step_key = "";
  assert.throws(
    () => buildUatDocument("analyzers", meta, missing),
    /missing step_key/,
  );
});

test("rejects duplicate step ordering within a section", () => {
  const duplicateOrder = structuredClone(rows);
  duplicateOrder[1].fields.section = "Profiles";
  duplicateOrder[1].fields.section_order = 0;
  duplicateOrder[1].fields.step_order = 0;

  assert.throws(
    () => buildUatDocument("analyzers", meta, duplicateOrder),
    /duplicate step order 0:0/,
  );
});
