import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url).pathname;
const deployScript = readFileSync(`${repoRoot}/deploy.sh`, "utf8");
const appDeployScript = readFileSync(
  `${repoRoot}/scripts/targeted-app-deploy.sh`,
  "utf8",
);
const appRollbackScript = readFileSync(
  `${repoRoot}/scripts/targeted-app-rollback.sh`,
  "utf8",
);
const phrasesOverride = readFileSync(
  `${repoRoot}/phrases/docker-compose.override.yml`,
  "utf8",
);

test("AWS preflight rejects a login profile from a different region", () => {
  const requireAws = deployScript.slice(
    deployScript.indexOf("require_aws()"),
    deployScript.indexOf("my_ip()"),
  );
  assert.match(deployScript, /export AWS_PROFILE="\$\{AWS_PROFILE:-default\}"/);
  assert.match(requireAws, /aws configure get region --profile "\$AWS_PROFILE"/);
  assert.match(requireAws, /AWS login refresh is region-bound/);
  assert.match(requireAws, /aws login --profile '\$AWS_PROFILE' --region '\$REGION'/);
  assert.match(deployScript, /AWS credentials could not be refreshed/);
  assert.match(
    deployScript,
    /AWS endpoint is unreachable; the login may still be valid/,
  );
  assert.doesNotMatch(
    deployScript,
    /get-caller-identity[^\n]+>\/dev\/null 2>&1 \|\| die "no AWS session/,
  );
  assert.doesNotMatch(requireAws, /for attempt in 1 2/);
  assert.doesNotMatch(requireAws, /sleep/);
});

