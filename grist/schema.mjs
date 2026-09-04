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
        description:
          "Shown as the heading of the reviewer's panel and as the report title.",
      },
      intro: {
        type: "Text",
        description:
          "Orientation shown above the first step. Say anything a reviewer needs before starting — credentials, seeded data, known gaps.",
      },
      jira: {
        type: "Text",
        description:
          "Epic or ticket key (e.g. OGC-1234). Carried into the downloaded report.",
      },
      published: {
        type: "Bool",
        description:
          "Lists this review in the public catalog every deployment can read. Off until someone says otherwise: the catalog names the slug and title of whatever is in it, so an unreleased review stays out of it by default.",
      },
    },
  },

  UAT_Stories: {
    title:
      "One row per story: a thing being reviewed, with the steps that check it.",
    columns: {
      instance: {
        type: "Ref:UAT_Meta",
        description:
          "The review this story belongs to. Pick one — typing a name that matches nothing used to create a second, empty checklist instead of an error.",
      },
      story_key: {
        type: "Text",
        description:
          "REQUIRED and unique within the instance. What anything pointing at this story uses, so it survives a retitle — rename the title freely, leave this alone.",
        formula:
          '"{}-S{:02d}".format((($instance or "uat").split("-")[0][:4] or "uat").upper(), $id)',
        isFormula: false,
        recalcWhen: 0,
      },
      title: {
        type: "Text",
        description:
          "The heading a reviewer reads above this story's steps. Say what is being reviewed, not what to do — the steps say that.",
      },
      story_order: {
        type: "Int",
        description:
          "0-based position of this story in the checklist. Reordering is free; answers follow step_key, not position.",
      },
      version: {
        type: "Text",
        description:
          "major.minor, and the only thing here a person decides. Raise the major when a change means answers already given no longer count; raise the minor for a clarification they survive. Nothing computes this: whether an edit invalidates a review is a judgement, and a review records the version it was answered against so it can be told apart from a later one.",
        formula: '"1.0"',
        isFormula: false,
        recalcWhen: 0,
      },
      jira: {
        type: "Text",
        description:
          "The ticket this story is about — a key like OGC-1234, or its full URL.",
      },
      pr: {
        type: "Text",
        description:
          "The pull request implementing it, as a URL. One; link the rest from there.",
      },
      mock: {
        type: "Text",
        description:
          "The design or mock this was built against, as a URL — Figma, an image, a doc.",
      },
      user_story: {
        type: "Text",
        description:
          "The user story in words. Prose rather than a link, because plenty of them are not written down anywhere with an address.",
      },
      hosts: {
        type: "Text",
        description:
          "Limit this story to particular deployments: one host per line (amr.openelis-global.org, 10.0.0.4:8443). Leave blank and it shows wherever the widget runs, which is what most stories want.",
      },
      problems: {
        type: "Any",
        computed: true,
        description:
          "Everything wrong with this story, checked as you type. Empty means it is publishable.",
        isFormula: true,
        formula: [
          "import re",
          "problems = []",
          'k = ($story_key or "").strip()',
          'if not k: problems.append("missing story_key")',
          "else:",
          '  dupes = [s for s in UAT_Stories.lookupRecords(instance=$instance) if (s.story_key or "").strip() == k and s.id != $id]',
          '  if dupes: problems.append("duplicate story_key")',
          'if not ($title or "").strip(): problems.append("missing title")',
          "clash = [s for s in UAT_Stories.lookupRecords(instance=$instance, story_order=$story_order) if s.id != $id]",
          'if clash: problems.append("another story already has this story_order")',
          "if not UAT_Steps.lookupRecords(story=$id):",
          '  problems.append("no steps — this story is a heading with nothing under it")',
          'v = ($version or "").strip()',
          'if not v: problems.append("missing version — say 1.0 if this is the first")',
          'elif not re.match(r"^\\d+\\.\\d+$", v):',
          '  problems.append("version should read major.minor, like 2.1")',
          'return ", ".join(problems)',
        ].join("\n"),
      },
    },
  },

  UAT_Steps: {
    title: "One row per step. Every step belongs to a story.",
    // Retired by name rather than by leaving them out: apply never removes a
    // column it was not told about, because Grist keeps its own bookkeeping
    // columns in these tables and people add their own. Which story a step is in
    // is the reference now; these two said it by repeating a title on every row.
    retired: ["section", "section_order"],
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
        formula:
          '"{}-{:03d}".format((($instance or "uat").split("-")[0][:4] or "uat").upper(), $id)',
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
      step_order: {
        type: "Int",
        description:
          "0-based position of this step within its story. Reordering is free — a reviewer's answer follows step_key, not position.",
      },
      story: {
        type: "Ref:UAT_Stories",
        description:
          "The story this step belongs to. Pick one — a step with no story has no heading to appear under, and the checklist is refused.",
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
          '  dupes = [s for s in UAT_Steps.lookupRecords(instance=$instance) if (s.step_key or "").strip() == k and s.id != $id]',
          '  if dupes: problems.append("duplicate step_key")',
          'if not ($do or "").strip(): problems.append("missing do")',
          'r = ($route or "").strip()',
          'if r and (not r.startswith("/") or r.startswith("//") or "\\\\" in r): problems.append("route must be a same-origin path starting with /")',
          'if not $story: problems.append("no story — pick the story this step belongs to")',
          "else:",
          "  order = [s for s in UAT_Steps.lookupRecords(story=$story, step_order=$step_order) if s.id != $id]",
          '  if order: problems.append("another step in this story already has this step_order")',
          'return ", ".join(problems)',
        ].join("\n"),
      },
    },
  },

  UAT_Submissions: {
    title:
      "One row per review somebody handed in. Written by the widget; not edited here.",
    columns: {
      instance: {
        type: "Ref:UAT_Meta",
        description: "The review that was worked through.",
      },
      login: {
        type: "Text",
        description:
          "The authenticated application login that handed it in. The reviewer cannot type or replace this value.",
      },
      reviewer: {
        type: "Text",
        description:
          "The required name entered by the person performing the review. This remains separate from the authenticated application login because demo accounts may be shared.",
      },
      submitted_at: {
        type: "DateTime:UTC",
        description:
          "When it was handed in, taken from the server rather than the reviewer's clock.",
      },
      host: {
        type: "Text",
        description:
          "The deployment reviewed (amr.openelis-global.org). The same checklist run against two hosts gives two different answers about the same software.",
      },
      app_sha: {
        type: "Text",
        description:
          "The build under review, as target.json reported it. Without this a failure cannot be tied to code, only to a date.",
      },
      checklist_revision: {
        type: "Text",
        description:
          "The revision of the whole checklist as served, so two submissions can be told apart when the checklist changed between them.",
      },
      note: {
        type: "Text",
        description:
          "Anything the reviewer wanted to say about the review as a whole.",
      },
      failed: {
        type: "Int",
        computed: true,
        description:
          "How many steps were failed. Sort by it to find the submissions worth reading first.",
        isFormula: true,
        formula:
          'return len([a for a in UAT_Answers.lookupRecords(review=$id) if (a.mark or "") == "fail"])',
      },
      tally: {
        type: "Any",
        computed: true,
        description:
          "The submission at a glance: how many passed, failed, and were not applicable.",
        isFormula: true,
        formula: [
          "answers = UAT_Answers.lookupRecords(review=$id)",
          'def n(mark): return len([a for a in answers if (a.mark or "") == mark])',
          'return "{} pass · {} fail · {} n/a".format(n("pass"), n("fail"), n("na"))',
        ].join("\n"),
      },
    },
  },

  UAT_Answers: {
    title:
      "One row per step answered. Every field here is a copy taken at the time.",
    columns: {
      review: {
        type: "Ref:UAT_Submissions",
        description: "The submission this answer was part of.",
      },
      // Everything below is written once, by the submission, and never computed.
      // A formula would follow the story forward: edit a step tomorrow and every
      // review ever given would start claiming it was answered against the new
      // wording. These are meant to go stale — that is what makes them evidence.
      step_key: {
        type: "Text",
        description:
          "The step answered. Text rather than a reference, because the step can be reworded or deleted afterwards and this still says which one it was.",
      },
      story_key: {
        type: "Text",
        description: "The story the step was in at the time.",
      },
      story_title: {
        type: "Text",
        description:
          "Its heading as the reviewer read it, which is not necessarily its heading now.",
      },
      story_version: {
        type: "Text",
        description:
          "The version the author had set when this was answered. A submission against 1.3 does not answer for 2.0: raising the major is how an author says the old answers no longer count.",
      },
      story_revision: {
        type: "Text",
        description:
          "The story's content revision at the time. Catches the edit nobody thought to raise a version for.",
      },
      mark: {
        type: "Text",
        description:
          "pass, fail, or na. A step with no answer produces no row at all, so an absent step_key here means it was never reached rather than that it was fine.",
      },
      note: {
        type: "Text",
        description: "What the reviewer wrote about this step.",
      },
      actual_url: {
        type: "Text",
        description:
          "The page they were on when they answered, which is often the whole of a bug report.",
      },
      step: {
        type: "Ref:UAT_Steps",
        description:
          "A way to click through to the step as it stands today. Navigation only — it goes blank if the step is deleted, and step_key is what the answer is actually about.",
      },
      story: {
        type: "Ref:UAT_Stories",
        description:
          "The story as it stands today, for the same reason as step: navigation. It is also what lets a page show one story's answers across every submission, because Grist links two widgets through a reference and not through matching text. story_key and story_version remain what this answer is a record of.",
      },
    },
  },
};

