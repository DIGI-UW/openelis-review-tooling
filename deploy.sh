#!/usr/bin/env bash
#
# deploy.sh — reproducible lifecycle for the dual-subdomain OpenELIS demo:
#   amr.openelis-global.org        — Microbiology MVP (OGC-782)
#   analyzers.openelis-global.org  — Analyzer Types & Mapping + harness (OGC-1054)
# One host, two isolated stacks behind one umbrella reverse proxy, per-domain LE.
#
# Everything here is idempotent and scripted — no hand-run steps. Config is in
# .env (copy from .env.example). Reuses: the harness's own bootstrap.sh, the
# repo's certbot pattern (generate-certs.sh / certbot-renew.sh), the PR's own
# analyzer + microbiology seed fixtures, and the deploy-vector-demo.sh
# detached-runner-with-polling pattern (from-source builds take 20-40 min).
#
# TRANSPORT: every automated command runs over SSM (aws ssm send-command), not
# SSH. This was an SSH-based script originally; SSH proved unreliable here
# (client egress IP churns between calls, breaking the SG /32 rule mid-poll —
# it once silently masked a build stall as "still building"). SSM needs no SG
# rule, no key, no stable client IP — only a live `aws` session. `connect` is
# the one exception (a human wanting an interactive shell) and still uses SSH.
#
# USAGE
#   ./deploy.sh status              # AWS + all HTTPS endpoints + container states + drift (read-only)
#   ./deploy.sh drift               # is what's RUNNING what's in git? (read-only)
#   ./deploy.sh connect [cmd…]      # SSH shell — interactive only, needs your IP in the SG (see below)
#   ./deploy.sh configure           # install Docker/git, install renew cron (idempotent)
#   ./deploy.sh deploy [--yes]      # build + bring up router + both stacks on self-signed (detached + polled)
#   ./deploy.sh certs               # issue LE certs for both domains (run AFTER DNS resolves to the host)
#   ./deploy.sh seed                # seed reviewable demo data: analyzers (9-device fleet) + a microbiology case
#   ./deploy.sh app deploy amr --ref <sha> --scope frontend|backend|app
#   ./deploy.sh app deploy analyzers --ref <sha> --scope frontend|backend|app
#   ./deploy.sh app status <instance> [--deployment <id>]
#   ./deploy.sh app verify <instance>
#   ./deploy.sh app rollback <instance>
#   ./deploy.sh review deploy --ref <sha> --scope widget|service|all
#   ./deploy.sh data seed amr --fixture microbiology-mvp
#   ./deploy.sh up-to-certs --yes   # configure -> deploy -> certs -> seed
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$HERE/.env" ]; then
  # shellcheck disable=SC1091
  . "$HERE/.env"
else
  echo "!! $HERE/.env missing — copy .env.example to .env and fill it in" >&2
  exit 1
fi

: "${REGION:?}" "${INSTANCE_ID:?}" "${EIP:?}" "${SG_ID:?}" "${OS_USER:?}" "${SSH_KEY:?}"
: "${AMR_DOMAIN:?}" "${ANALYZERS_DOMAIN:?}" "${GRIST_DOMAIN:?}"
: "${AMR_BRANCH:?}" "${ANALYZERS_BRANCH:?}"
: "${EDGE_DIR:?}" "${AMR_DIR:?}" "${ANALYZERS_DIR:?}" "${LETSENCRYPT_EMAIL:?}"
SSH_KEY_EXPANDED="${SSH_KEY/#\~/$HOME}"
# Two repos: this harness (cloned into EDGE_DIR) and the OpenELIS app it builds
# (cloned into AMR_DIR / ANALYZERS_DIR). They are separate checkouts on the host.
HARNESS_REPO="${HARNESS_REPO:-https://github.com/DIGI-UW/openelis-review-tooling.git}"
HARNESS_BRANCH="${HARNESS_BRANCH:-main}"
APP_REPO="${APP_REPO:-https://github.com/DIGI-UW/OpenELIS-Global-2.git}"
ROUTER_SUBDIR="router"
LE_DIR="$EDGE_DIR/$ROUTER_SUBDIR/letsencrypt"
WEBROOT_DIR="$EDGE_DIR/$ROUTER_SUBDIR/certbot"
DEPLOY_TIMEOUT="${DEPLOY_TIMEOUT:-3000}"
REMOTE_RUNNER="/home/$OS_USER/oe-dual-deploy.run.sh"
REMOTE_LOG="/home/$OS_USER/oe-dual-deploy.log"
DONE_MARK="OE_DUAL_DEPLOY_DONE_OK"
# astm-simulator's static analyzer-net IP (docker-compose.analyzer-test.yml IPAM,
# unchanged by the analyzers override — only the "default" network is remapped).
# The host can always reach this directly; it's never published as a host port.
MOCK_URL="${MOCK_URL:-http://172.21.1.100:8080}"

C_I=$'\033[1;36m'; C_W=$'\033[1;33m'; C_E=$'\033[1;31m'; C_0=$'\033[0m'
log()  { printf '%s>> %s%s\n' "$C_I" "$*" "$C_0"; }
warn() { printf '%s!! %s%s\n' "$C_W" "$*" "$C_0" >&2; }
die()  { printf '%s!! %s%s\n' "$C_E" "$*" "$C_0" >&2; exit 1; }

