#!/usr/bin/env bash
#
# Runs on the review host after the matching targeted OpenELIS app deployment.
# It rebuilds only the analyzer Bridge and mock services from the exact gitlinks
# in the already-deployed OpenELIS commit.
set -euo pipefail
exec 9>/var/lock/openelis-review-deploy.lock
flock -n 9 || {
  echo "[analyzer-runtime] another review-host deployment is already running" >&2
  exit 1
}

: "${APP_DIR:?}" "${EDGE_DIR:?}" "${APP_REF:?}" "${APP_DOMAIN:?}"
: "${REMOTE_USER:?}" "${DEPLOYMENT_ID:?}" "${DEPLOYMENT_DIR:?}"

INSTANCE="analyzers"
APP_CONTAINER="analyzers-openelisglobal-webapp"
BRIDGE_CONTAINER="analyzers-openelis-analyzer-bridge"
MOCK_CONTAINER="analyzers-openelis-astm-simulator"
BRIDGE_IMAGE="openelis-analyzer-bridge.analyzers"
MOCK_IMAGE="openelis-astm-simulator.analyzers"
TARGET_FILE="$EDGE_DIR/runtime/target-analyzers.json"
STATUS_FILE="$DEPLOYMENT_DIR/status.json"
COMPOSE_FILES=()
services=("openelis-analyzer-bridge" "astm-simulator")
candidate_started=false
deployment_complete=false

repo_git() {
  local dir="$1"
  shift
  sudo -u "$REMOTE_USER" git -c safe.directory="$dir" -C "$dir" "$@"
}

compose() {
  docker compose -p "$INSTANCE" "${COMPOSE_FILES[@]}" "$@"
}

verify_ready_target() {
  python3 - "$TARGET_FILE" "$APP_REF" <<'PY'
import json
import sys

target_file, app_ref = sys.argv[1:]
with open(target_file, encoding="utf-8") as handle:
    target = json.load(handle)
if target.get("state") != "ready" or target.get("appSha") != app_ref:
    raise SystemExit("published analyzer application does not match requested SHA")
PY
}

write_status() {
  local state="$1" verification="${2:-pending}" tmp
  tmp="$(mktemp "$DEPLOYMENT_DIR/.status.XXXXXX")"
  cat >"$tmp" <<JSON
{"instance":"analyzers","deploymentId":"$DEPLOYMENT_ID","state":"$state","appRef":"$APP_REF","scope":"analyzer-runtime","verification":"$verification","updatedAt":"$(date -u +%FT%TZ)"}
JSON
  chmod 0644 "$tmp"
  mv "$tmp" "$STATUS_FILE"
}

restore_previous_images() {
  [ "$candidate_started" = true ] || return 0
  echo "[analyzer-runtime] candidate failed; restoring previous Bridge and mock images"
  docker image tag "$BRIDGE_IMAGE:rollback-$DEPLOYMENT_ID" "$BRIDGE_IMAGE:latest"
  docker image tag "$MOCK_IMAGE:rollback-$DEPLOYMENT_ID" "$MOCK_IMAGE:latest"
  compose up -d --no-deps --force-recreate "${services[@]}" || true
}

on_exit() {
  local exit_code="$?"
  [ "$deployment_complete" = true ] && return
  restore_previous_images
  write_status failed failed
  echo "[analyzer-runtime] failed with exit code $exit_code; target metadata was not changed" >&2
}
trap on_exit EXIT

verify_runtime() {
  local bridge_ready=false mock_ready=false
  for _ in $(seq 1 60); do
    if docker exec "$BRIDGE_CONTAINER" /app/healthcheck.sh >/dev/null 2>&1; then
      bridge_ready=true
    fi
    if [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
      "$MOCK_CONTAINER" 2>/dev/null || true)" = healthy ]; then
      mock_ready=true
    fi
    if [ "$bridge_ready" = true ] && [ "$mock_ready" = true ]; then
      break
    fi
    sleep 5
  done
  [ "$bridge_ready" = true ] || {
    echo "Analyzer Bridge did not become healthy within five minutes" >&2
    return 1
  }
  [ "$mock_ready" = true ] || {
    echo "Analyzer mock did not become healthy within five minutes" >&2
    return 1
  }
  curl -fsSk --retry 12 --retry-delay 5 "https://$APP_DOMAIN/analyzers" >/dev/null
}

mkdir -p "$DEPLOYMENT_DIR" "$EDGE_DIR/runtime"
write_status preparing

running_workdir="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' \
  "$APP_CONTAINER" 2>/dev/null || true)"
running_configs="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' \
  "$APP_CONTAINER" 2>/dev/null || true)"
running_override="$(printf '%s' "$running_configs" | tr ',' '\n' |
  awk '$0 ~ "/analyzers/docker-compose\\.override\\.yml$" { print; exit }')"
[ -n "$running_workdir" ] || {
  echo "the analyzers application is not running" >&2
  exit 1
}
APP_DIR="$running_workdir"
if [ -n "$running_override" ]; then
  EDGE_DIR="${running_override%/analyzers/docker-compose.override.yml}"
