#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${GRIST_STATE_DIR:-${STATE_DIR:-/home/ubuntu/oe-grist}}"
SECRET_FILE="$STATE_DIR/.env"
incoming_client_secret="${DEX_GRIST_CLIENT_SECRET:-}"
incoming_password_hash="${DEX_REVIEWER_PASSWORD_HASH:-}"

mkdir -p "$STATE_DIR"

if [ -f "$SECRET_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$SECRET_FILE"
  set +a
fi

DEX_GRIST_CLIENT_SECRET="${DEX_GRIST_CLIENT_SECRET:-$incoming_client_secret}"
DEX_REVIEWER_PASSWORD_HASH="${DEX_REVIEWER_PASSWORD_HASH:-$incoming_password_hash}"

if { [ -z "$DEX_GRIST_CLIENT_SECRET" ] || [ -z "$DEX_REVIEWER_PASSWORD_HASH" ]; } \
    && command -v docker >/dev/null 2>&1; then
  container_env="$(
    docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' oe-grist-dex 2>/dev/null || true
  )"
  if [ -z "$DEX_GRIST_CLIENT_SECRET" ]; then
    DEX_GRIST_CLIENT_SECRET="$(
      printf '%s\n' "$container_env" | sed -n 's/^DEX_GRIST_CLIENT_SECRET=//p' | tail -1
    )"
  fi
  if [ -z "$DEX_REVIEWER_PASSWORD_HASH" ]; then
    DEX_REVIEWER_PASSWORD_HASH="$(
      printf '%s\n' "$container_env" | sed -n 's/^DEX_REVIEWER_PASSWORD_HASH=//p' | tail -1
    )"
  fi
fi

: "${DEX_GRIST_CLIENT_SECRET:?missing Grist OIDC client secret}"
: "${DEX_REVIEWER_PASSWORD_HASH:?missing reviewer password hash}"

umask 077
{
  printf 'DEX_GRIST_CLIENT_SECRET=%q\n' "$DEX_GRIST_CLIENT_SECRET"
  printf 'DEX_REVIEWER_PASSWORD_HASH=%q\n' "$DEX_REVIEWER_PASSWORD_HASH"
} > "$SECRET_FILE.tmp"
mv "$SECRET_FILE.tmp" "$SECRET_FILE"

export DEX_GRIST_CLIENT_SECRET DEX_REVIEWER_PASSWORD_HASH
