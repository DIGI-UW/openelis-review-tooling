// Grist UAT lifecycle:
//   migrate   add missing schema columns and stable keys without clearing rows
//   seed      add missing checklist instances (use --replace-all intentionally)
//   generate  export Grist checklists as schema-v2 JSON
//
// Env: GRIST_URL, GRIST_KEY, GRIST_ORG (default "openelis"),
//      GRIST_DOC_NAME (default "UAT Checklists"), REVIEW_DIR (seed input,
//      default ../widget/examples), EXPORT_DIR (generate output, default ../runtime/checklists).
// Schema: UAT_Meta(instance,title,intro,jira), UAT_Steps(instance,step_key,
// required,section,section_order,step_order,do,expect,route), UAT_Results(reviewer,instance,
// step_key,mark,note,page_url,at) — Results is created now, filled later.

import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildUatDocument, parseRequired } from "./mcp/uat-document.mjs";

const URL = process.env.GRIST_URL || "http://grist:8484";
const KEY = process.env.GRIST_KEY;
const ORG = process.env.GRIST_ORG || "openelis";
const DOC_NAME = process.env.GRIST_DOC_NAME || "UAT Checklists";
const REVIEW_DIR =
  process.env.REVIEW_DIR || join(import.meta.dirname, "..", "widget", "examples");
// seed READS the tracked fixtures in REVIEW_DIR; generate WRITES here. They must
// differ: writing the export back over tracked files dirties the checkout, which
// the deploy's dirty-worktree guard then treats as a reason to refuse every
// subsequent deploy.
const EXPORT_DIR =
  process.env.EXPORT_DIR || join(import.meta.dirname, "..", "runtime", "checklists");
if (!KEY) throw new Error("GRIST_KEY is required");

const TABLES = {
  UAT_Meta: [
    ["instance", "Text"],
    ["title", "Text"],
    ["intro", "Text"],
    ["jira", "Text"],
  ],
  UAT_Steps: [
    ["instance", "Text"],
    ["step_key", "Text"],
    ["required", "Bool"],
    ["section", "Text"],
    ["section_order", "Int"],
    ["step_order", "Int"],
    ["do", "Text"],
    ["expect", "Text"],
    ["route", "Text"],
  ],
  UAT_Results: [
    ["reviewer", "Text"],
    ["instance", "Text"],
    ["step_key", "Text"],
    ["mark", "Text"],
    ["note", "Text"],
    ["page_url", "Text"],
    ["at", "Text"],
  ],
};