require_aws() { aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1 || die "no AWS session — run 'aws login' first"; }
my_ip() { curl -fsS --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]'; }

# ---- SSM transport: base64-encode the script body (sidesteps all quoting),
# send it, poll for terminal status, print stdout, propagate failure. ----
SSM_POLL_TIMEOUT="${SSM_POLL_TIMEOUT:-600}"
ssm_run() {
  local script="$1" b64 cmdid status deadline
  b64="$(printf '%s' "$script" | base64 | tr -d '\n')"
  cmdid="$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters "commands=[\"tmp=\$(mktemp /tmp/deploy-cmd.XXXXXX) || exit 1; echo $b64 | base64 -d > \$tmp && bash \$tmp; status=\$?; rm -f \$tmp; exit \$status\"]" \
    --query "Command.CommandId" --output text 2>&1)" || { warn "ssm send-command failed: $cmdid"; return 1; }
  deadline=$(( $(date +%s) + SSM_POLL_TIMEOUT ))
  status=InProgress
  while [ "$(date +%s)" -lt "$deadline" ]; do
    status="$(aws ssm get-command-invocation --region "$REGION" --command-id "$cmdid" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo InProgress)"
    case "$status" in Success|Failed|Cancelled|TimedOut) break ;; esac
    sleep 3
  done
  aws ssm get-command-invocation --region "$REGION" --command-id "$cmdid" --instance-id "$INSTANCE_ID" --query "StandardOutputContent" --output text 2>/dev/null
  if [ "$status" != Success ]; then
    warn "ssm command $status (id $cmdid)"
    aws ssm get-command-invocation --region "$REGION" --command-id "$cmdid" --instance-id "$INSTANCE_ID" --query "StandardErrorContent" --output text 2>&1 >&2 || true
    return 1
  fi
}
# Fire-and-forget: same as ssm_run but does not wait — used to launch the
# detached deploy runner, which we then watch via a separate polling loop.
ssm_fire() {
  local script="$1" b64
  b64="$(printf '%s' "$script" | base64 | tr -d '\n')"
  aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters "commands=[\"tmp=\$(mktemp /tmp/deploy-cmd.XXXXXX) || exit 1; echo $b64 | base64 -d > \$tmp && bash \$tmp; status=\$?; rm -f \$tmp; exit \$status\"]" \
    --query "Command.CommandId" --output text 2>&1
}

# ---- SSH: interactive `connect` only. Needs the caller's current IP allowed
# in the SG (idempotent, same approach deploy-vector-demo.sh uses). ----
allow_ssh_ingress() {
  local ip; ip="$(my_ip)"
  aws ec2 describe-security-groups --region "$REGION" --group-ids "$SG_ID" \
    --query "SecurityGroups[0].IpPermissions[?FromPort==\`22\`].IpRanges[].CidrIp" --output text 2>/dev/null \
    | tr '\t' '\n' | grep -qx "$ip/32" && return
  log "authorizing SSH from $ip/32"
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$ip/32,Description=deploy.sh-connect}]" \
    >/dev/null 2>&1 || warn "ingress authorize failed (may already exist)"
}
SSH_OPTS=(-i "$SSH_KEY_EXPANDED" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o ServerAliveInterval=30)

