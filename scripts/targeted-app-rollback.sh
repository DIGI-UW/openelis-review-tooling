#!/usr/bin/env bash
#
# Restores the application images and target metadata saved by a successful
# targeted deployment. Schema-affecting releases require a separate data plan.
set -euo pipefail
exec 9>/var/lock/openelis-review-deploy.lock
flock -n 9 || {
  echo "[app-rollback] another review-host deployment is already running" >&2
  exit 1
}

: "${INSTANCE:?}" "${APP_DIR:?}" "${EDGE_DIR:?}" "${DEPLOYMENT_ID:?}" "${DEPLOYMENT_DIR:?}"
: "${APP_DOMAIN:?}"

running_workdir="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' \
  amr-openelisglobal-webapp 2>/dev/null || true)"
running_configs="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' \
  amr-openelisglobal-webapp 2>/dev/null || true)"
running_override="$(printf '%s' "$running_configs" | tr ',' '\n' |
  awk '/\/amr\/docker-compose\.override\.yml$/ { print; exit }')"
if [ -n "$running_workdir" ]; then
  APP_DIR="$running_workdir"
fi
if [ -n "$running_override" ]; then
  EDGE_DIR="${running_override%/amr/docker-compose.override.yml}"
fi
DEPLOYMENT_DIR="$EDGE_DIR/runtime/deployments/$DEPLOYMENT_ID"
STATUS_FILE="$DEPLOYMENT_DIR/status.json"
PREVIOUS_TARGET="$DEPLOYMENT_DIR/previous-target.json"
COMPOSE_FILES=(-f "$APP_DIR/build.docker-compose.yml" -f "$EDGE_DIR/amr/docker-compose.override.yml")
BACKEND_IMAGE="openelisglobal-webapp.amr"
FRONTEND_IMAGE="frontend.amr"

[ "$INSTANCE" = amr ] || {
  echo "targeted rollback currently supports only the AMR stack" >&2
  exit 1
}
[ -f "$STATUS_FILE" ] && [ -f "$PREVIOUS_TARGET" ] || {
  echo "rollback state is incomplete for deployment $DEPLOYMENT_ID" >&2
  exit 1
}
grep -q '"state":"ready"' "$STATUS_FILE" || {
  echo "deployment $DEPLOYMENT_ID is not a ready deployment" >&2
  exit 1
}
grep -q '"schemaAffecting":false' "$STATUS_FILE" || {
  echo "automatic rollback is disabled for schema-affecting deployments" >&2
  exit 1
}

scope="$(sed -n 's/.*"scope":"\([^"]*\)".*/\1/p' "$STATUS_FILE")"
services=()
if [ "$scope" = backend ] || [ "$scope" = app ]; then
  docker image tag "$BACKEND_IMAGE:rollback-$DEPLOYMENT_ID" "$BACKEND_IMAGE:latest"
  services+=("oe.openelis.org")
fi
if [ "$scope" = frontend ] || [ "$scope" = app ]; then
  docker image tag "$FRONTEND_IMAGE:rollback-$DEPLOYMENT_ID" "$FRONTEND_IMAGE:latest"
  services+=("frontend.openelis.org")
fi
[ "${#services[@]}" -gt 0 ] || {
  echo "deployment has an unsupported rollback scope: $scope" >&2
  exit 1
}

docker compose -p "$INSTANCE" "${COMPOSE_FILES[@]}" \
  up -d --no-deps --force-recreate "${services[@]}"
if [ "$scope" = backend ] || [ "$scope" = app ]; then
  healthy=false
  for _ in $(seq 1 120); do
    if [ "$(docker inspect -f '{{.State.Health.Status}}' amr-openelisglobal-webapp 2>/dev/null || true)" = healthy ]; then
      healthy=true
      break
    fi
    sleep 10
  done
  [ "$healthy" = true ]
fi
curl -fsSk --retry 12 --retry-delay 5 "https://$APP_DOMAIN/Microbiology/worklist" >/dev/null
target_tmp="$(mktemp "$EDGE_DIR/runtime/.target-$INSTANCE.XXXXXX")"
cp "$PREVIOUS_TARGET" "$target_tmp"
chmod 0644 "$target_tmp"
mv "$target_tmp" "$EDGE_DIR/runtime/target-$INSTANCE.json"
echo "[app-rollback] restored deployment preceding $DEPLOYMENT_ID"
