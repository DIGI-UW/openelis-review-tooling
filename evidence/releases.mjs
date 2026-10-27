#!/usr/bin/env node
// evidence/releases — the list of a site's published evidence releases and the
// index page rendered from it. Used by scripts/publish-evidence.sh; a release
// folder is never rewritten once published.
//
// Usage:
//   node evidence/releases.mjs --site amr --releases <releases.json> \
//     --id <release-id> --release <package/release.json> \
//     --out-releases <file> --out-index <file>

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSite } from "./package.mjs";

const RELEASE_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9][a-z0-9.-]*$/;

/** The list with the new release first; refuses a reused or malformed id. */
export function addRelease(releases, id, release) {
  if (!RELEASE_ID.test(id)) {
    throw new Error(
      `release id ${id} must be <yyyy-mm-dd>-<label> in lowercase`,
    );
  }
  if (releases.some((r) => r.id === id)) {
    throw new Error(`release ${id} is already published`);
  }
  for (const field of ["title", "summary"]) {
    if (!release?.[field]) throw new Error(`release.json needs a ${field}`);
  }
  return [
    {
      id,
      title: release.title,
      summary: release.summary,
      recordedOn: release.recordedOn ?? null,
      application: release.application ?? null,
    },
    ...releases,
  ];
}

const escape = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function siteIndexHtml(site, releases) {
  const [latest, ...earlier] = releases;
  const entry = (r) => {
    const about = [r.recordedOn, r.application]
      .filter(Boolean)
      .map(escape)
      .join(" · ");
    return `<a href="${escape(r.id)}/">${escape(r.title)}</a><p>${escape(r.summary)}</p>${about ? `<p class="about">${about}</p>` : ""}`;
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(site.title)}</title>
<style>
:root{color-scheme:light dark;--fg:#161616;--muted:#525252;--bg:#fff;--line:#e0e0e0;--link:#0f62fe}
@media (prefers-color-scheme:dark){:root{--fg:#f4f4f4;--muted:#c6c6c6;--bg:#161616;--line:#393939;--link:#78a9ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 16px}a{color:var(--link)}
section{border-top:1px solid var(--line);padding:16px 0}section>a{font-size:20px;font-weight:600}
p{margin:4px 0}.about{color:var(--muted);font-size:15px}
</style></head><body><main>
<h1>${escape(site.title)}</h1>
${site.home ? `<p><a href="${escape(site.home.href)}">${escape(site.home.text)}</a></p>` : ""}
<section><h2>Latest</h2>${latest ? entry(latest) : "<p>No evidence is published yet.</p>"}</section>
${earlier.length ? `<section><h2>Earlier</h2>${earlier.map((r) => `<div>${entry(r)}</div>`).join("")}</section>` : ""}
<p class="about">Automated synthetic workflows support review; human UAT and physical instrument validation remain separate.</p>
</main></body></html>
`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (
      ![
        "site",
        "releases",
        "id",
        "release",
        "out-releases",
        "out-index",
      ].includes(key)
    ) {
      console.error(`unknown argument: ${argv[i]}`);
      process.exit(2);
    }
    out[key] = argv[i + 1];
  }
  for (const key of [
    "site",
    "releases",
    "id",
    "release",
    "out-releases",
    "out-index",
  ]) {
    if (!out[key]) {
      console.error(`--${key} is required`);
      process.exit(2);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const site = loadSite(args.site);
    const releases = JSON.parse(fs.readFileSync(args.releases, "utf8"));
    const release = JSON.parse(fs.readFileSync(args.release, "utf8"));
    const next = addRelease(releases, args.id, release);
    fs.writeFileSync(
      args["out-releases"],
      `${JSON.stringify(next, null, 2)}\n`,
    );
    fs.writeFileSync(args["out-index"], siteIndexHtml(site, next));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
