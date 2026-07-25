import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("shipped checklist revisions are the real content hash, not a hand-written label", () => {
  // They were literals ("seed-amr-v3"), so editing a step silently left the
  // revision — and therefore the reviewer's storage key — pointing at stale
  // content. Recompute the way the builder does and require a match.
  for (const file of readdirSync(examples).filter((name) => name.endsWith(".json"))) {
    const checklist = JSON.parse(readFileSync(join(examples, file), "utf8"));
    const { checklistRevision, ...content } = checklist;
    const expected = createHash("sha256")
      .update(JSON.stringify(content))
      .digest("hex");
    assert.equal(
      checklistRevision,
      expected,
      `${file}: revision does not match its content — regenerate it`,
    );
  }
});
