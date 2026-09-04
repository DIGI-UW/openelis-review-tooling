import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url).pathname;

test("Microbiology seed provisions one deployment-scoped fixture per UAT story", async () => {
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
        [[ "$*" == *'"scenario": "CASE"'* ]]
        printf '{"scenario":"CASE","scenarioKey":"review-amr-1234567890ab-amr-s02","accessionNumber":"UATMICRO102","caseId":"case-02a"}'
        ;;
      *'"scenarioKey": "review-amr-1234567890ab-amr-s29"'*)
        [[ "$*" == *'"scenario": "CASE"'* ]]
        printf '{"scenario":"CASE","scenarioKey":"review-amr-1234567890ab-amr-s29","accessionNumber":"UATMICRO129","caseId":"case-29a"}'
        ;;
      *'"scenarioKey": "review-amr-1234567890ab-amr-s19"'*)
        [[ "$*" == *'"scenario": "CASE"'* ]]
        printf '{"scenario":"CASE","scenarioKey":"review-amr-1234567890ab-amr-s19","accessionNumber":"UATMICRO119","caseId":"case-19a"}'
        ;;
      *'"scenarioKey": "review-amr-1234567890ab-amr-s14"'*)
        [[ "$*" == *'"scenario": "M4"'* ]]
        printf '{"scenario":"M4","scenarioKey":"review-amr-1234567890ab-amr-s14","accessionNumber":"UATMICRO114","caseId":"case-14a","sampleTypeId":"sample-type-14","unmappedOrganismId":"organism-unmapped-14"}'
        ;;
      *'"scenarioKey": "review-amr-1234567890ab-amr-s30"'*)
        [[ "$*" == *'"scenario": "WHONET_FILTERS"'* ]]
        printf '{"scenario":"WHONET_FILTERS","scenarioKey":"review-amr-1234567890ab-amr-s30","accessionNumber":"UATMICRO130","caseId":"case-30a","sampleTypeId":"sample-type-30","methodId":"method-30","organismId":"organism-30","unmappedOrganismId":"organism-unmapped-30"}'
        ;;
      *'"scenarioKey": "review-amr-1234567890ab-amr-s21"'*)
        [[ "$*" == *'"scenario": "AST_ANALYZER_REVIEW"'* ]]
        printf '{"scenario":"AST_ANALYZER_REVIEW","scenarioKey":"review-amr-1234567890ab-amr-s21","accessionNumber":"UATMICRO121","caseId":"case-21a","isolateId":"isolate-21","astRunId":"run-21","analyzerInstrumentId":"analyzer-21","analyzerCardId":"card-21","organismId":"organism-21","antibioticId":"antibiotic-21"}'
        ;;
      *'"scenarioKey": "review-amr-1234567890ab-amr-s31"'*)
        [[ "$*" == *'"scenario": "AST_ANALYZER_REVIEW"'* ]]
        printf '{"scenario":"AST_ANALYZER_REVIEW","scenarioKey":"review-amr-1234567890ab-amr-s31","accessionNumber":"UATMICRO131","caseId":"case-31a","isolateId":"isolate-31","astRunId":"run-31","analyzerInstrumentId":"analyzer-31","analyzerCardId":"card-31","organismId":"organism-31","antibioticId":"antibiotic-31"}'
        ;;
      *'"scenarioKey": "review-amr-1234567890ab-amr-s32"'*)
        [[ "$*" == *'"scenario": "CASE"'* ]]
        printf '{"scenario":"CASE","scenarioKey":"review-amr-1234567890ab-amr-s32","accessionNumber":"UATMICRO132","caseId":"case-32a","methodId":"method-32"}'
        ;;
      *'"scenarioKey": "review-amr-1234567890ab-amr-s33"'*)
        [[ "$*" == *'"scenario": "WHONET_FILTERS"'* ]]
        printf '{"scenario":"WHONET_FILTERS","scenarioKey":"review-amr-1234567890ab-amr-s33","accessionNumber":"UATMICRO133","caseId":"case-33a","sampleTypeId":"sample-type-33","methodId":"method-33","organismId":"organism-33","unmappedOrganismId":"organism-unmapped-33"}'
        ;;
      *) exit 3 ;;
    esac
    ;;
  *rest/microbiology/cases/case-30a/order-detail*)
    [[ "$*" == *"--request PUT"* ]]
    [[ "$*" == *'"patientOrigin": "INPATIENT"'* ]]
    printf '{"id":"case-30a","orderDetail":{"patientOrigin":"INPATIENT"}}'
    ;;
  *rest/microbiology/cases/case-30a/release/final*)
    [[ "$*" == *'{}'* ]]
    printf '{"caseId":"case-30a","finalReleaseState":"FINAL_RELEASED"}'
    ;;
  *rest/microbiology/cases/case-32a/order-detail*)
    [[ "$*" == *"--request PUT"* ]]
    [[ "$*" == *'"culturePurpose": "CLINICAL_DIAGNOSTIC"'* ]]
    [[ "$*" == *'"clinicalHistory": "R11 culture-purpose review fixture"'* ]]
    printf '{"id":"case-32a","culturePurpose":"CLINICAL_DIAGNOSTIC"}'
    ;;
  *rest/microbiology/cases/case-33a/order-detail*)
    [[ "$*" == *"--request PUT"* ]]
    [[ "$*" == *'"patientOrigin": "INPATIENT"'* ]]
    printf '{"id":"case-33a","orderDetail":{"patientOrigin":"INPATIENT"}}'
    ;;
  *rest/microbiology/cases/case-30a*)
    printf '{"id":"case-30a","finalReleaseState":"NOT_RELEASED","orderDetail":{},"isolates":[{"id":"isolate-30a","isolateLabel":"ISO-1","organismId":"organism-30","significance":"CLINICALLY_SIGNIFICANT","identificationStatus":"CONFIRMED"}]}'
    ;;
  *rest/microbiology/cases/case-33a/release/final*)
    [[ "$*" == *'{}'* ]]
    printf '{"caseId":"case-33a","finalReleaseState":"FINAL_RELEASED"}'
    ;;
  *rest/microbiology/cases/case-33a*)
    printf '{"id":"case-33a","finalReleaseState":"NOT_RELEASED","orderDetail":{},"isolates":[{"id":"isolate-33a","isolateLabel":"ISO-1","organismId":"organism-33","significance":"CLINICALLY_SIGNIFICANT","identificationStatus":"CONFIRMED"}]}'
    ;;
  *rest/sample-types/sample-type-30*)
    if [[ "$*" == *"--request PUT"* ]]; then
      [[ "$*" == *'"whonetCode": "BLD"'* ]]
      printf '{"success":true,"data":{"id":"sample-type-30","whonetCode":"BLD"}}'
    else
      printf '{"success":true,"data":{"id":"sample-type-30","whonetCode":""}}'
    fi
    ;;
  *rest/sample-types/sample-type-33*)
    if [[ "$*" == *"--request PUT"* ]]; then
      [[ "$*" == *'"whonetCode": "BLD"'* ]]
      printf '{"success":true,"data":{"id":"sample-type-33","whonetCode":"BLD"}}'
    else
      printf '{"success":true,"data":{"id":"sample-type-33","whonetCode":""}}'
    fi
    ;;
  *rest/microbiology/isolates/isolate-30b/identification*)
    [[ "$*" == *"--request PUT"* ]]
    [[ "$*" == *'"organismId": "organism-unmapped-30"'* ]]
    [[ "$*" == *'"significance": "CONTAMINANT"'* ]]
    printf '{"id":"isolate-30b","isolateLabel":"WHONET-FILTER-CONTAMINANT","organismId":"organism-30","significance":"CONTAMINANT","identificationStatus":"CONFIRMED"}'
    ;;
  *rest/microbiology/isolates/isolate-33b/identification*)
    [[ "$*" == *"--request PUT"* ]]
    [[ "$*" == *'"organismId": "organism-unmapped-33"'* ]]
    [[ "$*" == *'"significance": "CONTAMINANT"'* ]]
    printf '{"id":"isolate-33b","isolateLabel":"WHONET-FILTER-CONTAMINANT","organismId":"organism-33","significance":"CONTAMINANT","identificationStatus":"CONFIRMED"}'
    ;;
  *rest/microbiology/isolates*)
    [[ "$*" == *'"isolateLabel": "WHONET-FILTER-CONTAMINANT"'* ]]
    if [[ "$*" == *'"caseId": "case-30a"'* ]]; then
      printf '{"id":"isolate-30b","isolateLabel":"WHONET-FILTER-CONTAMINANT","significance":"CONTAMINANT","identificationStatus":"PRELIMINARY"}'
    elif [[ "$*" == *'"caseId": "case-33a"'* ]]; then
      printf '{"id":"isolate-33b","isolateLabel":"WHONET-FILTER-CONTAMINANT","significance":"CONTAMINANT","identificationStatus":"PRELIMINARY"}'
    else
      exit 5
    fi
    ;;
  *rest/analyzer/events/ast*)
    [[ "$*" == *"--user admin:adminADMIN!"* ]]
    [[ "$*" != *"X-CSRF-Token"* ]]
    if [[ "$*" == *'"sourceId": "card-21-UNMATCHED"'* ]]; then
      [[ "$*" == *'"externalEventId": "review-amr-1234567890ab-amr-s21-unmatched-result"'* ]]
      printf '422'
    elif [[ "$*" == *'"sourceId": "card-31-UNMATCHED"'* ]]; then
      [[ "$*" == *'"externalEventId": "review-amr-1234567890ab-amr-s31-unmatched-result"'* ]]
      printf '422'
    elif [[ "$*" == *'"sourceId": "card-21"'* ]]; then
      [[ "$*" == *'"sourceId": "card-21"'* ]]
      [[ "$*" == *'"qcPassed": false'* ]]
      printf '{"status":"success"}'
    elif [[ "$*" == *'"sourceId": "card-31"'* ]]; then
      [[ "$*" == *'"qcPassed": false'* ]]
      printf '{"status":"success"}'
    else
      exit 4
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
    /https:\/\/amr\.example\.test\/Microbiology\/cases\/case-17a/,
  );
  assert.match(
    result.stdout,
    /https:\/\/amr\.example\.test\/Microbiology\/cases\/case-02a/,
  );
  assert.match(result.stdout, /scenario:\s+WORKLIST/);
  assert.match(result.stdout, /scenario:\s+R1/);
  assert.match(result.stdout, /scenario:\s+CASE/);

  const calls = await readFile(callsFile, "utf8");
  assert.match(result.stdout, /fixture:\s+AMR-S02/);
  assert.match(result.stdout, /fixture:\s+AMR-S29/);
  assert.match(result.stdout, /fixture:\s+AMR-S19/);
  assert.match(result.stdout, /fixture:\s+AMR-S14/);
  assert.match(result.stdout, /scenario:\s+M4/);
  assert.match(result.stdout, /fixture:\s+AMR-S30/);
  assert.match(result.stdout, /scenario:\s+WHONET_FILTERS/);
  assert.match(result.stdout, /fixture:\s+AMR-S21/);
  assert.match(result.stdout, /scenario:\s+AST_ANALYZER_REVIEW/);
  assert.match(result.stdout, /analyzer card:\s+card-21/);
  assert.match(result.stdout, /fixture:\s+AMR-S31/);
  assert.match(result.stdout, /analyzer card:\s+card-31/);
  assert.match(result.stdout, /fixture:\s+AMR-S32/);
  assert.match(result.stdout, /accession:\s+UATMICRO132/);
  assert.match(result.stdout, /fixture:\s+AMR-S33/);
  assert.match(result.stdout, /accession:\s+UATMICRO133/);

  assert.equal(calls.trim().split("\n").length, 33);
  assert.match(calls, /__review\/target\.json/);
  assert.match(calls, /ValidateLogin\?apiCall=true/);
  assert.match(calls, /api\/OpenELIS-Global\/session/);
  assert.match(calls, /rest\/microbiology\/uat\/scenarios/);
  assert.match(calls, /rest\/microbiology\/cases\/case-30a\/order-detail/);
  assert.match(calls, /rest\/sample-types\/sample-type-30/);
  assert.match(calls, /"whonetCode": "BLD"/);
  assert.match(calls, /rest\/microbiology\/isolates\/isolate-30b\/identification/);
  assert.match(calls, /rest\/microbiology\/cases\/case-30a\/release\/final/);
  assert.match(calls, /rest\/microbiology\/cases\/case-32a\/order-detail/);
  assert.match(calls, /rest\/microbiology\/cases\/case-33a\/order-detail/);
  assert.match(calls, /rest\/microbiology\/cases\/case-33a\/release\/final/);

  await writeFile(callsFile, "");
  const targetedResult = spawnSync(
    "bash",
    [`${repoRoot}/scripts/seed-microbiology.sh`],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        BASE_URL: "https://amr.example.test",
        CALLS_FILE: callsFile,
        FIXTURE_STORIES: "AMR-S33",
        PATH: `${binDir}:${process.env.PATH}`,
      },
    },
  );

  assert.equal(targetedResult.status, 0, targetedResult.stderr);
  assert.match(targetedResult.stdout, /fixture:\s+AMR-S33/);
  assert.doesNotMatch(targetedResult.stdout, /fixture:\s+AMR-S32/);
  const targetedCalls = await readFile(callsFile, "utf8");
  assert.match(targetedCalls, /review-amr-1234567890ab-amr-s33/);
  assert.doesNotMatch(targetedCalls, /review-amr-1234567890ab-amr-s30/);

  const unknownStoryResult = spawnSync(
    "bash",
    [`${repoRoot}/scripts/seed-microbiology.sh`],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        BASE_URL: "https://amr.example.test",
        CALLS_FILE: callsFile,
        FIXTURE_STORIES: "AMR-S99",
        PATH: `${binDir}:${process.env.PATH}`,
      },
    },
  );

  assert.notEqual(unknownStoryResult.status, 0);
  assert.match(unknownStoryResult.stderr, /Unknown microbiology fixture story: AMR-S99/);
});
