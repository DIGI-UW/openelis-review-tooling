#!/usr/bin/env bash
set -euo pipefail

# Reproducible Grist lifecycle. Runtime secrets are read from a box-side,
# untracked .env file and are never accepted as command arguments.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
REVIEW_DIR="${REVIEW_DIR:-$ROOT/widget/examples}"
GRIST_VOL="${GRIST_VOL:-oe-grist_grist-data}"
GRIST_ADMIN_EMAIL="${GRIST_ADMIN_EMAIL:-admin@openelis-global.org}"
NODE_IMG="${NODE_IMG:-node:22-alpine}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

STATE_DIR="${GRIST_STATE_DIR:-/home/ubuntu/oe-grist}"
KEYFILE="$STATE_DIR/.api-key"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

compose() {
  local args=(-p oe-grist -f "$HERE/docker-compose.grist.yml")
  if [ -f "$ENV_FILE" ]; then
    args=(--env-file "$ENV_FILE" "${args[@]}")
  fi
  docker compose "${args[@]}" "$@"
}

require_runtime() {
  command -v docker >/dev/null 2>&1 || die "docker is required"
  docker compose version >/dev/null 2>&1 || die "docker compose is required"
}

require_box_config() {
  [ -f "$ENV_FILE" ] ||
    die "$ENV_FILE is missing; provision the box-side Grist/Dex environment first"
  case "${DEX_GRIST_CLIENT_SECRET:-}" in
    "" | replace-*) die "DEX_GRIST_CLIENT_SECRET must be a real runtime secret" ;;
  esac
  case "${DEX_REVIEWER_PASSWORD_HASH:-}" in
    "" | *replace-*) die "DEX_REVIEWER_PASSWORD_HASH must be a real bcrypt hash" ;;
  esac
}

copy_runtime_scripts() {
  cp "$HERE/grist-sync.mjs" "$STATE_DIR/grist-sync.mjs"
  mkdir -p "$STATE_DIR/mcp"
  cp "$HERE/mcp/uat-document.mjs" "$STATE_DIR/mcp/uat-document.mjs"
}

run_node() {
  docker run --rm --network oe-edge --user "$(id -u):$(id -g)" \
    -v "$STATE_DIR:/work" \
    -v "$REVIEW_DIR:/review" \
    -e GRIST_KEY="$(cat "$KEYFILE")" \
    -e GRIST_URL=http://grist:8484 \
    -e REVIEW_DIR=/review \
    "$NODE_IMG" node /work/grist-sync.mjs "$@"
}

sqlite() {
  docker run --rm -v "$GRIST_VOL:/persist" alpine:3.20 sh -c \
    "apk add -q sqlite >/dev/null && sqlite3 /persist/home.sqlite3 \"$1\""
}

wait_for_grist() {
  local _
  for _ in $(seq 1 60); do
    if docker exec oe-edge-grist node -e \
      "fetch('http://127.0.0.1:8484/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  die "Grist did not become ready within 120 seconds"
}

ensure_api_key() {
  local user_id key
  [ -s "$KEYFILE" ] && return 0

  user_id="$(sqlite "SELECT user_id FROM logins WHERE email='$GRIST_ADMIN_EMAIL' LIMIT 1;" || true)"
  [ -n "$user_id" ] || die "Grist admin login $GRIST_ADMIN_EMAIL was not initialized"

  key="$(openssl rand -hex 24)"
  sqlite "UPDATE users SET api_key='$key' WHERE id=$user_id;" >/dev/null
  umask 077
  printf '%s\n' "$key" >"$KEYFILE"
  echo ">> minted the server-side Grist API key"
}

cmd_validate() {
  require_runtime
  compose config --quiet
  echo ">> Grist Compose model is valid"
  echo ">> validation did not contact or mutate the live deployment"
}

cmd_up() {
  require_runtime
  require_box_config
  install -d -m 700 "$STATE_DIR"
  copy_runtime_scripts

  docker network inspect oe-edge >/dev/null 2>&1 ||
    docker network create oe-edge >/dev/null
  docker volume inspect "$GRIST_VOL" >/dev/null 2>&1 ||
    docker volume create "$GRIST_VOL" >/dev/null
  docker run --rm -v "$GRIST_VOL:/persist" alpine:3.20 sh -c \
    'printf "%s\n" "{\"version\":\"1\",\"edition\":\"enterprise\"}" > /persist/config.json'

  echo ">> starting Grist, Dex, and Redis"
  compose up -d grist dex redis
  wait_for_grist
  ensure_api_key

  echo ">> migrating the UAT schema without clearing authored rows"
  run_node migrate
  echo ">> seeding only checklist instances that are not already authored"
  run_node seed

  echo ">> starting the public read-only UAT adapter"
  compose up -d --build uat-read
  echo ">> Grist is up; UI and native MCP edits are live without a publish step"
}

cmd_status() {
  require_runtime
  compose ps
}

cmd_generate() {
  require_runtime
  [ -s "$KEYFILE" ] || die "$KEYFILE is missing; run up first"
  copy_runtime_scripts
  run_node generate
  echo ">> diagnostic export complete; live delivery still reads directly from Grist"
}

cmd_seed_examples() {
  [ "${1:-}" = "--replace-all" ] ||
    die "seed-examples replaces committed checklist instances; re-run with --replace-all"
  cmd_up
  run_node seed --replace-all
}

main() {
  case "${1:-help}" in
    validate) cmd_validate ;;
    up) cmd_up ;;
    status) cmd_status ;;
    generate) cmd_generate ;;
    seed-examples)
      shift
      cmd_seed_examples "$@"
      ;;
    help | -h | --help)
      cat <<'USAGE'
Usage:
  ./grist/bootstrap.sh validate
  ./grist/bootstrap.sh up
  ./grist/bootstrap.sh status
  ./grist/bootstrap.sh generate
  ./grist/bootstrap.sh seed-examples --replace-all
USAGE
      ;;
    *) die "unknown command '$1'" ;;
  esac
}

main "$@"
