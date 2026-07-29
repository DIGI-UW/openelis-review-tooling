import assert from "node:assert/strict";
import test from "node:test";
import { buildUatDocument } from "../grist/mcp/uat-document.mjs";

const story = (id, fields = {}) => ({
  id,
  fields: { instance: 1, story_key: `S${id}`, title: `Story ${id}`, story_order: id, ...fields },
});
const step = (id, storyId, fields = {}) => ({
  id,
  fields: {
    instance: "amr", step_key: `AMR-${id}`, required: true,
    story: storyId, step_order: id, do: `Do ${id}`, ...fields,
  },
});
const revisions = (doc) => Object.fromEntries(doc.sections.map((s) => [s.key, s.revision]));

test("a story carries a revision of its own", () => {
  const doc = buildUatDocument("amr", {}, [step(1, 1)], [story(1)]);
  assert.match(doc.sections[0].revision, /^[a-f0-9]{12}$/);
});

test("the revision follows the story's content, not the document's", () => {
  // A review is pinned to what its story said when it was answered. Editing one
  // story must not invalidate reviews of the others, which is what would happen
  // if everything hung off the document-wide revision.
  const before = buildUatDocument("amr", {}, [step(1, 1), step(2, 2)], [story(1), story(2)]);
  const after = buildUatDocument("amr", {}, [step(1, 1, { do: "Do it differently" }), step(2, 2)], [story(1), story(2)]);

  assert.notEqual(revisions(before).S1, revisions(after).S1, "the edited story changes");
  assert.equal(revisions(before).S2, revisions(after).S2, "its neighbour does not");
  assert.notEqual(before.checklistRevision, after.checklistRevision, "the document still changes");
});

test("changes when anything a reviewer judges against changes", () => {
  const base = buildUatDocument("amr", {}, [step(1, 1)], [story(1)]);
  for (const [what, docFn] of [
    ["the instruction", () => buildUatDocument("amr", {}, [step(1, 1, { do: "Something else" })], [story(1)])],
    ["the expected result", () => buildUatDocument("amr", {}, [step(1, 1, { expect: "Now it says this" })], [story(1)])],
    ["whether it is required", () => buildUatDocument("amr", {}, [step(1, 1, { required: false })], [story(1)])],
    ["the route", () => buildUatDocument("amr", {}, [step(1, 1, { route: "/elsewhere" })], [story(1)])],
    ["the heading", () => buildUatDocument("amr", {}, [step(1, 1)], [story(1, { title: "Renamed" })])],
    ["a step being added", () => buildUatDocument("amr", {}, [step(1, 1), step(3, 1)], [story(1)])],
  ]) {
    assert.notEqual(base.sections[0].revision, docFn().sections[0].revision, `${what} must change the revision`);
  }
});

test("does not change when something a reviewer never sees changes", () => {
  // Reordering the stories, or renaming the review, leaves every answer as valid
  // as it was. A revision that moved for those would flag every review stale for
  // nothing, and a staleness signal nobody believes is worse than none.
  const base = buildUatDocument("amr", { title: "A" }, [step(1, 1)], [story(1)]);
  const renamed = buildUatDocument("amr", { title: "B" }, [step(1, 1)], [story(1)]);
  const moved = buildUatDocument("amr", { title: "A" }, [step(1, 1)], [story(1, { story_order: 9 })]);
  assert.equal(base.sections[0].revision, renamed.sections[0].revision);
  assert.equal(base.sections[0].revision, moved.sections[0].revision);
});

test("is stable across runs, so it can be compared later", () => {
  const a = buildUatDocument("amr", {}, [step(1, 1)], [story(1)]);
  const b = buildUatDocument("amr", {}, [step(1, 1)], [story(1)]);
  assert.equal(a.sections[0].revision, b.sections[0].revision);
});

test("two stories with identical content still have their own identity", () => {
  // Same steps, different story: pinning a review to a revision has to say which
  // story it was, and the key does that — the revision only says which content.
  const doc = buildUatDocument("amr", {},
    [step(1, 1), step(2, 2)],
    [story(1, { title: "Same" }), story(2, { title: "Same" })]);
  assert.notEqual(doc.sections[0].key, doc.sections[1].key);
});

test("carries the version its author set, beside the revision nobody sets", () => {
  const doc = buildUatDocument("amr", {}, [step(1, 1)], [story(1, { version: "2.1" })]);
  assert.equal(doc.sections[0].version, "2.1");
  assert.match(doc.sections[0].revision, /^[a-f0-9]{12}$/);
});

test("a story with no version stated is version 1.0", () => {
  // Rather than absent: an answer pins the version it was given against, and
  // "none" is not something a later comparison can reason about.
  const doc = buildUatDocument("amr", {}, [step(1, 1)], [story(1)]);
  assert.equal(doc.sections[0].version, "1.0");
});

test("the version moves only when an author moves it", () => {
  // This is the whole point of having both. Rewording an expectation changes what
  // the text says without changing whether prior answers still count — only the
  // author knows which it is, so only the author sets the version.
  const before = buildUatDocument("amr", {}, [step(1, 1)], [story(1, { version: "1.0" })]);
  const reworded = buildUatDocument("amr", {}, [step(1, 1, { expect: "Reworded, same meaning" })], [story(1, { version: "1.0" })]);
  assert.equal(before.sections[0].version, reworded.sections[0].version, "the author said nothing, so the version stands");
  assert.notEqual(before.sections[0].revision, reworded.sections[0].revision, "the text moved, and that is recorded");
});
