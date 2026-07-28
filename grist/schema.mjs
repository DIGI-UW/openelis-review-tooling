// The UAT document's schema, declared.
//
// Everything a human relies on when authoring a checklist — the column
// descriptions, the defaults that fire on create, the validation column — lived
// only in the running document. Lose the document and the authoring experience
// goes with it, and nothing could tell you whether the document still matched
// what the repository expected. This is that declaration; `grist-sync.mjs apply`
// reconciles a document to it.
//
// Reconciling is not owning: a column the declaration says nothing about is left
// alone, because Grist keeps its own bookkeeping columns here and people add
// their own.

export const SCHEMA = {
  UAT_Meta: {
    title: "One row per review. Create the row here first, then its steps.",
    columns: {
      instance: {
        type: "Text",
        description:
          "The slug that identifies this review everywhere: the checklist URL, the widget's data-instance, and each reviewer's saved answers. Lowercase, no spaces. Changing it orphans existing answers.",
      },
      title: {
        type: "Text",
        description: "Shown as the heading of the reviewer's panel and as the report title.",
      },
      intro: {
        type: "Text",
        description:
          "Orientation shown above the first step. Say anything a reviewer needs before starting — credentials, seeded data, known gaps.",
      },
      jira: {
        type: "Text",
        description: "Epic or ticket key (e.g. OGC-1234). Carried into the downloaded report.",
      },
      published: {
        type: "Bool",
        description:
          "Lists this review in the public catalog every deployment can read. Off until someone says otherwise: the catalog names the slug and title of whatever is in it, so an unreleased review stays out of it by default.",
      },
    },
  },

  UAT_Steps: {
    title: "One row per step. Every step belongs to an instance in UAT_Meta.",
    columns: {
      instance: {
        type: "Text",
        description:
          "Must exactly match an instance in UAT_Meta. This is free text, so a typo silently creates a separate, empty checklist rather than an error.",
      },
      step_key: {
        type: "Text",
        description:
          "REQUIRED and unique within the instance. Reviewer answers are keyed by it, so never change or reuse one — reorder rows instead. A blank value makes the ENTIRE checklist fail for every reviewer, not just this row.",
        // A default that fires once, on create, rather than a formula: the author
        // must be able to overwrite it, and a reviewer's answers are keyed by
        // whatever it settles on.
        formula: '"{}-{:03d}".format((($instance or "uat").split("-")[0][:4] or "uat").upper(), $id)',
        isFormula: false,
        recalcWhen: 0,
      },
      required: {
        type: "Bool",
        description:
          "Set this explicitly. An untouched checkbox reads as false, which silently makes the step optional so it cannot fail the review.",
        formula: "True",
        isFormula: false,
        recalcWhen: 0,
      },
      section: {
        type: "Text",
        description:
          "Group heading shown to the reviewer. Every row sharing a section_order must use the identical title, or the checklist is rejected.",
      },
      section_order: {
        type: "Int",
        description:
          "0-based order of this section within the checklist. Rows sharing it form one section.",
      },
      step_order: {
        type: "Int",
        description:
          "0-based order of this step inside its section. Reordering is free — the answer follows step_key, not position.",
      },
      do: {
        type: "Text",
        description:
          "The action the reviewer performs. Required. One observation per step — if it needs an 'and', make it two steps.",
      },
      expect: {
        type: "Text",
        description:
          "What should happen, and what to flag if it doesn't. This is what makes a Fail meaningful rather than just 'confused'.",
      },
      route: {
        type: "Text",
        description:
          "Optional same-origin path (e.g. /Microbiology/worklist) rendered as a 'Go to' link. Leave blank if you don't know the real path — a guess sends reviewers to a 404.",
      },
      problems: {
        type: "Any",
        computed: true,
        description:
          "Everything wrong with this row, checked as you type. Empty means the row is publishable; anything here means the checklist endpoint will refuse it.",
        isFormula: true,
        formula: [
          "problems = []",
          'k = ($step_key or "").strip()',
          'if not k: problems.append("missing step_key — this breaks the WHOLE checklist")',
          "else:",
          "  dupes = [s for s in UAT_Steps.lookupRecords(instance=$instance) if (s.step_key or \"\").strip() == k and s.id != $id]",
          '  if dupes: problems.append("duplicate step_key")',
          'if not ($do or "").strip(): problems.append("missing do")',
          'r = ($route or "").strip()',
          'if r and (not r.startswith("/") or r.startswith("//") or "\\\\" in r): problems.append("route must be a same-origin path starting with /")',
          'clash = [s for s in UAT_Steps.lookupRecords(instance=$instance, section_order=$section_order) if (s.section or "") != ($section or "")]',
          'if clash: problems.append("section title disagrees with others at this section_order")',
          "order = [s for s in UAT_Steps.lookupRecords(instance=$instance, section_order=$section_order, step_order=$step_order) if s.id != $id]",
          'if order: problems.append("duplicate section_order/step_order")',
          'return ", ".join(problems)',
        ].join("\n"),
      },
    },
  },

  UAT_Results: {
    title: "Where a returned review lands. Reviewers answer in their own browser; nothing arrives here until a report is imported.",
    columns: {
      reviewer: {
        type: "Text",
        description: "Who ran the review, as they typed it into the panel's name field.",
      },
      instance: {
        type: "Text",
        description: "The review this answer belongs to. Matches UAT_Meta.instance.",
      },
      step_key: {
        type: "Text",
        description: "The step this answers, by its stable key rather than its position.",
      },
      mark: {
        type: "Text",
        description: "pass, fail or na — exactly as the reviewer's panel recorded it.",
      },
      note: {
        type: "Text",
        description: "What the reviewer wrote against this step. The most useful column here.",
      },
      page_url: {
        type: "Text",
        description: "The page the reviewer was actually looking at when they marked it.",
      },
      at: {
        type: "Text",
        description: "When the step was marked, as an ISO timestamp from the reviewer's browser.",
      },
    },
  },
};

