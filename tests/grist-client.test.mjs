import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { loadClientConfig } from "../grist/client-config.mjs";
import { buildUatDocument } from "../grist/uat-read/uat-document.mjs";
import { fakeGristDoc, startFakeGrist } from "./helpers/fake-grist.mjs";

const run = promisify(execFile);
const sync = new URL("../grist/grist-sync.mjs", import.meta.url).pathname;
const key = "fixture-author-key";

function authoredDoc() {
  return fakeGristDoc({
    tables: {
      UAT_Meta: {
        records: [
          { id: 1, fields: { instance: "test", title: "Test review" } },
        ],
      },
      UAT_Stories: {
        records: [
          {
            id: 2,
            fields: {
              instance: 1,
              story_key: "S01",
              title: "Current story",
              story_order: 1,
              version: "1.0",
            },
          },
          {
            id: 3,
            fields: {
              instance: 1,
              story_key: "S02",
              title: "Sibling story",
              story_order: 2,
              version: "1.0",
            },
          },
        ],
      },
      UAT_Steps: {
        records: [
          {
            id: 7,
            fields: {
              instance: "test",
              story: 2,
              step_key: "T01",
              step_order: 1,
              required: true,
              do: "Open the report",
              expect: "The report opens",
              route: "/reports",
            },
          },
          {
            id: 8,
            fields: {
              instance: "test",
              story: 3,
              step_key: "T02",
              step_order: 1,
              required: true,
              do: "Open another report",
              route: "/reports",
            },
          },
        ],
      },
      UAT_Answers: {
        records: [
          {
            id: 9,
            fields: {
              step: 7,
              step_key: "T01",
              mark: "pass",
              note: "Original review",
            },
          },
        ],
      },
    },
  });
}

