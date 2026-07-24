import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";

const examples = join(import.meta.dirname, "..", "widget", "examples");

test("all shipped checklists use schema v2 and unique stable step keys", () => {
  for (const file of readdirSync(examples).filter((name) => name.endsWith(".json"))) {
    const checklist = JSON.parse(readFileSync(join(examples, file), "utf8"));
    assert.equal(checklist.schemaVersion, 2, file);
    assert.ok(checklist.checklistRevision, file);
    const keys = checklist.sections.flatMap((section) =>
      section.steps.map((step) => step.key),
    );
    assert.ok(keys.every(Boolean), `${file} has a missing step key`);
    assert.equal(new Set(keys).size, keys.length, `${file} has duplicate step keys`);
  }
});
