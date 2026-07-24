import assert from "node:assert/strict";
import test from "node:test";

import { buildUatDocument } from "../grist/mcp/uat-document.mjs";

const meta = [
  {
    id: 1,
    fields: {
      instance: "amr",
      title: "Microbiology MVP",
      intro: "Review the bacteriology path",
      jira: "OGC-782",
    },
  },
];

const step = (id, order, action, route = "/Microbiology/worklist") => ({
  id,
  fields: {
    instance: "amr",
    section: "Workflow",
    section_order: 1,
    step_order: order,
    do: action,
    expect: `${action} succeeds`,
    route,
  },
});

test("Grist row IDs become stable widget step IDs", () => {
  const document = buildUatDocument("amr", meta, [
    step(102, 2, "Record an isolate"),
    step(101, 1, "Open the worklist"),
  ]);

  assert.deepEqual(
    document.sections[0].steps.map((item) => item.step_id),
    ["grist:101", "grist:102"],
  );
  assert.match(document.checklist_revision, /^[a-f0-9]{64}$/);
});

test("source record order does not affect the ordered revision", () => {
  const first = buildUatDocument("amr", meta, [
    step(101, 1, "Open the worklist"),
    step(102, 2, "Record an isolate"),
  ]);
  const second = buildUatDocument("amr", meta, [
    step(102, 2, "Record an isolate"),
    step(101, 1, "Open the worklist"),
  ]);

  assert.equal(first.checklist_revision, second.checklist_revision);
});

test("workflow-visible changes produce a different revision without changing IDs", () => {
  const before = buildUatDocument("amr", meta, [
    step(101, 1, "Open the worklist"),
    step(102, 2, "Record an isolate"),
  ]);
  const after = buildUatDocument("amr", meta, [
    step(101, 2, "Open the worklist"),
    step(102, 1, "Record an isolate"),
  ]);

  assert.notEqual(before.checklist_revision, after.checklist_revision);
  assert.deepEqual(
    new Set(before.sections[0].steps.map((item) => item.step_id)),
    new Set(after.sections[0].steps.map((item) => item.step_id)),
  );
});
