#!/usr/bin/env bash
#
# Rebuilds the checklist read service on the review host and proves the rebuilt
# one is answering. Its source is baked into its image, so checking out a new
# commit alone leaves the old code serving.
#
# Runs as root over SSM. Compose is driven from the running container's own
# labels: inferring the project from the path picks a different project, whose
# first act is to recreate Grist and Dex under names that are already taken.
set -euo pipefail

: "${REMOTE_USER:?}" "${GRIST_DOMAIN:?}"
CONTAINER="${CONTAINER:-oe-edge-grist-uat-read}"
SERVICE="${SERVICE:-uat-read}"
PROBE_ATTEMPTS="${PROBE_ATTEMPTS:-30}"
PROBE_DELAY="${PROBE_DELAY:-2}"

label() {
  docker inspect -f "{{index .Config.Labels \"$1\"}}" "$CONTAINER" 2>/dev/null || true
}

project="$(label com.docker.compose.project)"
workdir="$(label com.docker.compose.project.working_dir)"
config_files="$(label com.docker.compose.project.config_files)"
if [ -z "$project" ] || [ ! -d "$workdir" ]; then
  echo "could not resolve the running checklist service Compose project" >&2
  exit 1
fi

# Checked before the split rather than after: an empty list would otherwise leave
# Compose to infer the file from the working directory, which is the same guess
# this script exists to avoid — and expanding an empty array under `set -u` is
# itself an error on older bash.
[ -n "$config_files" ] || {
  echo "no Compose files resolved for $CONTAINER" >&2
  exit 1
}
compose_args=()
IFS=',' read -r -a file_list <<<"$config_files"
for config in "${file_list[@]}"; do
  [ -f "$config" ] || {
    echo "active Compose file is missing: $config" >&2
    exit 1
  }
  compose_args+=(-f "$config")
done

cd "$workdir"
# --no-deps keeps the rebuild to the service that changed; without it Compose
# recreates Grist, Dex and Redis alongside it.
sudo -u "$REMOTE_USER" docker compose -p "$project" "${compose_args[@]}" \
  up -d --no-deps --build "$SERVICE"

probe="$(mktemp)"
trap 'rm -f "$probe"' EXIT
for _ in $(seq 1 "$PROBE_ATTEMPTS"); do
  curl -fsSk "https://$GRIST_DOMAIN/uat/index.json" -o "$probe" && break
  sleep "$PROBE_DELAY"
done
# Fetching it is not proof: a stale image answers too. The catalog shape is what
# says the rebuilt service is the one on the line.
grep -q '"stories"' "$probe" || {
  echo "checklist service did not serve a catalog after rebuild" >&2
  exit 1
}
echo "checklist service ready"
