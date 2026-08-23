// Grist UAT lifecycle:
//   apply     reconcile the document to grist/schema.mjs (--dry-run to just look,\n//             --rebuild-pages to replace declared pages whose shape has changed)
//   migrate   add missing schema columns and stable keys without clearing rows
//   publish   list a story in the public catalog (or --unlist it again)
//   seed      add missing checklist instances (use --replace-all intentionally)
//   generate  export Grist checklists as schema-v2 JSON
//
// Env: GRIST_URL, GRIST_KEY, GRIST_ORG (default "openelis"),
//      GRIST_DOC_NAME (default "UAT Checklists"), REVIEW_DIR (seed input,
//      default ../widget/examples), EXPORT_DIR (generate output, default ../runtime/checklists).
// Schema: declared in schema.mjs — UAT_Meta (one row per review), UAT_Stories
// (one per story, with its links and the hosts it applies to), UAT_Steps (one per
// step, pointing at its story), and UAT_Submissions/UAT_Answers (what came back).

import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildUatDocument, parseRequired } from "./mcp/uat-document.mjs";
import {
  PAGES,
  SCHEMA,
  planColumns,
  planInstanceRefs,
  planPages,
  planSortColRefs,
  planStoryMigration,
} from "./schema.mjs";

const URL = process.env.GRIST_URL || "http://grist:8484";
const KEY = process.env.GRIST_KEY;
const ORG = process.env.GRIST_ORG || "openelis";
const DOC_NAME = process.env.GRIST_DOC_NAME || "UAT Checklists";
const ADMIN_EMAIL = process.env.GRIST_ADMIN_EMAIL;
const REVIEW_DIR =
  process.env.REVIEW_DIR ||
  join(import.meta.dirname, "..", "widget", "examples");
// seed READS the tracked fixtures in REVIEW_DIR; generate WRITES here. They must
// differ: writing the export back over tracked files dirties the checkout, which
// the deploy's dirty-worktree guard then treats as a reason to refuse every
// subsequent deploy.
const EXPORT_DIR =
  process.env.EXPORT_DIR ||
  join(import.meta.dirname, "..", "runtime", "checklists");
if (!KEY) throw new Error("GRIST_KEY is required");

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
  if (!r.ok)
    throw new Error(`${opts.method || "GET"} ${path} -> ${r.status} ${text}`);
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

async function checkAccess() {
  const doc = await resolveDoc();
  const info = await api(`/api/docs/${doc}`);
  const access = String(info.access || "none");
  console.log(`${info.name || DOC_NAME} ${doc}: ${access}`);
  if (access !== "owners") {
    throw new Error(
      `Grist authoring identity must own ${DOC_NAME}; expected owners, received ${access}`,
    );
  }
}

async function repairAccess() {
  if (!ADMIN_EMAIL) throw new Error("GRIST_ADMIN_EMAIL is required");
  const doc = await resolveDoc();
  await api(`/api/docs/${doc}/access`, {
    method: "PATCH",
    body: JSON.stringify({
      delta: { users: { [ADMIN_EMAIL]: "owners" } },
    }),
  });
  console.log(`restored ${ADMIN_EMAIL} as owner of ${DOC_NAME}`);
  await checkAccess();
}

async function ensureTables(doc, { dryRun = false } = {}) {
  const existing = new Set(
    (await api(`/api/docs/${doc}/tables`)).tables.map((t) => t.id),
  );
  for (const [id, spec] of Object.entries(SCHEMA)) {
    if (!existing.has(id)) {
      const columns = planColumns([], spec.columns, spec.retired).add;
      if (dryRun) {
        console.log(`  would create table ${id} (${columns.length} columns)`);
        continue;
      }
      await api(`/api/docs/${doc}/tables`, {
        method: "POST",
        body: JSON.stringify({ tables: [{ id, columns }] }),
      });
      console.log(`  created table ${id}`);
      continue;
    }
    const live = (await api(`/api/docs/${doc}/tables/${id}/columns`)).columns;
    const plan = planColumns(live, spec.columns, spec.retired);
    for (const column of plan.add) {
      console.log(`  ${dryRun ? "would add" : "add"} ${id}.${column.id}`);
    }
    for (const column of plan.update) {
      console.log(
        `  ${dryRun ? "would update" : "update"} ${id}.${column.id}: ${Object.keys(column.fields).join(", ")}`,
      );
    }
    if (dryRun) continue;
    if (plan.add.length) {
      await api(`/api/docs/${doc}/tables/${id}/columns`, {
        method: "POST",
        body: JSON.stringify({ columns: plan.add }),
      });
    }
    // One column per request: Grist refuses a PATCH whose records do not all carry
    // the same fields, and a plan is by definition a set of different drifts.
    for (const column of plan.update) {
      await api(`/api/docs/${doc}/tables/${id}/columns`, {
        method: "PATCH",
        body: JSON.stringify({ columns: [column] }),
      });
    }
  }
  await dropRawPages(doc, { dryRun });
}

