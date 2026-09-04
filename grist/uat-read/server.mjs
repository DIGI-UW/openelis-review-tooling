// Grist UAT read bridge:
//   GET  /uat/:file                Public reviewer-widget checklist, live from Grist.
//   POST /uat/:instance/submissions  A review handed in, attributed to the
//                                  application's session rather than to a name
//                                  the submitter typed.
//   GET  /healthz                  Liveness.
//
// The Grist API key is held here (server-side) and never exposed to callers:
// the widget reads through GET /uat. Authoring uses Grist's REST API directly.
//
// Env: GRIST_URL, GRIST_KEY | GRIST_KEY_FILE, GRIST_ORG, GRIST_DOC_NAME,
//      PORT, REVIEW_BACKENDS, REVIEW_TLS_INSECURE_HOSTS, SESSION_PATH.

import express from "express";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { parseBackends, verifyTlsFor } from "./backends.mjs";
import { buildUatDocument, buildUatIndex } from "./uat-document.mjs";

const GRIST_URL = process.env.GRIST_URL || "http://grist:8484";
const GRIST_ORG = process.env.GRIST_ORG || "openelis";
const DOC_NAME = process.env.GRIST_DOC_NAME || "UAT Checklists";
const GRIST_KEY_FILE = process.env.GRIST_KEY_FILE;
const PORT = Number(process.env.PORT || 8585);

// Which application answers for a given review's reviewers, as
// "amr=https://amr-oe:8443,analyzers=https://analyzers-oe:8443". Keyed by
// instance rather than taken from a header: the instance is already in the URL,
// and a header naming the backend would be one a caller could choose.
const { backends: BACKENDS, malformed: BAD_BACKENDS } = parseBackends(
  process.env.REVIEW_BACKENDS,
);
// Said at boot rather than dropped. A deployment whose map did not parse accepts
// no submissions for that review, and the reason should not have to be inferred
// from a 501 weeks later.
if (BAD_BACKENDS.length) {
  console.error(
    `[grist-uat] ignoring malformed REVIEW_BACKENDS entries (expected instance=url): ${BAD_BACKENDS.join(", ")}`,
  );
}
// Hostnames whose certificate is not checked — compose aliases on a network no
// public CA can vouch for. Empty by default, so a backend pointed at a real host
// is verified like anything else.
const TLS_INSECURE_HOSTS = process.env.REVIEW_TLS_INSECURE_HOSTS || "";
const SESSION_PATH = process.env.SESSION_PATH || "/api/OpenELIS-Global/session";

function gristKey() {
  if (process.env.GRIST_KEY) return process.env.GRIST_KEY.trim();
  if (GRIST_KEY_FILE) return readFileSync(GRIST_KEY_FILE, "utf8").trim();
  throw new Error("no GRIST_KEY or GRIST_KEY_FILE configured");
}