# ---- the on-box deploy runner (heredoc; local vars interpolate here, \$(...) runs remote) ----
_runner_script() {
  cat <<RUNNER
#!/usr/bin/env bash
set -euo pipefail
exec 9>/var/lock/openelis-review-deploy.lock
flock -n 9 || {
  echo "[deploy] another review-host deployment is already running" >&2
  exit 1
}
echo "[deploy] start \$(date -u)"
REMOTE_USER="$OS_USER"
repo_git() {
  local dir="\$1"
  shift
  sudo -u "\$REMOTE_USER" git -c safe.directory="\$dir" -C "\$dir" "\$@"
}
normalize_runtime_markers() {
  local dir="\$1" marker
  marker="\$dir/volume/plugins/.gitignore"
  if [ -f "\$marker" ]; then
    chmod 0644 "\$marker"
  fi
}
sync_checkout() { # dir branch repo
  local dir="\$1" br="\$2" repo="\$3"
  if [ -d "\$dir/.git" ]; then
    sudo chown -R "$OS_USER":"$OS_USER" "\$dir" 2>/dev/null || true
    normalize_runtime_markers "\$dir"
    if ! repo_git "\$dir" diff --quiet || ! repo_git "\$dir" diff --cached --quiet; then
      echo "[deploy] refusing to overwrite tracked changes in \$dir" >&2
      repo_git "\$dir" status --short >&2
      exit 1
    fi
    repo_git "\$dir" fetch --depth 1 origin "\$br"
    repo_git "\$dir" checkout -B "\$br" FETCH_HEAD
  else
    sudo mkdir -p "\$dir" && sudo chown "$OS_USER":"$OS_USER" "\$dir"
    sudo -u "\$REMOTE_USER" git clone --depth 1 --single-branch --branch "\$br" "\$repo" "\$dir"
  fi
  repo_git "\$dir" submodule update --init --depth 1 dataexport plugins tools/openelis-analyzer-bridge tools/analyzer-mock-server \\
    || die "submodule init failed in \$dir (the plugin registry check depends on it)"
  echo "[deploy] \$dir -> \$br @\$(repo_git "\$dir" rev-parse --short HEAD)"
}
prepare_analyzer_plugin_volume() {
  local app_dir="\$1" destination
  destination="\$app_dir/volume/plugins"
  mkdir -p "\$destination"
  find "\$destination" -maxdepth 1 -type f -name '*.jar' -delete
  echo "[deploy] cleared analyzer runtime plugin volume; the app image will seed shipped generic handlers"
}
sync_checkout "$EDGE_DIR" "$HARNESS_BRANCH" "$HARNESS_REPO"
sync_checkout "$AMR_DIR" "$AMR_BRANCH" "$APP_REPO"
sync_checkout "$ANALYZERS_DIR" "$ANALYZERS_BRANCH" "$APP_REPO"
prepare_analyzer_plugin_volume "$ANALYZERS_DIR"
[ -f "$EDGE_DIR/.env" ] || {
  echo "[deploy] $EDGE_DIR/.env is missing; provision box-side Grist/Dex secrets before deployment" >&2
  exit 1
}

docker network create oe-edge 2>/dev/null || true
mkdir -p "$LE_DIR" "$WEBROOT_DIR"
mkdir -p "$EDGE_DIR/runtime"

harness_sha=\$(repo_git "$EDGE_DIR" rev-parse HEAD)
amr_sha=\$(repo_git "$AMR_DIR" rev-parse HEAD)
analyzers_sha=\$(repo_git "$ANALYZERS_DIR" rev-parse HEAD)
deployment_id=\$(date -u +%Y%m%dT%H%M%SZ)-\${harness_sha:0:12}

echo "[deploy] Grist, Dex, Redis, and UAT read service up"
ENV_FILE="$EDGE_DIR/.env" REVIEW_DIR="$EDGE_DIR/widget/examples" \\
  bash "$EDGE_DIR/grist/bootstrap.sh" up

echo "[deploy] router up (self-signed until certs issued)"
cd "$EDGE_DIR/$ROUTER_SUBDIR"
AMR_DOMAIN="$AMR_DOMAIN" ANALYZERS_DOMAIN="$ANALYZERS_DOMAIN" \\
  docker compose -p oe-edge -f docker-compose.router.yml up -d --build

echo "[deploy] amr stack build+up"
cd "$AMR_DIR"
docker compose -p amr -f build.docker-compose.yml \\
  -f "$EDGE_DIR/amr/docker-compose.override.yml" \\
  up -d --build certs db.openelis.org oe.openelis.org fhir.openelis.org frontend.openelis.org

# Build the analyzers webapp FROM SOURCE (like amr), using the harness's CI chain
# (build.docker-compose.yml + base + ci.analyzer-harness.yml) — NOT the dev chain
# (docker-compose.dev.yml), which host-mounts a pre-built target/OpenELIS-Global.war
# and fails ("mount dir onto file") when it's absent. Run from the repo root so the
# ci-harness ./tools/... build contexts resolve.
echo "[deploy] analyzers stack build+up (build-from-source CI harness chain)"
cd "$ANALYZERS_DIR"
mkdir -p projects/analyzer-harness/volume/analyzer-imports
docker compose -p analyzers \\
  -f build.docker-compose.yml \\
  -f projects/analyzer-harness/docker-compose.base.yml \\
  -f .github/ci/ci.analyzer-harness.yml \\
  -f "$EDGE_DIR/analyzers/docker-compose.override.yml" \\
  up -d --build certs db.openelis.org oe.openelis.org fhir.openelis.org frontend.openelis.org \\
        astm-simulator openelis-analyzer-bridge

echo "[deploy] waiting for both webapps healthy (up to 20 min)"
healthy=false
for i in \$(seq 1 120); do
  a=\$(docker inspect -f '{{.State.Health.Status}}' amr-openelisglobal-webapp 2>/dev/null || echo none)
  n=\$(docker inspect -f '{{.State.Health.Status}}' analyzers-openelisglobal-webapp 2>/dev/null || echo none)
  echo "[deploy]   amr=\$a analyzers=\$n (\$((i*10))s)"
  if [ "\$a" = healthy ] && [ "\$n" = healthy ]; then
    healthy=true
    break
  fi
  sleep 10
done
if [ "\$healthy" != true ]; then
  echo "[deploy] health verification failed; ready deployment metadata was not changed" >&2
  exit 1
fi

verify_analyzer_plugin_registry() {
  local registry
  registry=\$(docker exec analyzers-openelisglobal-database psql -U clinlims -d clinlims -t -A -c \
    "SELECT count(*) || ':' || string_agg(protocol, ',' ORDER BY protocol)
       FROM clinlims.analyzer_type
      WHERE is_active IS TRUE
        AND is_generic_plugin IS TRUE;")
  if [ "\$registry" != "3:ASTM,FILE,HL7" ]; then
    echo "[deploy] expected active generic analyzer registry 3:ASTM,FILE,HL7; found '\$registry'" >&2
    exit 1
  fi
  echo "[deploy] verified active generic analyzer registry: \$registry"
}
verify_analyzer_plugin_registry

publish_target() {
  local instance branch app_sha deployed_at tmp
  instance="\$1"
  branch="\$2"
  app_sha="\$3"
  deployed_at=\$(date -u +%FT%TZ)
  tmp=\$(mktemp "$EDGE_DIR/runtime/.target-\${instance}.XXXXXX")
  cat > "\$tmp" <<TARGETJSON
{"instance":"\$instance","deploymentId":"\$deployment_id","state":"ready","appRepo":"$APP_REPO","appBranch":"\$branch","appSha":"\$app_sha","harnessSha":"\$harness_sha","deployedAt":"\$deployed_at","scope":"full","verification":{"health":"passed"}}
TARGETJSON
  chmod 0644 "\$tmp"
  mv "\$tmp" "$EDGE_DIR/runtime/target-\${instance}.json"
}
publish_target amr "$AMR_BRANCH" "\$amr_sha"
publish_target analyzers "$ANALYZERS_BRANCH" "\$analyzers_sha"
echo "[deploy] published ready target metadata for deployment \$deployment_id"
echo "[deploy] container states:"; docker ps --format '   {{.Names}}: {{.Status}}'
echo "$DONE_MARK \$(date -u)"
RUNNER
}

_poll() {
  local deadline=$(( $(date +%s) + DEPLOY_TIMEOUT )) out
  while [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 45
    out="$(ssm_run "tail -3 '$REMOTE_LOG' 2>/dev/null; echo ---; grep -q '$DONE_MARK' '$REMOTE_LOG' && echo DONE_OK; pgrep -f oe-dual-deploy.run.sh >/dev/null && echo RUNNING || echo STOPPED" 2>/dev/null || echo SSMFAIL)"
    # SSMFAIL must NOT be silently treated as "still building" — it means we
    # lost visibility (e.g. a transient AWS API error), not that the build progressed.
    if [ "$out" = SSMFAIL ]; then warn "SSM unreachable this round — can't read build state; retrying"; continue; fi
    printf '%s\n' "$out" | grep -vE '^(DONE_OK|RUNNING|STOPPED|---)$' | sed 's/^/   /'
    printf '%s' "$out" | grep -q DONE_OK && { log "runner finished"; return 0; }
    printf '%s' "$out" | grep -q STOPPED && { warn "runner stopped without success marker — inspect: ./deploy.sh connect \"tail -60 $REMOTE_LOG\""; return 1; }
    log "still building… (polling 45s, up to ${DEPLOY_TIMEOUT}s)"
  done
  warn "poll deadline reached; VM may still be building — ./deploy.sh connect \"tail -60 $REMOTE_LOG\""; return 1
}

cmd_configure() {
  require_aws
  log "installing Docker + git on the host (idempotent)"
  ssm_run '
    if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sudo sh; sudo usermod -aG docker '"$OS_USER"'; fi
    command -v git >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq git; }
    command -v envsubst >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq gettext-base; }  # bootstrap.sh renders templates
    docker --version; docker compose version | head -1' || die "configure failed"
  log "installing certbot renewal cron"
  ssm_run "sudo tee /etc/cron.d/oe-edge-certbot-renew >/dev/null <<'CRON'
# twice-daily LE renewal for the dual-subdomain demo (installed by deploy.sh)
17 3,15 * * * $OS_USER LETSENCRYPT_DIR=$LE_DIR CERTBOT_WEBROOT=$WEBROOT_DIR ROUTER_CONTAINER_NAME=oe-edge-router bash $EDGE_DIR/scripts/certbot-renew.sh >> /home/$OS_USER/certbot-renew.log 2>&1
CRON" || die "cron install failed"
  log "configure complete — next: ./deploy.sh deploy --yes"
}

