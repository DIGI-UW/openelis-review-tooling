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
  failFirst = 0,
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
      // The domains are what the entrypoint renders into server_name and the
      // certificate paths, so whether they arrived is the whole question.
      `printf 'env AMR_DOMAIN=%s ANALYZERS_DOMAIN=%s GRIST_DOMAIN=%s\\n' "\${AMR_DOMAIN-unset}" "\${ANALYZERS_DOMAIN-unset}" "\${GRIST_DOMAIN-unset}" >> ${JSON.stringify(join(root, "docker.log"))}`,
      `printf '%s\\n' "$*" >> ${JSON.stringify(join(root, "docker.log"))}`,
    ].join("\n"),
  );
  stub(
    "sudo",
    [
      `[ "$1" = -u ] && { printf 'user=%s\\n' "$2" >> ${JSON.stringify(join(root, "sudo.log"))}; shift 2; }`,
      // Real sudo resets the environment (env_reset is the default), keeping
      // only a secure PATH. Inheriting it here would let the script look like it
      // hands the domains across when it does not — which is the outage this
      // whole file exists downstream of.
      `exec env -i PATH="$PATH" "$@"`,
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
      // Counts its own calls, so the first N can refuse the connection the way
      // curl really does: 000 through -w, and a non-zero exit alongside it.
      `n=$(cat ${JSON.stringify(join(root, "curl.n"))} 2>/dev/null || echo 0)`,
      `n=$((n + 1)); printf '%s' "$n" > ${JSON.stringify(join(root, "curl.n"))}`,
      `if [ "$n" -le ${failFirst} ]; then printf '000'; exit 7; fi`,
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
          AMR_DOMAIN: "amr.example.org",
          ANALYZERS_DOMAIN: "analyzers.example.org",
          GRIST_DOMAIN: "grist.example.org",
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

test("waits for the router to come back rather than probing it once", () => {
  // A recreated container has not bound 443 the instant Compose returns. curl
  // reports that as 000 through -w *and* a non-zero exit, and appending another
  // 000 to that made the value "000000" — never equal to the 000 the retry
  // tested for, so the loop broke immediately and a working reload was reported
  // as an unexpected status.
  const rig = harness({ failFirst: 2, status: "400" });
  assert.match(rig.run({ PROBE_ATTEMPTS: "5" }), /router reloaded/);
});

test("gives up if the router never answers, and says so as a connection failure", () => {
  const rig = harness({ failFirst: 99 });
  assert.throws(() => rig.run({ PROBE_ATTEMPTS: "3" }), /unexpected 000/);
});

test("refuses to recreate the router without the domains it renders", () => {
  // Recreating it without these yields a configuration naming no host and
  // pointing at no certificate: nginx starts and serves nothing on 443. That is
  // an outage rather than a failed reload, so it has to be impossible to do by
  // omission.
  const rig = harness();
  for (const missing of ["AMR_DOMAIN", "ANALYZERS_DOMAIN", "GRIST_DOMAIN"]) {
    assert.throws(
      () => rig.run({ [missing]: "" }),
      new RegExp(missing),
      `${missing} must be required`,
    );
  }
});

test("hands the domains to the compose that renders them", () => {
  // Not merely required of the caller — actually passed across the sudo
  // boundary, which drops the environment by default. Recreating the router
  // without them renders a configuration naming no host and pointing at no
  // certificate, and nginx then serves nothing on 443.
  const rig = harness();
  rig.run();
  assert.match(rig.dockerLog(), /AMR_DOMAIN=amr\.example\.org/);
  assert.match(rig.dockerLog(), /ANALYZERS_DOMAIN=analyzers\.example\.org/);
  assert.match(rig.dockerLog(), /GRIST_DOMAIN=grist\.example\.org/);
});
