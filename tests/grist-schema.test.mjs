import assert from "node:assert/strict";
import test from "node:test";
import {
  PAGES,
  SCHEMA,
  planColumns,
  planPages,
  planSortColRefs,
  sortSpec,
} from "../grist/schema.mjs";

// A live column as the Grist columns endpoint returns it.
function live(id, fields = {}) {
  return {
    id,
    fields: {
      type: "Text",
      label: id,
      description: "",
      isFormula: false,
      formula: "",
      recalcWhen: 0,
      ...fields,
    },
  };
}

test("adds a declared column the document does not have", () => {
  const plan = planColumns([live("instance", { description: "the slug" })], {
    instance: { type: "Text", description: "the slug" },
    title: { type: "Text", description: "the heading" },
  });
  assert.deepEqual(
    plan.add.map((c) => c.id),
    ["title"],
  );
  assert.equal(plan.add[0].fields.description, "the heading");
  assert.deepEqual(plan.update, []);
});

test("updates a column whose description has drifted from the declaration", () => {
  const plan = planColumns([live("instance", { description: "old wording" })], {
    instance: { type: "Text", description: "new wording" },
  });
  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.update, [
    { id: "instance", fields: { description: "new wording" } },
  ]);
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
    required: {
      type: "Bool",
      formula: "True",
      isFormula: false,
      recalcWhen: 0,
    },
  });
  assert.deepEqual(plan.update, [
    { id: "required", fields: { formula: "True" } },
  ]);
});

// A formula column and a trigger column differ only by isFormula, and getting it
// backwards is silent: the value is computed once and then frozen, or recomputed
// forever over an answer somebody typed.
test("tells a formula column apart from a default that only fires on create", () => {
  const plan = planColumns(
    [live("problems", { type: "Any", isFormula: true, formula: "old" })],
    { problems: { type: "Any", formula: "new", isFormula: true } },
  );
  assert.deepEqual(plan.update, [
    { id: "problems", fields: { formula: "new" } },
  ]);
});

test("leaves a column the declaration says nothing about alone", () => {
  // Grist's own bookkeeping columns live here too, and somebody may have added a
  // column by hand. Reconciling is not the same as owning the table.
  const plan = planColumns(
    [live("manualSort", { type: "ManualSortPos" }), live("instance")],
    {
      instance: { type: "Text" },
    },
  );
  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.update, []);
  assert.deepEqual(plan.extra, ["manualSort"]);
});

