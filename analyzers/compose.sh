#!/usr/bin/env bash
# Compose for the analyzers.openelis-global.org stack, run on the host.
#
# The site directory holds the deployed release of OpenELIS-Global-2's
# deployment files under releases/<sha> (site-deploy.sh puts it there and
# points `release` at it), the site overlay, and the private .env.
set -euo pipefail

site="${OE_ANALYZERS_SITE:-/opt/oe-analyzers-site}"
release="$site/release"
[[ -d "$release" ]] || { printf 'No deployed release at %s\n' "$release" >&2; exit 1; }
[[ -f "$site/.env" ]] || { printf 'Missing private environment file %s\n' "$site/.env" >&2; exit 1; }

exec docker compose \
  --env-file "$site/.env" \
  --project-name oe-analyzers \
  --project-directory "$release" \
  -f "$release/docker-compose.yml" \
  -f "$release/docker-compose.analyzers.yml" \
  -f "$site/docker-compose.site.yml" \
  "$@"