cmd_deploy() {
  [ "${1:-}" = "--yes" ] || die "deploy rebuilds both stacks (long). Re-run: ./deploy.sh deploy --yes"
  require_aws
  log "writing detached runner + launching (nohup) — amr=$AMR_BRANCH analyzers=$ANALYZERS_BRANCH"
  ssm_run "cat > '$REMOTE_RUNNER' <<'RUNNEREOF'
$(_runner_script)
RUNNEREOF
chmod +x '$REMOTE_RUNNER'" >/dev/null || die "failed to write runner"
  ssm_run "cd ~ && nohup bash '$REMOTE_RUNNER' > '$REMOTE_LOG' 2>&1 & echo launched pid \$!" || die "failed to launch runner"
  log "polling until both stacks are up (safe to Ctrl-C; box keeps building — resume by re-running deploy, or connect+tail)"
  _poll || die "deploy did not complete cleanly"
  log "STACKS UP (self-signed). Once DNS resolves to $EIP: ./deploy.sh certs, then ./deploy.sh seed"
}

cmd_certs() {
  require_aws
  for d in "$AMR_DOMAIN" "$ANALYZERS_DOMAIN" "$GRIST_DOMAIN"; do
    got="$(dig +short "$d" | tail -1)"
    [ "$got" = "$EIP" ] || warn "DNS: $d -> ${got:-<none>} (expected $EIP) — ACME will fail until this resolves"
  done
  log "issuing certs for all demo domains on the host"
  ssm_run "AMR_DOMAIN=$AMR_DOMAIN ANALYZERS_DOMAIN=$ANALYZERS_DOMAIN GRIST_DOMAIN=$GRIST_DOMAIN LETSENCRYPT_EMAIL=$LETSENCRYPT_EMAIL LETSENCRYPT_STAGING=${LETSENCRYPT_STAGING:-false} LETSENCRYPT_DIR=$LE_DIR CERTBOT_WEBROOT=$WEBROOT_DIR bash $EDGE_DIR/scripts/generate-certs.sh" \
    || die "cert issuance failed"
  cmd_status
}