test("remote repository operations run as the checkout owner", () => {
  assert.match(
    deployScript,
    /repo_git\(\).*sudo -u "\\?\$REMOTE_USER" git -c safe\.directory=/s,
  );
  assert.doesNotMatch(deployScript, /\bgit -C "\\?\$dir/);
  assert.match(deployScript, /repo_git "\$EDGE_DIR" rev-parse HEAD/);
  assert.match(deployScript, /repo_git "\$ANALYZERS_DIR" rev-parse HEAD/);
});

test("tracked runtime markers are normalized before the dirty-worktree guard", () => {
  const normalizeMarker = deployScript.indexOf(
    'normalize_runtime_markers "\\$dir"',
  );
  const dirtyCheck = deployScript.indexOf(
    'if ! repo_git "\\$dir" diff --quiet',
  );

  assert.match(
    deployScript,
    /chmod 0644 "\\\$marker"/,
    "the tracked plugin marker must retain its repository file mode",
  );
  assert.ok(normalizeMarker > -1, "checkout sync must normalize runtime markers");
  assert.ok(
    dirtyCheck > normalizeMarker,
    "normalization must happen before checking for tracked changes",
  );
});

test("analyzer deployment prepares only the generic runtime plugins", () => {
  assert.match(
    deployScript,
    /submodule update --init --depth 1 dataexport plugins tools\/openelis-analyzer-bridge tools\/analyzer-mock-server/,
  );
  assert.match(
    deployScript,
    /prepare_analyzer_plugin_volume "\$ANALYZERS_DIR"/,
  );
  assert.match(
    deployScript,
    /find "\\\$destination" -maxdepth 1 -type f -name '\*\.jar' -delete/,
  );
  assert.match(
    deployScript,
    /verify_analyzer_plugin_registry/,
  );
  assert.match(
    deployScript,
    /expected active generic analyzer registry 3:ASTM,FILE,HL7/,
  );
});
test("targeted app deployment accepts only an exact SHA and explicit scope", () => {
  assert.match(deployScript, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(deployScript, /--scope must be frontend, backend, or app/);
  assert.match(deployScript, /app deploy amr --ref <sha>/);
  assert.match(deployScript, /app deploy phrases --ref <sha>/);
  assert.match(deployScript, /review deploy --ref <sha> --scope widget/);
  assert.match(
    deployScript,
    /data seed amr --fixture microbiology-mvp --story AMR-S33/,
  );
  assert.match(deployScript, /--story\) stories\+=\("\$\{2:-\}"\)/);
  assert.match(
    deployScript,
    /FIXTURE_STORIES='\$story_values' BASE_URL=https:\/\/\$SELECTED_APP_DOMAIN/,
  );
  assert.match(deployScript, /grist check-access/);
  assert.match(deployScript, /grist\/bootstrap\.sh check-access/);
  assert.match(deployScript, /grist reconcile-access --yes/);
  assert.match(deployScript, /grist\/bootstrap\.sh reconcile-access --yes/);
});

test("targeted app status resolves and validates the requested instance", () => {
  assert.match(
    deployScript,
    /target=.*edge_dir\/runtime\/target-.*instance\.json/,
  );
  assert.match(
    deployScript,
    /target_instance=.*instance.*\n.*target_instance.*=.*instance/s,
  );
  assert.match(
    deployScript,
    /status_instance=.*instance.*\n.*status_instance.*=.*instance/s,
  );
  assert.doesNotMatch(
    deployScript,
    /find \\\"\\\\\$edge_dir\/runtime\/deployments\\\".*sort.*tail -1/,
  );
});

test("targeted app logs use SSM instead of the legacy SSH path", () => {
  assert.match(
    deployScript,
    /app logs <instance> \[--since <duration>\] \[--tail <lines>\] \[--errors\]/,
  );
  assert.match(deployScript, /cmd_app_logs\(\)/);
  const appLogs = deployScript.slice(
    deployScript.indexOf("cmd_app_logs()"),
    deployScript.indexOf("cmd_app_verify()"),
  );
  assert.match(appLogs, /require_aws/);
  assert.match(appLogs, /ssm_run .*docker logs/s);
  assert.match(appLogs, /openELIS\.log/);
  assert.match(appLogs, /error-backup-\*/);
  assert.doesNotMatch(appLogs, /ssh|allow_ssh_ingress/);
});

test("phrases is an isolated first-class OpenELIS review instance", () => {
  assert.match(deployScript, /amr \| analyzers \| phrases/);
  assert.match(deployScript, /SELECTED_APP_DIR="\$PHRASES_DIR"/);
  assert.match(deployScript, /SELECTED_APP_DOMAIN="\$PHRASES_DOMAIN"/);
  assert.match(deployScript, /SELECTED_APP_SMOKE_PATH="\/admin\/MacroLibrary"/);
  assert.match(phrasesOverride, /container_name: phrases-openelisglobal-webapp/);
  assert.match(phrasesOverride, /aliases: \[phrases-oe\]/);
  assert.match(phrasesOverride, /aliases: \[phrases-frontend\]/);
  assert.match(phrasesOverride, /subnet: 172\.26\.1\.0\/24/);
});

test("targeted deployment bootstraps a missing declared instance", () => {
  assert.match(appDeployScript, /\[ -n "\$running_configs" \] \|\| bootstrap=true/);
  assert.match(appDeployScript, /git clone --no-checkout/);
  assert.match(appDeployScript, /build\.docker-compose\.yml/);
  assert.match(appDeployScript, /docker-compose\.override\.yml/);
  assert.match(
    appDeployScript,
    /compose up -d --build certs db\.openelis\.org fhir\.openelis\.org "\$\{services\[@\]\}"/,
  );
  assert.match(
    appDeployScript,
    /bootstrap failed; removing partial containers.*compose down/s,
  );
});

test("targeted app deployment publishes only truthful branch provenance", () => {
  assert.doesNotMatch(appDeployScript, /APP_BRANCH/);
  assert.match(appDeployScript, /ls-remote --heads origin/);
  assert.match(
    appDeployScript,
    /exact SHA \$app_sha is not a unique remote branch head; publishing SHA-only provenance/,
  );
  assert.match(appDeployScript, /"appBranch":"\$published_branch"/);
});

test("targeted app deployment normalizes clean initialized submodules", () => {
  const normalizeCall = 'normalize_initialized_submodules "$APP_DIR"';
  const firstNormalize = appDeployScript.indexOf(normalizeCall);
  const dirtyGuard = appDeployScript.indexOf(
    'if ! repo_git "$APP_DIR" diff --quiet',
  );
  const checkout = appDeployScript.indexOf(
    'repo_git "$APP_DIR" checkout --detach FETCH_HEAD',
  );
  const secondNormalize = appDeployScript.indexOf(normalizeCall, checkout);

  assert.match(
    appDeployScript,
    /normalize_initialized_submodules\(\).*submodule foreach.*git diff --quiet.*git diff --cached --quiet.*submodule update --depth 1/s,
  );
  assert.ok(
    firstNormalize > -1 && firstNormalize < dirtyGuard,
    "clean initialized submodules must match the current checkout before the dirty guard",
  );
  assert.ok(
    secondNormalize > checkout,
    "initialized submodules must follow the exact deployed checkout",
  );
});

test("targeted app deployment preserves unrelated review infrastructure", () => {
  assert.match(
    appDeployScript,
    /compose build "\$\{services\[@\]\}"/,
  );
  assert.match(
    appDeployScript,
    /compose up -d --no-deps --force-recreate "\$\{services\[@\]\}"/,
  );
  assert.doesNotMatch(appDeployScript, /grist\/bootstrap/);
  assert.doesNotMatch(appDeployScript, /docker compose -p analyzers/);
  assert.match(
    appDeployScript,
    /if \[ "\$bootstrap" = false \]; then\s+candidate_started=true\s+write_status verifying[\s\S]*compose up -d --no-deps --force-recreate/,
  );
});

test("clinical review deployments enable service-backed UAT provisioning", () => {
  assert.match(
    appDeployScript,
    /if \[ "\$INSTANCE" = amr \] \|\| \[ "\$INSTANCE" = phrases \]; then\s+export OE_UAT_SCENARIOS_ENABLED=true/s,
  );
  assert.match(
    deployScript,
    /OE_UAT_SCENARIOS_ENABLED=true docker compose -p amr/,
  );
  assert.doesNotMatch(
    deployScript,
    /OE_UAT_SCENARIOS_ENABLED=true docker compose -p analyzers/,
  );
});

test("targeted analyzer deployment reuses its active Compose chain", () => {
  assert.match(deployScript, /app deploy analyzers --ref <sha>/);
  assert.match(
    deployScript,
    /case "\$1" in\s+amr \| analyzers \| phrases\)/,
  );
  assert.doesNotMatch(
    appDeployScript,
    /targeted app deployment currently supports only the AMR stack/,
  );
  assert.match(
    appDeployScript,
    /APP_CONTAINER="\$\{INSTANCE\}-openelisglobal-webapp"/,
  );
  assert.match(appDeployScript, /com\.docker\.compose\.project\.config_files/);
  assert.match(appDeployScript, /APP_SMOKE_PATH/);
  assert.match(
    appDeployScript,
    /docker compose -p "\$INSTANCE" "\$\{COMPOSE_FILES\[@\]\}"/,
  );
});

