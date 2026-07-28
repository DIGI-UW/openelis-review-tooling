import assert from "node:assert/strict";
import test from "node:test";
import { buildUatDocument } from "../grist/mcp/uat-document.mjs";

// Grist returns a Ref column as the row id it points at, and 0 when it is empty.
function story(id, fields = {}) {
  return {
    id,
    fields: { instance: "amr", story_key: `S${id}`, title: `Story ${id}`, story_order: id, ...fields },
  };
}
function step(id, storyId, fields = {}) {
  return {
    id,
    fields: {
      instance: "amr",
      step_key: `AMR-${id}`,
      required: true,
      story: storyId,
      step_order: id,
      do: `Do ${id}`,
      ...fields,
    },
  };
}

test("nests steps under the story they belong to", () => {
  const doc = buildUatDocument(
    "amr",
    { title: "Microbiology" },
    [step(3, 2), step(1, 1), step(2, 1)],
    [story(1, { story_order: 0 }), story(2, { story_order: 1 })],
  );
  assert.deepEqual(
    doc.sections.map((s) => [s.title, s.steps.map((step) => step.key)]),
    [
      ["Story 1", ["AMR-1", "AMR-2"]],
      ["Story 2", ["AMR-3"]],
    ],
  );
});

test("gives a story an identity of its own", () => {
  // The title is what a reviewer reads; the key is what survives retitling, so it
  // is the half anything else can point at.
  const doc = buildUatDocument("amr", {}, [step(1, 1)], [story(1, { story_key: "AMR-WORKLIST" })]);
  assert.equal(doc.sections[0].key, "AMR-WORKLIST");
});

test("carries the links an author filled in and leaves out the ones they did not", () => {
  const doc = buildUatDocument(
    "amr",
    {},
    [step(1, 1)],
    [
      story(1, {
        jira: "OGC-782",
        pr: "https://github.com/DIGI-UW/OpenELIS-Global-2/pull/3195",
        mock: "",
        user_story: "As a microbiologist I want the worklist to keep my filters",
      }),
    ],
  );
  assert.deepEqual(doc.sections[0].links, {
    jira: "OGC-782",
    pr: "https://github.com/DIGI-UW/OpenELIS-Global-2/pull/3195",
    userStory: "As a microbiologist I want the worklist to keep my filters",
  });
});

test("says nothing about links when a story has none", () => {
  const doc = buildUatDocument("amr", {}, [step(1, 1)], [story(1)]);
  assert.equal("links" in doc.sections[0], false);
});

test("keeps the user story as prose rather than requiring a link", () => {
  // Not every user story is written down somewhere with a URL, and demanding one
  // means the field goes unused.
  const doc = buildUatDocument("amr", {}, [step(1, 1)], [story(1, { user_story: "Reviewers can hand a review over mid-flight" })]);
  assert.equal(doc.sections[0].links.userStory, "Reviewers can hand a review over mid-flight");
});

test("carries the hosts a story is limited to", () => {
  const doc = buildUatDocument(
    "amr",
    {},
    [step(1, 1)],
    [story(1, { hosts: "amr.openelis-global.org\n10.0.0.4:8443" })],
  );
  assert.deepEqual(doc.sections[0].hosts, ["amr.openelis-global.org", "10.0.0.4:8443"]);
});

test("a story with no hosts is a story that shows everywhere", () => {
  const doc = buildUatDocument("amr", {}, [step(1, 1)], [story(1)]);
  assert.equal("hosts" in doc.sections[0], false);
});

test("refuses a step that belongs to no story", () => {
  // The reviewer would otherwise be shown a step with no heading, or not shown it
  // at all — and which of those happened would depend on the renderer.
  assert.throws(
    () => buildUatDocument("amr", {}, [step(1, 0)], [story(1)]),
    /step AMR-1 has no story/,
  );
});

test("refuses two stories claiming the same key", () => {
  assert.throws(
    () =>
      buildUatDocument("amr", {}, [step(1, 1), step(2, 2)], [
        story(1, { story_key: "SAME" }),
        story(2, { story_key: "SAME" }),
      ]),
    /duplicate story_key SAME/,
  );
});

test("leaves out a story that has no steps", () => {
  // Listing it would offer the reviewer a heading with nothing under it.
  const doc = buildUatDocument("amr", {}, [step(1, 1)], [story(1), story(2)]);
  assert.deepEqual(doc.sections.map((s) => s.title), ["Story 1"]);
});

test("still refuses a step with no key, and an off-origin route", () => {
  assert.throws(
    () => buildUatDocument("amr", {}, [step(1, 1, { step_key: "" })], [story(1)]),
    /missing step_key/,
  );
  assert.throws(
    () => buildUatDocument("amr", {}, [step(1, 1, { route: "//evil.example" })], [story(1)]),
    /same-origin/,
  );
});

test("keeps emitting sections, so a deployed widget still renders it", () => {
  // The wire key is unchanged and the new fields are additive: a widget that
  // predates stories ignores them and shows the checklist exactly as before.
  const doc = buildUatDocument("amr", { title: "T" }, [step(1, 1)], [story(1)]);
  assert.ok(Array.isArray(doc.sections));
  assert.equal(doc.sections[0].steps[0].do, "Do 1");
  assert.equal(doc.sections[0].steps[0].required, true);
});
