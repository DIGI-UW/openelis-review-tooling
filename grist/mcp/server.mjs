// Grist UAT read bridge:
//   GET /uat/:file  Public reviewer-widget checklist, computed live from Grist.
//   GET /healthz    Liveness.
//
// The Grist API key is held here (server-side) and never exposed to callers:
// the widget reads through GET /uat. Authoring uses Grist's native /api/mcp.
//
// Env: GRIST_URL, GRIST_KEY | GRIST_KEY_FILE, GRIST_ORG, GRIST_DOC_NAME,
//      PORT.

import express from "express";
import { readFileSync } from "node:fs";
import { buildUatDocument, buildUatIndex } from "./uat-document.mjs";

const GRIST_URL = process.env.GRIST_URL || "http://grist:8484";
const GRIST_ORG = process.env.GRIST_ORG || "openelis";
const DOC_NAME = process.env.GRIST_DOC_NAME || "UAT Checklists";
const GRIST_KEY_FILE = process.env.GRIST_KEY_FILE;
const PORT = Number(process.env.PORT || 8585);

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
    const failure = new Error(`Grist ${opts.method || "GET"} ${path} -> ${r.status} ${text}`);
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
    review ? listRecords("UAT_Stories", { instance: [review.id] }) : Promise.resolve([]),
  ]);
  return buildUatDocument(instance, (review && review.fields) || {}, stepRecs, storyRecs);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// Grist's own errors quote the request path and the document id. Callers here are
// anonymous, so the detail goes to the log and they are told the fact.
function upstreamFailure(res, scope, error) {
  console.error(`[grist-uat] ${scope}:`, (error && error.message) || error);
  res.status(502).json({ error: "the checklist service could not read from Grist" });
}

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Ahead of /uat/:file on purpose: "index" is a legal instance slug as far as the
// router's pattern is concerned, and the catalog has to win. It rides the same
// path shape so no deployment needs a new proxy rule to expose it.
app.get("/uat/index.json", async (_req, res) => {
  try {
    const [metaRecs, stepRecs] = await Promise.all([
      listRecords("UAT_Meta"),
      listRecords("UAT_Steps"),
    ]);
    const index = buildUatIndex(metaRecs, stepRecs);
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
    if (e && e.upstream) return upstreamFailure(res, `checklist ${instance}`, e);
    // A checklist this service refused: the message names the offending row, and
    // whoever is looking at this is the person who has to fix it.
    console.error(`[grist-uat] checklist ${instance} rejected:`, e.message);
    res.status(502).json({ error: e.message });
  }
});

app.listen(PORT, () =>
  console.error(`[grist-uat] :${PORT} — GET /uat/:file (public read); author via Grist /api/mcp`),
);
