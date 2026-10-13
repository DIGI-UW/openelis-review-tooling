#!/usr/bin/env bash
# Deploy one OpenELIS-Global-2 commit's published-image analyzer stack to
# analyzers.openelis-global.org. Runs on the host as the Docker user.
#
#   site-deploy.sh <app-sha> <bundle.tgz> [bundle-sha]
#
# The bundle is the commit's deployment files: docker-compose.yml,
# docker-compose.analyzers.yml, volume/, projects/analyzer-harness/
# (seed-analyzers.sh and dictionary/), and the Bridge profiles at the
# commit's submodule pin under tools/openelis-analyzer-bridge/. README.md
# says how to build it. The app sha names the commit the images were built
# from; a bundle built from a later commit of the same stack, differing only
# in deployment files, names itself with the third argument.
#
# Cutover is a separate, explicit step (README.md): this script refuses to
# start while another project publishes the router aliases.
set -euo pipefail

APP_SHA="${1:?app sha}"
BUNDLE="${2:?bundle.tgz}"
BUNDLE_SHA="${3:-$APP_SHA}"
# The branch the app commit is on, named in the ready target for the review widget.
APP_BRANCH="${APP_BRANCH:-develop}"
SITE="${OE_ANALYZERS_SITE:-/opt/oe-analyzers-site}"
EDGE_DIR="${EDGE_DIR:-/opt/oe-review-tooling}"
DOMAIN="${ANALYZERS_DOMAIN:-analyzers.openelis-global.org}"
MOCK_URL="${MOCK_URL:-http://127.0.0.1:8085}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="$HERE/compose.sh"
RELEASE="$SITE/releases/$APP_SHA"
TARGET_FILE="$EDGE_DIR/runtime/target-analyzers.json"
DEPLOYMENT_ID="$(date -u +%Y%m%dT%H%M%SZ)-${APP_SHA:0:8}"

log() { printf '>> %s\n' "$*"; }
die() { printf '!! %s\n' "$*" >&2; exit 1; }

[[ "$APP_SHA" =~ ^[0-9a-f]{40}$ ]] || die "app sha must be a full commit hash"
[[ -f "$BUNDLE" ]] || die "bundle $BUNDLE not found"
[[ -f "$SITE/docker-compose.site.yml" ]] || die "copy docker-compose.site.yml to $SITE first"

# --- release files -----------------------------------------------------------
mkdir -p "$SITE/releases" "$SITE/lucene" "$SITE/configuration/backend"
if [[ ! -d "$RELEASE" ]]; then
  staging="$(mktemp -d "$SITE/releases/.unpack.XXXXXX")"
  tar -xzf "$BUNDLE" -C "$staging"
  for f in docker-compose.yml docker-compose.analyzers.yml volume/properties/common.properties \
           projects/analyzer-harness/seed-analyzers.sh projects/analyzer-harness/dictionary \
           tools/openelis-analyzer-bridge/src/main/resources/analyzer-profiles; do
    [[ -e "$staging/$f" ]] || die "bundle is missing $f"
  done
  # Runtime state the site owns across releases: the search index, the catalog
  # directory Catalog Import writes to, and the private environment.
  rm -rf "$staging/volume/lucene" "$staging/configuration"
  ln -s "$SITE/lucene" "$staging/volume/lucene"
  ln -s "$SITE/configuration" "$staging/configuration"
  ln -s "$SITE/.env" "$staging/.env"
  mv "$staging" "$RELEASE"
  log "unpacked release $APP_SHA"
fi

# The harness dictionary is the site's catalog, loaded by OpenELIS's
# configuration service at startup; a file Catalog Import wrote is kept.
if [[ -z "$(ls -A "$SITE/configuration/backend")" ]]; then
  cp -R "$RELEASE/projects/analyzer-harness/dictionary/." "$SITE/configuration/backend/"
  sudo chown -R 8443:8443 "$SITE/configuration/backend"
  log "seeded configuration/backend from the harness dictionary"
fi