// Creating a table gives it a page.
//
// POST /tables sends AddTable, and AddTable is
// `doAddTable(..., primary_view=True, raw_section=True, ...)` — so every table
// this declaration creates arrives with a page in the left-hand nav showing a
// raw dump of it. Beside the pages PAGES builds, which present the same rows
// already arranged, those are noise nobody asked for. planPages cannot see
// them: it ignores raw_data views when deciding what to create, which is right,
// but nothing removed them.
//
// Scoped to raw views of tables this declaration owns, because how its own
// tables are presented is exactly what PAGES is for. A page somebody authored
// is left alone, and so is the raw view of a table that is none of our
// business.
//
// Deliberately not scoped to the tables this run created: that would tidy a
// fresh document and never touch one where the pages are already sitting there,
// which is every document that has run this before.
async function dropRawPages(doc, { dryRun = false } = {}) {
  const ours = new Set(Object.keys(SCHEMA));
  const views = (await api(`/api/docs/${doc}/tables/_grist_Views/records`))
    .records;
  for (const view of views) {
    const fields = view.fields || {};
    if (fields.type !== "raw_data" || !ours.has(fields.name)) continue;
    console.log(
      `  ${dryRun ? "would remove" : "removed"} the raw page Grist added for ${fields.name}`,
    );
    if (!dryRun) await userActions(doc, [["RemoveView", view.id]]);
  }
}

// Separate from ensureTables on purpose, and run last. The columns being retired
// are the ones the migration reads to build stories from, so dropping them while
// reconciling the schema would destroy the grouping before anything had used it:
// on a fresh document, or a restore, every step would collapse into one story.
async function retireColumns(doc, { dryRun = false } = {}) {
  for (const [id, spec] of Object.entries(SCHEMA)) {
    if (!spec.retired || !spec.retired.length) continue;
    const live = (await api(`/api/docs/${doc}/tables/${id}/columns`)).columns;
    const { retire } = planColumns(live, spec.columns, spec.retired);
    for (const colId of retire) {
      console.log(`  ${dryRun ? "would retire" : "retire"} ${id}.${colId}`);
      if (dryRun) continue;
      await api(`/api/docs/${doc}/apply`, {
        method: "POST",
        body: JSON.stringify([["RemoveColumn", id, colId]]),
      });
    }
  }
}

// Pages are built with user actions rather than the records API: a page is a view,
// its sections, and the links between them, and only the actions know how to make
// those consistently.
async function userActions(doc, actions) {
  return await api(`/api/docs/${doc}/apply`, {
    method: "POST",
    body: JSON.stringify(actions),
  });
}

async function metaRefs(doc) {
  const tables = (await api(`/api/docs/${doc}/tables/_grist_Tables/records`))
    .records;
  const columns = (
    await api(`/api/docs/${doc}/tables/_grist_Tables_column/records`)
  ).records;
  const tableRef = new Map(tables.map((t) => [t.fields.tableId, t.id]));
  const colRef = new Map();
  for (const column of columns) {
    const table = tables.find((t) => t.id === column.fields.parentId);
    if (table)
      colRef.set(`${table.fields.tableId}.${column.fields.colId}`, column.id);
  }
  return { tableRef, colRef };
}

// Section titles were the only record of which story a step belonged to, so this
// has to run before anything drops them.
// Read before the column becomes a reference: afterwards the names are no longer
// something the document can resolve back to a review.
async function readStoryNames(doc) {
  const tables = (await api(`/api/docs/${doc}/tables`)).tables.map((t) => t.id);
  if (!tables.includes("UAT_Stories")) return [];
  return (await api(`/api/docs/${doc}/tables/UAT_Stories/records`)).records;
}

