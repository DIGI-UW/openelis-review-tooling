#!/usr/bin/env bash
#
# Runs on the review host. deploy.sh supplies only validated, non-secret values.
# The ready target is published only after the selected app services are healthy.
set -euo pipefail
exec 9>/var/lock/openelis-review-deploy.lock
flock -n 9 || {
  echo "[app-deploy] another review-host deployment is already running" >&2
  exit 1
}

: "${INSTANCE:?}" "${APP_DIR:?}" "${EDGE_DIR:?}" "${APP_REPO:?}"
: "${APP_REF:?}" "${APP_SCOPE:?}" "${APP_DOMAIN:?}"
: "${APP_SMOKE_PATH:?}" "${REMOTE_USER:?}" "${DEPLOYMENT_ID:?}" "${DEPLOYMENT_DIR:?}"

APP_CONTAINER="${INSTANCE}-openelisglobal-webapp"
FRONTEND_CONTAINER="${INSTANCE}-openelisglobal-front-end"
running_workdir="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' \
  "$APP_CONTAINER" 2>/dev/null || true)"
running_configs="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' \
  "$APP_CONTAINER" 2>/dev/null || true)"
running_override="$(printf '%s' "$running_configs" | tr ',' '\n' |
  awk -v instance="$INSTANCE" '$0 ~ "/" instance "/docker-compose\\.override\\.yml$" { print; exit }')"
[ -z "$running_workdir" ] || APP_DIR="$running_workdir"
if [ -n "$running_override" ]; then
  EDGE_DIR="${running_override%/"$INSTANCE"/docker-compose.override.yml}"
fi
DEPLOYMENT_DIR="$EDGE_DIR/runtime/deployments/$DEPLOYMENT_ID"
STATUS_FILE="$DEPLOYMENT_DIR/status.json"
TARGET_FILE="$EDGE_DIR/runtime/target-$INSTANCE.json"
PREVIOUS_TARGET="$DEPLOYMENT_DIR/previous-target.json"
COMPOSE_FILES=()
BACKEND_IMAGE="openelisglobal-webapp.$INSTANCE"
FRONTEND_IMAGE="frontend.$INSTANCE"
BACKEND_CONTAINER="$APP_CONTAINER"
candidate_started=false
schema_affecting=false
previous_app_sha=""
deployment_complete=false
bootstrap=false
[ -n "$running_configs" ] || bootstrap=true

repo_git() {
  local dir="$1"
  shift
  sudo -u "$REMOTE_USER" git -c safe.directory="$dir" -C "$dir" "$@"
}

write_status() {
  local state="$1" verification="${2:-pending}" tmp
  tmp="$(mktemp "$DEPLOYMENT_DIR/.status.XXXXXX")"
  cat > "$tmp" <<JSON
{"instance":"$INSTANCE","deploymentId":"$DEPLOYMENT_ID","state":"$state","appRef":"$APP_REF","scope":"$APP_SCOPE","schemaAffecting":$schema_affecting,"verification":"$verification","updatedAt":"$(date -u +%FT%TZ)"}
JSON
  chmod 0644 "$tmp"
  mv "$tmp" "$STATUS_FILE"
}

compose() {
  docker compose -p "$INSTANCE" "${COMPOSE_FILES[@]}" "$@"
}

selected_services() {
  case "$APP_SCOPE" in
    frontend) printf '%s\n' "frontend.openelis.org" ;;
    backend) printf '%s\n' "oe.openelis.org" ;;
    app) printf '%s\n' "oe.openelis.org" "frontend.openelis.org" ;;
    *) echo "unsupported app scope: $APP_SCOPE" >&2; return 1 ;;
  esac
}

restore_previous_images() {
  local services=()
  [ "$candidate_started" = true ] || return 0
  if [ "$bootstrap" = true ]; then
    echo "[app-deploy] bootstrap failed; removing partial containers"
    compose down || true
    return 0
  fi
  echo "[app-deploy] candidate failed; restoring previous application images"
  if [ "$APP_SCOPE" = backend ] || [ "$APP_SCOPE" = app ]; then
    docker image tag "$BACKEND_IMAGE:rollback-$DEPLOYMENT_ID" "$BACKEND_IMAGE:latest"
    services+=("oe.openelis.org")
  fi
  if [ "$APP_SCOPE" = frontend ] || [ "$APP_SCOPE" = app ]; then
    docker image tag "$FRONTEND_IMAGE:rollback-$DEPLOYMENT_ID" "$FRONTEND_IMAGE:latest"
    services+=("frontend.openelis.org")
  fi
  compose up -d --no-deps --force-recreate "${services[@]}" || true
}