# Seed reviewable demo data on BOTH instances. Idempotent-ish (each run adds
# fresh, uniquely-suffixed records rather than erroring on conflict):
#   analyzers — the harness's own seed-analyzers.sh (9-device Madagascar fleet:
#               ASTM + HL7/MLLP + FILE, mock networks wired to the bridge)
#   amr       — scripts/seed-microbiology.sh (a bacteriology + sibling TB case,
#               reusing the PR's own test-fixture SQL) so the configured
#               /Microbiology/worklist and case routes have something to review.
cmd_seed() {
  require_aws
  log "seeding analyzers.openelis-global.org (9-device fleet via the harness's own seed script)"
  ssm_run "cd $ANALYZERS_DIR/projects/analyzer-harness && BASE_URL=https://$ANALYZERS_DOMAIN MOCK_URL=$MOCK_URL DB_CONTAINER=analyzers-openelisglobal-database ./seed-analyzers.sh" \
    || warn "analyzer seed failed — see output above"
  log "seeding amr.openelis-global.org (microbiology demo case)"
  ssm_run "cat > /tmp/seed-microbiology.sh <<'SEEDEOF'
$(cat "$HERE/scripts/seed-microbiology.sh")
SEEDEOF
chmod +x /tmp/seed-microbiology.sh
DB_CONTAINER=amr-openelisglobal-database BASE_URL=https://$AMR_DOMAIN /tmp/seed-microbiology.sh" \
    || warn "microbiology seed failed — see output above"
  log "seed complete. Microbiology worklist:"
  log "  https://$AMR_DOMAIN/Microbiology/worklist"
}

validate_instance() {
  case "$1" in
    amr | analyzers) ;;
    *) die "targeted app lifecycle supports instances 'amr' and 'analyzers'" ;;
  esac
}

select_instance_config() {
  validate_instance "$1"
  case "$1" in
    amr)
      SELECTED_APP_DIR="$AMR_DIR"
      SELECTED_APP_BRANCH="$AMR_BRANCH"
      SELECTED_APP_DOMAIN="$AMR_DOMAIN"
      SELECTED_APP_SMOKE_PATH="/Microbiology/worklist"
      ;;
    analyzers)
      SELECTED_APP_DIR="$ANALYZERS_DIR"
      SELECTED_APP_BRANCH="$ANALYZERS_BRANCH"
      SELECTED_APP_DOMAIN="$ANALYZERS_DOMAIN"
      SELECTED_APP_SMOKE_PATH="/analyzers"
      ;;
  esac
}

validate_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die "--ref must be an exact 40-character lowercase Git SHA"
}

validate_scope() {
  case "$1" in frontend|backend|app) ;; *) die "--scope must be frontend, backend, or app" ;; esac
}

cmd_app_deploy() {
  local instance="${1:-}" ref="" scope="" deployment_id deployment_dir remote_runner remote_log
  shift || true
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ref) ref="${2:-}"; shift 2 ;;
      --scope) scope="${2:-}"; shift 2 ;;
      *) die "unknown app deploy argument '$1'" ;;
    esac
  done
  select_instance_config "$instance"
  validate_sha "$ref"
  validate_scope "$scope"
  require_aws

  deployment_id="$(date -u +%Y%m%dT%H%M%SZ)-${ref:0:12}"
  deployment_dir="$EDGE_DIR/runtime/deployments/$deployment_id"
  remote_runner="/home/$OS_USER/oe-app-deploy-$deployment_id.sh"
  remote_log="/home/$OS_USER/oe-app-deploy-$deployment_id.log"
  log "launching targeted $instance $scope deploy at exact SHA $ref"
  ssm_run "mkdir -p '$deployment_dir'
cat > '$remote_runner' <<'RUNNEREOF'
INSTANCE='$instance'
APP_DIR='$SELECTED_APP_DIR'
EDGE_DIR='$EDGE_DIR'
APP_REPO='$APP_REPO'
APP_BRANCH='$SELECTED_APP_BRANCH'
APP_REF='$ref'
APP_SCOPE='$scope'
APP_DOMAIN='$SELECTED_APP_DOMAIN'
APP_SMOKE_PATH='$SELECTED_APP_SMOKE_PATH'
REMOTE_USER='$OS_USER'
DEPLOYMENT_ID='$deployment_id'
DEPLOYMENT_DIR='$deployment_dir'
$(cat "$HERE/scripts/targeted-app-deploy.sh")
RUNNEREOF
chmod 0700 '$remote_runner'
nohup bash '$remote_runner' > '$remote_log' 2>&1 </dev/null &
echo '$deployment_id'" || die "failed to launch targeted deployment"
  log "deployment launched: $deployment_id"
  log "status: ./deploy.sh app status $instance --deployment $deployment_id"
}

