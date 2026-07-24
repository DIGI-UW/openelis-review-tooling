#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
STATE_DIR="${GRIST_STATE_DIR:-/home/ubuntu/oe-grist}"
GRIST_VOL="${GRIST_VOL:-oe-grist_grist-data}"
GRIST_ADMIN_EMAIL="${GRIST_ADMIN_EMAIL:-admin@openelis-global.org}"
NODE_IMG="${NODE_IMG:-node:22-alpine}"
KEYFILE="$STATE_DIR/.api-key"
TOKENS_FILE="$STATE_DIR/mcp-tokens.json"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  STATE_DIR="${GRIST_STATE_DIR:-$STATE_DIR}"
  KEYFILE="$STATE_DIR/.api-key"
  TOKENS_FILE="$STATE_DIR/mcp-tokens.json"
fi

compose() {
  local args=(-p oe-grist -f "$HERE/docker-compose.grist.yml")
  if [ -f "$ENV_FILE" ]; then
    args=(--env-file "$ENV_FILE" "${args[@]}")
  fi
  docker compose "${args[@]}" "$@"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_runtime() {
  command -v docker >/dev/null 2>&1 || die "docker is required"
  docker compose version >/dev/null 2>&1 || die "docker compose is required"
}

require_secrets() {
  [ -f "$ENV_FILE" ] || die "$ENV_FILE is missing; copy .env.example and replace its placeholders"
  case "${DEX_GRIST_CLIENT_SECRET:-}" in
    ""|replace-*) die "DEX_GRIST_CLIENT_SECRET must be set to a real runtime secret" ;;
  esac
  case "${DEX_REVIEWER_PASSWORD_HASH:-}" in
    ""|replace-*) die "DEX_REVIEWER_PASSWORD_HASH must be set to a bcrypt hash" ;;
  esac
}

sqlite() {
  docker run --rm -v "$GRIST_VOL:/persist" alpine:3.20 sh -c \
    "apk add -q sqlite >/dev/null && sqlite3 /persist/home.sqlite3 \"$1\""
}

wait_for_grist_db() {
  local attempt
  for attempt in $(seq 1 60); do
    if docker run --rm -v "$GRIST_VOL:/persist" alpine:3.20 \
      test -s /persist/home.sqlite3 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  die "Grist did not initialize home.sqlite3 within 120 seconds"
}

ensure_api_key() {
  local user_id key
  [ -s "$KEYFILE" ] && return 0

  user_id="$(sqlite "SELECT user_id FROM logins WHERE email='$GRIST_ADMIN_EMAIL' LIMIT 1;" || true)"
  [ -n "$user_id" ] || die "Grist admin login $GRIST_ADMIN_EMAIL was not initialized"

  key="$(openssl rand -hex 24)"
  sqlite "UPDATE users SET api_key='$key' WHERE id=$user_id;" >/dev/null
  umask 077
  printf '%s\n' "$key" > "$KEYFILE"
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
  require_secrets

  install -d -m 700 "$STATE_DIR"
  if [ ! -f "$TOKENS_FILE" ]; then
    umask 077
    printf '[]\n' > "$TOKENS_FILE"
  fi

  docker network inspect oe-edge >/dev/null 2>&1 || docker network create oe-edge >/dev/null
  docker volume inspect "$GRIST_VOL" >/dev/null 2>&1 || docker volume create "$GRIST_VOL" >/dev/null
  docker run --rm -v "$GRIST_VOL:/persist" alpine:3.20 sh -c \
    'printf "%s\n" "{\"version\":\"1\",\"edition\":\"enterprise\"}" > /persist/config.json'

  echo ">> starting Grist, Dex, and Redis"
  compose up -d grist dex redis
  wait_for_grist_db
  ensure_api_key

  echo ">> starting the live-read adapter"
  compose up -d --build mcp
  echo ">> Grist stack is up; checklist edits are live without a publish step"
}

cmd_status() {
  require_runtime
  compose ps
}

cmd_seed_examples() {
  [ "${1:-}" = "--replace-all" ] ||
    die "seed-examples replaces every UAT_Meta/UAT_Steps row; re-run with --replace-all"
  cmd_up

  cp "$HERE/grist-sync.mjs" "$STATE_DIR/grist-sync.mjs"
  docker run --rm --network oe-edge --user "$(id -u):$(id -g)" \
    -v "$STATE_DIR:/work" \
    -v "$ROOT/widget/examples:/review:ro" \
    -e GRIST_KEY="$(cat "$KEYFILE")" \
    -e GRIST_URL=http://grist:8484 \
    -e REVIEW_DIR=/review \
    "$NODE_IMG" node /work/grist-sync.mjs seed
}

main() {
  case "${1:-help}" in
    validate) cmd_validate ;;
    up) cmd_up ;;
    status) cmd_status ;;
    seed-examples)
      shift
      cmd_seed_examples "$@"
      ;;
    help|-h|--help)
      cat <<'USAGE'
Usage:
  ./grist/bootstrap.sh validate
  ./grist/bootstrap.sh up
  ./grist/bootstrap.sh status
  ./grist/bootstrap.sh seed-examples --replace-all
USAGE
      ;;
    *) die "unknown command '$1'" ;;
  esac
}

main "$@"