// Fields that describe a column rather than a row of data. `computed` and
// `title` are ours; everything else is Grist's.
const COLUMN_FIELDS = [
  "type",
  "label",
  "description",
  "formula",
  "isFormula",
  "recalcWhen",
  "widgetOptions",
];

export function declaredFields(colId, spec) {
  const fields = { label: colId };
  for (const key of COLUMN_FIELDS) {
    if (key in spec) fields[key] = spec[key];
  }
  return fields;
}

function same(a, b) {
  if (typeof a === "boolean" || typeof b === "boolean")
    return Boolean(a) === Boolean(b);
  return String(a ?? "") === String(b ?? "");
}

// What it would take to bring `liveColumns` in line with `declared`. Returns the
// columns to add, the narrowest patch for the ones that have drifted, and the
// ones nobody declared — reported rather than removed.
export function planColumns(liveColumns, declared, retired = []) {
  const live = new Map(
    (liveColumns || []).map((column) => [column.id, column.fields || {}]),
  );
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
    if (Object.keys(drifted).length)
      update.push({ id: colId, fields: drifted });
  }

  const retire = retired.filter((colId) => live.has(colId));
  return {
    add,
    update,
    retire,
    extra: [...live.keys()].filter(
      (colId) => !(colId in declared) && !retired.includes(colId),
    ),
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
    // One story at a time: pick it, see its steps, edit one. The steps follow the
    // story through the reference the step already carries.
    name: "Story",
    sections: [
      {
        table: "UAT_Stories",
        type: "record",
        sort: ["instance", "story_order"],
      },
      {
        table: "UAT_Steps",
        type: "record",
        linkFrom: 0,
        linkVia: "story",
        sort: ["step_order"],
      },
      { table: "UAT_Steps", type: "single", linkFrom: 1 },
    ],
  },
  {
    // Every story at once, for a sweep: what is unpublishable, what has no
    // expected result, what the last edit touched.
    name: "All steps",
    sections: [
      { table: "UAT_Steps", type: "record", sort: ["instance", "step_order"] },
    ],
  },
  {
    // One checklist, whole: its stories, and the steps of whichever story is
    // picked. This is the authored side — what reviewers will be asked.
    //
    // It was called "Reviews", which is what UAT_Meta rows are called, and sat
    // beside a "Results" page holding the reviews people had actually given.
    // Two pages, both fairly described as reviews, and no way to tell from the
    // nav which was which.
    name: "Checklists",
    renamedFrom: ["Reviews"],
    sections: [
      { table: "UAT_Meta", type: "record", sort: ["instance"] },
      {
        table: "UAT_Stories",
        type: "record",
        linkFrom: 0,
        linkVia: "instance",
        sort: ["story_order"],
      },
      {
        table: "UAT_Steps",
        type: "record",
        linkFrom: 1,
        linkVia: "story",
        sort: ["step_order"],
      },
    ],
  },
  {
    // What came back, by person. Pick a submission, read what that reviewer
    // answered.
    name: "Submitted reviews",
    renamedFrom: ["Results"],
    sections: [
      { table: "UAT_Submissions", type: "record", sort: ["-submitted_at"] },
      { table: "UAT_Answers", type: "record", linkFrom: 0, linkVia: "review" },
      { table: "UAT_Answers", type: "single", linkFrom: 1 },
    ],
  },
  {
    // What came back, by story — the other axis, and usually the one worth
    // reading. "Submitted reviews" answers what one person said; this answers
    // how one story did, across everybody who tried it.
    //
    // Possible only because an answer carries a reference to its story: Grist
    // links two widgets through a reference, never through matching text, and
    // story_key is deliberately text so it cannot follow a story that moves.
    name: "Story results",
    sections: [
      {
        table: "UAT_Stories",
        type: "record",
        sort: ["instance", "story_order"],
      },
      {
        table: "UAT_Answers",
        type: "record",
        linkFrom: 0,
        linkVia: "story",
        // Ascending mark puts fail above na above pass. That is alphabetical
        // order doing the work rather than a rule anybody wrote, so the tests
        // assert it holds for the three marks a widget can produce.
        sort: ["mark"],
      },
      { table: "UAT_Answers", type: "single", linkFrom: 1 },
    ],
  },
];

