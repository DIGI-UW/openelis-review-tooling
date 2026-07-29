#!/usr/bin/env bash
set -euo pipefail

# Provision the review fixture through OpenELIS business services. The AMR demo
# deployment explicitly enables this ADMIN-only endpoint; ordinary deployments
# leave it disabled.
BASE_URL="${BASE_URL:-https://amr.openelis-global.org}"
TEST_USER="${TEST_USER:-admin}"
TEST_PASS="${TEST_PASS:-adminADMIN!}"
SCENARIO_KEY="${SCENARIO_KEY:-review-amr-microbiology-mvp}"
API_ROOT="${BASE_URL%/}/api/OpenELIS-Global"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

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

payload="$(
  SCENARIO_KEY="$SCENARIO_KEY" python3 -c '
import json
import os

print(json.dumps({
    "scenario": "WORKLIST",
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

printf '%s' "$scenario_json" |
  BASE_URL="$BASE_URL" python3 -c '
import json
import os
import sys

scenario = json.load(sys.stdin)
base_url = os.environ["BASE_URL"].rstrip("/")
case_id = scenario["caseId"]
sibling_id = scenario.get("siblingCaseId")
scenario_key = scenario["scenarioKey"]
accession = scenario["accessionNumber"]

print("=== SEEDED THROUGH OPENELIS SERVICES ===")
print(f"scenario key:  {scenario_key}")
print(f"accession:     {accession}")
print(f"primary case: {case_id} -> {base_url}/Microbiology/cases/{case_id}")
if sibling_id:
    print(f"sibling case: {sibling_id} -> {base_url}/Microbiology/cases/{sibling_id}")
print(f"worklist:     {base_url}/Microbiology/worklist")
print("MICRO_SEED_DONE")
'
