import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../scripts/rebuild-checklist-service.sh", import.meta.url).pathname;

// The script talks to docker, sudo and curl. Standing in for all three lets the
// test assert on what it actually invokes rather than on what its source says.
// PATH ends in /bin on purpose: that resolves the system bash, which is older
// than any shell a developer is likely to be running, so footguns like expanding
// an empty array under `set -u` surface here instead of on the review host.
function harness({ labels = {}, composeFiles = [], catalogBody = '{"stories":[]}', curlFails = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "oe-rebuild-"));
  const bin = join(root, "bin");
  const workdir = join(root, "project");
  mkdirSync(bin);
  mkdirSync(workdir);

  const resolved = {
    "com.docker.compose.project": "oe-grist",
    "com.docker.compose.project.working_dir": workdir,
    "com.docker.compose.project.config_files": composeFiles
      .map((name) => join(workdir, name))
      .join(","),
    ...labels,
  };
  for (const name of composeFiles) writeFileSync(join(workdir, name), "services: {}\n");

  const stub = (name, body) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path, 0o755);
  };

  // `docker inspect -f '{{index .Config.Labels "KEY"}}' CONTAINER`
  stub(
    "docker",
    [
      `if [ "$1" = inspect ]; then`,
      `  key=$(printf '%s' "$3" | sed 's/.*Labels "//; s/".*//')`,
      ...Object.entries(resolved).map(
        ([key, value]) => `  [ "$key" = ${JSON.stringify(key)} ] && { printf '%s\\n' ${JSON.stringify(value)}; exit 0; }`,
      ),
      `  printf '\\n'; exit 0`,
      `fi`,
      `printf '%s\\n' "$*" >> ${JSON.stringify(join(root, "docker.log"))}`,
    ].join("\n"),
  );
  // sudo -u USER cmd… — record who, then run the rest through the same stubs.
  stub("sudo", [`[ "$1" = -u ] && { printf 'user=%s\\n' "$2" >> ${JSON.stringify(join(root, "sudo.log"))}; shift 2; }`, `exec "$@"`].join("\n"));
  stub(
    "curl",
    curlFails
      ? "exit 22"
      : [
          `out=""`,
          `while [ "$#" -gt 0 ]; do [ "$1" = -o ] && { out="$2"; shift 2; continue; }; shift; done`,
          `printf '%s' ${JSON.stringify(catalogBody)} > "$out"`,
        ].join("\n"),
  );
  stub("sleep", "exit 0");

  return {
    root,
    run(env = {}) {
      return execFileSync("bash", [SCRIPT], {
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          REMOTE_USER: "ubuntu",
          GRIST_DOMAIN: "grist.example.org",
          PROBE_ATTEMPTS: "2",
          PROBE_DELAY: "0",
          ...env,
        },
        encoding: "utf8",
      });
    },
    dockerLog: () => (existsSync(join(root, "docker.log")) ? readFileSync(join(root, "docker.log"), "utf8") : ""),
    sudoLog: () => (existsSync(join(root, "sudo.log")) ? readFileSync(join(root, "sudo.log"), "utf8") : ""),
  };
}

test("rebuilds in the project and file list the running container reports", () => {
  const rig = harness({ composeFiles: ["docker-compose.grist.yml", "override.yml"] });
  const output = rig.run();

  const invocation = rig.dockerLog();
  assert.match(invocation, /compose -p oe-grist /);
  // Every resolved file has to be threaded through: dropping them leaves Compose
  // to infer the file from the directory, which is a different project.
  assert.match(invocation, /-f \S*docker-compose\.grist\.yml/);
  assert.match(invocation, /-f \S*override\.yml/);
  assert.match(invocation, /up -d --no-deps --build uat-read/);
  assert.match(rig.sudoLog(), /user=ubuntu/);
  assert.match(output, /checklist service ready/);
});

test("refuses when the running container names a Compose file that is gone", () => {
  const rig = harness({ composeFiles: ["docker-compose.grist.yml"] });
  rig.run(); // the file exists, so this one succeeds
  const missing = harness({
    labels: { "com.docker.compose.project.config_files": "/nowhere/docker-compose.yml" },
  });
  assert.throws(() => missing.run(), /active Compose file is missing/);
});

test("refuses when no Compose file is resolved at all", () => {
  const rig = harness({ labels: { "com.docker.compose.project.config_files": "" } });
  assert.throws(() => rig.run(), /no Compose files resolved/);
});

test("refuses when the running container cannot be resolved", () => {
  const rig = harness({ labels: { "com.docker.compose.project": "" } });
  assert.throws(() => rig.run(), /could not resolve the running checklist service/);
});

test("fetching the endpoint is not accepted as proof of the rebuild", () => {
  // A stale image answers 200 too. Only the catalog shape says the rebuilt
  // service is the one on the line.
  const rig = harness({
    composeFiles: ["docker-compose.grist.yml"],
    catalogBody: '{"error":"still the old one"}',
  });
  assert.throws(() => rig.run(), /did not serve a catalog after rebuild/);
});

test("fails when the endpoint never answers", () => {
  const rig = harness({ composeFiles: ["docker-compose.grist.yml"], curlFails: true });
  assert.throws(() => rig.run(), /did not serve a catalog after rebuild/);
});
