#!/usr/bin/env node
// evidence/package — one MP4 per recorded evidence story, filed by the site's
// lanes and stages, with a gallery page.
//
// Reads the JSON report of an OpenELIS-Global-2 `evidence-video` Playwright run.
// Every story in it must carry `@evidence`, exactly one lane tag and one stage
// tag that the site lists, have passed and have a video; otherwise nothing is
// written and every problem is listed. Each video is re-encoded to H.264
// (faststart, so browsers, GitHub and Slack play it inline) with every stretch
// in which nothing on screen changes cut down to a few seconds, long enough to
// read the caption over it.
//
// Usage:
//   node evidence/package.mjs --site amr --report <report.json> --out <dir> \
//     [--release <release.json>]
//
// Writes <out>/<lane>/<stage>/<nn>-<story>.mp4, <out>/index.json,
// <out>/index.html and, when given, <out>/release.json. Requires ffmpeg and
// ffprobe on PATH.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  filedStories,
  galleryHtml,
  problemsWith,
  recordedStories,
} from "./stories.mjs";

// Seconds of every still stretch that stay, so the caption over it can be read.
export const KEEP_STILL_SECONDS = 3.5;
// Playwright inserts a keyframe every few seconds while nothing paints; at
// -60dB those split every still stretch, at -42dB they do not.
const FREEZE_NOISE = "-42dB";
const FREEZE_MIN_SECONDS = 4.5;

const SITES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "sites",
);

export function loadSite(name) {
  const file = path.join(SITES_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    const known = fs
      .readdirSync(SITES_DIR)
      .map((f) => f.replace(/\.json$/, ""))
      .join(", ");
    throw new Error(`unknown site ${name}; known: ${known}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseArgs(argv) {
  const out = { site: null, report: null, out: null, release: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--site") out.site = argv[++i];
    else if (arg === "--report") out.report = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--release") out.release = argv[++i];
    else if (arg === "-h" || arg === "--help") {
      console.log(
        "package --site <name> --report <playwright json report> --out <dir> [--release <release.json>]",
      );
      process.exit(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  for (const key of ["site", "report", "out"]) {
    if (!out[key]) {
      console.error(`--${key} is required`);
      process.exit(2);
    }
  }
  return out;
}

export function durationSeconds(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  return Number(out.trim());
}

/** Intervals in which no frame changes; Playwright repeats the last frame while nothing paints. */
export function stillStretches(video) {
  const run = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      video,
      "-vf",
      `fps=25,freezedetect=n=${FREEZE_NOISE}:d=${FREEZE_MIN_SECONDS}`,
      "-map",
      "0:v",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(run.stderr);
  const stretches = [];
  let begin = null;
  for (const line of run.stderr.split("\n")) {
    if (line.includes("freeze_start:")) {
      begin = Number(line.slice(line.lastIndexOf(":") + 1));
    } else if (line.includes("freeze_end:") && begin !== null) {
      stretches.push([begin, Number(line.slice(line.lastIndexOf(":") + 1))]);
      begin = null;
    }
  }
  if (begin !== null) stretches.push([begin, durationSeconds(video)]);
  return stretches;
}

/** Encodes one story, cutting each still stretch down to KEEP_STILL_SECONDS; returns seconds cut. */
export function encodeStory(video, target) {
  const cuts = stillStretches(video)
    .map(([a, b]) => [a + KEEP_STILL_SECONDS, b - 0.2])
    .filter(([a, b]) => b - a > 0.5);
  let chain = "fps=25";
  if (cuts.length > 0) {
    const cut = cuts
      .map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`)
      .join("+");
    chain += `,select='not(${cut})',setpts=N/25/TB`;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    video,
    "-vf",
    chain,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    target,
  ]);
  return cuts.reduce((sum, [a, b]) => sum + (b - a), 0);
}

const sha256 = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function packageEvidence({ site, report, out, release }) {
  const stories = recordedStories(report, site.project);
  if (stories.length === 0) {
    throw new Error(`the report has no ${site.project} stories`);
  }
  const problems = stories
    .map((story) => ({ story, problems: problemsWith(story, site) }))
    .filter(({ problems }) => problems.length > 0);
  if (problems.length > 0) {
    throw new Error(
      problems
        .map(
          ({ story, problems: list }) => `${story.title}\n  ${list.join("; ")}`,
        )
        .join("\n"),
    );
  }

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const index = [];
  for (const { story, lane, stage, file } of filedStories(stories, site)) {
    const target = path.join(out, file);
    const cut = encodeStory(story.video, target);
    const seconds = durationSeconds(target);
    index.push({
      lane: lane.tag.slice(1),
      stage: stage.tag.slice(1),
      title: story.title,
      spec: story.file,
      file,
      seconds: Math.round(seconds * 10) / 10,
      stillSecondsCut: Math.round(cut * 10) / 10,
      bytes: fs.statSync(target).size,
      sha256: sha256(target),
    });
    console.log(
      `${file} ${seconds.toFixed(0)}s (${cut.toFixed(0)}s of still screen cut)`,
    );
  }
  fs.writeFileSync(
    path.join(out, "index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  if (release) {
    fs.writeFileSync(
      path.join(out, "release.json"),
      `${JSON.stringify(release, null, 2)}\n`,
    );
  }
  fs.writeFileSync(
    path.join(out, "index.html"),
    galleryHtml(site, index, release ?? {}),
  );
  return index;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const index = packageEvidence({
      site: loadSite(args.site),
      report: JSON.parse(fs.readFileSync(args.report, "utf8")),
      out: args.out,
      release: args.release
        ? JSON.parse(fs.readFileSync(args.release, "utf8"))
        : null,
    });
    console.log(`${index.length} videos under ${args.out}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