async function repointStories(doc, before, { dryRun = false } = {}) {
  if (!before.length) return;
  const meta = (await api(`/api/docs/${doc}/tables/UAT_Meta/records`)).records;
  const plan = planInstanceRefs(before, meta);
  for (const name of plan.unmatched) {
    console.error(
      `  !! story names review "${name}", which does not exist — left as it is`,
    );
  }
  if (!plan.assign.length) return;
  console.log(
    `  ${dryRun ? "would repoint" : "repoint"} ${plan.assign.length} stories at their review`,
  );
  if (dryRun) return;
  await api(`/api/docs/${doc}/tables/UAT_Stories/records`, {
    method: "PATCH",
    body: JSON.stringify({
      records: plan.assign.map((row) => ({
        id: row.id,
        fields: { instance: row.instance },
      })),
    }),
  });
}

async function ensureStories(doc, { dryRun = false } = {}) {
  const [steps, reviews] = await Promise.all([
    api(`/api/docs/${doc}/tables/UAT_Steps/records`).then((r) => r.records),
    api(`/api/docs/${doc}/tables/UAT_Meta/records`).then((r) => r.records),
  ]);
  const plan = planStoryMigration(reviews, steps);
  if (!plan.stories.length) return;
  console.log(
    `  ${dryRun ? "would convert" : "convert"} ${plan.assign.length} steps into ${plan.stories.length} stories`,
  );
  if (dryRun) return;

  const created = await api(`/api/docs/${doc}/tables/UAT_Stories/records`, {
    method: "POST",
    body: JSON.stringify({
      records: plan.stories.map((fields) => ({ fields })),
    }),
  });
  const ids = created.records.map((record) => record.id);
  await api(`/api/docs/${doc}/tables/UAT_Steps/records`, {
    method: "PATCH",
    body: JSON.stringify({
      records: plan.assign.map((row) => ({
        id: row.id,
        fields: { story: ids[row.story] },
      })),
    }),
  });
  console.log(`  converted ${plan.assign.length} steps`);
}

