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
: "${APP_BRANCH:?}" "${APP_REF:?}" "${APP_SCOPE:?}" "${APP_DOMAIN:?}"
: "${REMOTE_USER:?}" "${DEPLOYMENT_ID:?}" "${DEPLOYMENT_DIR:?}"

running_workdir="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' \
  amr-openelisglobal-webapp 2>/dev/null || true)"
running_configs="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' \
  amr-openelisglobal-webapp 2>/dev/null || true)"
running_override="$(printf '%s' "$running_configs" | tr ',' '\n' |
  awk '/\/amr\/docker-compose\.override\.yml$/ { print; exit }')"
[ -z "$running_workdir" ] || APP_DIR="$running_workdir"
if [ -n "$running_override" ]; then
  EDGE_DIR="${running_override%/amr/docker-compose.override.yml}"
fi
DEPLOYMENT_DIR="$EDGE_DIR/runtime/deployments/$DEPLOYMENT_ID"
STATUS_FILE="$DEPLOYMENT_DIR/status.json"
TARGET_FILE="$EDGE_DIR/runtime/target-$INSTANCE.json"
PREVIOUS_TARGET="$DEPLOYMENT_DIR/previous-target.json"
COMPOSE_FILES=(-f "$APP_DIR/build.docker-compose.yml" -f "$EDGE_DIR/amr/docker-compose.override.yml")
BACKEND_IMAGE="openelisglobal-webapp.amr"
FRONTEND_IMAGE="frontend.amr"
BACKEND_CONTAINER="amr-openelisglobal-webapp"
FRONTEND_CONTAINER="amr-openelisglobal-front-end"
candidate_started=false
schema_affecting=false
previous_app_sha=""
deployment_complete=false

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

[ "$INSTANCE" = amr ] || {
  echo "targeted app deployment currently supports only the AMR stack" >&2
  exit 1
}
[ -d "$APP_DIR/.git" ] || {
  echo "application checkout is missing: $APP_DIR" >&2
  exit 1
}
if ! repo_git "$APP_DIR" diff --quiet || ! repo_git "$APP_DIR" diff --cached --quiet; then
  echo "refusing to overwrite tracked changes in $APP_DIR" >&2
  repo_git "$APP_DIR" status --short >&2
  exit 1
fi

previous_app_sha="$(repo_git "$APP_DIR" rev-parse HEAD)"
[ -f "$TARGET_FILE" ] && cp "$TARGET_FILE" "$PREVIOUS_TARGET"
repo_git "$APP_DIR" fetch --depth 1 origin "$APP_REF"
repo_git "$APP_DIR" checkout --detach FETCH_HEAD
app_sha="$(repo_git "$APP_DIR" rev-parse HEAD)"
[ "$app_sha" = "$APP_REF" ] || {
  echo "fetched SHA $app_sha does not match requested SHA $APP_REF" >&2
  exit 1
}
repo_git "$APP_DIR" submodule update --init --depth 1 dataexport plugins

if repo_git "$APP_DIR" diff --name-only "$previous_app_sha" "$app_sha" -- \
  src/main/resources/liquibase | grep -q .; then
  schema_affecting=true
fi
write_status building
echo "[app-deploy] exact app SHA: $app_sha; schema-affecting: $schema_affecting"

if [ "$APP_SCOPE" = backend ] || [ "$APP_SCOPE" = app ]; then
  previous_backend_image="$(docker inspect -f '{{.Image}}' "$BACKEND_CONTAINER")"
  docker image tag "$previous_backend_image" "$BACKEND_IMAGE:rollback-$DEPLOYMENT_ID"
fi
if [ "$APP_SCOPE" = frontend ] || [ "$APP_SCOPE" = app ]; then
  previous_frontend_image="$(docker inspect -f '{{.Image}}' "$FRONTEND_CONTAINER")"
  docker image tag "$previous_frontend_image" "$FRONTEND_IMAGE:rollback-$DEPLOYMENT_ID"
fi

mapfile -t services < <(selected_services)
compose build "${services[@]}"
if [ "$APP_SCOPE" = backend ] || [ "$APP_SCOPE" = app ]; then
  docker image tag "$BACKEND_IMAGE:latest" "$BACKEND_IMAGE:$app_sha"
fi
if [ "$APP_SCOPE" = frontend ] || [ "$APP_SCOPE" = app ]; then
  docker image tag "$FRONTEND_IMAGE:latest" "$FRONTEND_IMAGE:$app_sha"
fi

candidate_started=true
write_status verifying
compose up -d --no-deps --force-recreate "${services[@]}"

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
curl -fsSk --retry 12 --retry-delay 5 "https://$APP_DOMAIN/Microbiology/worklist" >/dev/null

harness_sha="$(repo_git "$EDGE_DIR" rev-parse HEAD)"
deployed_at="$(date -u +%FT%TZ)"
target_tmp="$(mktemp "$EDGE_DIR/runtime/.target-$INSTANCE.XXXXXX")"
cat > "$target_tmp" <<JSON
{"instance":"$INSTANCE","deploymentId":"$DEPLOYMENT_ID","state":"ready","appRepo":"$APP_REPO","appBranch":"$APP_BRANCH","appSha":"$app_sha","harnessSha":"$harness_sha","deployedAt":"$deployed_at","scope":"$APP_SCOPE","schemaAffecting":$schema_affecting,"verification":{"health":"passed","smoke":"passed"}}
JSON
chmod 0644 "$target_tmp"
mv "$target_tmp" "$TARGET_FILE"
write_status ready passed
deployment_complete=true
trap - EXIT
echo "[app-deploy] ready: $INSTANCE $app_sha ($APP_SCOPE)"