# --- private environment -----------------------------------------------------
if [[ ! -f "$SITE/.env" ]]; then
  (umask 077; cat > "$SITE/.env" <<EOF
TZ=UTC
ASTM_SIMULATOR_HTTP_PORT=${MOCK_URL##*:}
TEST_USER=admin
TEST_PASS=adminADMIN!
DEV_STACK_TLS=letsencrypt
EOF
  )
fi
if ! grep -q '^ANALYZER_BRIDGE_PAIRING_CODE=.\+' "$SITE/.env"; then
  printf 'ANALYZER_BRIDGE_PAIRING_CODE=%s\n' "$(openssl rand -hex 16)" >> "$SITE/.env"
  log "generated the Bridge pairing code"
fi
chmod 600 "$SITE/.env"
ln -sfn "$RELEASE" "$SITE/release"

# --- the router aliases belong to one project at a time ----------------------
others="$(docker ps --filter network=oe-edge --format '{{.Names}}' | grep -E '^(madagascar-|analyzers-)' || true)"
[[ -z "$others" ]] || die "stop the project publishing the analyzers aliases first (README.md, Cutover): $others"

# --- start -------------------------------------------------------------------
"$COMPOSE" config --quiet
"$COMPOSE" pull --quiet
"$COMPOSE" up -d --no-build
log "waiting for OpenELIS at https://$DOMAIN"
for _ in $(seq 1 90); do
  if curl -fsS --max-time 10 "https://$DOMAIN/api/OpenELIS-Global/health" >/dev/null 2>&1; then
    break
  fi
  sleep 10
done
curl -fsS --max-time 10 "https://$DOMAIN/api/OpenELIS-Global/health" >/dev/null || die "OpenELIS did not become ready; see $COMPOSE logs"
log "OpenELIS is ready"

# --- analyzers set up as an operator would -----------------------------------
set -a; . "$SITE/.env"; set +a
BASE_URL="https://$DOMAIN" MOCK_URL="$MOCK_URL" DEV_STACK_TLS=letsencrypt \
  bash "$RELEASE/projects/analyzer-harness/seed-analyzers.sh" --ensure-connections --no-mock-network

# --- one result per protocol reaches review ----------------------------------
python3 - "https://$DOMAIN" "$MOCK_URL" "$TEST_USER" "$TEST_PASS" "$DEPLOYMENT_ID" <<'PY'
import base64, json, sys, time, urllib.request

base, mock, user, password, deployment = sys.argv[1:]
api = base + "/api/OpenELIS-Global/rest"
auth = "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


def call(method, url, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={
        "Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(request, timeout=60) as response:
        text = response.read().decode()
    return json.loads(text) if text else {}


analyzers = {a["name"]: a["id"] for a in call("GET", f"{api}/analyzer/analyzers", headers={"Authorization": auth})["analyzers"]}
digits = "".join(c for c in deployment if c.isdigit())[-9:]
lanes = [
    ("Cepheid GeneXpert (ASTM Mode)", "/simulate/fixture/genexpert_astm/hivvl/quantified",
     {"destination": "tcp://openelis-analyzer-bridge:12001", "sample_id": f"DEV01{digits}000001", "sender_id": "OE2-TEST-GENEXPERT"}),
    ("Mindray BC-5380", "/simulate/fixture/mindray_bc5380_hl7/cbc/analysis-result",
     {"destination": "mllp://openelis-analyzer-bridge:2575", "sample_id": f"DEV01{digits}000002", "sender_id": "OE2-TEST-BC5380"}),
    ("FluoroCycler XT", "/simulate/file/hain_fluorocycler",
     {"target_dir": "/data/analyzer-imports/fluorocycler-xt/incoming"}),
]
for name, path, body in lanes:
    analyzer_id = analyzers.get(name)
    if analyzer_id is None:
        raise SystemExit(f"{name} is not set up; the seed left it out")
    before = len(call("GET", f"{api}/AnalyzerResults?id={analyzer_id}", headers={"Authorization": auth}).get("resultList", []))
    pushed = call("POST", mock + path, body)
    deadline = time.monotonic() + 180
    while True:
        rows = call("GET", f"{api}/AnalyzerResults?id={analyzer_id}", headers={"Authorization": auth}).get("resultList", [])
        if len(rows) > before:
            print(f"  {name}: {len(rows) - before} new row(s) in review")
            break
        if time.monotonic() > deadline:
            raise SystemExit(f"{name}: nothing reached review within 180s after {pushed}")
        time.sleep(5)
PY

# --- publish the ready target the review widget pins answers to --------------
[[ -f "$TARGET_FILE" ]] && cp "$TARGET_FILE" "$SITE/releases/previous-target-$DEPLOYMENT_ID.json"
bridge_sha="$(cat "$RELEASE/tools/openelis-analyzer-bridge/PIN" 2>/dev/null || echo unknown)"
mock_sha="$(cat "$RELEASE/tools/analyzer-mock-server/PIN" 2>/dev/null || echo unknown)"
tmp="$(mktemp "$EDGE_DIR/runtime/.target-analyzers.XXXXXX")"
python3 - "$tmp" "$DEPLOYMENT_ID" "$APP_SHA" "$BUNDLE_SHA" "$APP_BRANCH" "$bridge_sha" "$mock_sha" "$(git -C "$EDGE_DIR" rev-parse HEAD)" <<'PY'
import datetime, json, sys
path, deployment, app_sha, bundle_sha, app_branch, bridge_sha, mock_sha, harness_sha = sys.argv[1:]
json.dump({
    "instance": "analyzers", "deploymentId": deployment, "state": "ready",
    "appRepo": "https://github.com/DIGI-UW/OpenELIS-Global-2.git",
    "appBranch": app_branch, "appSha": app_sha, "bundleSha": bundle_sha,
    "harnessSha": harness_sha, "deployedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "scope": "full", "schemaAffecting": True,
    "verification": {"health": "passed", "seed": "passed", "astm": "passed", "hl7": "passed", "file": "passed"},
    "bridgeSha": bridge_sha, "mockSha": mock_sha, "profileCatalogSha": bridge_sha,
    "stack": "openelis-published-images",
}, open(path, "w"), indent=1)
PY
chmod 0644 "$tmp"
mv "$tmp" "$TARGET_FILE"
log "deployment $DEPLOYMENT_ID is ready: https://$DOMAIN"
