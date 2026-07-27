import assert from "node:assert/strict";
import test from "node:test";
import { buildUatIndex, parsePublished } from "../grist/mcp/uat-document.mjs";

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
  { id: 1, fields: { instance: "amr", title: "Microbiology MVP", jira: "OGC-782", published: true } },
  { id: 2, fields: { instance: "analyzers", title: "Analyzer QC", jira: "OGC-1054", published: true } },
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

test("does not list a story that nobody has published", () => {
  const draft = { id: 9, fields: { instance: "draft", title: "Unreleased thing", jira: "OGC-999" } };
  const index = buildUatIndex([...metaRows, draft], [step("amr", "AMR-1"), step("draft", "DR-1")]);

  // The catalog is readable by anyone, so a slug, title and Jira key reach the
  // world the moment the row is saved unless the default is "not yet".
  assert.deepEqual(index.stories.map((story) => story.instance), ["amr"]);
  // …and it must not name what it withheld, which would defeat the point.
  assert.equal(JSON.stringify(index).includes("draft"), false);
  assert.equal(JSON.stringify(index).includes("OGC-999"), false);
});

test("steps with no meta row at all are not published by omission", () => {
  const index = buildUatIndex([], [step("orphan", "OR-1")]);
  assert.deepEqual(index.stories, []);
});

test("reads the published flag the way Grist can store it", () => {
  for (const yes of [true, "true", "TRUE", " yes ", "1", "on"]) {
    assert.equal(parsePublished(yes), true, `expected ${JSON.stringify(yes)} to publish`);
  }
  // Unset is the case that matters: Grist backfills a new Bool column with false,
  // and a blank cell must never read as "go ahead".
  for (const no of [undefined, null, false, "", "  ", "false", "no", "0", "off", "maybe"]) {
    assert.equal(parsePublished(no), false, `expected ${JSON.stringify(no)} to stay private`);
  }
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

test("leaves an off-origin route out of the catalog and says why", () => {
  const index = buildUatIndex(metaRows, [
    step("amr", "AMR-1", { route: "/\\evil.example" }),
    step("amr", "AMR-2", { route: "/Dashboard" }),
  ]);

  // The catalog covers every story on the deployment, so one bad row in somebody
  // else's draft must not take it — or the deploy gated on it — down.
  assert.deepEqual(index.stories[0].routes, ["/Dashboard"]);
  assert.equal(index.stories[0].steps, 2);
  assert.equal(index.warnings.length, 1);
  assert.match(index.warnings[0], /^amr: /);
  assert.match(index.warnings[0], /same-origin/);
});

test("says nothing when every route is sound", () => {
  const index = buildUatIndex(metaRows, [step("amr", "AMR-1", { route: "/Dashboard" })]);
  assert.deepEqual(index.warnings, []);
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
