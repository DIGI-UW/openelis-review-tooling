#!/usr/bin/env bash
# Build the deployment bundle for one OpenELIS-Global-2 commit, from a clone
# that has that commit:
#
#   make-bundle.sh <oe2-repo> <commit> <out.tgz>
#
# The bundle holds the commit's deployment files and its Bridge profiles at
# the submodule pin, the same set publish-images.yml ships to testing.
set -euo pipefail

REPO="${1:?OpenELIS-Global-2 clone}"
COMMIT="$(git -C "$REPO" rev-parse --verify "${2:?commit}^{commit}")"
OUT="$(cd "$(dirname "${3:?out.tgz}")" && pwd)/$(basename "$3")"
PROFILES=src/main/resources/analyzer-profiles

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git -C "$REPO" archive "$COMMIT" docker-compose.yml docker-compose.analyzers.yml volume \
  projects/analyzer-harness/seed-analyzers.sh projects/analyzer-harness/dictionary | tar -x -C "$work"
mkdir -p "$work/volume/lucene"

for submodule in tools/openelis-analyzer-bridge tools/analyzer-mock-server; do
  pin="$(git -C "$REPO" ls-tree "$COMMIT" "$submodule" | awk '{print $3}')"
  [[ -n "$pin" ]] || { printf 'no submodule pin for %s at %s\n' "$submodule" "$COMMIT" >&2; exit 1; }
  mkdir -p "$work/$submodule"
  printf '%s\n' "$pin" > "$work/$submodule/PIN"
done
bridge_pin="$(cat "$work/tools/openelis-analyzer-bridge/PIN")"
git init -q "$work/bridge"
git -C "$work/bridge" fetch -q --depth 1 --filter=blob:none https://github.com/DIGI-UW/openelis-analyzer-bridge.git "$bridge_pin"
git -C "$work/bridge" checkout -q FETCH_HEAD -- "$PROFILES"
mkdir -p "$work/tools/openelis-analyzer-bridge/$(dirname "$PROFILES")"
mv "$work/bridge/$PROFILES" "$work/tools/openelis-analyzer-bridge/$PROFILES"
rm -rf "$work/bridge"

# No AppleDouble (._*) entries: the mock reads every *.json in the profiles directory.
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$OUT" -C "$work" docker-compose.yml docker-compose.analyzers.yml volume projects tools
printf '%s %s\n' "$COMMIT" "$OUT"
