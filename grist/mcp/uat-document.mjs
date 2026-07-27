import { createHash } from "node:crypto";

const SCHEMA_VERSION = 2;

// One canonical reading of `required`, shared with the migration and mirrored by
// the widget. These had drifted into three different defaults: this module
// treated an unset value as optional while the widget and the migration treated
// it as required, so a blank cell meant opposite things either side of the wire.
// A step is required unless it says otherwise — an acceptance report must not be
// able to claim completeness because a step quietly defaulted to optional.
export function parseRequired(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "") return true;
    return !["false", "0", "no", "n", "off"].includes(normalized);
  }
  return Boolean(value);
}

// The mirror of parseRequired, with deliberately the opposite default. A story
// is listed only once somebody has said it should be: the catalog is readable by
// anyone, so an unset flag has to mean "not yet", not "sure". Grist backfills a
// new Bool column with false, which lands on the safe side by itself.
export function parsePublished(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") {
    return ["true", "1", "yes", "y", "on"].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
}

// A prefix test is not enough: "/\evil.com" starts with a single slash, but the
// URL parser treats the backslash as an authority separator and resolves it to
// another origin. Anyone who can edit a checklist row could otherwise put an
// off-site link into an overlay the reviewer has been told to trust. Resolve
// against a sentinel origin and require the result to stay on it.
const ROUTE_BASE = "https://route-check.invalid";
function validateRoute(route, stepKey) {
  if (!route) return "";
  let sameOrigin = false;
  if (route.startsWith("/")) {
    try {
      sameOrigin = new URL(route, ROUTE_BASE).origin === ROUTE_BASE;
    } catch {
      sameOrigin = false;
    }
  }
  if (!sameOrigin) {
    throw new Error(`step ${stepKey} route must be a same-origin absolute path`);
  }
  return route;
}

function contentHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// The catalog of stories reviewable on a deployment. The widget uses it to offer
// a switcher and to say which stories have anything to say about the page the
// reviewer is currently looking at, so `routes` carries paths only — a step's
// query string selects a filter, it does not identify a different page.
export function buildUatIndex(metaRecords, stepRecords) {
  const titles = new Map();
  for (const record of metaRecords || []) {
    const fields = record.fields || {};
    const instance = String(fields.instance || "").trim();
    if (instance) titles.set(instance, fields);
  }

  const stories = new Map();
  const warnings = [];
  for (const record of stepRecords || []) {
    const fields = record.fields || {};
    const instance = String(fields.instance || "").trim();
    if (!instance) continue;
    let story = stories.get(instance);
    if (!story) {
      story = { instance, steps: 0, required: 0, routes: new Set() };
      stories.set(instance, story);
    }
    story.steps += 1;
    if (parseRequired(fields.required)) story.required += 1;
    if (fields.route) {
      // Reported and skipped rather than thrown. The catalog spans every story on
      // the deployment, so one bad row in somebody's draft would otherwise take
      // the whole thing down — and the deploy that is gated on this endpoint with
      // it. The checklist document still refuses the route outright, which is
      // where the reviewer would actually be sent.
      try {
        const route = validateRoute(String(fields.route).trim(), fields.step_key || instance);
        story.routes.add(new URL(route, ROUTE_BASE).pathname);
      } catch (error) {
        warnings.push(`${instance}: ${error.message}`);
      }
    }
  }

  return {
    schemaVersion: 1,
    warnings,
    // A story with a meta row but no steps is not reviewable; listing it would
    // offer the reviewer an empty checklist.
    stories: [...stories.values()]
      // Unpublished stories are left out silently. Naming them here would put the
      // slugs and titles of unreleased work into the very document this flag
      // exists to keep them out of; grist/mcp/README.md says how to publish one.
      .filter((story) => parsePublished((titles.get(story.instance) || {}).published))
      .sort((a, b) => a.instance.localeCompare(b.instance))
      .map((story) => {
        const meta = titles.get(story.instance) || {};
        return {
          instance: story.instance,
          title: meta.title || `${story.instance} review`,
          jira: meta.jira || "",
          steps: story.steps,
          required: story.required,
          routes: [...story.routes].sort(),
        };
      }),
  };
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
      required: parseRequired(row.required),
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
