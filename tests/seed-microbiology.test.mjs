import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url).pathname;

test("Microbiology seed provisions deployment-scoped worklist and classification scenarios", async () => {
  const binDir = await mkdtemp(path.join(tmpdir(), "oe-review-seed-"));
  const callsFile = path.join(binDir, "curl-calls");
  const curlStub = path.join(binDir, "curl");

  await writeFile(
    curlStub,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$CALLS_FILE"
case "$*" in
  *__review/target.json*)
    printf '{"appSha":"1234567890abcdef"}'
    ;;
  *ValidateLogin*)
    printf '{"success":true}'
    ;;
  *api/OpenELIS-Global/session*)
    printf '{"authenticated":true,"csrf":"test-csrf"}'
    ;;
  *rest/microbiology/uat/scenarios*)
    [[ "$*" == *"X-CSRF-Token: test-csrf"* ]]
    if [[ "$*" == *'"scenario": "WORKLIST"'* ]]; then
      [[ "$*" == *'"scenarioKey": "review-amr-1234567890ab-worklist"'* ]]
      printf '{"scenario":"WORKLIST","scenarioKey":"review-amr-1234567890ab-worklist","accessionNumber":"UATMICRO123","caseId":"case-1","siblingCaseId":"case-2"}'
    else
      [[ "$*" == *'"scenario": "R1"'* ]]
      [[ "$*" == *'"scenarioKey": "review-amr-1234567890ab-r1"'* ]]
      printf '{"scenario":"R1","scenarioKey":"review-amr-1234567890ab-r1","accessionNumber":"UATMICRO456","caseId":"case-3","siblingCaseId":"case-4"}'
    fi
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
  assert.match(
    result.stdout,
    /https:\/\/amr\.example\.test\/Microbiology\/cases\/case-3/,
  );
  assert.match(result.stdout, /scenario:\s+WORKLIST/);
  assert.match(result.stdout, /scenario:\s+R1/);

  const calls = await readFile(callsFile, "utf8");
  assert.equal(calls.trim().split("\n").length, 5);
  assert.match(calls, /__review\/target\.json/);
  assert.match(calls, /ValidateLogin\?apiCall=true/);
  assert.match(calls, /api\/OpenELIS-Global\/session/);
  assert.match(calls, /rest\/microbiology\/uat\/scenarios/);
});
