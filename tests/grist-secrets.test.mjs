import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url).pathname;
const resolver = join(repoRoot, "grist", "resolve-secrets.sh");

function runResolver({ existingEnv, incoming = {}, containerEnv = "" }) {
  const root = mkdtempSync(join(tmpdir(), "oe-grist-secrets-"));
  const stateDir = join(root, "state");
  const binDir = join(root, "bin");
  mkdirSync(stateDir);
  mkdirSync(binDir);

  if (existingEnv) {
    writeFileSync(join(stateDir, ".env"), existingEnv, { mode: 0o600 });
  }

  writeFileSync(
    join(binDir, "docker"),
    `#!/usr/bin/env bash
if [ "$1" = "inspect" ]; then
  cat <<'ENV'
${containerEnv}
ENV
  exit 0
fi
exit 1
`,
    { mode: 0o755 },
  );

  const result = spawnSync("bash", [resolver], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      GRIST_STATE_DIR: stateDir,
      ...incoming,
    },
  });

  return {
    result,
    stateDir,
    contents:
      result.status === 0 ? readFileSync(join(stateDir, ".env"), "utf8") : "",
  };
}

function readResolvedValues(stateDir) {
  const result = spawnSync(
    "bash",
    [
      "-c",
      '. "$1/.env"; printf "%s\\n%s" "$DEX_GRIST_CLIENT_SECRET" "$DEX_REVIEWER_PASSWORD_HASH"',
      "read-grist-secrets",
      stateDir,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\n");
}

test("persists first-bootstrap secrets without exposing raw shell syntax", () => {
  const { result, stateDir, contents } = runResolver({
    incoming: {
      DEX_GRIST_CLIENT_SECRET: "initial-secret",
      DEX_REVIEWER_PASSWORD_HASH: "$2y$10$initial-hash",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(contents, /^DEX_GRIST_CLIENT_SECRET=/m);
  assert.match(contents, /^DEX_REVIEWER_PASSWORD_HASH=/m);
  assert.deepEqual(readResolvedValues(stateDir), [
    "initial-secret",
    "$2y$10$initial-hash",
  ]);
});

test("preserves stored secrets and recovers a missing legacy value from Dex", () => {
  const { result, stateDir } = runResolver({
    existingEnv: "DEX_GRIST_CLIENT_SECRET=stored-secret\n",
    incoming: {
      DEX_GRIST_CLIENT_SECRET: "replacement-secret",
      DEX_REVIEWER_PASSWORD_HASH: "",
    },
    containerEnv:
      "DEX_GRIST_CLIENT_SECRET=container-secret\nDEX_REVIEWER_PASSWORD_HASH=$2y$10$container-hash",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.deepEqual(readResolvedValues(stateDir), [
    "stored-secret",
    "$2y$10$container-hash",
  ]);
});
