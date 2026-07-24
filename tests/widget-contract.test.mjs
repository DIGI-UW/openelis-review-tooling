import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../widget/oe-review-widget.js", import.meta.url),
  "utf8",
);

function widgetContract() {
  const hooks = {};
  const window = {
    __OE_REVIEW_TEST_HOOKS__: hooks,
    OE_REVIEW_TARGET: { deployment_id: "deploy-123" },
  };
  const context = {
    window,
    document: {
      currentScript: {
        getAttribute(name) {
          if (name === "data-instance") return "amr";
          if (name === "data-label") return "Microbiology MVP";
          return null;
        },
      },
      readyState: "loading",
      addEventListener() {},
      getElementById() {
        return null;
      },
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    location: {
      origin: "https://amr.example.test",
      href: "https://amr.example.test/Microbiology/worklist",
    },
    console,
  };
  vm.runInNewContext(source, context, { filename: "oe-review-widget.js" });
  return hooks;
}

function checklist(steps, revision) {
  return {
    title: "Microbiology MVP",
    instance: "amr",
    checklist_revision: revision,
    sections: [{ title: "Workflow", steps }],
  };
}

const step = (id, action, route = "/Microbiology/worklist") => ({
  step_id: id,
  do: action,
  expect: `${action} succeeds`,
  route,
});

test("legacy static checklists receive deterministic IDs and revisions", () => {
  const contract = widgetContract();
  const input = {
    title: "Static review",
    sections: [
      {
        title: "Start",
        steps: [
          { do: "Open the page", expect: "The page loads" },
          { do: "Submit the form", expect: "The form saves" },
        ],
      },
    ],
  };

  const first = contract.normalizeChecklist(input);
  const second = contract.normalizeChecklist(input);

  assert.match(first.checklist_revision, /^static:[a-f0-9]{8}$/);
  assert.deepEqual(
    first.sections[0].steps.map((item) => item.step_id),
    second.sections[0].steps.map((item) => item.step_id),
  );
});

test("reorder and insert preserve unchanged answers by stable ID", () => {
  const contract = widgetContract();
  const before = contract.normalizeChecklist(
    checklist(
      [
        step("grist:101", "Open the worklist"),
        step("grist:102", "Record an isolate"),
        step("grist:103", "Enter an AST result"),
      ],
      "revision-before",
    ),
  );
  const state = contract.fresh();
  for (const item of before.sections[0].steps) {
    state.steps[item.step_id] = {
      mark: item.step_id === "grist:101" ? "pass" : "fail",
      note: item.do,
      fingerprint: item._fingerprint,
    };
  }

  const after = contract.normalizeChecklist(
    checklist(
      [
        step("grist:102", "Record an isolate"),
        step("grist:104", "Review the report"),
        step("grist:101", "Open the worklist"),
      ],
      "revision-after",
    ),
  );
  const migrated = contract.migrateState(state, after);

  assert.equal(migrated.carried, 2);
  assert.equal(migrated.dropped, 1);
  assert.equal(migrated.state.steps["grist:101"].mark, "pass");
  assert.equal(migrated.state.steps["grist:102"].mark, "fail");
  assert.equal(migrated.state.steps["grist:103"], undefined);
  assert.equal(migrated.state.steps["grist:104"], undefined);
});

test("rewritten steps do not inherit an answer with the same row ID", () => {
  const contract = widgetContract();
  const before = contract.normalizeChecklist(
    checklist([step("grist:101", "Open the worklist")], "revision-before"),
  );
  const state = contract.fresh();
  state.steps["grist:101"] = {
    mark: "pass",
    note: "looked good",
    fingerprint: before.sections[0].steps[0]._fingerprint,
  };

  const after = contract.normalizeChecklist(
    checklist([step("grist:101", "Open and filter the worklist")], "revision-after"),
  );
  const migrated = contract.migrateState(state, after);

  assert.equal(migrated.carried, 0);
  assert.equal(migrated.dropped, 1);
  assert.equal(migrated.state.steps["grist:101"], undefined);
});

test("storage namespace changes with checklist revision", () => {
  const contract = widgetContract();
  const first = contract.storageKeys("amr", "deploy-123", "revision-a");
  const second = contract.storageKeys("amr", "deploy-123", "revision-b");

  assert.notEqual(first.current, second.current);
  assert.equal(first.latest, second.latest);
});

test("reports retain stable IDs, revision, route, and summary", () => {
  const contract = widgetContract();
  const normalized = contract.normalizeChecklist(
    checklist(
      [
        step("grist:101", "Open the worklist"),
        step("grist:102", "Record an isolate", "/Microbiology/cases/42"),
      ],
      "revision-report",
    ),
  );
  const state = contract.fresh();
  for (const item of normalized.sections[0].steps) {
    state.steps[item.step_id] = {
      mark: item.step_id === "grist:101" ? "pass" : "fail",
      note: item.step_id === "grist:102" ? "Needs another pass" : "",
      fingerprint: item._fingerprint,
    };
  }

  const report = contract.buildReportFor(normalized, state, {
    instance: "amr",
    label: "Microbiology MVP",
    origin: "https://amr.example.test",
    deployment_id: "deploy-123",
    generated: "2026-07-24T20:00:00.000Z",
  });
  const json = JSON.parse(report.json);

  assert.equal(json.checklist_revision, "revision-report");
  assert.equal(json.summary.pass, 1);
  assert.equal(json.summary.fail, 1);
  assert.equal(json.checklist[0].steps[1].step_id, "grist:102");
  assert.equal(json.checklist[0].steps[1].route, "/Microbiology/cases/42");
  assert.match(report.md, /Checklist revision: `revision-report`/);
  assert.match(report.md, /step id: `grist:102`/);
  assert.match(report.md, /route: `\/Microbiology\/cases\/42`/);
  assert.match(report.md, /\*\*Summary:\*\* 1 pass · 1 fail · 0 n\/a · 0 untested/);
});
