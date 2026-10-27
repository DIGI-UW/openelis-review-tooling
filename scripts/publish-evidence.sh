#!/usr/bin/env bash
#
# Publishes one evidence package (the output of evidence/package.mjs) to a review
# host as runtime/evidence/<site>/<release-id>/ and rebuilds that site's index
# from runtime/evidence/<site>/releases.json. A published release is never
# overwritten; the index and the release list are replaced atomically.
#
# Usage:
#   scripts/publish-evidence.sh --site amr --package <dir> --id <yyyy-mm-dd-label> \
#     [--host <ssh host>] [--root <evidence root on the host>]
#
# --host defaults to amr; --root to /opt/oe-review-tooling/runtime/evidence.
# --host local publishes under --root on this machine.
set -euo pipefail

SITE=""
PACKAGE=""
ID=""
HOST="amr"
ROOT="/opt/oe-review-tooling/runtime/evidence"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --site) SITE="$2"; shift 2 ;;
    --package) PACKAGE="$2"; shift 2 ;;
    --id) ID="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --root) ROOT="$2"; shift 2 ;;
    *) echo "[publish-evidence] unknown argument: $1" >&2; exit 2 ;;
  esac
done

fail() { echo "[publish-evidence] $*" >&2; exit 1; }

if [ -z "$SITE" ] || [ -z "$PACKAGE" ] || [ -z "$ID" ]; then
  fail "--site, --package and --id are required"
fi
[[ "$SITE" =~ ^[a-z0-9-]+$ ]] || fail "site $SITE is not a plain name"
[ -f "$REPO/evidence/sites/$SITE.json" ] || fail "no site configuration evidence/sites/$SITE.json"
[[ "$ID" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9][a-z0-9.-]*$ ]] ||
  fail "release id $ID must be <yyyy-mm-dd>-<label> in lowercase"
for file in index.json index.html release.json; do
  [ -f "$PACKAGE/$file" ] || fail "$PACKAGE has no $file; package it with evidence/package.mjs --release"
done
find "$PACKAGE" -name '*.mp4' -print -quit | grep -q . || fail "$PACKAGE has no videos"

SITE_DIR="$ROOT/$SITE"

on_host() {
  if [ "$HOST" = local ]; then
    bash -c "$1"
  else
    # shellcheck disable=SC2029 # The command is built here on purpose; values are validated above.
    ssh -o BatchMode=yes "$HOST" "sudo -n bash -c $(printf '%q' "$1")"
  fi
}

# Copies a local directory's contents into a new directory on the host.
copy_dir() {
  local from="$1" to="$2"
  if [ "$HOST" = local ]; then
    mkdir -p "$to"
    cp -R "$from"/. "$to"/
  else
    # COPYFILE_DISABLE and --no-xattrs keep macOS metadata out of the archive.
    COPYFILE_DISABLE=1 tar --no-xattrs --exclude="._*" -C "$from" -cf - . | ssh -o BatchMode=yes "$HOST" \
      "sudo -n mkdir -p $(printf '%q' "$to") && sudo -n tar --no-same-owner -C $(printf '%q' "$to") -xf -"
  fi
}

copy_file() {
  local from="$1" to="$2"
  if [ "$HOST" = local ]; then
    cp "$from" "$to"
  else
    ssh -o BatchMode=yes "$HOST" "sudo -n tee $(printf '%q' "$to") >/dev/null" <"$from"
  fi
}

q() { printf '%q' "$1"; }

on_host "test ! -e $(q "$SITE_DIR/$ID")" || fail "release $SITE/$ID is already published"
on_host "test -f $(q "$SITE_DIR/releases.json")" ||
  fail "$SITE_DIR/releases.json is missing; create it with the site's earlier releases first"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
on_host "cat $(q "$SITE_DIR/releases.json")" >"$work/releases.json"
node "$REPO/evidence/releases.mjs" --site "$SITE" --releases "$work/releases.json" \
  --id "$ID" --release "$PACKAGE/release.json" \
  --out-releases "$work/releases.next.json" --out-index "$work/index.next.html"

partial="$SITE_DIR/.$ID.partial"
on_host "rm -rf $(q "$partial")"
copy_dir "$PACKAGE" "$partial"
on_host "chmod -R a+rX $(q "$partial") && mv $(q "$partial") $(q "$SITE_DIR/$ID")"

copy_file "$work/releases.next.json" "$SITE_DIR/.releases.json.next"
copy_file "$work/index.next.html" "$SITE_DIR/.index.html.next"
on_host "chmod a+r $(q "$SITE_DIR/.releases.json.next") $(q "$SITE_DIR/.index.html.next") &&
  mv $(q "$SITE_DIR/.releases.json.next") $(q "$SITE_DIR/releases.json") &&
  mv $(q "$SITE_DIR/.index.html.next") $(q "$SITE_DIR/index.html")"

echo "[publish-evidence] published $SITE/$ID"
