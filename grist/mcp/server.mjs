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
import { buildUatDocument } from "./uat-document.mjs";

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
  if (!r.ok) throw new Error(`Grist ${opts.method || "GET"} ${path} -> ${r.status} ${text}`);
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
  const stepRecs = await listRecords("UAT_Steps", { instance: [instance] });
  const m = (metaRecs[0] && metaRecs[0].fields) || {};
  return buildUatDocument(instance, m, stepRecs);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

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
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, () =>
  console.error(`[grist-uat] :${PORT} — GET /uat/:file (public read); author via Grist /api/mcp`),
);