async function client(t, url, docId = "docFAKE") {
  const dir = await mkdtemp(join(tmpdir(), "grist-client-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "grist.api-key"), `${key}\n`, { mode: 0o600 });
  const config = join(dir, "grist.json");
  await writeFile(
    config,
    JSON.stringify({ url, docId, keyFile: "grist.api-key" }),
  );
  const env = {
    ...process.env,
    GRIST_CONFIG_FILE: config,
    GRIST_KEY: "",
    GRIST_KEY_FILE: "",
    GRIST_URL: "",
    GRIST_DOC_ID: "",
    GRIST_ADMIN_EMAIL: "",
  };
  return {
    dir,
    env,
    command: (...args) => run(process.execPath, [sync, ...args], { env }),
    payload: async (value) => {
      const path = join(dir, "story.json");
      await writeFile(path, JSON.stringify(value));
      return path;
    },
  };
}

test("credential file configuration supports headless read preview and repeatable stable-key writes", async (t) => {
  const doc = authoredDoc();
  const server = await startFakeGrist(doc);
  t.after(() => server.stop());
  const c = await client(t, server.url);
  const access = await c.command("check-access");
  assert.match(access.stdout, /owners/);
  assert.ok(
    !doc.calls.some((call) => call.includes("workspaces")),
    "explicit document selection does not discover or create documents",
  );
  const current = JSON.parse(
    (await c.command("read-story", "test", "S01")).stdout,
  );
  assert.equal(current.steps[0].step_key, "T01");
  assert.ok(current.expected_revision);
  const payload = {
    ...current,
    story: { ...current.story, title: "Updated story" },
    steps: [
      ...current.steps,
      {
        step_key: "T03",
        required: true,
        step_order: 2,
        do: "Download CSV",
        expect: "CSV contains the selected fields",
        route: "/reports",
      },
    ],
  };
  const path = await c.payload(payload);
  const before = structuredClone(doc.tables);
  doc.calls.length = 0;
  const preview = JSON.parse(
    (await c.command("apply-story", path, "--dry-run")).stdout,
  );
  assert.deepEqual(preview.add, ["T03"]);
  assert.deepEqual(preview.remove, []);
  assert.deepEqual(doc.tables, before);
  assert.ok(doc.calls.every((call) => call.startsWith("GET ")));
  const applied = await c.command("apply-story", path);
  assert.match(applied.stdout, /verified REST revision/);
  assert.doesNotMatch(applied.stdout + applied.stderr, new RegExp(key));
  assert.equal(doc.tables.UAT_Stories.records[0].id, 2);
  assert.equal(
    doc.tables.UAT_Steps.records.find((row) => row.fields.step_key === "T01")
      .id,
    7,
  );
  assert.deepEqual(
    doc.tables.UAT_Stories.records[1],
    before.UAT_Stories.records[1],
  );
  assert.deepEqual(
    doc.tables.UAT_Steps.records[1],
    before.UAT_Steps.records[1],
  );
  assert.deepEqual(doc.tables.UAT_Answers, before.UAT_Answers);
  doc.calls.length = 0;
  await assert.rejects(
    c.command("apply-story", path),
    /Checklist changed since it was read/,
  );
  assert.ok(doc.calls.every((call) => call.startsWith("GET ")));
  const refreshed = JSON.parse(
    (await c.command("read-story", "test", "S01")).stdout,
  );
  await c.payload(refreshed);
  doc.calls.length = 0;
  await c.command("apply-story", path);
  assert.ok(
    doc.calls.every((call) => call.startsWith("GET ")),
    "repeating the current story performs no writes",
  );
});

test("invalid routes and sibling key collisions fail before any authored row changes", async (t) => {
  const doc = authoredDoc();
  const server = await startFakeGrist(doc);
  t.after(() => server.stop());
  const c = await client(t, server.url);
  const current = JSON.parse(
    (await c.command("read-story", "test", "S01")).stdout,
  );
  for (const patch of [
    { route: "https://elsewhere.test" },
    { step_key: "T02" },
  ]) {
    const path = await c.payload({
      ...current,
      steps: [{ ...current.steps[0], ...patch }],
    });
    doc.calls.length = 0;
    await assert.rejects(
      c.command("apply-story", path),
      /same-origin|duplicate step_key/,
    );
    assert.ok(doc.calls.every((call) => call.startsWith("GET ")));
  }
});

test("missing credentials report setup and never fall back to browser authentication", async (t) => {
  const c = await client(t, "https://grist.example.test");
  await rm(join(c.dir, "grist.api-key"));
  await assert.rejects(
    c.command("check-access"),
    /Cannot read Grist credential file/,
  );
  assert.throws(
    () => loadClientConfig({ GRIST_CONFIG_FILE: c.env.GRIST_CONFIG_FILE }),
    /provision it once/,
  );
});

test("public verification compares the live revision without sending the author credential", async (t) => {
  const doc = authoredDoc();
  const server = await startFakeGrist(doc);
  t.after(() => server.stop());
  const c = await client(t, server.url);
  doc.publicDocument = buildUatDocument(
    "test",
    doc.tables.UAT_Meta.records[0].fields,
    doc.tables.UAT_Steps.records,
    doc.tables.UAT_Stories.records,
  );
  assert.match(
    (await c.command("verify", "test")).stdout,
    /public and REST revision/,
  );
  assert.equal(doc.publicAuthorization, undefined);
  assert.ok(doc.calls.every((call) => call.startsWith("GET ")));
  delete doc.publicDocument;
  await assert.rejects(
    c.command("verify", "test"),
    /Public checklist returned 404/,
  );
});

test("authentication redirects are refused and error bodies cannot print the API credential", async (t) => {
  let status = 302;
  let redirected = false;
  const server = createServer((req, res) => {
    if (req.url === "/login") redirected = true;
    assert.equal(req.headers.authorization, `Bearer ${key}`);
    res.writeHead(status, {
      Location: "/login",
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify({ error: `rejected ${key}` }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const c = await client(t, `http://127.0.0.1:${server.address().port}`);
  await assert.rejects(c.command("check-access"));
  assert.equal(redirected, false);
  status = 401;
  await assert.rejects(c.command("check-access"), (error) => {
    assert.match(error.stderr, /401/);
    assert.doesNotMatch(error.stderr + error.stdout, new RegExp(key));
    return true;
  });
});