on_exit() {
  local exit_code="$?"
  [ "$deployment_complete" = true ] && return
  restore_previous_images
  write_status failed failed
  echo "[app-deploy] failed with exit code $exit_code; ready target metadata was not changed" >&2
}
trap on_exit EXIT

mkdir -p "$DEPLOYMENT_DIR" "$EDGE_DIR/runtime"
write_status preparing
echo "[app-deploy] $INSTANCE $APP_SCOPE deployment $DEPLOYMENT_ID"
echo "[app-deploy] app checkout: $APP_DIR; review tooling: $EDGE_DIR"

case "$INSTANCE" in
  amr | analyzers | phrases) ;;
  *)
    echo "unsupported targeted app instance: $INSTANCE" >&2
    exit 1
    ;;
esac

# Service-backed fixtures are enabled only on isolated clinical review stacks.
# OpenELIS keeps them disabled by default everywhere else.
if [ "$INSTANCE" = amr ] || [ "$INSTANCE" = phrases ]; then
  export OE_UAT_SCENARIOS_ENABLED=true
fi

if [ ! -d "$APP_DIR/.git" ]; then
  sudo mkdir -p "$APP_DIR"
  sudo chown "$REMOTE_USER":"$REMOTE_USER" "$APP_DIR"
  sudo -u "$REMOTE_USER" git clone --no-checkout --filter=blob:none "$APP_REPO" "$APP_DIR"
fi
if ! repo_git "$APP_DIR" diff --quiet || ! repo_git "$APP_DIR" diff --cached --quiet; then
  echo "refusing to overwrite tracked changes in $APP_DIR" >&2
  repo_git "$APP_DIR" status --short >&2
  exit 1
fi

if [ "$bootstrap" = false ]; then
  previous_app_sha="$(repo_git "$APP_DIR" rev-parse HEAD)"
fi
[ -f "$TARGET_FILE" ] && cp "$TARGET_FILE" "$PREVIOUS_TARGET"
repo_git "$APP_DIR" fetch --depth 1 origin "$APP_REF"
repo_git "$APP_DIR" checkout --detach FETCH_HEAD
app_sha="$(repo_git "$APP_DIR" rev-parse HEAD)"
[ "$app_sha" = "$APP_REF" ] || {
  echo "fetched SHA $app_sha does not match requested SHA $APP_REF" >&2
  exit 1
}
# The configured instance branch only determines the initial checkout. A
# targeted deployment may intentionally select a newer stacked-PR branch, so
# publish a branch only when its remote head is the exact deployed SHA.
matching_branches="$(repo_git "$APP_DIR" ls-remote --heads origin | awk -v sha="$app_sha" '
  $1 == sha {
    sub(/^refs\/heads\//, "", $2)
    print $2
  }
')"
matching_branch_count="$(printf '%s\n' "$matching_branches" | awk 'NF { count++ } END { print count + 0 }')"
published_branch=""
case "$matching_branch_count" in
  1) published_branch="$matching_branches" ;;
  *)
    echo "[app-deploy] exact SHA $app_sha is not a unique remote branch head; publishing SHA-only provenance"
    ;;
esac
repo_git "$APP_DIR" submodule update --init --depth 1 dataexport plugins

if [ -n "$running_configs" ]; then
  IFS=',' read -r -a active_compose_files <<<"$running_configs"
  for compose_file in "${active_compose_files[@]}"; do
    [ -f "$compose_file" ] || {
      echo "active Compose file is missing: $compose_file" >&2
      exit 1
    }
    COMPOSE_FILES+=(-f "$compose_file")
  done
else
  COMPOSE_FILES=(
    -f "$APP_DIR/build.docker-compose.yml"
    -f "$EDGE_DIR/$INSTANCE/docker-compose.override.yml"
  )
