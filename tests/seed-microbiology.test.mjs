import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url).pathname;

test("Microbiology seed provisions one deployment-scoped fixture per R1 story", async () => {
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
    case "$*" in
      *'"scenarioKey": "review-amr-1234567890ab-amr-s17"'*)
        [[ "$*" == *'"scenario": "WORKLIST"'* ]]
        printf '{"scenario":"WORKLIST","scenarioKey":"review-amr-1234567890ab-amr-s17","accessionNumber":"UATMICRO117","caseId":"case-17a","siblingCaseId":"case-17b"}'
        ;;
      *'"scenarioKey": "review-amr-1234567890ab-amr-s18"'*)
        [[ "$*" == *'"scenario": "R1"'* ]]
        printf '{"scenario":"R1","scenarioKey":"review-amr-1234567890ab-amr-s18","accessionNumber":"UATMICRO118","caseId":"case-18a","siblingCaseId":"case-18b"}'
        ;;
      *'"scenarioKey": "review-amr-1234567890ab-amr-s02"'*)
        [[ "$*" == *'"scenario": "R1"'* ]]
        printf '{"scenario":"R1","scenarioKey":"review-amr-1234567890ab-amr-s02","accessionNumber":"UATMICRO102","caseId":"case-02a","siblingCaseId":"case-02b"}'
        ;;
      *'"scenarioKey": "review-amr-1234567890ab-amr-s19"'*)
        [[ "$*" == *'"scenario": "R1"'* ]]
        printf '{"scenario":"R1","scenarioKey":"review-amr-1234567890ab-amr-s19","accessionNumber":"UATMICRO119","caseId":"case-19a","siblingCaseId":"case-19b"}'
        ;;
      *) exit 3 ;;
    esac
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
    /https:\/\/amr\.example\.test\/Microbiology\/cases\/case-17a/,
  );
  assert.match(
    result.stdout,
    /https:\/\/amr\.example\.test\/Microbiology\/cases\/case-02a/,
  );
  assert.match(result.stdout, /scenario:\s+WORKLIST/);
  assert.match(result.stdout, /scenario:\s+R1/);

  const calls = await readFile(callsFile, "utf8");
  assert.match(result.stdout, /fixture:\s+AMR-S02/);
  assert.match(result.stdout, /fixture:\s+AMR-S19/);

  assert.equal(calls.trim().split("\n").length, 7);
  assert.match(calls, /__review\/target\.json/);
  assert.match(calls, /ValidateLogin\?apiCall=true/);
  assert.match(calls, /api\/OpenELIS-Global\/session/);
  assert.match(calls, /rest\/microbiology\/uat\/scenarios/);
});
