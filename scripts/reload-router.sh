#!/usr/bin/env bash
#
# Re-renders the umbrella router's nginx configuration and proves the new one is
# serving. The template is turned into nginx.conf by the container's entrypoint,
# so checking out a commit that changes the template leaves the old routes live
# until the container is recreated.
#
# Narrow on purpose: the only other thing that recreates the router is the full
# deploy, which also brings up both application stacks and so interrupts anyone
# mid-review. This touches the router alone.
#
# Runs as root over SSM. Compose is driven from the running container's own
# labels: inferring the project from the path picks a different project, whose
# first act is to recreate containers under names that are already taken.
set -euo pipefail

# The router's Compose file interpolates the domains with no defaults, and the
# entrypoint renders them into server_name and the certificate paths. Recreating
# it without them yields a configuration that names no host and points at no
# certificate — nginx starts and then serves nothing on 443, which is an outage,
# not a failed reload. Required here so that cannot happen quietly.
: "${REMOTE_USER:?}" "${PROBE_DOMAIN:?}" "${PROBE_INSTANCE:?}"
: "${AMR_DOMAIN:?}" "${ANALYZERS_DOMAIN:?}" "${PHRASES_DOMAIN:?}" "${GRIST_DOMAIN:?}"
CONTAINER="${CONTAINER:-oe-edge-router}"
SERVICE="${SERVICE:-router}"
PROBE_ATTEMPTS="${PROBE_ATTEMPTS:-30}"
PROBE_DELAY="${PROBE_DELAY:-2}"

label() {
  docker inspect -f "{{index .Config.Labels \"$1\"}}" "$CONTAINER" 2>/dev/null || true
}

project="$(label com.docker.compose.project)"
workdir="$(label com.docker.compose.project.working_dir)"
config_files="$(label com.docker.compose.project.config_files)"
if [ -z "$project" ] || [ ! -d "$workdir" ]; then
  echo "could not resolve the running router Compose project" >&2
  exit 1
fi

# Checked before the split rather than after: an empty list would leave Compose
# to infer the file from the working directory, which is the guess this exists to
# avoid — and expanding an empty array under `set -u` is itself an error on
# older bash.
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
# --no-deps so this stays the router; --force-recreate because the image does not
# change when only the mounted template did, and without it Compose sees nothing
# to do and the old configuration keeps serving.
# `sudo … env VAR=…` rather than a --preserve-env flag: sudo drops the
# environment by default, and this form says what is being handed across without
# depending on which sudo is installed.
sudo -u "$REMOTE_USER" env \
  AMR_DOMAIN="$AMR_DOMAIN" \
  ANALYZERS_DOMAIN="$ANALYZERS_DOMAIN" \
  PHRASES_DOMAIN="$PHRASES_DOMAIN" \
  GRIST_DOMAIN="$GRIST_DOMAIN" \
  docker compose -p "$project" "${compose_args[@]}" \
  up -d --no-deps --force-recreate --build "$SERVICE"

# The entrypoint runs `nginx -t` and the container will not come up on a bad
# configuration, so this waits for it to answer at all before asking what it
# knows about.
body="$(mktemp)"
trap 'rm -f "$body"' EXIT
code=000
for _ in $(seq 1 "$PROBE_ATTEMPTS"); do
  # `|| true`, not `|| echo 000`: curl already writes 000 through -w when it
  # cannot connect, so echoing another one made the value "000000" — which is not
  # equal to 000, so the retry below broke out on the first attempt and reported
  # a working reload as an unexpected status. The router simply had not finished
  # binding 443 yet.
  code="$(curl -sSk -o "$body" -w '%{http_code}' --max-time 10 \
    -X POST -H 'Content-Type: application/json' -d '{"answers":[]}' \
    "https://$PROBE_DOMAIN/__review/uat-$PROBE_INSTANCE/submissions" 2>/dev/null || true)"
  [ "$code" = 000 ] || break
  sleep "$PROBE_DELAY"
done

# 400 and 501 both come from the checklist service — an empty review, or a
# deployment with no backend configured for that instance. Either proves the
# route reached it. A 404 is nginx with no such location, which is exactly the
# state this script exists to leave behind.
case "$code" in
  400 | 501) ;;
  404)
    echo "router reloaded but /__review/uat-$PROBE_INSTANCE/submissions is still a 404" >&2
    exit 1
    ;;
  *)
    echo "unexpected $code from the submissions route:" >&2
    head -c 400 "$body" >&2
    echo >&2
    exit 1
    ;;
esac
echo "router reloaded; submissions route answering ($code)"
