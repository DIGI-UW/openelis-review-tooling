#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo ">> shell syntax"
while IFS= read -r file; do
  bash -n "$file"
done < <(find . -type f -name '*.sh' -not -path './.git/*' | sort)

echo ">> JavaScript syntax"
while IFS= read -r file; do
  node --check "$file"
done < <(find . -type f \( -name '*.js' -o -name '*.mjs' \) \
  -not -path './.git/*' -not -path './node_modules/*' | sort)

echo ">> repository contract tests"
node --test tests/*.test.mjs

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo ">> Compose models"
  AMR_DOMAIN=amr.example.test \
    ANALYZERS_DOMAIN=analyzers.example.test \
    GRIST_DOMAIN=grist.example.test \
    docker compose -f router/docker-compose.router.yml config --quiet
  DEX_GRIST_CLIENT_SECRET=fixture-client-secret \
    DEX_REVIEWER_PASSWORD_HASH=fixture-password-hash \
    GRIST_STATE_DIR=/tmp/openelis-review-tooling-state \
    docker compose -f grist/docker-compose.grist.yml config --quiet
else
  echo "!! Docker Compose unavailable; skipped Compose model validation" >&2
fi

echo ">> all checks passed"