fi
for ((i = 1; i < ${#COMPOSE_FILES[@]}; i += 2)); do
  [ -f "${COMPOSE_FILES[$i]}" ] || {
    echo "Compose file is missing: ${COMPOSE_FILES[$i]}" >&2
    exit 1
  }
done

if [ "$bootstrap" = true ]; then
  schema_affecting=true
elif repo_git "$APP_DIR" diff --name-only "$previous_app_sha" "$app_sha" -- \
  src/main/resources/liquibase | grep -q .; then
  schema_affecting=true
fi
write_status building
echo "[app-deploy] exact app SHA: $app_sha; schema-affecting: $schema_affecting"

if [ "$bootstrap" = false ] && { [ "$APP_SCOPE" = backend ] || [ "$APP_SCOPE" = app ]; }; then
  previous_backend_image="$(docker inspect -f '{{.Image}}' "$BACKEND_CONTAINER")"
  docker image tag "$previous_backend_image" "$BACKEND_IMAGE:rollback-$DEPLOYMENT_ID"
fi
if [ "$bootstrap" = false ] && { [ "$APP_SCOPE" = frontend ] || [ "$APP_SCOPE" = app ]; }; then
  previous_frontend_image="$(docker inspect -f '{{.Image}}' "$FRONTEND_CONTAINER")"
  docker image tag "$previous_frontend_image" "$FRONTEND_IMAGE:rollback-$DEPLOYMENT_ID"
fi

mapfile -t services < <(selected_services)
# mapfile returns 0 even when the process substitution fails, and an empty array
# would expand to nothing — turning the targeted build/recreate below into an
# every-service one that rebuilds the database, FHIR and harness containers this
# script exists to preserve. The rollback script guards the same way.
if [ "${#services[@]}" -eq 0 ]; then
  echo "no services selected for scope '$APP_SCOPE'" >&2
  exit 1
fi
if [ "$bootstrap" = true ]; then
  [ "$APP_SCOPE" = app ] || {
    echo "a new instance must be bootstrapped with --scope app" >&2
    exit 1
  }
  docker network create oe-edge 2>/dev/null || true
  candidate_started=true
  write_status verifying
  compose up -d --build certs db.openelis.org oe.openelis.org fhir.openelis.org frontend.openelis.org
else
  compose build "${services[@]}"
fi
if [ "$APP_SCOPE" = backend ] || [ "$APP_SCOPE" = app ]; then
  docker image tag "$BACKEND_IMAGE:latest" "$BACKEND_IMAGE:$app_sha"
fi
if [ "$APP_SCOPE" = frontend ] || [ "$APP_SCOPE" = app ]; then
  docker image tag "$FRONTEND_IMAGE:latest" "$FRONTEND_IMAGE:$app_sha"
fi

if [ "$bootstrap" = false ]; then
  candidate_started=true
  write_status verifying
  compose up -d --no-deps --force-recreate "${services[@]}"
fi

if [ "$APP_SCOPE" = backend ] || [ "$APP_SCOPE" = app ]; then
  healthy=false
  for _ in $(seq 1 120); do
    if [ "$(docker inspect -f '{{.State.Health.Status}}' "$BACKEND_CONTAINER" 2>/dev/null || true)" = healthy ]; then
      healthy=true
      break
    fi
    sleep 10
  done
  [ "$healthy" = true ] || {
    echo "backend did not become healthy within 20 minutes" >&2
    exit 1
  }
fi

[ "$(docker inspect -f '{{.State.Running}}' "$FRONTEND_CONTAINER" 2>/dev/null)" = true ]
curl -fsSk --retry 12 --retry-delay 5 "https://$APP_DOMAIN/" >/dev/null
curl -fsSk --retry 12 --retry-delay 5 "https://$APP_DOMAIN$APP_SMOKE_PATH" >/dev/null

harness_sha="$(repo_git "$EDGE_DIR" rev-parse HEAD)"
deployed_at="$(date -u +%FT%TZ)"
target_tmp="$(mktemp "$EDGE_DIR/runtime/.target-$INSTANCE.XXXXXX")"
cat > "$target_tmp" <<JSON
{"instance":"$INSTANCE","deploymentId":"$DEPLOYMENT_ID","state":"ready","appRepo":"$APP_REPO","appBranch":"$published_branch","appSha":"$app_sha","harnessSha":"$harness_sha","deployedAt":"$deployed_at","scope":"$APP_SCOPE","schemaAffecting":$schema_affecting,"verification":{"health":"passed","smoke":"passed"}}
JSON
chmod 0644 "$target_tmp"
mv "$target_tmp" "$TARGET_FILE"
write_status ready passed
deployment_complete=true
trap - EXIT

# Every deploy pins another rollback tag, and tagged images survive
# `docker image prune -a`, so without this the demo box slowly fills its root
# volume until the live stacks go down. Keep the most recent few and drop the
# rest; the retained ones are what `app rollback` can actually restore to.
ROLLBACK_KEEP="${ROLLBACK_KEEP:-3}"
prune_rollback_tags() {
  local image="$1" tag
  docker image ls "$image" --format '{{.Tag}}' \
    | grep '^rollback-' \
    | sort -r \
    | tail -n "+$((ROLLBACK_KEEP + 1))" \
    | while read -r tag; do
        echo "[app-deploy] pruning $image:$tag"
        docker image rm "$image:$tag" >/dev/null 2>&1 || true
      done
}
prune_rollback_tags "$BACKEND_IMAGE"
prune_rollback_tags "$FRONTEND_IMAGE"

echo "[app-deploy] ready: $INSTANCE $app_sha ($APP_SCOPE)"
