import assert from "node:assert/strict";
import test from "node:test";
import { planStoryMigration } from "../grist/schema.mjs";

const step = (id, fields) => ({ id, fields: { instance: "amr", ...fields } });

test("makes one story per section a review actually has", () => {
  const plan = planStoryMigration([
    step(1, { section: "Open the worklist", section_order: 0 }),
    step(2, { section: "Open the worklist", section_order: 0 }),
    step(3, { section: "Enter results", section_order: 1 }),
  ]);
  assert.deepEqual(
    plan.stories.map((s) => [s.instance, s.title, s.story_order]),
    [["amr", "Open the worklist", 0], ["amr", "Enter results", 1]],
  );
});

test("points every step at the story it was already in", () => {
  const plan = planStoryMigration([
    step(1, { section: "A", section_order: 0 }),
    step(2, { section: "B", section_order: 1 }),
    step(3, { section: "A", section_order: 0 }),
  ]);
  assert.deepEqual(plan.assign, [
    { id: 1, story: 0 },
    { id: 2, story: 1 },
    { id: 3, story: 0 },
  ]);
});

test("keeps reviews apart even when they name a section the same", () => {
  // Two reviews both starting with "Sign in" are two stories, not one shared by
  // both — merging them would put one review's steps under the other's heading.
  const plan = planStoryMigration([
    step(1, { instance: "amr", section: "Sign in", section_order: 0 }),
    step(2, { instance: "analyzers", section: "Sign in", section_order: 0 }),
  ]);
  assert.equal(plan.stories.length, 2);
  assert.deepEqual(plan.stories.map((s) => s.instance), ["amr", "analyzers"]);
});

test("leaves a step that already has a story alone", () => {
  // Migrating twice must not build a second set of stories over the first.
  const plan = planStoryMigration([
    step(1, { section: "A", section_order: 0, story: 7 }),
    step(2, { section: "B", section_order: 1 }),
  ]);
  assert.deepEqual(plan.stories.map((s) => s.title), ["B"]);
  assert.deepEqual(plan.assign, [{ id: 2, story: 0 }]);
});

test("has nothing to do once everything is converted", () => {
  const plan = planStoryMigration([step(1, { section: "A", section_order: 0, story: 7 })]);
  assert.deepEqual(plan.stories, []);
  assert.deepEqual(plan.assign, []);
});

test("gives a section that lost its title something a reviewer can read", () => {
  const plan = planStoryMigration([step(1, { section: "", section_order: 2 })]);
  assert.equal(plan.stories[0].title, "Section 2");
});
