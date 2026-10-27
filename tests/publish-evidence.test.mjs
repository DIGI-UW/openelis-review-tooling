import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const script = new URL("../scripts/publish-evidence.sh", import.meta.url)
  .pathname;

function setup({ seeded = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-evidence-"));
  const pkg = path.join(dir, "package");
  fs.mkdirSync(path.join(pkg, "microbiology", "culture"), { recursive: true });
  fs.writeFileSync(
    path.join(pkg, "microbiology", "culture", "01-inoculates.mp4"),
    "video",
  );
  fs.writeFileSync(path.join(pkg, "index.json"), "[]\n");
  fs.writeFileSync(path.join(pkg, "index.html"), "<p>gallery</p>");
  fs.writeFileSync(
    path.join(pkg, "release.json"),
    JSON.stringify({
      title: "Narrated AMR workflow videos",
      summary: "Thirty-five stories by stage.",
      recordedOn: "Local stack",
      application: "OpenELIS 908d3ce",
    }),
  );
  const root = path.join(dir, "evidence");
  fs.mkdirSync(path.join(root, "amr", "2026-10-24-clsi-workflow"), {
    recursive: true,
  });
  if (seeded) {
    fs.writeFileSync(
      path.join(root, "amr", "releases.json"),
      JSON.stringify([
        {
          id: "2026-10-24-clsi-workflow",
          title: "CLSI workflow",
          summary: "Screenshots.",
        },
      ]),
    );
  }
  return { pkg, root };
}

const publish = (pkg, root, id = "2026-10-27-amr-videos") =>
  spawnSync(
    "bash",
    [
      script,
      "--site",
      "amr",
      "--package",
      pkg,
      "--id",
      id,
      "--host",
      "local",
      "--root",
      root,
    ],
    {
      encoding: "utf8",
    },
  );

test("publishes the package as a new release and lists it first on the index", () => {
  const { pkg, root } = setup();
  const run = publish(pkg, root);
  assert.equal(run.status, 0, run.stderr);
  const release = path.join(root, "amr", "2026-10-27-amr-videos");
  assert.ok(
    fs.existsSync(
      path.join(release, "microbiology", "culture", "01-inoculates.mp4"),
    ),
  );
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(root, "amr", "releases.json"), "utf8"),
    ).map((r) => r.id),
    ["2026-10-27-amr-videos", "2026-10-24-clsi-workflow"],
  );
  const index = fs.readFileSync(path.join(root, "amr", "index.html"), "utf8");
  assert.ok(
    index.indexOf("Narrated AMR workflow videos") <
      index.indexOf("CLSI workflow"),
  );
  assert.match(index, /href="2026-10-27-amr-videos\/"/);
  assert.match(
    index,
    /href="https:\/\/amr\.openelis-global\.org\/">Open the AMR V2 demo/,
  );
  assert.deepEqual(
    fs.readdirSync(path.join(root, "amr")).filter((f) => f.startsWith(".")),
    [],
  );
});

test("a published release is never overwritten", () => {
  const { pkg, root } = setup();
  assert.equal(publish(pkg, root).status, 0);
  const releases = fs.readFileSync(
    path.join(root, "amr", "releases.json"),
    "utf8",
  );
  fs.writeFileSync(path.join(pkg, "index.html"), "<p>changed</p>");
  const again = publish(pkg, root);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already published/);
  assert.equal(
    fs.readFileSync(
      path.join(root, "amr", "2026-10-27-amr-videos", "index.html"),
      "utf8",
    ),
    "<p>gallery</p>",
  );
  assert.equal(
    fs.readFileSync(path.join(root, "amr", "releases.json"), "utf8"),
    releases,
  );
});

test("a site without its release list is refused before anything is copied", () => {
  const { pkg, root } = setup({ seeded: false });
  const run = publish(pkg, root);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /releases\.json is missing/);
  assert.ok(!fs.existsSync(path.join(root, "amr", "2026-10-27-amr-videos")));
});

test("a malformed release id or a package without release metadata is refused", () => {
  const { pkg, root } = setup();
  assert.match(
    publish(pkg, root, "Latest").stderr,
    /must be <yyyy-mm-dd>-<label>/,
  );
  fs.rmSync(path.join(pkg, "release.json"));
  assert.match(publish(pkg, root).stderr, /has no release\.json/);
});

test("the publish script parses as Bash", () => {
  assert.equal(spawnSync("bash", ["-n", script]).status, 0);
});