cmd_app_status() {
  local instance="${1:-}" deployment_id=""
  shift || true
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --deployment) deployment_id="${2:-}"; shift 2 ;;
      *) die "unknown app status argument '$1'" ;;
    esac
  done
  select_instance_config "$instance"
  require_aws
  ssm_run "deployment_id='$deployment_id'
instance='$instance'
app_container='$instance-openelisglobal-webapp'
running_configs=\$(docker inspect -f '{{index .Config.Labels \"com.docker.compose.project.config_files\"}}' \"\$app_container\" 2>/dev/null || true)
running_override=\$(printf '%s' \"\$running_configs\" | tr ',' '\n' | awk -v instance=\"\$instance\" '\$0 ~ \"/\" instance \"/docker-compose\\\\.override\\\\.yml$\" { print; exit }')
edge_dir='$EDGE_DIR'
[ -z \"\$running_override\" ] || edge_dir=\${running_override%/\$instance/docker-compose.override.yml}
if [ -z \"\$deployment_id\" ]; then
  latest=\$(find \"\$edge_dir/runtime/deployments\" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -1)
  deployment_id=\${latest##*/}
fi
[ -n \"\$deployment_id\" ] || { echo 'no targeted deployments found'; exit 1; }
status=\"\$edge_dir/runtime/deployments/\$deployment_id/status.json\"
log='/home/$OS_USER/oe-app-deploy-'\"\$deployment_id\"'.log'
echo \"deployment=\$deployment_id\"
cat \"\$status\" 2>/dev/null || echo '{\"state\":\"launching\"}'
echo
tail -12 \"\$log\" 2>/dev/null || true"
}

cmd_app_verify() {
  local instance="${1:-}"
  select_instance_config "$instance"
  require_aws
  log "verified target metadata"
  curl -fsSk "https://$SELECTED_APP_DOMAIN/__review/target.json"
  echo
  log "$instance application smoke"
  printf '   / -> HTTP %s\n' "$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 "https://$SELECTED_APP_DOMAIN/")"
  printf '   %s -> HTTP %s\n' "$SELECTED_APP_SMOKE_PATH" \
    "$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 "https://$SELECTED_APP_DOMAIN$SELECTED_APP_SMOKE_PATH")"
  ssm_run "docker inspect -f '{{.Name}}: running={{.State.Running}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}} image={{.Image}} started={{.State.StartedAt}}' \
    '$instance-openelisglobal-webapp' '$instance-openelisglobal-front-end'"
}

cmd_app_rollback() {
  local instance="${1:-}" deployment_id remote_runner
  select_instance_config "$instance"
  require_aws
  deployment_id="$(curl -fsSk "https://$SELECTED_APP_DOMAIN/__review/target.json" |
    sed -n 's/.*"deploymentId":"\([^"]*\)".*/\1/p')"
  [ -n "$deployment_id" ] || die "could not determine current $instance deployment"
  remote_runner="/home/$OS_USER/oe-app-rollback-$deployment_id.sh"
  log "rolling back targeted deployment $deployment_id"
  ssm_run "cat > '$remote_runner' <<'ROLLBACKEOF'
INSTANCE='$instance'
APP_DIR='$SELECTED_APP_DIR'
EDGE_DIR='$EDGE_DIR'
APP_DOMAIN='$SELECTED_APP_DOMAIN'
APP_SMOKE_PATH='$SELECTED_APP_SMOKE_PATH'
DEPLOYMENT_ID='$deployment_id'
DEPLOYMENT_DIR='$EDGE_DIR/runtime/deployments/$deployment_id'
$(cat "$HERE/scripts/targeted-app-rollback.sh")
ROLLBACKEOF
chmod 0700 '$remote_runner'
bash '$remote_runner'" || die "rollback failed"
  cmd_app_verify "$instance"
}

cmd_app() {
  local action="${1:-}"
  shift || true
  case "$action" in
    deploy) cmd_app_deploy "$@" ;;
    status) cmd_app_status "$@" ;;
    verify) cmd_app_verify "$@" ;;
    rollback) cmd_app_rollback "$@" ;;
    *) die "unknown app action '$action' (deploy|status|verify|rollback)" ;;
  esac
}

cmd_review_deploy() {
  local ref="" scope=""
  shift || true
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ref) ref="${2:-}"; shift 2 ;;
      --scope) scope="${2:-}"; shift 2 ;;
      *) die "unknown review deploy argument '$1'" ;;
    esac
  done
  validate_sha "$ref"
  case "$scope" in
    widget | service | all) ;;
    *) die "--scope must be widget, service or all" ;;
  esac
  require_aws
  log "deploying review $scope at exact harness SHA $ref"
  ssm_run "set -euo pipefail