test("declares every column the read service and the widget rely on", () => {
  // The endpoint reads these by name; a rename here is a broken checklist there.
  for (const col of [
    "instance",
    "step_key",
    "required",
    "story",
    "step_order",
    "do",
    "expect",
    "route",
  ]) {
    assert.ok(
      SCHEMA.UAT_Steps.columns[col],
      `UAT_Steps.${col} must be declared`,
    );
  }
  // A story is a row of its own now, and these are what the endpoint reads off it.
  for (const col of [
    "instance",
    "story_key",
    "title",
    "story_order",
    "jira",
    "pr",
    "mock",
    "user_story",
    "hosts",
  ]) {
    assert.ok(
      SCHEMA.UAT_Stories.columns[col],
      `UAT_Stories.${col} must be declared`,
    );
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

test("asks for a page only when the document has no authored one by that name", () => {
  // A document with no pages still reports one view per table: Grist's raw-data
  // fallback. Counting those as pages means never building any.
  const live = [
    { id: 3, fields: { name: "UAT_Steps", type: "raw_data" } },
    { id: 4, fields: { name: "Checklist", type: "" } },
  ];
  const plan = planPages(live, [{ name: "Checklist" }, { name: "Reviews" }]);
  assert.deepEqual(plan.create, ["Reviews"]);
});

test("does not rebuild a page that is already there", () => {
  const live = [{ id: 9, fields: { name: "Checklist", type: "" } }];
  assert.deepEqual(planPages(live, [{ name: "Checklist" }]).create, []);
});

test("every declared page names a table the schema declares", () => {
  for (const page of PAGES) {
    for (const section of page.sections) {
      assert.ok(
        SCHEMA[section.table],
        `${page.name} uses undeclared table ${section.table}`,
      );
      if (section.sort) {
        for (const entry of section.sort) {
          const { col } = sortSpec(entry);
          assert.ok(
            SCHEMA[section.table].columns[col],
            `${page.name} sorts ${section.table} by undeclared column ${col}`,
          );
        }
      }
    }
  }
});

test("puts one story and its steps on a single page", () => {
  // The ask this page answers: pick a story, see only its steps, edit one of
  // them, without leaving the page or filtering by hand.
  const story = PAGES.find((page) => page.name === "Story");
  assert.ok(story, "there must be a Story page");
  const [picker, steps, card] = story.sections;

  assert.equal(picker.table, "UAT_Stories");
  assert.equal(steps.table, "UAT_Steps");
  assert.equal(steps.linkFrom, 0, "the step list follows the story picked");
  assert.equal(
    steps.linkVia,
    "story",
    "…through the reference the step already carries",
  );
  assert.equal(card.linkFrom, 1, "the card follows the step picked");
  assert.deepEqual(steps.sort, ["step_order"]);
});

test("names the columns a migration has finished with, so they can go", () => {
  // apply never removes a column it was not told about — Grist keeps bookkeeping
  // columns in these tables and people add their own. Retiring one is therefore
  // something the declaration says out loud, not something inferred from absence.
  assert.deepEqual(SCHEMA.UAT_Steps.retired, ["section", "section_order"]);
  for (const colId of SCHEMA.UAT_Steps.retired) {
    assert.equal(
      colId in SCHEMA.UAT_Steps.columns,
      false,
      `${colId} is retired, not declared`,
    );
  }
});

test("plans the retirement of a column that is still there, and only that one", () => {
  const plan = planColumns(
    [
      live("instance"),
      live("section"),
      live("manualSort", { type: "ManualSortPos" }),
    ],
    { instance: { type: "Text" } },
    ["section", "section_order"],
  );
  // section_order is already gone; manualSort was never ours to remove.
  assert.deepEqual(plan.retire, ["section"]);
  assert.deepEqual(plan.extra, ["manualSort"]);
});

test("hangs a review's stories and steps off the review itself", () => {
  // Without this there is nowhere to see one review whole: the story page lists
  // every story of every review, and the reviews page has nothing under it.
  const reviews = PAGES.find((page) => page.name === "Reviews");
  const [list, stories, steps] = reviews.sections;
  assert.equal(list.table, "UAT_Meta");
  assert.equal(stories.table, "UAT_Stories");
  assert.equal(stories.linkFrom, 0);
  assert.equal(
    stories.linkVia,
    "instance",
    "a story names its review by reference",
  );
  assert.equal(steps.table, "UAT_Steps");
  assert.equal(steps.linkFrom, 1);
  assert.equal(steps.linkVia, "story");
});

test("a story names its review by reference, not by retyping its name", () => {
  // Free text here is why a typo silently created a separate, empty checklist —
  // and why nothing could be hung off a review in the first place.
  assert.equal(SCHEMA.UAT_Stories.columns.instance.type, "Ref:UAT_Meta");
});

// ---- what a submitted review is made of ------------------------------------

test("a submission records who did it, when, and against which build", () => {
  const cols = SCHEMA.UAT_Submissions.columns;
  for (const col of [
    "instance",
    "login",
    "reviewer",
    "submitted_at",
    "host",
    "app_sha",
  ]) {
    assert.ok(cols[col], `UAT_Submissions.${col} must be declared`);
  }
  // login rather than only a display name: it is what the session verified, and
  // two people called Mercy Mwanza are two reviewers.
  assert.equal(cols.login.type, "Text");
  assert.equal(cols.instance.type, "Ref:UAT_Meta");
});

test("an answer pins the story version it was given against", () => {
  const cols = SCHEMA.UAT_Answers.columns;
  for (const col of [
    "review",
    "step_key",
    "story_version",
    "story_revision",
    "mark",
  ]) {
    assert.ok(cols[col], `UAT_Answers.${col} must be declared`);
  }
  assert.equal(cols.review.type, "Ref:UAT_Submissions");
});

test("nothing an answer pins is recomputed from the story it points at", () => {
  // The whole point of pinning. A formula here would follow the story forward:
  // edit a step tomorrow and every review ever given would silently start
  // claiming it was answered against the new wording. These are copies taken at
  // submission, and they are meant to go stale.
  const pinned = [
    "step_key",
    "story_key",
    "story_title",
    "story_version",
    "story_revision",
    "mark",
    "note",
    "actual_url",
  ];
  for (const colId of pinned) {
    const col = SCHEMA.UAT_Answers.columns[colId];
    assert.ok(col, `UAT_Answers.${colId} must be declared`);
    assert.equal(col.type, "Text", `${colId} is a copy, so it is text`);
    assert.equal(
      Boolean(col.isFormula),
      false,
      `${colId} must not be computed from the live story`,
    );
    assert.equal(
      col.formula ?? "",
      "",
      `${colId} must have no formula — a submission writes it once`,
    );
  }
});

test("a review can be read whole, from the person down to the answers", () => {
  const page = PAGES.find((p) => p.name === "Results");
  assert.ok(page, "there must be a Results page");
  const [submissions, answers] = page.sections;
  assert.equal(submissions.table, "UAT_Submissions");
  assert.equal(answers.table, "UAT_Answers");
  assert.equal(answers.linkFrom, 0);
  assert.equal(
    answers.linkVia,
    "review",
    "the answers shown are the ones from the submission picked",
  );
});

test("a page that names a column the table does not have is refused, not sorted by nothing", () => {
  // A typo in the declaration used to be dropped in silence: the page was built,
  // the run reported success, and the section came out sorted by whatever was
  // left. Which is to say, it shipped.
  const refs = new Map([["UAT_Submissions.submitted_at", 12]]);
  assert.deepEqual(
    planSortColRefs("UAT_Submissions", ["-submitted_at"], refs),
    [-12],
  );
  assert.deepEqual(
    planSortColRefs("UAT_Submissions", ["submitted_at"], refs),
    [12],
  );
  assert.throws(
    () => planSortColRefs("UAT_Submissions", ["submited_at"], refs),
    /unknown column submited_at/,
  );
});
