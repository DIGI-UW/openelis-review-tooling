import assert from "node:assert/strict";
import test from "node:test";
import { SCHEMA, planColumns } from "../grist/schema.mjs";

// A live column as the Grist columns endpoint returns it.
function live(id, fields = {}) {
  return { id, fields: { type: "Text", label: id, description: "", isFormula: false, formula: "", recalcWhen: 0, ...fields } };
}

test("adds a declared column the document does not have", () => {
  const plan = planColumns([live("instance", { description: "the slug" })], {
    instance: { type: "Text", description: "the slug" },
    title: { type: "Text", description: "the heading" },
  });
  assert.deepEqual(plan.add.map((c) => c.id), ["title"]);
  assert.equal(plan.add[0].fields.description, "the heading");
  assert.deepEqual(plan.update, []);
});

test("updates a column whose description has drifted from the declaration", () => {
  const plan = planColumns([live("instance", { description: "old wording" })], {
    instance: { type: "Text", description: "new wording" },
  });
  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.update, [{ id: "instance", fields: { description: "new wording" } }]);
});

test("says nothing about a column that already matches", () => {
  const plan = planColumns([live("instance", { description: "same" })], {
    instance: { type: "Text", description: "same" },
  });
  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.update, []);
});

test("patches only what has drifted, not the whole column", () => {
  // A column carries a reviewer-visible label and an author's description; a plan
  // that rewrites every field to bring one of them into line would quietly undo
  // anything set in the document that the declaration does not mention.
  const plan = planColumns([live("required", { type: "Bool" })], {
    required: { type: "Bool", formula: "True", isFormula: false, recalcWhen: 0 },
  });
  assert.deepEqual(plan.update, [{ id: "required", fields: { formula: "True" } }]);
});

// A formula column and a trigger column differ only by isFormula, and getting it
// backwards is silent: the value is computed once and then frozen, or recomputed
// forever over an answer somebody typed.
test("tells a formula column apart from a default that only fires on create", () => {
  const plan = planColumns(
    [live("problems", { type: "Any", isFormula: true, formula: "old" })],
    { problems: { type: "Any", formula: "new", isFormula: true } },
  );
  assert.deepEqual(plan.update, [{ id: "problems", fields: { formula: "new" } }]);
});

test("leaves a column the declaration says nothing about alone", () => {
  // Grist's own bookkeeping columns live here too, and somebody may have added a
  // column by hand. Reconciling is not the same as owning the table.
  const plan = planColumns([live("manualSort", { type: "ManualSortPos" }), live("instance")], {
    instance: { type: "Text" },
  });
  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.update, []);
  assert.deepEqual(plan.extra, ["manualSort"]);
});

test("declares every column the read service and the widget rely on", () => {
  // The endpoint reads these by name; a rename here is a broken checklist there.
  for (const col of ["instance", "step_key", "required", "section", "section_order", "step_order", "do", "expect", "route"]) {
    assert.ok(SCHEMA.UAT_Steps.columns[col], `UAT_Steps.${col} must be declared`);
  }
  for (const col of ["instance", "title", "intro", "jira", "published"]) {
    assert.ok(SCHEMA.UAT_Meta.columns[col], `UAT_Meta.${col} must be declared`);
  }
});

test("explains every column an author has to fill in", () => {
  // The description is the only help a human gets in a Grist grid. The rules that
  // bite — a blank step_key breaking the whole checklist, required defaulting to
  // false — are invisible without it.
  for (const [table, spec] of Object.entries(SCHEMA)) {
    for (const [colId, col] of Object.entries(spec.columns)) {
      if (col.computed) continue;
      assert.ok(
        (col.description || "").trim().length > 20,
        `${table}.${colId} needs a description an author can act on`,
      );
    }
  }
});
