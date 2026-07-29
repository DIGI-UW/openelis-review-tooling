// Handing a review in.
//
// The point of the endpoint is that the name on a submission is not one the
// submitter typed. Everything here is about that: the service asks the
// application who holds the cookie, and writes down the answer it gets rather
// than the one it was sent.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { fakeGristDoc, startFakeGrist } from "./helpers/fake-grist.mjs";
import { startFakeOpenELIS } from "./helpers/fake-openelis.mjs";

const SERVER = new URL("../grist/mcp/server.mjs", import.meta.url).pathname;

const MERCY = {
  authenticated: true,
  loginName: "mmwanza",
  firstName: "Mercy",
  lastName: "Mwanza",
};

function seededDoc() {
  const col = (id, fields = {}) => ({
    id,
    fields: { type: "Text", label: id, ...fields },
  });
  return fakeGristDoc({
    tables: {
      UAT_Meta: {
        columns: [col("instance"), col("title")],
        records: [
          { id: 7, fields: { instance: "amr", title: "Microbiology" } },
        ],
      },
      UAT_Stories: {
        columns: [
          col("instance", { type: "Ref:UAT_Meta" }),
          col("story_key"),
          col("title"),
          col("version"),
        ],
        records: [
          {
            id: 3,
            fields: {
              instance: 7,
              story_key: "AMR-S01",
              title: "Open the worklist",
              version: "1.2",
            },
          },
        ],
      },
      UAT_Steps: {
        columns: [
          col("instance"),
          col("step_key"),
          col("story", { type: "Ref:UAT_Stories" }),
        ],
        records: [
          { id: 5, fields: { instance: "amr", step_key: "AMR-001", story: 3 } },
        ],
      },
      UAT_Submissions: {
        columns: [
          col("instance"),
          col("login"),
          col("reviewer"),
          col("submitted_at"),
          col("host"),
          col("app_sha"),
          col("checklist_revision"),
          col("note"),
        ],
        records: [],
      },
      UAT_Answers: {
        columns: [
          col("review"),
          col("step_key"),
          col("story_key"),
          col("story_title"),
          col("story_version"),
          col("story_revision"),
          col("mark"),
          col("note"),
          col("actual_url"),
        ],
        records: [],
      },
    },
  });
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

// Runs the real service, unmodified, against the two fakes it talks to.
async function withService(doc, sessions, env, body) {
  const grist = await startFakeGrist(doc);
  const app = await startFakeOpenELIS(sessions);
  const port = await freePort();
  const child = spawn("node", [SERVER], {
    env: {
      ...process.env,
      GRIST_URL: grist.url,
      GRIST_KEY: "test-key",
      PORT: String(port),
      // ghost is a verifiable deployment with no review of that name, which is
      // a different refusal from a deployment that cannot verify anyone.
      REVIEW_BACKENDS: `amr=${app.url},ghost=${app.url}`,
      ...env,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const logs = [];
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));

  try {
    let up = false;
    for (let attempt = 0; attempt < 100 && !up; attempt++) {
      try {
        up = (await fetch(`http://127.0.0.1:${port}/healthz`)).ok;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    // Otherwise every assertion below fails with "fetch failed" and the reason —
    // which the service printed and this captured — is thrown away. That is how
    // a missing dependency reads as eight broken tests.
    if (!up) {
      throw new Error(
        `the review service did not start on :${port}\n${logs.join("") || "(it printed nothing)"}`,
      );
    }
    const response = await body(`http://127.0.0.1:${port}`);
    return { response, app, logs: logs.join("") };
  } finally {
    child.kill();
    await grist.stop();
    await app.stop();
  }
}

const submit = (base, { cookie, payload, instance = "amr" }) =>
  fetch(`${base}/uat/${instance}/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(payload),
  });

const ANSWER = {
  stepKey: "AMR-001",
  storyKey: "AMR-S01",
  storyTitle: "Open the worklist",
  storyVersion: "1.2",
  storyRevision: "a1b2c3d4e5f6",
  mark: "fail",
  note: "the worklist was empty",
  actualUrl: "https://amr.openelis-global.org/MicrobiologyWorklist",
};

test("the name on a submission is the one the application vouched for", async () => {
  // The whole reason this endpoint exists. A submission that could name its own
  // author would be a form, not a record — so the body says one thing here and
  // the session says another, and the session wins.
  const doc = seededDoc();
  await withService(doc, { "JSESSIONID=real": MERCY }, {}, async (base) => {
    const res = await submit(base, {
      cookie: "JSESSIONID=real",
      payload: {
        login: "someone-else",
        reviewer: "Someone Else",
        answers: [ANSWER],
      },
    });
    assert.equal(res.status, 201, await res.text());
  });

  const [row] = doc.tables.UAT_Submissions.records;
  assert.equal(
    row.fields.login,
    "mmwanza",
    "the login comes from the session, never the body",
  );
  assert.equal(row.fields.reviewer, "Mercy Mwanza");
  assert.equal(
    row.fields.instance,
    7,
    "the submission points at the review's row",
  );
});

test("it is the reviewer's own cookie that gets checked", async () => {
  // Not a token the service holds, and not a claim in the body: the credential
  // is the session the reviewer already has with the application.
  const doc = seededDoc();
  const { app } = await withService(
    doc,
    { "JSESSIONID=real": MERCY },
    {},
    (base) =>
      submit(base, {
        cookie: "JSESSIONID=real",
        payload: { answers: [ANSWER] },
      }),
  );
  assert.equal(app.seen.length, 1, "the application was asked exactly once");
  assert.equal(
    app.seen[0].cookie,
    "JSESSIONID=real",
    "…with the reviewer's cookie",
  );
  assert.match(app.seen[0].url, /session/);
});

test("an anonymous reviewer is refused, and nothing is written", async () => {
  const doc = seededDoc();
  const { response } = await withService(doc, {}, {}, (base) =>
    submit(base, { payload: { answers: [ANSWER] } }),
  );
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(
    body.needsLogin,
    true,
    "the widget has to be able to tell this apart from a fault",
  );
  assert.equal(doc.tables.UAT_Submissions.records.length, 0);
  assert.equal(doc.tables.UAT_Answers.records.length, 0);
});

test("a deployment that cannot verify anyone refuses to record a name", async () => {
  // Accepting here would write down a name nothing checked, which is worse than
  // not accepting: it looks exactly like one that was verified.
  const doc = seededDoc();
  const { response } = await withService(
    doc,
    { "JSESSIONID=real": MERCY },
    { REVIEW_BACKENDS: "" },
    (base) =>
      submit(base, {
        cookie: "JSESSIONID=real",
        payload: { answers: [ANSWER] },
      }),
  );
  assert.equal(response.status, 501);
  assert.equal(doc.tables.UAT_Submissions.records.length, 0);
});

test("every answer is stored under the submission with what it was answered against", async () => {
  const doc = seededDoc();
  await withService(doc, { "JSESSIONID=real": MERCY }, {}, (base) =>
    submit(base, {
      cookie: "JSESSIONID=real",
      payload: {
        checklistRevision: "rev-9",
        appSha: "deadbee",
        answers: [
          ANSWER,
          { ...ANSWER, stepKey: "AMR-002", mark: "pass", note: "" },
        ],
      },
    }),
  );

  const submission = doc.tables.UAT_Submissions.records[0];
  assert.equal(submission.fields.checklist_revision, "rev-9");
  assert.equal(submission.fields.app_sha, "deadbee");

  const answers = doc.tables.UAT_Answers.records;
  assert.equal(answers.length, 2);
  for (const answer of answers) {
    assert.equal(
      answer.fields.review,
      submission.id,
      "each answer points at its submission",
    );
    assert.equal(
      answer.fields.story_version,
      "1.2",
      "the version it was answered against",
    );
    assert.equal(answer.fields.story_revision, "a1b2c3d4e5f6");
  }
  const failed = answers.find((a) => a.fields.mark === "fail");
  assert.equal(failed.fields.note, "the worklist was empty");
  assert.equal(failed.fields.actual_url, ANSWER.actualUrl);

  // Resolvable step keys become a way to click through to the step; one that
  // matches nothing leaves the reference empty rather than refusing the answer,
  // because the answer is still evidence about a step that used to exist.
  assert.equal(failed.fields.step, 5, "AMR-001 is a step in this review");
  const orphan = answers.find((a) => a.fields.step_key === "AMR-002");
  assert.equal(orphan.fields.step, 0);
});

test("when it was handed in is the server's answer, not the reviewer's", async () => {
  // A clock the submitter controls is not a timestamp, and a review's date is
  // the sort of thing that gets read back months later as fact.
  const doc = seededDoc();
  const before = Math.floor(Date.now() / 1000);
  await withService(doc, { "JSESSIONID=real": MERCY }, {}, (base) =>
    submit(base, {
      cookie: "JSESSIONID=real",
      payload: { submittedAt: 0, answers: [ANSWER] },
    }),
  );
  const at = doc.tables.UAT_Submissions.records[0].fields.submitted_at;
  assert.equal(typeof at, "number", "Grist stores a DateTime as epoch seconds");
  assert.ok(
    at >= before,
    `submitted_at ${at} must be the server's clock, not the body's 0`,
  );
});

test("a submission with no answers is refused", async () => {
  const doc = seededDoc();
  const { response } = await withService(
    doc,
    { "JSESSIONID=real": MERCY },
    {},
    (base) =>
      submit(base, { cookie: "JSESSIONID=real", payload: { answers: [] } }),
  );
  assert.equal(response.status, 400);
  assert.equal(doc.tables.UAT_Submissions.records.length, 0);
});

test("a submission against an unknown review is refused rather than filed under nothing", async () => {
  const doc = seededDoc();
  const { response } = await withService(
    doc,
    { "JSESSIONID=real": MERCY },
    {},
    (base) =>
      submit(base, {
        cookie: "JSESSIONID=real",
        payload: { answers: [ANSWER] },
        instance: "ghost",
      }),
  );
  assert.equal(response.status, 404);
  assert.equal(doc.tables.UAT_Submissions.records.length, 0);
});

test("a config entry that names no backend is refused, not half-read", async () => {
  // "amr" with no "=" used to map instance "am" to a URL of "amr": indexOf
  // returns -1, so one slice drops the last character and the other returns the
  // whole string, and both are truthy enough to survive a filter. A typo in the
  // deployment's environment became a backend that answers for a review nobody
  // named.
  const doc = seededDoc();
  const { response } = await withService(
    doc,
    { "JSESSIONID=real": MERCY },
    { REVIEW_BACKENDS: "amr" },
    (base) =>
      submit(base, {
        cookie: "JSESSIONID=real",
        payload: { answers: [ANSWER] },
        instance: "am",
      }),
  );
  assert.equal(response.status, 501, "no backend was configured for anything");
  assert.equal(doc.tables.UAT_Submissions.records.length, 0);
});

test("the host recorded is the one the request arrived on", async () => {
  // The body is the submitter's word for it. The Host header is what the request
  // was actually routed by — nginx matched a vhost on it — so it is the one that
  // says which deployment these answers are about.
  const doc = seededDoc();
  await withService(doc, { "JSESSIONID=real": MERCY }, {}, (base) =>
    submit(base, {
      cookie: "JSESSIONID=real",
      payload: { host: "somewhere-else.example.org", answers: [ANSWER] },
    }),
  );
  const [row] = doc.tables.UAT_Submissions.records;
  assert.match(
    row.fields.host,
    /^127\.0\.0\.1:\d+$/,
    `recorded ${row.fields.host}`,
  );
});

test("a submission whose answers fail to save does not survive as an empty review", async () => {
  // The submission row is written first, because an answer points at it. If the
  // answers then fail, what is left reads as a review somebody handed in having
  // answered nothing — and the tally on the page says "0 pass · 0 fail · 0 n/a"
  // as though that were a finding.
  const doc = seededDoc();
  doc.failWrites.add("UAT_Answers");
  const { response } = await withService(
    doc,
    { "JSESSIONID=real": MERCY },
    {},
    (base) =>
      submit(base, {
        cookie: "JSESSIONID=real",
        payload: { answers: [ANSWER] },
      }),
  );
  assert.equal(response.status, 502);
  assert.equal(
    doc.tables.UAT_Submissions.records.length,
    0,
    "the submission row is taken back out again",
  );
});