async function ensurePages(doc, { dryRun = false, rebuild = false } = {}) {
  let views = (await api(`/api/docs/${doc}/tables/_grist_Views/records`))
    .records;

  // Renames first, and before anything reads the list by name. A page is its
  // widgets, their links, and whatever layout somebody dragged into place, and
  // all of that survives a rename — whereas creating the new name and leaving
  // the old page behind is worse than the ambiguity being fixed.
  const renames = planPages(views, PAGES).rename;
  for (const { id, from, to } of renames) {
    console.log(
      `  ${dryRun ? "would rename" : "renamed"} page ${from} to ${to}`,
    );
    if (dryRun) continue;
    await userActions(doc, [
      ["UpdateRecord", "_grist_Views", id, { name: to }],
    ]);
    const view = views.find((candidate) => candidate.id === id);
    if (view) view.fields.name = to;
  }

  if (rebuild) {
    // A page is created whole or not at all, so changing its shape means removing
    // the one that is there. Only pages this repository declares, and only when
    // asked: somebody else's page is not ours to drop.
    const declared = new Set(PAGES.map((page) => page.name));
    const stale = views.filter(
      (view) =>
        view.fields.type !== "raw_data" && declared.has(view.fields.name),
    );
    for (const view of stale) {
      console.log(
        `  ${dryRun ? "would rebuild" : "rebuild"} page ${view.fields.name}`,
      );
      if (!dryRun) await userActions(doc, [["RemoveView", view.id]]);
    }
    if (!dryRun && stale.length) {
      views = (await api(`/api/docs/${doc}/tables/_grist_Views/records`))
        .records;
    }
  }
  const plan = planPages(views, PAGES);
  if (!plan.create.length) return;
  const { tableRef, colRef } = await metaRefs(doc);

  for (const name of plan.create) {
    const page = PAGES.find((candidate) => candidate.name === name);
    if (dryRun) {
      console.log(
        `  would create page ${name} (${page.sections.length} widgets)`,
      );
      continue;
    }
    let viewRef = 0;
    const sectionRefs = [];
    for (const section of page.sections) {
      // groupbyColRefs turns the section into a summary of its table. Grist links
      // a summary to that same table's detail on the group-by column, which is
      // what lets a story picker filter the steps without a reference column.
      const groupBy = section.groupBy
        ? section.groupBy.map((col) => colRef.get(`${section.table}.${col}`))
        : null;
      const result = await userActions(doc, [
        [
          "CreateViewSection",
          tableRef.get(section.table),
          viewRef,
          section.type,
          groupBy,
          "",
        ],
      ]);
      const created = result.retValues[0];
      viewRef = created.viewRef;
      sectionRefs.push(created.sectionRef);
    }
    const updates = [["UpdateRecord", "_grist_Views", viewRef, { name }]];
    page.sections.forEach((section, index) => {
      const fields = {};
      if (section.sort) {
        fields.sortColRefs = JSON.stringify(
          planSortColRefs(section.table, section.sort, colRef),
        );
      }
      if (section.linkFrom !== undefined) {
        fields.linkSrcSectionRef = sectionRefs[section.linkFrom];
        fields.linkSrcColRef = 0;
        // linkVia names the reference the target carries back to the source, which
        // is how one table's rows filter another's. Without it the two sections
        // are over the same table and the link is a shared cursor instead.
        fields.linkTargetColRef = section.linkVia
          ? colRef.get(`${section.table}.${section.linkVia}`) || 0
          : 0;
      }
      if (Object.keys(fields).length) {
        updates.push([
          "UpdateRecord",
          "_grist_Views_section",
          sectionRefs[index],
          fields,
        ]);
      }
    });
    await userActions(doc, updates);
    console.log(`  created page ${name}`);
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
  const steps = (await api(`/api/docs/${doc}/tables/UAT_Steps/records`))
    .records;
  const patches = steps
    .filter(
      (record) => !record.fields.step_key || record.fields.required == null,
    )
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
    const j = JSON.parse(
      readFileSync(join(REVIEW_DIR, `uat-${inst}.json`), "utf8"),
    );
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
  const storyRecs = (await api(`/api/docs/${doc}/tables/UAT_Stories/records`))
    .records;
  const meta = {};
  for (const r of (await api(`/api/docs/${doc}/tables/UAT_Meta/records`))
    .records)
    meta[r.fields.instance] = r.fields;
  const steps = (await api(`/api/docs/${doc}/tables/UAT_Steps/records`))
    .records;
  const byInstance = {};
  for (const record of steps)
    (byInstance[record.fields.instance] ||= []).push(record);
  mkdirSync(EXPORT_DIR, { recursive: true });
  for (const [inst, rows] of Object.entries(byInstance)) {
    const m = meta[inst] || {};
    const out = buildUatDocument(inst, m, rows, storyRecs);
    const path = join(EXPORT_DIR, `uat-${inst}.json`);
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
    console.log(
      `wrote ${path}: ${out.sections.length} sections, ${rows.length} steps`,
    );
  }
}

async function publish(instances, listed) {
  if (!instances.length) throw new Error("publish needs at least one instance");
  const doc = await resolveDoc();
  await ensureTables(doc);
  const meta = (await api(`/api/docs/${doc}/tables/UAT_Meta/records`)).records;
  const wanted = new Set(instances);
  const patches = meta
    .filter((record) => wanted.has(String(record.fields.instance || "").trim()))
    .map((record) => ({ id: record.id, fields: { published: listed } }));
  const found = new Set(
    meta
      .map((record) => String(record.fields.instance || "").trim())
      .filter((instance) => wanted.has(instance)),
  );
  const missing = instances.filter((instance) => !found.has(instance));
  if (missing.length)
    throw new Error(`no UAT_Meta row for: ${missing.join(", ")}`);
  await patchRecords(doc, "UAT_Meta", patches);
  console.log(
    `${listed ? "listed" : "unlisted"} ${patches.length}: ${instances.join(", ")}`,
  );
}

const mode = process.argv[2];
if (mode === "apply") {
  const dryRun = process.argv.includes("--dry-run");
  const rebuild = process.argv.includes("--rebuild-pages");
  const doc = await resolveDoc();
  const storyNames = await readStoryNames(doc);
  await ensureTables(doc, { dryRun });
  await ensureStories(doc, { dryRun });
  await repointStories(doc, storyNames, { dryRun });
  // After the migration that reads them, never before.
  await retireColumns(doc, { dryRun });
  await ensurePages(doc, { dryRun, rebuild });
  console.log(dryRun ? `dry run against ${doc}` : `applied schema to ${doc}`);
} else if (mode === "migrate") await migrate();
else if (mode === "seed") await seed(process.argv.includes("--replace-all"));
else if (mode === "generate") await generate();
else if (mode === "check-access") await checkAccess();
else if (mode === "repair-access") await repairAccess();
else if (mode === "publish") {
  const unlist = process.argv.includes("--unlist");
  await publish(
    process.argv.slice(3).filter((arg) => !arg.startsWith("--")),
    !unlist,
  );
} else {
  console.error(
    "usage: grist-sync.mjs apply [--dry-run] [--rebuild-pages]|migrate|seed [--replace-all]|generate|check-access|repair-access|publish <instance…> [--unlist]",
  );
  process.exit(1);
}