// Fields that describe a column rather than a row of data. `computed` and
// `title` are ours; everything else is Grist's.
const COLUMN_FIELDS = ["type", "label", "description", "formula", "isFormula", "recalcWhen", "widgetOptions"];

export function declaredFields(colId, spec) {
  const fields = { label: colId };
  for (const key of COLUMN_FIELDS) {
    if (key in spec) fields[key] = spec[key];
  }
  return fields;
}

function same(a, b) {
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  return String(a ?? "") === String(b ?? "");
}

// What it would take to bring `liveColumns` in line with `declared`. Returns the
// columns to add, the narrowest patch for the ones that have drifted, and the
// ones nobody declared — reported rather than removed.
export function planColumns(liveColumns, declared) {
  const live = new Map((liveColumns || []).map((column) => [column.id, column.fields || {}]));
  const add = [];
  const update = [];

  for (const [colId, spec] of Object.entries(declared)) {
    const wanted = declaredFields(colId, spec);
    const current = live.get(colId);
    if (!current) {
      add.push({ id: colId, fields: wanted });
      continue;
    }
    const drifted = {};
    for (const [key, value] of Object.entries(wanted)) {
      if (!same(current[key], value)) drifted[key] = value;
    }
    if (Object.keys(drifted).length) update.push({ id: colId, fields: drifted });
  }

  return {
    add,
    update,
    extra: [...live.keys()].filter((colId) => !(colId in declared)),
  };
}

// The pages an author actually works in.
//
// A document with no pages is not empty in the left-hand nav: Grist falls back to
// one raw-data view per table, which is why this looked like it had three pages
// while having none. Raw data is a table dump — every column, every instance
// interleaved, and a paragraph of instructions to be typed into a grid cell.
export const PAGES = [
  {
    name: "Checklist",
    sections: [
      // Sorted the way a checklist reads rather than the order rows were typed.
      { table: "UAT_Steps", type: "record", sort: ["instance", "section_order", "step_order"] },
      // The same rows again as a card, following the list's cursor. do and expect
      // are paragraphs, and a card gives them room; a grid cell gives them a line.
      // Linking a section to another over the same table needs no reference
      // column — it follows the cursor.
      { table: "UAT_Steps", type: "single", linkFrom: 0 },
    ],
  },
  {
    name: "Reviews",
    sections: [
      { table: "UAT_Meta", type: "record", sort: ["instance"] },
      { table: "UAT_Meta", type: "single", linkFrom: 0 },
    ],
  },
];

// Which declared pages the document is missing. Grist's raw-data views carry the
// table's own name and are never a page somebody authored, so they cannot stand
// in for one.
export function planPages(liveViews, declared = PAGES) {
  const authored = new Set(
    (liveViews || [])
      .filter((view) => (view.fields || {}).type !== "raw_data")
      .map((view) => (view.fields || {}).name),
  );
  return { create: declared.filter((page) => !authored.has(page.name)).map((page) => page.name) };
}
