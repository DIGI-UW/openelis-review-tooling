#!/usr/bin/env bash
set -euo pipefail

# Provision the review fixture through OpenELIS business services. The AMR demo
# deployment explicitly enables this ADMIN-only endpoint; ordinary deployments
# leave it disabled.
BASE_URL="${BASE_URL:-https://amr.openelis-global.org}"
TEST_USER="${TEST_USER:-admin}"
TEST_PASS="${TEST_PASS:-adminADMIN!}"
API_ROOT="${BASE_URL%/}/api/OpenELIS-Global"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

if [ -z "${SCENARIO_KEY:-}" ]; then
  target_json="$(curl -fsSk "${BASE_URL%/}/__review/target.json")"
  deployment_key="$(
    printf '%s' "$target_json" |
      python3 -c '
import json
import sys

target = json.load(sys.stdin)
app_sha = str(target.get("appSha", "")).strip()
if not app_sha:
    raise SystemExit("AMR target metadata does not contain appSha")
print(app_sha[:12])
'
  )"
  SCENARIO_KEY="review-amr-${deployment_key}"
fi

login_json="$(
  curl -fsSk \
    -c "$COOKIE_JAR" \
    --data-urlencode "loginName=$TEST_USER" \
    --data-urlencode "password=$TEST_PASS" \
    "$API_ROOT/ValidateLogin?apiCall=true"
)"

printf '%s' "$login_json" |
  python3 -c '
import json
import sys

response = json.load(sys.stdin)
if not response.get("success"):
    raise SystemExit("OpenELIS demo login failed")
'

session_json="$(
  curl -fsSk \
    -b "$COOKIE_JAR" \
    "$API_ROOT/session"
)"

csrf="$(
  printf '%s' "$session_json" |
    python3 -c '
import json
import sys

response = json.load(sys.stdin)
if not response.get("authenticated"):
    raise SystemExit("OpenELIS demo session is not authenticated")
print(response.get("csrf", ""))
'
)"
[ -n "$csrf" ] || {
  echo "OpenELIS login did not return a CSRF token" >&2
  exit 1
}

default_fixture_specs=(
  "AMR-S17:WORKLIST"
  "AMR-S18:R1"
  "AMR-S02:CASE"
  "AMR-S29:CASE"
  "AMR-S19:CASE"
  "AMR-S14:M4"
  "AMR-S21:AST_ANALYZER_REVIEW"
)
if [ -n "${FIXTURE_SPECS:-}" ]; then
  read -r -a fixture_specs <<< "$FIXTURE_SPECS"
else
  fixture_specs=("${default_fixture_specs[@]}")
fi

for fixture_spec in "${fixture_specs[@]}"; do
  fixture_key="${fixture_spec%%:*}"
  scenario="${fixture_spec#*:}"
  case "$scenario" in
    CASE|MVP|WORKLIST|M3|M4|R1|AST_ANALYZER_REVIEW) ;;
    *)
      echo "Unsupported fixture scenario in $fixture_spec" >&2
      exit 1
      ;;
  esac
  scenario_key="${SCENARIO_KEY}-$(printf '%s' "$fixture_key" | tr '[:upper:]' '[:lower:]')"
  payload="$(
    SCENARIO="$scenario" SCENARIO_KEY="$scenario_key" python3 -c '
import json
import os

print(json.dumps({
    "scenario": os.environ["SCENARIO"],
    "scenarioKey": os.environ["SCENARIO_KEY"],
}))
'
  )"

  scenario_json="$(
    curl -fsSk \
      -b "$COOKIE_JAR" \
      -H "Content-Type: application/json" \
      -H "X-CSRF-Token: $csrf" \
      --data "$payload" \
      "$API_ROOT/rest/microbiology/uat/scenarios"
  )"

  if [ "$scenario" = "AST_ANALYZER_REVIEW" ]; then
    matched_event_payload="$(
      printf '%s' "$scenario_json" |
        python3 -c '
import json
import sys