// A sort entry, which is a column id optionally prefixed with "-" for descending.
// Shared so the declaration and the tool that builds the pages cannot disagree
// about what "-submitted_at" means.
export function sortSpec(entry) {
  const descending = entry.startsWith("-");
  return { col: descending ? entry.slice(1) : entry, descending };
}

// How Grist wants a section sorted: column refs, negated for descending.
//
// Refuses a column it cannot resolve. Skipping it would leave the page sorted by
// whatever survived — or by nothing — while the run still reported the page
// built, which is the quietest way for a typo in the declaration to ship.
export function planSortColRefs(table, sort, colRef) {
  return (sort || []).map((entry) => {
    const { col, descending } = sortSpec(entry);
    const ref = colRef.get(`${table}.${col}`);
    if (!ref) throw new Error(`cannot sort ${table} by unknown column ${col}`);
    return descending ? -ref : ref;
  });
}

// Which declared pages the document is missing, and which are there under a
// name this declaration has since changed. Grist's raw-data views carry the
// table's own name and are never a page somebody authored, so they cannot stand
// in for one.
//
// Renaming rather than rebuilding: a page is its widgets, their links and
// whatever layout somebody dragged into place, and all of that survives a
// rename. Creating the new name and leaving the old page behind would be worse
// than the ambiguity the rename is fixing.
export function planPages(liveViews, declared = PAGES) {
  const views = (liveViews || []).filter(
    (view) => (view.fields || {}).type !== "raw_data",
  );
  const byName = new Map(views.map((view) => [(view.fields || {}).name, view]));

  const create = [];
  const rename = [];
  for (const page of declared) {
    if (byName.has(page.name)) continue;
    const old = (page.renamedFrom || []).find((name) => byName.has(name));
    if (old) {
      rename.push({ id: byName.get(old).id, from: old, to: page.name });
      continue;
    }
    create.push(page.name);
  }
  return { create, rename };
}