exec 9>/var/lock/openelis-review-deploy.lock
flock -n 9 || { echo 'another review-host deployment is already running' >&2; exit 1; }
router_workdir=\$(docker inspect -f '{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}' oe-edge-router)
edge_dir=\${router_workdir%/router}
repo_git() { sudo -u '$OS_USER' git -c safe.directory=\"\$edge_dir\" -C \"\$edge_dir\" \"\$@\"; }
# The repository metadata, and the files git tracks. Never the whole directory:
# the checkout also holds Let's Encrypt private keys that have no business being
# readable by the application user, and ls-files never names them.
#
# Tracked files matter because the checkout below runs as this user. A file owned
# by root cannot be rewritten, so git leaves the old content in place — and the
# worktree is then dirty forever, which the guard reads as somebody's uncommitted
# work and refuses every later deploy over it.
sudo chown -R '$OS_USER':'$OS_USER' \"\$edge_dir/.git\"
# The directories too, not only the files in them: replacing a file means
# unlinking it, and that is permission on the directory rather than on the file.
# A tracked file inside a root-owned directory cannot be replaced however it is
# owned itself.
#
# cd first: ls-files names paths relative to the repository, and chown resolves
# them against wherever it happens to be running. Untracked directories are never
# named, so the Let's Encrypt material keeps the ownership it has.
(
  cd \"\$edge_dir\"
  repo_git ls-files -z | sudo xargs -0 -r chown '$OS_USER':'$OS_USER'
  repo_git ls-files -z | xargs -0 -r -n1 dirname | sort -u \
    | sudo xargs -r chown '$OS_USER':'$OS_USER'
)
if ! repo_git diff --quiet || ! repo_git diff --cached --quiet; then
  echo \"refusing to overwrite tracked changes in \$edge_dir\" >&2
  repo_git status --short >&2
  exit 1
fi
repo_git fetch --depth 1 origin '$ref'
repo_git checkout --detach FETCH_HEAD
[ \"\$(repo_git rev-parse HEAD)\" = '$ref' ]
grep -q 'attachShadow({ mode: \"open\" })' \"\$edge_dir/widget/oe-review-widget.js\"
for instance in amr analyzers; do
  target=\"\$edge_dir/runtime/target-\$instance.json\"
  [ -f \"\$target\" ] || continue
  tmp=\$(mktemp \"\$edge_dir/runtime/.target-\$instance.XXXXXX\")
  sed 's/\"harnessSha\":\"[^\"]*\"/\"harnessSha\":\"$ref\"/' \"\$target\" > \"\$tmp\"
  chmod 0644 \"\$tmp\"
  mv \"\$tmp\" \"\$target\"
done
scope='$scope'
probe=\$(mktemp)
trap 'rm -f \"\$probe\"' EXIT
if [ \"\$scope\" = widget ] || [ \"\$scope\" = all ]; then
  curl -fsSk 'https://$AMR_DOMAIN/__review/oe-review-widget.js' -o \"\$probe\"
  grep -q 'attachShadow({ mode: \"open\" })' \"\$probe\"
  echo 'review widget ready at $ref'
fi
if [ \"\$scope\" = service ] || [ \"\$scope\" = all ]; then
  # Shipped as a real script rather than inlined here, so it is covered by
  # shellcheck and by tests that actually run it against stubs — a string built
  # inside this heredoc can only ever be grepped.
  cat > /tmp/oe-rebuild-checklist-service.sh <<'SVCEOF'
$(cat "$HERE/scripts/rebuild-checklist-service.sh")
SVCEOF
  chmod +x /tmp/oe-rebuild-checklist-service.sh
  REMOTE_USER='$OS_USER' GRIST_DOMAIN='$GRIST_DOMAIN' /tmp/oe-rebuild-checklist-service.sh
  echo 'checklist service ready at $ref'
fi"
}

cmd_review() {
  local action="${1:-}"
  case "$action" in
    deploy) cmd_review_deploy "$@" ;;
    *) die "unknown review action '$action' (deploy)" ;;
  esac
}

# The document's schema, from the checkout on the box. Reuses the harness's own
# bootstrap, so the runtime that runs is the one the repository ships rather than
# whatever a caller happened to copy over.
cmd_grist_apply() {
  shift || true
  require_aws
  local flags="$*"
  log "applying the Grist schema${flags:+ ($flags)}"
  ssm_run "set -euo pipefail
router_workdir=\$(docker inspect -f '{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}' oe-edge-router)
edge_dir=\${router_workdir%/router}
cd \"\$edge_dir\"
sudo -u '$OS_USER' bash grist/bootstrap.sh apply $flags"
}

cmd_grist() {
  local action="${1:-}"
  case "$action" in
    apply) cmd_grist_apply "$@" ;;
    *) die "unknown grist action '$action' (apply)" ;;
  esac
}

cmd_data_seed() {
  local instance="${1:-}" fixture=""
  shift || true
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --fixture) fixture="${2:-}"; shift 2 ;;
      *) die "unknown data seed argument '$1'" ;;
    esac
  done
  validate_instance "$instance"
  # The only fixture is the AMR microbiology MVP, and the body below targets the
  # amr database and domain unconditionally. Without this guard, asking for
  # 'analyzers' would quietly seed amr instead.
  [ "$instance" = amr ] || die "data seed supports only instance 'amr' (fixture microbiology-mvp)"
  [ "$fixture" = microbiology-mvp ] || die "AMR fixture must be 'microbiology-mvp'"
  require_aws
  log "seeding AMR microbiology MVP fixture only"
  ssm_run "cat > /tmp/seed-microbiology.sh <<'SEEDEOF'
