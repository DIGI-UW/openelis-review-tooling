import { createHash } from "node:crypto";

const SCHEMA_VERSION = 2;

function requiredValue(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function validateRoute(route, stepKey) {
  if (!route) return "";
  if (!route.startsWith("/") || route.startsWith("//")) {
    throw new Error(`step ${stepKey} route must be a same-origin absolute path`);
  }
  return route;
}

function contentHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildUatDocument(instance, meta, records) {
  const seenKeys = new Set();
  const seenOrders = new Set();
  const rows = records
    .map((record) => ({ id: record.id, ...record.fields }))
    .sort(
      (a, b) =>
        Number(a.section_order) - Number(b.section_order) ||
        Number(a.step_order) - Number(b.step_order),
    );
  const sections = [];

  for (const row of rows) {
    const key = String(row.step_key || "").trim();
    if (!key) throw new Error(`step row ${row.id} is missing step_key`);
    if (seenKeys.has(key)) throw new Error(`duplicate step_key ${key}`);
    seenKeys.add(key);

    const orderKey = `${Number(row.section_order)}:${Number(row.step_order)}`;
    if (seenOrders.has(orderKey)) throw new Error(`duplicate step order ${orderKey}`);
    seenOrders.add(orderKey);

    let section = sections.find((candidate) => candidate._order === Number(row.section_order));
    if (!section) {
      section = {
        title: String(row.section || "").trim(),
        steps: [],
        _order: Number(row.section_order),
      };
      sections.push(section);
    } else if (section.title !== String(row.section || "").trim()) {
      throw new Error(`section order ${row.section_order} has conflicting titles`);
    }

    const step = {
      key,
      required: requiredValue(row.required),
      do: String(row.do || "").trim(),
    };
    if (!step.do) throw new Error(`step ${key} is missing do`);
    if (row.expect) step.expect = String(row.expect).trim();
    if (row.route) step.route = validateRoute(String(row.route).trim(), key);
    section.steps.push(step);
  }

  sections.forEach((section) => delete section._order);
  const content = {
    schemaVersion: SCHEMA_VERSION,
    title: meta.title || `${instance} review`,
    instance,
    jira: meta.jira || "",
    intro: meta.intro || "",
    sections,
  };

  return {
    ...content,
    checklistRevision: contentHash(content),
  };
}