test("analyzer app deployment includes the pinned Bridge and mock runtime", () => {
  assert.match(
    appDeployScript,
    /tools\/openelis-analyzer-bridge tools\/analyzer-mock-server/,
    "the exact analyzer runtime submodules must be initialized from the deployed OpenELIS commit",
  );
  assert.match(
    appDeployScript,
    /\[ "\$INSTANCE" = analyzers \].*openelis-analyzer-bridge.*astm-simulator/s,
    "an analyzer app deployment must select both runtime services",
  );
  assert.match(
    appDeployScript,
    /BRIDGE_CONTAINER="\$INSTANCE-openelis-analyzer-bridge".*MOCK_CONTAINER="\$INSTANCE-openelis-astm-simulator".*docker exec "\$BRIDGE_CONTAINER".*docker inspect.*"\$MOCK_CONTAINER"/s,
    "runtime containers must participate in health verification and rollback",
  );
  assert.match(
    appRollbackScript,
    /BRIDGE_CONTAINER="\$INSTANCE-openelis-analyzer-bridge".*MOCK_CONTAINER="\$INSTANCE-openelis-astm-simulator".*docker exec "\$BRIDGE_CONTAINER".*docker inspect.*"\$MOCK_CONTAINER"/s,
    "explicit rollback must restore the runtime images with the OpenELIS images",
  );
  const appVerify = deployScript.slice(
    deployScript.indexOf("cmd_app_verify()"),
    deployScript.indexOf("cmd_app_rollback()"),
  );
  assert.match(appVerify, /analyzers-openelis-analyzer-bridge/);
  assert.match(appVerify, /analyzers-openelis-astm-simulator/);
});