async function grist(path, opts = {}) {
  const r = await fetch(GRIST_URL + path, {
    ...opts,
    headers: {
      Authorization: "Bearer " + gristKey(),
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  if (!r.ok) {
    // Tagged so the handlers can tell an upstream failure — whose message quotes
    // the document id and internal paths — from a checklist this service refused,
    // whose message is what an author needs to fix the row.
    const failure = new Error(
      `Grist ${opts.method || "GET"} ${path} -> ${r.status} ${text}`,
    );
    failure.upstream = true;
    throw failure;
  }
  return text ? JSON.parse(text) : null;
}

// Doc id is stable for the life of the doc; resolve once by name.
let _docId = null;
async function docId() {
  if (_docId) return _docId;
  const wss = await grist(`/api/orgs/${GRIST_ORG}/workspaces`);
  for (const ws of wss) {
    const hit = (ws.docs || []).find((d) => d.name === DOC_NAME);
    if (hit) return (_docId = hit.id);
  }
  throw new Error(`Grist doc "${DOC_NAME}" not found in org ${GRIST_ORG}`);
}

async function listRecords(table, filter) {
  const doc = await docId();
  let path = `/api/docs/${doc}/tables/${table}/records`;
  if (filter) path += `?filter=${encodeURIComponent(JSON.stringify(filter))}`;
  return (await grist(path)).records;
}
// Grist rows -> the widget's checklist shape (title/intro/sections[].steps[]).
async function uatDocument(instance) {
  const metaRecs = await listRecords("UAT_Meta", { instance: [instance] });
  const review = metaRecs[0];
  const [stepRecs, storyRecs] = await Promise.all([
    listRecords("UAT_Steps", { instance: [instance] }),
    // A story names its review by reference, so the filter is that review's row.
    // With no such review there are no stories, and the empty checklist below
    // reports the slug rather than an error about a row id.
    review
      ? listRecords("UAT_Stories", { instance: [review.id] })
      : Promise.resolve([]),
  ]);
  return buildUatDocument(
    instance,
    (review && review.fields) || {},
    stepRecs,
    storyRecs,
  );
}

// Who the application says is holding this cookie.
//
// The reviewer's own session is the credential. Nothing the submission says
// about its author is consulted — that is the entire point of asking.
function readSession(backend, cookie) {
  const url = new URL(backend + SESSION_PATH);
  const secure = url.protocol === "https:";
  return new Promise((resolve, reject) => {
    const req = (secure ? httpsRequest : httpRequest)(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "GET",
        headers: cookie ? { Cookie: cookie } : {},
        // Verified unless this exact hostname was named in
        // REVIEW_TLS_INSECURE_HOSTS. The deployment this was built for dials
        // compose aliases over a network that is not routable, and no public CA
        // can vouch for a name like "amr-oe" — but that is a property of those
        // hosts, not a reason to stop checking every backend everywhere.
        ...(secure && !verifyTlsFor(url.hostname, TLS_INSECURE_HOSTS)
          ? { rejectUnauthorized: false }
          : {}),
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) return resolve(null);
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () =>
      req.destroy(new Error("session lookup timed out")),
    );
    req.end();
  });
}

function reviewerOf(session) {
  if (!session || !session.authenticated) return null;
  const login = String(session.loginName || "").trim();
  if (!login) return null;
  const name = [session.firstName, session.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return { login, name: name || login };
}

async function addRecords(table, rows) {
  const doc = await docId();
  const created = await grist(`/api/docs/${doc}/tables/${table}/records`, {
    method: "POST",
    body: JSON.stringify({ records: rows.map((fields) => ({ fields })) }),
  });
  return (created && created.records) || [];
}

async function removeRecords(table, ids) {
  const doc = await docId();
  await grist(`/api/docs/${doc}/apply`, {
    method: "POST",
    body: JSON.stringify([["BulkRemoveRecord", table, ids]]),
  });
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// Grist's own errors quote the request path and the document id. Callers here are
// anonymous, so the detail goes to the log and they are told the fact.
function upstreamFailure(res, scope, error) {
  console.error(`[grist-uat] ${scope}:`, (error && error.message) || error);
  res
    .status(502)
    .json({ error: "the checklist service could not read from Grist" });
}

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Ahead of /uat/:file on purpose: "index" is a legal instance slug as far as the
// router's pattern is concerned, and the catalog has to win. It rides the same
// path shape so no deployment needs a new proxy rule to expose it.
app.get("/uat/index.json", async (_req, res) => {
  try {
    const [metaRecs, stepRecs, storyRecs] = await Promise.all([
      listRecords("UAT_Meta"),
      listRecords("UAT_Steps"),
      listRecords("UAT_Stories"),
    ]);
    const index = buildUatIndex(metaRecs, stepRecs, storyRecs);
    // Skipped routes are reported rather than fatal, so the only place anyone
    // would notice a malformed row is here.
    if (index.warnings.length) {
      console.error("[grist-uat] catalog warnings:", index.warnings.join("; "));
    }
    res.set("Cache-Control", "no-store").json(index);
  } catch (e) {
    upstreamFailure(res, "catalog", e);
  }
});

app.get("/uat/:file", async (req, res) => {
  const instance = req.params.file.replace(/\.json$/, "");
  try {
    const doc = await uatDocument(instance);
    // An unknown slug would otherwise render as a valid-looking empty checklist,
    // which reads to an integrator as "the widget is broken" rather than "typo".
    if (!doc.sections.length) {
      return res.status(404).json({
        error: `no checklist for instance "${instance}"`,
        hint: "check the slug, or add rows for it in the Grist UAT_Steps table",
      });
    }
    res.set("Cache-Control", "no-store").json(doc);
  } catch (e) {
    if (e && e.upstream)
      return upstreamFailure(res, `checklist ${instance}`, e);
    // A checklist this service refused: the message names the offending row, and
    // whoever is looking at this is the person who has to fix it.
    console.error(`[grist-uat] checklist ${instance} rejected:`, e.message);
    res.status(502).json({ error: e.message });
  }
});

// Handing a review in.
//
// Ordered so nothing is written until everything that could refuse has. A
// submission is a record, and a half-written one is worse than none: it reads
// like a review somebody abandoned rather than one the service dropped.
app.post("/uat/:instance/submissions", async (req, res) => {
  const instance = String(req.params.instance).replace(/\.json$/, "");
  const backend = BACKENDS.get(instance);
  // Recording an unverified name would be worse than refusing: on the page it
  // is indistinguishable from one the application vouched for.
  if (!backend) {
    return res.status(501).json({
      error:
        "this deployment cannot verify who is reviewing, so it does not accept submissions",
      hint: `add "${instance}=https://<app-host>:8443" to REVIEW_BACKENDS`,
    });
  }

  const answers = Array.isArray(req.body && req.body.answers)
    ? req.body.answers
    : [];
  if (!answers.length) {
    return res
      .status(400)
      .json({ error: "a submission needs at least one answered step" });
  }
  const reviewerName = String((req.body && req.body.reviewer) || "").trim();
  if (!reviewerName) {
    return res.status(400).json({ error: "a reviewer name is required" });
  }

  let reviewer;
  try {
    reviewer = reviewerOf(await readSession(backend, req.headers.cookie));
  } catch (e) {
    console.error(`[grist-uat] session lookup for ${instance}:`, e.message);
    return res
      .status(502)
      .json({ error: "could not reach the application to check who you are" });
  }
  // needsLogin distinguishes "sign in and try again" from a fault the reviewer
  // can do nothing about — the widget says something different for each.
  if (!reviewer) {
    return res
      .status(401)
      .json({ error: "sign in to submit this review", needsLogin: true });
  }

  try {
    const [review] = await listRecords("UAT_Meta", { instance: [instance] });
    if (!review) {
      return res.status(404).json({ error: `no review called "${instance}"` });
    }

    // A row id for each step key and story key, so an answer can be clicked
    // through to either as they stand today, and so one story's answers can be
    // shown across every submission — Grist links two widgets through a
    // reference, never through matching text. Navigation only: the pinned keys
    // are what the answer is about, and they survive either row being deleted.
    const [steps, stories] = await Promise.all([
      listRecords("UAT_Steps", { instance: [instance] }),
      listRecords("UAT_Stories", { instance: [review.id] }),
    ]);
    const refsBy = (records, field) =>
      new Map(
        records.map((record) => [
          String((record.fields || {})[field] || "").trim(),
          record.id,
        ]),
      );
    const stepRefs = refsBy(steps, "step_key");
    const storyRefs = refsBy(stories, "story_key");

    const [submission] = await addRecords("UAT_Submissions", [
      {
        instance: review.id,
        login: reviewer.login,
        reviewer: reviewerName,
        // Grist stores a DateTime as epoch seconds. Taken here rather than from
        // the body: a clock the submitter controls is not a timestamp.
        submitted_at: Math.floor(Date.now() / 1000),
        // The header, not the body: the request was routed by it — nginx
        // matched a vhost on it — so it says which deployment these answers are
        // about. The body is the submitter's word for the same thing.
        host: String(req.headers.host || ""),
        app_sha: String((req.body && req.body.appSha) || ""),
        checklist_revision: String(
          (req.body && req.body.checklistRevision) || "",
        ),
        note: String((req.body && req.body.note) || ""),
      },
    ]);

    // What the reviewer saw, which is the only place that information exists —
    // the story may already have moved on, and the answer is evidence about the
    // version in front of them at the time.
    //
    // The submission row had to go first, because every answer points at it. If
    // these fail, that row is taken back out: left behind it is a review
    // somebody handed in having answered nothing, and the tally on the page
    // reports "0 pass · 0 fail · 0 n/a" as though that were the finding.
    try {
      await addRecords(
        "UAT_Answers",
        answers.map((answer) => ({
          review: submission.id,
          step_key: String(answer.stepKey || ""),
          story_key: String(answer.storyKey || ""),
          story_title: String(answer.storyTitle || ""),
          story_version: String(answer.storyVersion || ""),
          story_revision: String(answer.storyRevision || ""),
          mark: String(answer.mark || ""),
          note: String(answer.note || ""),
          actual_url: String(answer.actualUrl || ""),
          step: stepRefs.get(String(answer.stepKey || "").trim()) || 0,
          story: storyRefs.get(String(answer.storyKey || "").trim()) || 0,
        })),
      );
    } catch (e) {
      try {
        await removeRecords("UAT_Submissions", [submission.id]);
      } catch (cleanup) {
        // Both writes failed, so the empty row is still there. Say so plainly —
        // it is the one case where the document is left in a state a person has
        // to look at.
        console.error(
          `[grist-uat] submission ${submission.id} for ${instance} has no answers and could not be removed:`,
          (cleanup && cleanup.message) || cleanup,
        );
      }
      throw e;
    }

    res.status(201).json({
      id: submission.id,
      reviewer: { login: reviewer.login, name: reviewerName },
    });
  } catch (e) {
    console.error(
      `[grist-uat] submission for ${instance}:`,
      (e && e.message) || e,
    );
    res.status(502).json({ error: "the review could not be saved" });
  }
});

// The port it actually bound, not the one it was asked for: PORT=0 means "pick
// a free one", and reporting the request rather than the result made the line a
// lie in exactly the case where somebody needs to read it.
const server = app.listen(PORT, () =>
  console.error(
    `[grist-uat] :${server.address().port} — GET /uat/:file (public read); author via Grist REST`,
  ),
);
