import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  durationSeconds,
  KEEP_STILL_SECONDS,
  loadSite,
  packageEvidence,
} from "../evidence/package.mjs";
import { filedStories, recordedStories } from "../evidence/stories.mjs";

const amr = loadSite("amr");

function spec(
  title,
  tags,
  {
    status = "passed",
    video = "/v.webm",
    project = "evidence-video",
    line = 1,
  } = {},
) {
  return {
    title,
    line,
    tags,
    tests: [
      {
        projectName: project,
        results: [
          {
            status,
            attachments: video ? [{ name: "video", path: video }] : [],
          },
        ],
      },
    ],
  };
}

const report = (specs, file = "foundational/core/microbiology-a.spec.ts") => ({
  suites: [{ file, specs }],
});

test("only the evidence project's stories are read, with tags normalised to @", () => {
  const stories = recordedStories(
    report([
      spec("records a culture", ["evidence", "microbiology", "culture"]),
      spec("runs elsewhere", ["evidence"], { project: "core-app" }),
    ]),
    "evidence-video",
  );
  assert.equal(stories.length, 1);
  assert.deepEqual(stories[0].tags, ["@evidence", "@microbiology", "@culture"]);
  assert.equal(stories[0].file, "foundational/core/microbiology-a.spec.ts");
});

test("stories are filed in the site's stage order and numbered within each stage", () => {
  const stories = recordedStories(
    report([
      spec(
        "exports the population",
        ["@evidence", "@microbiology", "@exports"],
        { line: 1 },
      ),
      spec(
        "Publishes an immutable AST panel version",
        ["@evidence", "@microbiology", "@admin"],
        { line: 2 },
      ),
      spec(
        "activates a loaded standard",
        ["@evidence", "@microbiology", "@admin"],
        { line: 3 },
      ),
    ]),
    "evidence-video",
  );
  assert.deepEqual(
    filedStories(stories, amr).map((f) => f.file),
    [
      "microbiology/admin/01-publishes-an-immutable-ast-panel-version.mp4",
      "microbiology/admin/02-activates-a-loaded-standard.mp4",
      "microbiology/exports/01-exports-the-population.mp4",
    ],
  );
});

test("a run with any unfit story writes nothing and names every problem", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-out-"));
  fs.writeFileSync(path.join(out, "keep.txt"), "earlier package");
  const unfit = report([
    spec("has no evidence tag", ["@microbiology", "@case"]),
    spec("belongs to another site", ["@evidence", "@astm", "@setup"]),
    spec("failed", ["@evidence", "@microbiology", "@case"], {
      status: "failed",
    }),
    spec("lost its video", ["@evidence", "@microbiology", "@case"], {
      video: null,
    }),
  ]);
  assert.throws(
    () => packageEvidence({ site: amr, report: unfit, out }),
    (error) => {
      assert.match(
        error.message,
        /has no evidence tag\n {2}not tagged @evidence/,
      );
      assert.match(
        error.message,
        /belongs to another site\n {2}lane tags for amr: none; stage tags for amr: none/,
      );
      assert.match(error.message, /failed\n {2}status failed/);
      assert.match(error.message, /lost its video\n {2}no video/);
      return true;
    },
  );
  assert.deepEqual(fs.readdirSync(out), ["keep.txt"]);
});

test("a recording's still stretch is cut to a readable pause and the MP4 streams from its start", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-clip-"));
  const clip = path.join(work, "video.webm");
  // Two seconds of motion, nine seconds of an unchanging frame, one second of motion.
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x240:rate=25:duration=2",
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:size=320x240:rate=25:duration=9",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x240:rate=25:duration=1",
    "-filter_complex",
    "[0:v][1:v][2:v]concat=n=3:v=1:a=0",
    "-c:v",
    "libvpx",
    "-b:v",
    "500k",
    clip,
  ]);
  const out = path.join(work, "package");
  const index = packageEvidence({
    site: amr,
    report: report([
      spec("inoculates a culture", ["@evidence", "@microbiology", "@culture"], {
        video: clip,
      }),
    ]),
    out,
    release: { recordedOn: "Local stack", application: "OpenELIS abc1234" },
  });

  assert.equal(index.length, 1);
  const mp4 = path.join(out, index[0].file);
  const seconds = durationSeconds(mp4);
  // About 2 + KEEP_STILL_SECONDS + 1 seconds remain of the original 12.
  assert.ok(
    seconds > 2 + KEEP_STILL_SECONDS && seconds < 8,
    `kept ${seconds}s`,
  );
  assert.ok(index[0].stillSecondsCut > 4, `cut ${index[0].stillSecondsCut}s`);
  const codec = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,pix_fmt",
      "-of",
      "csv=p=0",
      mp4,
    ],
    { encoding: "utf8" },
  ).trim();
  assert.equal(codec, "h264,yuv420p");
  const head = fs.readFileSync(mp4).subarray(0, 4096).toString("latin1");
  const moov = head.indexOf("moov");
  const mdat = head.indexOf("mdat");
  assert.ok(moov > -1 && (mdat === -1 || moov < mdat), "moov precedes mdat");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(out, "release.json"), "utf8"))
      .application,
    "OpenELIS abc1234",
  );
  const gallery = fs.readFileSync(path.join(out, "index.html"), "utf8");
  assert.match(gallery, /<h2>Cultures<\/h2>/);
  assert.match(
    gallery,
    /src="microbiology\/culture\/01-inoculates-a-culture\.mp4"/,
  );
  assert.match(gallery, /Inoculates a culture/);
  assert.match(gallery, /Local stack · OpenELIS abc1234/);
});

test("every site lists distinct lane and stage tags", () => {
  for (const name of ["amr", "analyzers"]) {
    const site = loadSite(name);
    const tags = [...site.lanes, ...site.stages].map((t) => t.tag);
    assert.equal(new Set(tags).size, tags.length, name);
    assert.ok(
      tags.every((t) => /^@[a-z0-9]+$/.test(t)),
      name,
    );
    assert.equal(site.project, "evidence-video");
  }
});