test("targeted lifecycle resolves the active Compose paths from the running app", () => {
  for (const script of [appDeployScript, appRollbackScript]) {
    assert.match(script, /com\.docker\.compose\.project\.working_dir/);
    assert.match(script, /com\.docker\.compose\.project\.config_files/);
    assert.match(
      script,
      /EDGE_DIR="\$\{running_override%\/"\$INSTANCE"\/docker-compose\.override\.yml\}"/,
    );
  }
});

test("full and targeted deployment runners share an exclusive host lock", () => {
  for (const script of [deployScript, appDeployScript, appRollbackScript]) {
    assert.match(script, /\/var\/lock\/openelis-review-deploy\.lock/);
    assert.match(script, /flock -n 9/);
  }
});

test("review deployment is exact-SHA and locked", () => {
  assert.match(deployScript, /cmd_review_deploy/);
  assert.match(deployScript, /repo_git fetch --depth 1 origin '\$ref'/);
  assert.match(deployScript, /flock -n 9/);
  assert.match(
    deployScript,
    /curl -fsSk 'https:\/\/\$AMR_DOMAIN\/__review\/oe-review-widget\.js' -o/,
  );
});

const reviewDeploy = deployScript.slice(
  deployScript.indexOf("cmd_review_deploy()"),
  deployScript.indexOf("cmd_review()", deployScript.indexOf("cmd_review_deploy()")),
);

test("shipping the widget touches no container", () => {
  // The widget is served straight from the checkout, so publishing it is a file
  // swap. Restarting anything for it would take the demo down for a change that
  // never needed it.
  const widgetScope = reviewDeploy.slice(
    reviewDeploy.indexOf("= widget ]"),
    reviewDeploy.indexOf("= service ]"),
  );
  assert.ok(widgetScope.length > 0);
  assert.doesNotMatch(widgetScope, /docker compose|docker restart/);
});

test("the checklist service rebuild is shipped as a script, not inlined", () => {
  const serviceScope = reviewDeploy.slice(reviewDeploy.indexOf("= service ]"));
  // What the rebuild does is asserted by running it, in
  // rebuild-checklist-service.test.mjs. All this file can honestly check is that
  // the deploy ships that script and hands it the values it needs — a command
  // built as a string in a heredoc can only ever be grepped.
  assert.match(serviceScope, /cat > \/tmp\/oe-rebuild-checklist-service\.sh/);
  assert.match(serviceScope, /REMOTE_USER='\$OS_USER'/);
  assert.match(serviceScope, /GRIST_DOMAIN='\$GRIST_DOMAIN'/);
  assert.match(serviceScope, /\/tmp\/oe-rebuild-checklist-service\.sh/);
  assert.doesNotMatch(serviceScope, /docker compose/);
});

test("ready metadata is published only after health and route smoke checks", () => {
  const healthCheck = appDeployScript.indexOf(
    ".State.Health.Status",
  );
  const routeSmoke = appDeployScript.indexOf(
    "https://$APP_DOMAIN$APP_SMOKE_PATH",
  );
  const publishTarget = appDeployScript.indexOf(
    'mv "$target_tmp" "$TARGET_FILE"',
  );

  assert.ok(healthCheck > -1);
  assert.ok(routeSmoke > healthCheck);
  assert.ok(publishTarget > routeSmoke);
  assert.match(appDeployScript, /"health":"passed","smoke":"passed"/);
});

test("failed candidates and explicit rollback restore saved images", () => {
  assert.match(appDeployScript, /restore_previous_images/);
  assert.match(appDeployScript, /rollback-\$DEPLOYMENT_ID/);
  assert.match(appRollbackScript, /rollback-\$DEPLOYMENT_ID/);
  assert.match(
    appRollbackScript,
    /automatic rollback is disabled for schema-affecting deployments/,
  );
  assert.match(appRollbackScript, /previous-target\.json/);
});

test("concurrent SSM commands cannot overwrite each other's scripts", () => {
  assert.doesNotMatch(deployScript, /\/tmp\/deploy-cmd\.sh/);
  assert.equal(
    deployScript.match(/mktemp \/tmp\/deploy-cmd\.XXXXXX/g)?.length,
    2,
    "both synchronous and fire-and-forget transports need unique scripts",
  );
  assert.equal(
    deployScript.match(/rm -f \\\$tmp/g)?.length,
    2,
    "both transports must remove their unique scripts",
  );
});
