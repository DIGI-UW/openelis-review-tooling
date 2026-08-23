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
  "AMR-S30:WHONET_FILTERS"
  "AMR-S21:AST_ANALYZER_REVIEW"
  "AMR-S31:AST_ANALYZER_REVIEW"
  "AMR-S32:CASE"
  "AMR-S33:WHONET_FILTERS"
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
    CASE|MVP|WORKLIST|M3|M4|R1|AST_REVIEWED|WHONET_FILTERS|AST_ANALYZER_REVIEW) ;;
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

  if [ "$fixture_key" = "AMR-S32" ]; then
    case_id="$(printf '%s' "$scenario_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["caseId"])')"
    method_id="$(printf '%s' "$scenario_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["methodId"])')"
    order_payload="$(
      METHOD_ID="$method_id" python3 -c '
import json
import os

print(json.dumps({
    "culturePurpose": "CLINICAL_DIAGNOSTIC",
    "cultureMethodId": os.environ["METHOD_ID"],
    "patientOrigin": "",
    "admissionDate": None,
    "numberOfSets": 1,
    "clinicalHistory": "R11 culture-purpose review fixture",
    "antibioticExposure": False,
}))
'
    )"
    curl -fsSk \
      --request PUT \
      -b "$COOKIE_JAR" \
      -H "Content-Type: application/json" \
      -H "X-CSRF-Token: $csrf" \
      --data "$order_payload" \
      "$API_ROOT/rest/microbiology/cases/$case_id/order-detail" >/dev/null
  fi

  if [ "$scenario" = "WHONET_FILTERS" ]; then
    case_id="$(printf '%s' "$scenario_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["caseId"])')"
    sample_type_id="$(printf '%s' "$scenario_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sampleTypeId"])')"
    unmapped_organism_id="$(printf '%s' "$scenario_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["unmappedOrganismId"])')"
    method_id="$(printf '%s' "$scenario_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["methodId"])')"
    sample_type_json="$(curl -fsSk -b "$COOKIE_JAR" "$API_ROOT/rest/sample-types/$sample_type_id")"
    specimen_code="$(printf '%s' "$sample_type_json" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("data") or {}).get("whonetCode") or "")')"
    if [ "$specimen_code" != "BLD" ]; then
      curl -fsSk \
        --request PUT \
        -b "$COOKIE_JAR" \
        -H "Content-Type: application/json" \
        -H "X-CSRF-Token: $csrf" \
        --data '{"whonetCode": "BLD"}' \
        "$API_ROOT/rest/sample-types/$sample_type_id" >/dev/null
    fi
    case_json="$(curl -fsSk -b "$COOKIE_JAR" "$API_ROOT/rest/microbiology/cases/$case_id")"
    final_state="$(printf '%s' "$case_json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("finalReleaseState", ""))')"
    patient_origin="$(printf '%s' "$case_json" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("orderDetail") or {}).get("patientOrigin", ""))')"
    contaminant_id="$(
      printf '%s' "$case_json" |
        python3 -c '
import json
import sys

case = json.load(sys.stdin)
isolate = next((item for item in case.get("isolates", [])
                if item.get("isolateLabel") == "WHONET-FILTER-CONTAMINANT"), {})
print(isolate.get("id", ""))
'
    )"

    if [ "$final_state" = "FINAL_RELEASED" ]; then
      printf '%s' "$case_json" |
        UNMAPPED_ORGANISM_ID="$unmapped_organism_id" \
        python3 -c '
import json
import os
import sys

case = json.load(sys.stdin)
origin = (case.get("orderDetail") or {}).get("patientOrigin")
unmapped_organism_id = os.environ["UNMAPPED_ORGANISM_ID"]
contaminant = next((item for item in case.get("isolates", [])
                    if item.get("isolateLabel") == "WHONET-FILTER-CONTAMINANT"), None)
if origin != "INPATIENT":
    raise SystemExit("Final R9 fixture is missing patient origin INPATIENT")
if not contaminant or contaminant.get("organismId") != unmapped_organism_id or contaminant.get("significance") != "CONTAMINANT" or contaminant.get("identificationStatus") != "CONFIRMED":
    raise SystemExit("Final R9 fixture is missing its confirmed contaminant isolate")
'
    else
      if [ "$patient_origin" != "INPATIENT" ]; then
        order_payload="$(
          METHOD_ID="$method_id" python3 -c '
import json
import os

print(json.dumps({
    "cultureMethodId": os.environ["METHOD_ID"],
    "patientOrigin": "INPATIENT",
    "numberOfSets": 1,
    "clinicalHistory": "Synthetic WHONET population-filter fixture",
    "antibioticExposure": False,
}))
'
        )"
        curl -fsSk \
          --request PUT \
          -b "$COOKIE_JAR" \
          -H "Content-Type: application/json" \
          -H "X-CSRF-Token: $csrf" \
          --data "$order_payload" \
          "$API_ROOT/rest/microbiology/cases/$case_id/order-detail" >/dev/null
      fi

      if [ -z "$contaminant_id" ]; then
        isolate_payload="$(
          CASE_ID="$case_id" python3 -c '
import json
import os

print(json.dumps({
    "caseId": os.environ["CASE_ID"],
    "isolateLabel": "WHONET-FILTER-CONTAMINANT",
    "gramStain": "Gram negative rods",
    "colonyMorphology": "Synthetic contaminant colonies",
    "significance": "CONTAMINANT",
}))
'
        )"
        isolate_json="$(
          curl -fsSk \
            -b "$COOKIE_JAR" \
            -H "Content-Type: application/json" \
            -H "X-CSRF-Token: $csrf" \
            --data "$isolate_payload" \
            "$API_ROOT/rest/microbiology/isolates"
        )"
        contaminant_id="$(printf '%s' "$isolate_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
      fi

      identification_payload="$(
        ORGANISM_ID="$unmapped_organism_id" python3 -c '
import json
import os

print(json.dumps({
    "organismId": os.environ["ORGANISM_ID"],
    "preliminaryOrganismText": "Escherichia coli (UAT contaminant)",
    "significance": "CONTAMINANT",
    "identificationStatus": "CONFIRMED",
    "identificationMethod": "MALDI_TOF",
    "identificationConfidence": 99.5,
    "identificationReason": "Deterministic WHONET population-filter fixture",
}))
'
      )"
      curl -fsSk \
        --request PUT \
        -b "$COOKIE_JAR" \
        -H "Content-Type: application/json" \
        -H "X-CSRF-Token: $csrf" \
        --data "$identification_payload" \
        "$API_ROOT/rest/microbiology/isolates/$contaminant_id/identification" >/dev/null

      curl -fsSk \
        -b "$COOKIE_JAR" \
        -H "Content-Type: application/json" \
        -H "X-CSRF-Token: $csrf" \
        --data '{}' \
        "$API_ROOT/rest/microbiology/cases/$case_id/release/final" >/dev/null
    fi
  fi

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
      --user "$TEST_USER:$TEST_PASS" \
      -H "Content-Type: application/json" \
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
        --user "$TEST_USER:$TEST_PASS" \
        -H "Content-Type: application/json" \
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
