import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url).pathname;

test("Microbiology seed authenticates and provisions one stable service scenario", async () => {
  const binDir = await mkdtemp(path.join(tmpdir(), "oe-review-seed-"));
  const callsFile = path.join(binDir, "curl-calls");
  const curlStub = path.join(binDir, "curl");

  await writeFile(
    curlStub,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$CALLS_FILE"
case "$*" in
  *ValidateLogin*)
    printf '{"success":true,"csrf":"test-csrf"}'
    ;;
  *rest/microbiology/uat/scenarios*)
    [[ "$*" == *"X-CSRF-Token: test-csrf"* ]]
    [[ "$*" == *'"scenario": "WORKLIST"'* ]]
    [[ "$*" == *'"scenarioKey": "review-amr-microbiology-mvp"'* ]]
    printf '{"scenario":"WORKLIST","scenarioKey":"review-amr-microbiology-mvp","accessionNumber":"UATMICRO123","caseId":"case-1","siblingCaseId":"case-2"}'
    ;;
  *)
    exit 2
    ;;
esac
`,
  );
  await chmod(curlStub, 0o755);

  const result = spawnSync(
    "bash",
    [`${repoRoot}/scripts/seed-microbiology.sh`],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        BASE_URL: "https://amr.example.test",
        CALLS_FILE: callsFile,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SEEDED THROUGH OPENELIS SERVICES/);
  assert.match(
    result.stdout,
    /https:\/\/amr\.example\.test\/Microbiology\/cases\/case-1/,
  );

  const calls = await readFile(callsFile, "utf8");
  assert.equal(calls.trim().split("\n").length, 2);
  assert.match(calls, /ValidateLogin\?apiCall=true/);
  assert.match(calls, /rest\/microbiology\/uat\/scenarios/);
});
