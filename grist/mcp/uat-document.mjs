import { createHash } from "node:crypto";

function orderValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

function compareRecords(left, right) {
  const section = orderValue(left.fields.section_order) - orderValue(right.fields.section_order);
  if (section) return section;
  const step = orderValue(left.fields.step_order) - orderValue(right.fields.step_order);
  if (step) return step;
  return String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
}

function revisionFor(document) {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}

export function buildUatDocument(instance, metaRecords, stepRecords) {
  const meta = (metaRecords[0] && metaRecords[0].fields) || {};
  const rows = stepRecords.slice().sort(compareRecords);
  const sections = [];

  for (const record of rows) {
    const fields = record.fields;
    let section = sections.find((candidate) => candidate._order === fields.section_order);
    if (!section) {
      section = { title: fields.section, steps: [], _order: fields.section_order };
      sections.push(section);
    }

    const step = {
      step_id: `grist:${record.id}`,
      do: fields.do,
    };
    if (fields.expect) step.expect = fields.expect;
    if (fields.route) step.route = fields.route;
    section.steps.push(step);
  }

  sections.forEach((section) => delete section._order);
  const document = {
    title: meta.title || `${instance} review`,
    instance,
    jira: meta.jira || "",
    intro: meta.intro || "",
    sections,
  };

  return {
    ...document,
    checklist_revision: revisionFor(document),
  };
}
