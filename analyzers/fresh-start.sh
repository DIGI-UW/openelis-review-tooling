#!/usr/bin/env bash
# Start the analyzers.openelis-global.org stack over from nothing but the
# private .env: no database, Bridge state, catalog uploads or search index.
#
#   fresh-start.sh <app-sha> <bundle.tgz> [bundle-sha]
set -euo pipefail

APP_SHA="${1:?app sha}"
SITE="${OE_ANALYZERS_SITE:-/opt/oe-analyzers-site}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -d "$SITE/release" ]]; then
  "$HERE/compose.sh" down -v
fi
rm -rf "$SITE/release" "$SITE/releases/$APP_SHA"
sudo rm -rf "$SITE/configuration/backend" "$SITE/lucene"
exec "$HERE/site-deploy.sh" "$@"