fi
TARGET_FILE="$EDGE_DIR/runtime/target-analyzers.json"
DEPLOYMENT_DIR="$EDGE_DIR/runtime/deployments/$DEPLOYMENT_ID"
STATUS_FILE="$DEPLOYMENT_DIR/status.json"
mkdir -p "$DEPLOYMENT_DIR"

[ -f "$TARGET_FILE" ] || {
  echo "analyzers target metadata is missing; deploy the application first" >&2
  exit 1
}
verify_ready_target
app_sha="$(repo_git "$APP_DIR" rev-parse HEAD)"
[ "$app_sha" = "$APP_REF" ] || {
  echo "analyzers checkout is $app_sha, expected $APP_REF; deploy the application first" >&2
  exit 1
}
if ! repo_git "$APP_DIR" diff --quiet || ! repo_git "$APP_DIR" diff --cached --quiet; then
  echo "refusing to update submodules in a dirty analyzers checkout" >&2
  repo_git "$APP_DIR" status --short >&2
  exit 1
fi

repo_git "$APP_DIR" submodule update --init --depth 1 \
  tools/openelis-analyzer-bridge tools/analyzer-mock-server
bridge_sha="$(repo_git "$APP_DIR" rev-parse HEAD:tools/openelis-analyzer-bridge)"
mock_sha="$(repo_git "$APP_DIR" rev-parse HEAD:tools/analyzer-mock-server)"
[ "$(repo_git "$APP_DIR/tools/openelis-analyzer-bridge" rev-parse HEAD)" = "$bridge_sha" ]
[ "$(repo_git "$APP_DIR/tools/analyzer-mock-server" rev-parse HEAD)" = "$mock_sha" ]

IFS=',' read -r -a active_compose_files <<<"$running_configs"
for compose_file in "${active_compose_files[@]}"; do
  [ -f "$compose_file" ] || {
    echo "active Compose file is missing: $compose_file" >&2
    exit 1
  }
  COMPOSE_FILES+=(-f "$compose_file")
done
[ "${#COMPOSE_FILES[@]}" -gt 0 ] || {
  echo "the active analyzers Compose chain is empty" >&2
  exit 1
}

write_status building
previous_bridge_image="$(docker inspect -f '{{.Image}}' "$BRIDGE_CONTAINER")"
previous_mock_image="$(docker inspect -f '{{.Image}}' "$MOCK_CONTAINER")"
docker image tag "$previous_bridge_image" "$BRIDGE_IMAGE:rollback-$DEPLOYMENT_ID"
docker image tag "$previous_mock_image" "$MOCK_IMAGE:rollback-$DEPLOYMENT_ID"

compose build "${services[@]}"
docker image tag "$BRIDGE_IMAGE:latest" "$BRIDGE_IMAGE:$bridge_sha"
docker image tag "$MOCK_IMAGE:latest" "$MOCK_IMAGE:$mock_sha"
candidate_started=true
write_status verifying
compose up -d --no-deps --force-recreate "${services[@]}"
verify_runtime

deployed_at="$(date -u +%FT%TZ)"
target_tmp="$(mktemp "$EDGE_DIR/runtime/.target-analyzers.XXXXXX")"
python3 - "$TARGET_FILE" "$target_tmp" "$APP_REF" "$bridge_sha" "$mock_sha" "$deployed_at" <<'PY'
import json
import sys

source, destination, app_ref, bridge_sha, mock_sha, deployed_at = sys.argv[1:]
with open(source, encoding="utf-8") as handle:
    target = json.load(handle)
if target.get("state") != "ready" or target.get("appSha") != app_ref:
    raise SystemExit("published analyzer application does not match requested SHA")
target.update({
    "bridgeSha": bridge_sha,
    "mockSha": mock_sha,
    "profileCatalogSha": bridge_sha,
    "analyzerRuntimeDeployedAt": deployed_at,
})
verification = target.setdefault("verification", {})
verification["analyzerRuntime"] = "passed"
with open(destination, "w", encoding="utf-8") as handle:
    json.dump(target, handle, separators=(",", ":"))
    handle.write("\n")
PY
chmod 0644 "$target_tmp"
write_status ready passed
mv "$target_tmp" "$TARGET_FILE"
deployment_complete=true
trap - EXIT

ROLLBACK_KEEP="${ROLLBACK_KEEP:-3}"
for image in "$BRIDGE_IMAGE" "$MOCK_IMAGE"; do
  docker image ls "$image" --format '{{.Tag}}' |
    grep '^rollback-' |
    sort -r |
    tail -n "+$((ROLLBACK_KEEP + 1))" |
    while read -r tag; do
      docker image rm "$image:$tag" >/dev/null 2>&1 || true
    done
done

echo "[analyzer-runtime] ready: app=$app_sha bridge=$bridge_sha mock=$mock_sha"