async function api(path, opts = {}) {
  const r = await fetch(URL + path, {
    ...opts,
    headers: {
      Authorization: "Bearer " + KEY,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${opts.method || "GET"} ${path} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveDoc() {
  const wss = await api(`/api/orgs/${ORG}/workspaces`);
  for (const ws of wss) {
    const hit = (ws.docs || []).find((d) => d.name === DOC_NAME);
    if (hit) return hit.id;
  }
  const ws = wss[0];
  return await api(`/api/workspaces/${ws.id}/docs`, {
    method: "POST",
    body: JSON.stringify({ name: DOC_NAME }),
  });
}

async function ensureTables(doc) {
  const existing = new Set(
    (await api(`/api/docs/${doc}/tables`)).tables.map((t) => t.id),
  );
  for (const [id, cols] of Object.entries(TABLES)) {
    if (!existing.has(id)) {
      await api(`/api/docs/${doc}/tables`, {
        method: "POST",
        body: JSON.stringify({
          tables: [
            {
              id,
              columns: cols.map(([c, type]) => ({
                id: c,
                fields: { label: c, type },
              })),
            },
          ],
        }),
      });
      console.log(`  created table ${id}`);
      continue;
    }
    const current = new Set(
      (await api(`/api/docs/${doc}/tables/${id}/columns`)).columns.map(
        (column) => column.id,
      ),
    );
    const missing = cols.filter(([column]) => !current.has(column));
    if (missing.length) {
      await api(`/api/docs/${doc}/tables/${id}/columns`, {
        method: "POST",
        body: JSON.stringify({
          columns: missing.map(([column, type]) => ({
            id: column,
            fields: { label: column, type },
          })),
        }),
      });
      console.log(`  added ${missing.map(([column]) => column).join(", ")} to ${id}`);
    }
  }
}

async function addRecords(doc, table, rows) {
  if (!rows.length) return;
  await api(`/api/docs/${doc}/tables/${table}/records`, {
    method: "POST",
    body: JSON.stringify({ records: rows.map((fields) => ({ fields })) }),
  });
}

async function patchRecords(doc, table, records) {
  if (!records.length) return;
  await api(`/api/docs/${doc}/tables/${table}/records`, {
    method: "PATCH",
    body: JSON.stringify({ records }),
  });
}

async function deleteInstance(doc, table, instance) {
  const records = (
    await api(
      `/api/docs/${doc}/tables/${table}/records?filter=${encodeURIComponent(
        JSON.stringify({ instance: [instance] }),
      )}`,
    )
  ).records;
  if (records.length) {
    await api(`/api/docs/${doc}/tables/${table}/data/delete`, {
      method: "POST",
      body: JSON.stringify(records.map((record) => record.id)),
    });
  }
}

function instancesFromReviewDir() {
  return readdirSync(REVIEW_DIR)
    .filter((f) => /^uat-.*\.json$/.test(f))
    .map((f) => f.replace(/^uat-|\.json$/g, ""));
}

async function migrate() {
  const doc = await resolveDoc();
  await ensureTables(doc);
  const steps = (await api(`/api/docs/${doc}/tables/UAT_Steps/records`)).records;
  const patches = steps
    .filter((record) => !record.fields.step_key || record.fields.required == null)
    .map((record) => ({
      id: record.id,
      fields: {
        step_key:
          record.fields.step_key ||
          `${String(record.fields.instance || "uat").toUpperCase()}-${record.id}`,
        required: parseRequired(record.fields.required),
      },
    }));
  await patchRecords(doc, "UAT_Steps", patches);
  console.log(`migrated doc ${doc}: ${patches.length} step rows updated`);
  return doc;
}

async function seed(replaceAll) {
  const doc = await migrate();
  for (const inst of instancesFromReviewDir()) {
    const j = JSON.parse(readFileSync(join(REVIEW_DIR, `uat-${inst}.json`), "utf8"));
    const existingMeta = (
      await api(
        `/api/docs/${doc}/tables/UAT_Meta/records?filter=${encodeURIComponent(
          JSON.stringify({ instance: [inst] }),
        )}`,
      )
    ).records;
    const existingSteps = (
      await api(
        `/api/docs/${doc}/tables/UAT_Steps/records?filter=${encodeURIComponent(
          JSON.stringify({ instance: [inst] }),
        )}`,
      )
    ).records;
    if ((existingMeta.length || existingSteps.length) && !replaceAll) {
      console.log(`  skipped ${inst}: already authored in Grist`);
      continue;
    }
    if (replaceAll) {
      await deleteInstance(doc, "UAT_Meta", inst);
      await deleteInstance(doc, "UAT_Steps", inst);
    }
    const metaRow = {
      instance: inst,
      title: j.title || "",
      intro: j.intro || "",
      jira: j.jira || "",
    };
    const stepRows = [];
    (j.sections || []).forEach((sec, si) => {
      (sec.steps || []).forEach((step, ti) => {
        stepRows.push({
          instance: inst,
          step_key:
            step.key ||
            `${inst.toUpperCase()}-${String(si + 1).padStart(2, "0")}-${String(
              ti + 1,
            ).padStart(2, "0")}`,
          required: step.required !== false,
          section: sec.title,
          section_order: si,
          step_order: ti,
          do: step.do || step.text || "",
          expect: step.expect || "",
          route: step.route || "",
        });
      });
    });
    await addRecords(doc, "UAT_Meta", [metaRow]);
    await addRecords(doc, "UAT_Steps", stepRows);
    console.log(`  seeded ${inst}: ${stepRows.length} steps`);
  }
  console.log(doc);
}

async function generate() {
  const doc = await resolveDoc();
  const meta = {};
  for (const r of (await api(`/api/docs/${doc}/tables/UAT_Meta/records`)).records)
    meta[r.fields.instance] = r.fields;
  const steps = (await api(`/api/docs/${doc}/tables/UAT_Steps/records`)).records;
  const byInstance = {};
  for (const record of steps)
    (byInstance[record.fields.instance] ||= []).push(record);
  mkdirSync(EXPORT_DIR, { recursive: true });
  for (const [inst, rows] of Object.entries(byInstance)) {
    const m = meta[inst] || {};
    const out = buildUatDocument(inst, m, rows);
    const path = join(EXPORT_DIR, `uat-${inst}.json`);
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
    console.log(
      `wrote ${path}: ${out.sections.length} sections, ${rows.length} steps`,
    );
  }
}

const mode = process.argv[2];
if (mode === "migrate") await migrate();
else if (mode === "seed") await seed(process.argv.includes("--replace-all"));
else if (mode === "generate") await generate();
else {
  console.error("usage: grist-sync.mjs migrate|seed [--replace-all]|generate");
  process.exit(1);
}
