import assert from "node:assert/strict";
import test from "node:test";
import { buildUatIndex, parsePublished } from "../grist/mcp/uat-document.mjs";

function story(id, instance, key, fields = {}) {
  return {
    id,
    fields: {
      instance,
      story_key: key,
      title: `${key} title`,
      story_order: id,
      ...fields,
    },
  };
}

function step(instance, key, storyId, fields = {}) {
  return {
    id: key.length + instance.length,
    fields: {
      instance,
      step_key: key,
      story: storyId,
      step_order: Number(key.slice(-1)),
      do: "Do the thing",
      ...fields,
    },
  };
}

const metaRows = [
  {
    id: 1,
    fields: {
      instance: "amr",
      title: "Microbiology MVP",
      jira: "OGC-782",
      published: true,
    },
  },
  {
    id: 2,
    fields: {
      instance: "analyzers",
      title: "Analyzer QC",
      jira: "OGC-1054",
      published: true,
    },
  },
];

const storyRows = [
  story(11, 1, "AMR-S01", {
    title: "Find and route microbiology work",
    story_order: 0,
    jira: "OGC-782",
    hosts: "amr.openelis-global.org",
  }),
  story(12, 1, "AMR-S02", {
    title: "Work the bacteriology case",
    story_order: 1,
    jira: "OGC-782",
  }),
  story(21, 2, "AN-S01", {
    title: "Configure an analyzer",
    story_order: 0,
    jira: "OGC-1054",
  }),
];

test("lists every real story that has steps", () => {
  const index = buildUatIndex(
    metaRows,
    [
      step("amr", "AMR-1", 11, { route: "/Dashboard" }),
      step("analyzers", "AN-1", 21, { route: "/analyzers/types" }),
      step("amr", "AMR-2", 11, { route: "/Microbiology/worklist" }),
      step("amr", "AMR-3", 12, { route: "/Microbiology/worklist" }),
    ],
    storyRows,
  );

  assert.equal(index.schemaVersion, 2);
  assert.deepEqual(
    index.stories.map((item) => item.id),
    ["amr--AMR-S01", "amr--AMR-S02", "analyzers--AN-S01"],
  );
  const first = index.stories[0];
  assert.equal(first.review, "amr");
  assert.equal(first.key, "AMR-S01");
  assert.equal(first.title, "Find and route microbiology work");
  assert.equal(first.jira, "OGC-782");
  assert.equal(first.steps, 2);
  assert.deepEqual(first.hosts, ["amr.openelis-global.org"]);
});

test("omits a story that has no steps", () => {
  const index = buildUatIndex(metaRows, [step("amr", "AMR-1", 11)], storyRows);

  assert.deepEqual(
    index.stories.map((item) => item.id),
    ["amr--AMR-S01"],
  );
});

test("does not list stories from an unpublished review", () => {
  const draftMeta = {
    id: 9,
    fields: {
      instance: "draft",
      title: "Unreleased thing",
      jira: "OGC-999",
    },
  };
  const draftStory = story(91, 9, "DRAFT-S01", {
    title: "Unreleased story",
    jira: "OGC-999",
  });
  const index = buildUatIndex(
    [...metaRows, draftMeta],
    [step("amr", "AMR-1", 11), step("draft", "DR-1", 91)],
    [...storyRows, draftStory],
  );

  assert.deepEqual(index.stories.map((item) => item.id), ["amr--AMR-S01"]);
  assert.equal(JSON.stringify(index).includes("draft"), false);
  assert.equal(JSON.stringify(index).includes("OGC-999"), false);
});

test("stories with no review row are not published", () => {
  const orphan = story(99, 404, "OR-S01");
  const index = buildUatIndex(
    [],
    [step("orphan", "OR-1", 99)],
    [orphan],
  );
  assert.deepEqual(index.stories, []);
});

test("reads the published flag the way Grist can store it", () => {
  for (const yes of [true, "true", "TRUE", " yes ", "1", "on"]) {
    assert.equal(parsePublished(yes), true, `expected ${JSON.stringify(yes)} to publish`);
  }
  for (const no of [
    undefined,
    null,
    false,
    "",
    "  ",
    "false",
    "no",
    "0",
    "off",
    "maybe",
  ]) {
    assert.equal(parsePublished(no), false, `expected ${JSON.stringify(no)} to stay private`);
  }
});

test("publishes the pages each story touches without duplicates or query strings", () => {
  const index = buildUatIndex(
    metaRows,
    [
      step("amr", "AMR-1", 11, {
        route: "/Microbiology/worklist?workflow=BACTERIOLOGY&sort=newest",
      }),
      step("amr", "AMR-2", 11, { route: "/Microbiology/worklist" }),
      step("amr", "AMR-3", 11, { route: "/Dashboard" }),
      step("amr", "AMR-4", 11),
      step("amr", "AMR-5", 12, { route: "/Microbiology/case/1" }),
    ],
    storyRows,
  );

  assert.deepEqual(index.stories[0].routes, [
    "/Dashboard",
    "/Microbiology/worklist",
  ]);
  assert.deepEqual(index.stories[1].routes, ["/Microbiology/case/1"]);
});

test("leaves an off-origin route out of its story and says why", () => {
  const index = buildUatIndex(
    metaRows,
    [
      step("amr", "AMR-1", 11, { route: "/\\evil.example" }),
      step("amr", "AMR-2", 11, { route: "/Dashboard" }),
    ],
    storyRows,
  );

  assert.deepEqual(index.stories[0].routes, ["/Dashboard"]);
  assert.equal(index.stories[0].steps, 2);
  assert.equal(index.warnings.length, 1);
  assert.match(index.warnings[0], /^AMR-S01: /);
  assert.match(index.warnings[0], /same-origin/);
});

test("says nothing when every route is sound", () => {
  const index = buildUatIndex(
    metaRows,
    [step("amr", "AMR-1", 11, { route: "/Dashboard" })],
    storyRows,
  );
  assert.deepEqual(index.warnings, []);
});

test("counts how much of each story is required", () => {
  const index = buildUatIndex(
    metaRows,
    [
      step("amr", "AMR-1", 11, { required: true }),
      step("amr", "AMR-2", 11, { required: false }),
      step("amr", "AMR-3", 11, { required: "" }),
    ],
    storyRows,
  );

  assert.equal(index.stories[0].steps, 3);
  assert.equal(index.stories[0].required, 2);
});
