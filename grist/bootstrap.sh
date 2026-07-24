#!/usr/bin/env bash
set -euo pipefail
# Reproducible Grist bootstrap — run on the box (as the ubuntu owner).
# Brings Grist up, mints a headless API key, migrates the UAT schema, and seeds
# only instances that do not already exist. Routine runs never clear authored
# rows. Use `seed-force` only for an intentional replacement.
#
#   bash bootstrap.sh             # up + migrate + seed missing instances
#   bash bootstrap.sh generate    # Grist -> widget/examples/uat-*.json
#   bash bootstrap.sh seed-force  # explicitly replace committed instances

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REVIEW_DIR="${REVIEW_DIR:-$HERE/../widget/examples}"
STATE_DIR="${STATE_DIR:-/home/ubuntu/oe-grist}"
GRIST_VOL="${GRIST_VOL:-oe-grist_grist-data}"
GRIST_ADMIN_EMAIL="${GRIST_ADMIN_EMAIL:-admin@openelis-global.org}"
NODE_IMG=node:22-alpine
KEYFILE="$STATE_DIR/.api-key"
mkdir -p "$STATE_DIR"

run_node() {
  docker run --rm --network oe-edge --user "$(id -u):$(id -g)" \
    -v "$STATE_DIR":/work -v "$REVIEW_DIR":/review \
    -e GRIST_KEY="$(cat "$KEYFILE")" -e GRIST_URL=http://grist:8484 -e REVIEW_DIR=/review \
    "$NODE_IMG" node /work/grist-sync.mjs "$@"
}
sqlite() { docker run --rm -v "$GRIST_VOL":/persist alpine sh -c "apk add -q sqlite; sqlite3 /persist/home.sqlite3 \"$1\""; }

# copy the sync script into the state dir (node container mounts it)
cp "$HERE/grist-sync.mjs" "$STATE_DIR/grist-sync.mjs"
mkdir -p "$STATE_DIR/mcp"
cp "$HERE/mcp/uat-document.mjs" "$STATE_DIR/mcp/uat-document.mjs"

echo ">> grist up"
docker compose -p oe-grist -f "$HERE/docker-compose.grist.yml" up -d >/dev/null
for i in $(seq 1 30); do
  docker exec oe-edge-router sh -c 'wget -qO- --timeout=3 http://grist:8484/status >/dev/null 2>&1' && break
  sleep 3
done

if [ "${1:-bootstrap}" = "generate" ]; then
  run_node generate
  exit 0
fi

# Mint an API key on the admin user if it doesn't have one yet (headless: no UI).
if [ ! -s "$KEYFILE" ]; then
  KEY="$(openssl rand -hex 24)"
  sqlite "UPDATE users SET api_key='$KEY' WHERE id=(SELECT user_id FROM logins WHERE email='$GRIST_ADMIN_EMAIL');" >/dev/null
  umask 077; echo "$KEY" > "$KEYFILE"
  echo ">> minted API key for $GRIST_ADMIN_EMAIL"
fi

echo ">> migrate UAT schema without clearing authored rows"
run_node migrate
echo ">> seed missing UAT instances from $REVIEW_DIR"
if [ "${1:-bootstrap}" = "seed-force" ]; then
  run_node seed --force
else
  run_node seed
fi
echo ">> done. Author via Grist UI or native /api/mcp"
