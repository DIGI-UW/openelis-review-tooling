import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../scripts/reload-router.sh", import.meta.url).pathname;

// Stands in for docker, sudo and curl, so the test can assert on what the script
// actually invokes rather than on what its source says. PATH ends in /bin to
// resolve the system bash, which is older than a developer's — footguns like
// expanding an empty array under `set -u` surface here, not on the review host.
function harness({
  labels = {},
  composeFiles = ["docker-compose.router.yml"],
  status = "400",
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "oe-reload-router-"));
  const bin = join(root, "bin");
  const workdir = join(root, "project");
  mkdirSync(bin);
  mkdirSync(workdir);

  const resolved = {
    "com.docker.compose.project": "oe-edge",
    "com.docker.compose.project.working_dir": workdir,
    "com.docker.compose.project.config_files": composeFiles
      .map((name) => join(workdir, name))
      .join(","),
    ...labels,
  };
  for (const name of composeFiles)
    writeFileSync(join(workdir, name), "services: {}\n");

  const stub = (name, body) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path, 0o755);
  };

  stub(
    "docker",
    [
      `if [ "$1" = inspect ]; then`,
      `  key=$(printf '%s' "$3" | sed 's/.*Labels "//; s/".*//')`,
      ...Object.entries(resolved).map(
        ([key, value]) =>
          `  [ "$key" = ${JSON.stringify(key)} ] && { printf '%s\\n' ${JSON.stringify(value)}; exit 0; }`,
      ),
      `  printf '\\n'; exit 0`,
      `fi`,
      `printf '%s\\n' "$*" >> ${JSON.stringify(join(root, "docker.log"))}`,
    ].join("\n"),
  );
  stub(
    "sudo",
    [
      `[ "$1" = -u ] && { printf 'user=%s\\n' "$2" >> ${JSON.stringify(join(root, "sudo.log"))}; shift 2; }`,
      `exec "$@"`,
    ].join("\n"),
  );
  // curl -sSk -o BODY -w '%{http_code}' … : the status is what the script reads.
  stub(
    "curl",
    [
      `out=/dev/null`,
      `url=""`,
      `while [ "$#" -gt 0 ]; do`,
      `  [ "$1" = -o ] && { out="$2"; shift 2; continue; }`,
      `  case "$1" in https://*) url="$1";; esac`,
      `  shift`,
      `done`,
      `printf '%s\\n' "$url" >> ${JSON.stringify(join(root, "curl.log"))}`,
      `printf 'body-for-%s' ${JSON.stringify(status)} > "$out"`,
      `printf '%s' ${JSON.stringify(status)}`,
    ].join("\n"),
  );
  stub("sleep", "exit 0");

  const read = (name) =>
    existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8") : "";
  return {
    run(env = {}) {
      return execFileSync("bash", [SCRIPT], {
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          REMOTE_USER: "ubuntu",
          PROBE_DOMAIN: "amr.example.org",
          PROBE_INSTANCE: "amr",
          PROBE_ATTEMPTS: "2",
          PROBE_DELAY: "0",
          ...env,
        },
        encoding: "utf8",
      });
    },
    dockerLog: () => read("docker.log"),
    sudoLog: () => read("sudo.log"),
    curlLog: () => read("curl.log"),
  };
}

test("recreates only the router, in the project the running container reports", () => {
  const rig = harness({
    composeFiles: ["docker-compose.router.yml", "override.yml"],
  });
  const output = rig.run();

  const invocation = rig.dockerLog();
  assert.match(invocation, /compose -p oe-edge /);
  assert.match(invocation, /-f \S*docker-compose\.router\.yml/);
  assert.match(invocation, /-f \S*override\.yml/);
  // --no-deps is what keeps this off the application stacks, which is the whole
  // reason this exists rather than running the full deploy.
  assert.match(invocation, /--no-deps/);
  assert.match(invocation, /\brouter\b\s*$/m);
  assert.match(rig.sudoLog(), /user=ubuntu/);
  assert.match(output, /router reloaded/);
});

test("forces the recreate, because only a mounted file changed", () => {
  // The image is unchanged when the edit was to nginx.conf.template, so without
  // this Compose sees nothing to do and the old configuration keeps serving — a
  // reload that reports success and changes nothing.
  const rig = harness();
  rig.run();
  assert.match(rig.dockerLog(), /--force-recreate/);
});

test("a route that is still a 404 fails the reload", () => {
  // nginx with no such location. Reporting success here is what would send
  // somebody to click Submit on a deployment that cannot take one.
  const rig = harness({ status: "404" });
  assert.throws(() => rig.run(), /still a 404/);
});

test("an unexpected status fails rather than being read as good enough", () => {
  const rig = harness({ status: "200" });
  assert.throws(() => rig.run(), /unexpected 200/);
});

test("501 counts, because a deployment with no backend still proves the route", () => {
  const rig = harness({ status: "501" });
  assert.match(rig.run(), /router reloaded/);
});

test("probes the submissions route on the domain it was given", () => {
  const rig = harness();
  rig.run({
    PROBE_DOMAIN: "analyzers.example.org",
    PROBE_INSTANCE: "analyzers",
  });
  assert.match(
    rig.curlLog(),
    /https:\/\/analyzers\.example\.org\/__review\/uat-analyzers\/submissions/,
  );
});

test("refuses when the running container names a Compose file that is gone", () => {
  const rig = harness({
    labels: {
      "com.docker.compose.project.config_files": "/nowhere/docker-compose.yml",
    },
  });
  assert.throws(() => rig.run(), /active Compose file is missing/);
});

test("refuses when no Compose file is resolved at all", () => {
  const rig = harness({
    labels: { "com.docker.compose.project.config_files": "" },
  });
  assert.throws(() => rig.run(), /no Compose files resolved/);
});

test("refuses when the running router cannot be resolved", () => {
  const rig = harness({ labels: { "com.docker.compose.project": "" } });
  assert.throws(() => rig.run(), /could not resolve the running router/);
});
