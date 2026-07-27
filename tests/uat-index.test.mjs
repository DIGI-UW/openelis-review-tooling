import assert from "node:assert/strict";
import test from "node:test";
import { buildUatIndex } from "../grist/mcp/uat-document.mjs";

function step(instance, key, fields = {}) {
  return {
    id: key.length + instance.length,
    fields: {
      instance,
      step_key: key,
      section: "A section",
      section_order: 0,
      step_order: Number(key.slice(-1)),
      do: "Do the thing",
      ...fields,
    },
  };
}

const metaRows = [
  { id: 1, fields: { instance: "amr", title: "Microbiology MVP", jira: "OGC-782" } },
  { id: 2, fields: { instance: "analyzers", title: "Analyzer QC", jira: "OGC-1054" } },
];

test("lists every story that has steps", () => {
  const index = buildUatIndex(metaRows, [
    step("amr", "AMR-1", { route: "/Dashboard" }),
    step("analyzers", "AN-1", { route: "/analyzers/types" }),
    step("amr", "AMR-2", { route: "/Microbiology/worklist" }),
  ]);

  assert.equal(index.schemaVersion, 1);
  assert.deepEqual(
    index.stories.map((story) => story.instance),
    ["amr", "analyzers"],
  );
  const amr = index.stories[0];
  assert.equal(amr.title, "Microbiology MVP");
  assert.equal(amr.jira, "OGC-782");
  assert.equal(amr.steps, 2);
});

test("omits a story that has a meta row but nothing to review", () => {
  const index = buildUatIndex(
    [...metaRows, { id: 3, fields: { instance: "ghost", title: "Never written" } }],
    [step("amr", "AMR-1")],
  );

  assert.deepEqual(
    index.stories.map((story) => story.instance),
    ["amr"],
  );
});

test("names a story that has steps but no meta row", () => {
  const index = buildUatIndex([], [step("orphan", "OR-1")]);

  assert.equal(index.stories[0].instance, "orphan");
  assert.equal(index.stories[0].title, "orphan review");
});

test("publishes the pages a story touches, without duplicates or query strings", () => {
  const index = buildUatIndex(metaRows, [
    step("amr", "AMR-1", { route: "/Microbiology/worklist?workflow=BACTERIOLOGY&sort=newest" }),
    step("amr", "AMR-2", { route: "/Microbiology/worklist" }),
    step("amr", "AMR-3", { route: "/Dashboard" }),
    step("amr", "AMR-4" ),
  ]);

  assert.deepEqual(index.stories[0].routes, ["/Dashboard", "/Microbiology/worklist"]);
});

test("refuses a route that would send the reviewer off-origin", () => {
  assert.throws(
    () => buildUatIndex(metaRows, [step("amr", "AMR-1", { route: "/\\evil.example" })]),
    /same-origin/,
  );
});

test("counts how much of a story is required", () => {
  const index = buildUatIndex(metaRows, [
    step("amr", "AMR-1", { required: true }),
    step("amr", "AMR-2", { required: false }),
    step("amr", "AMR-3", { required: "" }),
  ]);

  assert.equal(index.stories[0].steps, 3);
  assert.equal(index.stories[0].required, 2);
});
