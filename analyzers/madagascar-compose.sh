#!/usr/bin/env bash
set -euo pipefail

site_root="${MDG_SITE_ROOT:-/opt/madagascar-analyzers}"

require_commit() {
  local name="$1" expected="$2" actual
  actual="$(git -C "$site_root/$name" rev-parse HEAD)"
  if [[ "$actual" != "$expected" ]]; then
    printf 'Wrong %s commit: expected %s, found %s\n' "$name" "$expected" "$actual" >&2
    exit 1
  fi
}

require_commit distro 05a2132debcee3f26e9da14ba450375fc7fad346
require_commit harness ee0cb55722c668a8fa7cb7a261bdfce16da78b29
require_commit bridge b4a9f2cbffe93fa1900f25055755c2ff3bccea0e

env_file="$site_root/distro/.env"
[[ -f "$env_file" ]] || { printf 'Missing private distro environment file\n' >&2; exit 1; }
[[ -f "$site_root/docker-compose.site.yml" ]] || { printf 'Missing site overlay\n' >&2; exit 1; }

export BRIDGE_REPO="$site_root/bridge"
export HARNESS_DEMO_CONTEXT="$site_root/harness/tests/playwright"
export HARNESS_TEST_RESULTS_DIR="$site_root/test-results"
export BASE_URL="${BASE_URL:-https://analyzers.openelis-global.org}"
TEST_PASS="$(sed -n 's/^OE_ADMIN_PASSWORD=//p' "$env_file" | head -n 1)"
[[ -n "$TEST_PASS" ]] || { printf 'Missing OE_ADMIN_PASSWORD\n' >&2; exit 1; }
export TEST_PASS

exec docker compose \
  --env-file "$env_file" \
  -p madagascar-analyzers \
  -f "$site_root/distro/docker-compose.yml" \
  -f "$site_root/harness/compose.validate.yaml" \
  -f "$site_root/docker-compose.site.yml" \
  "$@"
