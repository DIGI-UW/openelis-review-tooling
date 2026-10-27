// Which recorded stories an evidence package holds, and where each one is filed.
// Pure functions over a Playwright JSON report and a site configuration; the
// encoding lives in package.mjs.

/** Every test the given project ran, with its tags, last status and video. */
export function recordedStories(report, project) {
  const stories = [];
  const visit = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.projectName !== project) continue;
        const result = test.results?.[test.results.length - 1];
        const video = result?.attachments?.find((a) => a.name === "video");
        // A narrated story names itself in its intro; the test title is the fallback.
        const note = (type) =>
          [...(result?.annotations ?? []), ...(test.annotations ?? [])].find(
            (a) => a.type === type,
          )?.description;
        stories.push({
          title: note("story") ?? spec.title,
          summary: note("story-summary") ?? null,
          file: spec.file ?? file,
          line: spec.line ?? 0,
          // The JSON reporter writes tags without their "@".
          tags: (spec.tags ?? test.tags ?? []).map((tag) =>
            tag.startsWith("@") ? tag : `@${tag}`,
          ),
          status: result?.status ?? "missing",
          video: video?.path ?? null,
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, suite.file ?? file);
  };
  for (const suite of report.suites ?? []) visit(suite, suite.file);
  return stories.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  );
}

/** Why a story cannot be filed on this site; empty when it can. */
export function problemsWith(story, site) {
  const problems = [];
  if (!story.tags.includes("@evidence")) problems.push("not tagged @evidence");
  const lanes = story.tags.filter((t) => site.lanes.some((l) => l.tag === t));
  const stages = story.tags.filter((t) => site.stages.some((s) => s.tag === t));
  if (lanes.length !== 1)
    problems.push(`lane tags for ${site.site}: ${lanes.join(" ") || "none"}`);
  if (stages.length !== 1)
    problems.push(`stage tags for ${site.site}: ${stages.join(" ") || "none"}`);
  if (story.status !== "passed") problems.push(`status ${story.status}`);
  if (!story.video) problems.push("no video");
  return problems;
}

export function slug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-[^-]*$/, (tail) => (tail.length > 12 ? "" : tail));
}

/**
 * Lane, stage and numbered file name for each story, in the site's lane and
 * stage order; within a stage, in spec order.
 */
export function filedStories(stories, site) {
  const order = (list, tag) => list.findIndex((item) => item.tag === tag);
  const placed = stories.map((story) => {
    const lane = site.lanes.find((l) => story.tags.includes(l.tag));
    const stage = site.stages.find((s) => story.tags.includes(s.tag));
    return { story, lane, stage };
  });
  placed.sort(
    (a, b) =>
      order(site.lanes, a.lane.tag) - order(site.lanes, b.lane.tag) ||
      order(site.stages, a.stage.tag) - order(site.stages, b.stage.tag),
  );
  const counters = new Map();
  return placed.map(({ story, lane, stage }) => {
    const laneName = lane.tag.slice(1);
    const stageName = stage.tag.slice(1);
    const key = `${laneName}/${stageName}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return {
      story,
      lane,
      stage,
      file: `${key}/${String(n).padStart(2, "0")}-${slug(story.title)}.mp4`,
    };
  });
}

const escape = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const sentence = (title) => title.charAt(0).toUpperCase() + title.slice(1);

/** A self-contained gallery of the package's videos, grouped by lane and stage. */
export function galleryHtml(site, index, release) {
  const sections = [];
  for (const lane of site.lanes) {
    for (const stage of site.stages) {
      const videos = index.filter(
        (v) => v.lane === lane.tag.slice(1) && v.stage === stage.tag.slice(1),
      );
      if (videos.length === 0) continue;
      const heading =
        site.lanes.length > 1 ? `${lane.title}: ${stage.title}` : stage.title;
      sections.push(
        `<section><h2>${escape(heading)}</h2>${videos
          .map(
            (v) =>
              `<figure><video controls preload="metadata" src="${escape(v.file)}"></video><figcaption>${escape(sentence(v.title))} <span>${Math.round(v.seconds)} s</span>${v.summary ? `<p>${escape(v.summary)}</p>` : ""}</figcaption></figure>`,
          )
          .join("")}</section>`,
      );
    }
  }
  const about = [
    release.recordedOn,
    release.application,
    release.recordedAt,
  ].filter(Boolean);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(site.title)}</title>
<style>
:root{color-scheme:light dark;--fg:#161616;--muted:#525252;--bg:#fff;--line:#e0e0e0}
@media (prefers-color-scheme:dark){:root{--fg:#f4f4f4;--muted:#c6c6c6;--bg:#161616;--line:#393939}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px}
h1{font-size:28px;margin:0 0 4px}p.about{color:var(--muted);margin:0 0 24px}
section{border-top:1px solid var(--line);padding:16px 0}h2{font-size:20px;margin:0 0 12px}
figure{margin:0 0 20px}video{width:100%;max-width:960px;background:#000;border-radius:4px}
figcaption{margin-top:6px;font-weight:600}figcaption span{color:var(--muted);margin-left:8px;font-weight:400}
figcaption p{margin:2px 0 0;font-weight:400;color:var(--muted)}
</style></head><body><main>
<h1>${escape(site.title)}</h1>
<p class="about">${about.map(escape).join(" · ")}</p>
${sections.join("\n")}
</main></body></html>
`;
}