scenario = json.load(sys.stdin)
event_id = f"{scenario['"'"'scenarioKey'"'"']}-matched-result"
print(json.dumps({
    "externalEventId": event_id,
    "eventType": "AST_RESULT_AVAILABLE",
    "analyzerId": scenario["analyzerInstrumentId"],
    "sourceId": scenario["analyzerCardId"],
    "payload": {
        "analyzerInstrumentId": scenario["analyzerInstrumentId"],
        "analyzerCardId": scenario["analyzerCardId"],
        "analyzerSoftwareVersion": "UAT-1.0",
        "analyzerOrganismId": scenario["organismId"],
        "analyzerOrganismName": "Escherichia coli (UAT)",
        "analyzerOrganismConfidence": 99.5,
        "instrumentQcReference": "UAT-QC-CONTROL-17",
        "qcPassed": False,
        "analyzerMessageCodes": ["CONTROL_OUT_OF_RANGE"],
        "readings": [{
            "antibioticId": scenario["antibioticId"],
            "rawValue": 4,
            "units": "mg/L",
            "instrumentInterpretation": "SUSCEPTIBLE",
            "analyzerResultReference": f"{event_id}-CIP",
        }],
    },
}))
'
    )"
    curl -fsSk \
      -b "$COOKIE_JAR" \
      -H "Content-Type: application/json" \
      -H "X-CSRF-Token: $csrf" \
      --data "$matched_event_payload" \
      "$API_ROOT/rest/analyzer/events/ast" >/dev/null

    unmatched_event_payload="$(
      printf '%s' "$scenario_json" |
        python3 -c '
import json
import sys

scenario = json.load(sys.stdin)
event_id = f"{scenario['"'"'scenarioKey'"'"']}-unmatched-result"
source_id = f"{scenario['"'"'analyzerCardId'"'"']}-UNMATCHED"
print(json.dumps({
    "externalEventId": event_id,
    "eventType": "AST_RESULT_AVAILABLE",
    "analyzerId": scenario["analyzerInstrumentId"],
    "sourceId": source_id,
    "payload": {
        "analyzerInstrumentId": scenario["analyzerInstrumentId"],
        "analyzerCardId": source_id,
        "analyzerSoftwareVersion": "UAT-1.0",
        "readings": [{
            "antibioticId": scenario["antibioticId"],
            "rawValue": 4,
            "units": "mg/L",
            "instrumentInterpretation": "SUSCEPTIBLE",
            "analyzerResultReference": f"{event_id}-CIP",
        }],
    },
}))
'
    )"
    unmatched_status="$(
      curl -sSk \
        -o /dev/null \
        -w '%{http_code}' \
        -b "$COOKIE_JAR" \
        -H "Content-Type: application/json" \
        -H "X-CSRF-Token: $csrf" \
        --data "$unmatched_event_payload" \
        "$API_ROOT/rest/analyzer/events/ast"
    )"
    [ "$unmatched_status" = "422" ] || {
      echo "Unmatched analyzer fixture returned HTTP $unmatched_status" >&2
      exit 1
    }
  fi

  printf '%s' "$scenario_json" |
    BASE_URL="$BASE_URL" FIXTURE_KEY="$fixture_key" python3 -c '
import json
import os
import sys

scenario = json.load(sys.stdin)
fixture_key = os.environ["FIXTURE_KEY"]
scenario_name = scenario["scenario"]
base_url = os.environ["BASE_URL"].rstrip("/")
case_id = scenario["caseId"]
sibling_id = scenario.get("siblingCaseId")
scenario_key = scenario["scenarioKey"]
accession = scenario["accessionNumber"]

print("=== SEEDED THROUGH OPENELIS SERVICES ===")
print(f"fixture:       {fixture_key}")
print(f"scenario:      {scenario_name}")
print(f"scenario key:  {scenario_key}")
print(f"accession:     {accession}")
print(f"primary case: {case_id} -> {base_url}/Microbiology/cases/{case_id}")
if sibling_id:
    print(f"sibling case: {sibling_id} -> {base_url}/Microbiology/cases/{sibling_id}")
if scenario.get("analyzerCardId"):
    print(f"analyzer card: {scenario['"'"'analyzerCardId'"'"']}")
print(f"worklist:     {base_url}/Microbiology/worklist")
print("MICRO_SEED_DONE")
'
done