// Turning the section a step names into a story it points at.
//
// The section title and its order were repeated on every step in the group, so
// the distinct pairs are the stories. Grouped per instance: two reviews both
// opening with "Sign in" are two stories, and merging them would file one
// review's steps under the other's heading.
//
// A step that already points at a story is left alone, so running this a second
// time does not build another set of stories over the first.
export function planStoryMigration(metaRecords, stepRecords) {
  const reviewByName = new Map(
    (metaRecords || []).map((record) => [
      String((record.fields || {}).instance || "").trim(),
      record.id,
    ]),
  );
  const stories = [];
  const index = new Map();
  const assign = [];
  const perReview = new Map();

  for (const record of stepRecords || []) {
    const fields = record.fields || {};
    if (fields.story) continue;
    const name = String(fields.instance || "").trim();
    const order = Number(fields.section_order) || 0;
    const group = `${name} ${order}`;
    if (!index.has(group)) {
      index.set(group, stories.length);
      const seq = (perReview.get(name) || 0) + 1;
      perReview.set(name, seq);
      stories.push({
        // The review's row id. instance is a reference, and the name written into
        // one is alt-text Grist cannot resolve back to a review.
        instance: reviewByName.get(name) || 0,
        // Written here rather than left to the column's trigger: the rows this
        // creates would otherwise have no key until Grist computed one, and
        // everything downstream is keyed by it.
        story_key: `${(name.split("-")[0].slice(0, 4) || "uat").toUpperCase()}-S${String(seq).padStart(2, "0")}`,
        // A section that lost its title still needs a heading a reviewer can read.
        title: String(fields.section || "").trim() || `Section ${order}`,
        story_order: order,
      });
    }
    assign.push({ id: record.id, story: index.get(group) });
  }

  return { stories, assign };
}

// Turning the review name a story typed into the review it points at.
//
// For documents whose stories predate the reference: captured before the column
// becomes one, because afterwards the text is no longer something the document
// can resolve. A migration running now writes row ids directly and never needs
// this.
export function planInstanceRefs(storyRecords, metaRecords) {
  const byName = new Map(
    (metaRecords || []).map((record) => [
      String((record.fields || {}).instance || "").trim(),
      record.id,
    ]),
  );
  const assign = [];
  const unmatched = [];
  for (const record of storyRecords || []) {
    const value = (record.fields || {}).instance;
    // Already a reference: a row id is a number, a name is not.
    if (typeof value === "number") continue;
    const name = String(value || "").trim();
    if (!name) continue;
    const id = byName.get(name);
    // Reported rather than zeroed. Emptying it would detach the story from its
    // review, and its steps would leave the checklist with nothing saying why.
    if (!id) {
      unmatched.push(name);
      continue;
    }
    assign.push({ id: record.id, instance: id });
  }
  return { assign, unmatched };
}