$(cat "$HERE/scripts/seed-microbiology.sh")
SEEDEOF
chmod +x /tmp/seed-microbiology.sh
DB_CONTAINER=amr-openelisglobal-database BASE_URL=https://$AMR_DOMAIN /tmp/seed-microbiology.sh"
}

cmd_data() {
  local action="${1:-}"
  shift || true
  case "$action" in
    seed) cmd_data_seed "$@" ;;
    *) die "unknown data action '$action' (seed)" ;;
  esac
}

cmd_status() {
  require_aws
  log "instance"; aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
    --query "Reservations[0].Instances[0].[State.Name,PublicIpAddress,InstanceType]" --output text | sed 's/^/   /'
  for d in "$AMR_DOMAIN" "$ANALYZERS_DOMAIN" "$GRIST_DOMAIN"; do
    printf '   https://%s/ -> HTTP %s\n' "$d" "$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 "https://$d/" 2>/dev/null || echo 000)"
  done
  echo "   containers:"
  ssm_run "docker ps --format '{{.Names}}: {{.Status}}' | grep -E 'amr-|analyzers-|oe-edge' || true" | sed 's/^/     /' \
    || warn "remote status failed"
  cmd_drift
}

# Compare what is RUNNING against what is in git. A deploy that reuses a cached
# image, a hand edit on the box, or a checkout left behind a merge are all
# invisible otherwise — the read service once served four-commit-old code while
# every container reported healthy and every endpoint returned 200.
cmd_drift() {
  require_aws
  echo "   drift:"
  # Built with a quoted heredoc so nothing expands locally: every $ below is for
  # the remote shell.
  local script
  script="$(cat <<'DRIFT'
cd EDGE_DIR_PLACEHOLDER 2>/dev/null || { echo "checkout missing"; exit 0; }
# SSM runs as root and the fetch below writes loose objects. Fetching as root
# leaves root-owned fanout directories under .git/objects that the deploy path —
# which correctly runs as the checkout's owner — can no longer write into, so a
# read-only drift check would break the next deploy.
G="sudo -u OS_USER_PLACEHOLDER git -c safe.directory=*"
$G fetch -q origin BRANCH_PLACEHOLDER 2>/dev/null || true
head=$($G rev-parse --short HEAD)
want=$($G rev-parse --short FETCH_HEAD 2>/dev/null || echo unknown)
if [ "$head" = "$want" ]; then
  echo "checkout: $head (matches origin/BRANCH_PLACEHOLDER)"
else
  echo "checkout: $head DRIFTED from origin/BRANCH_PLACEHOLDER ($want)"
fi
dirty=$($G status --porcelain | wc -l)
if [ "$dirty" -eq 0 ]; then
  echo "worktree: clean"
else
  echo "worktree: $dirty uncommitted file(s)"
  $G status --porcelain | head -5
fi
# The read service bakes its source into the image, so a deploy that reused a
# cached image looks healthy while serving old code. Compare the two.
img=$(docker exec oe-edge-grist-uat-read md5sum /app/uat-document.mjs 2>/dev/null | cut -d" " -f1)
src=$(md5sum grist/mcp/uat-document.mjs 2>/dev/null | cut -d" " -f1)
if [ -n "$img" ]; then
  if [ "$img" = "$src" ]; then
    echo "uat-read image: matches checkout"
  else
    echo "uat-read image: STALE - rebuild it (compose up -d --build uat-read)"
  fi
fi
DRIFT
)"
  script="${script//EDGE_DIR_PLACEHOLDER/$EDGE_DIR}"
  script="${script//BRANCH_PLACEHOLDER/$HARNESS_BRANCH}"
  script="${script//OS_USER_PLACEHOLDER/$OS_USER}"
  ssm_run "$script" | sed 's/^/     /' || warn "drift check failed"
}

cmd_up_to_certs() { cmd_configure; cmd_deploy "${1:-}"; cmd_certs; cmd_seed; }

main() {
  local sub="${1:-help}"; shift || true
  case "$sub" in
    status) cmd_status ;;
    drift) cmd_drift ;;
    connect)
      allow_ssh_ingress
      # Arguments intentionally expand on the client before the remote command runs.
      # shellcheck disable=SC2029
      if [ "$#" -gt 0 ]; then ssh "${SSH_OPTS[@]}" "$OS_USER@$EIP" "$@"; else ssh -t "${SSH_OPTS[@]}" "$OS_USER@$EIP"; fi ;;
    configure) cmd_configure ;;
    deploy) cmd_deploy "$@" ;;
    certs) cmd_certs ;;
    seed) cmd_seed ;;
    app) cmd_app "$@" ;;
    review) cmd_review "$@" ;;
    data) cmd_data "$@" ;;
    grist) cmd_grist "$@" ;;
    up-to-certs) cmd_up_to_certs "$@" ;;
    help|-h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//' ;;
    *) die "unknown subcommand '$sub' (status|connect|configure|deploy|certs|seed|app|review|data|grist|up-to-certs|help)" ;;
  esac
}
main "$@"
