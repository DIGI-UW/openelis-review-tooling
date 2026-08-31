import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const analyzerRuntimeDeployScript = readFileSync(
  `${repoRoot}/scripts/targeted-analyzer-runtime-deploy.sh`,
  "utf8",
);
const phrasesOverride = readFileSync(
  `${repoRoot}/phrases/docker-compose.override.yml`,
  "utf8",
);

test("deployment entrypoint parses as Bash", () => {
  assert.doesNotThrow(() =>
    execFileSync("bash", ["-n", `${repoRoot}/deploy.sh`]),
  );
});

test("AWS preflight distinguishes refresh failures from endpoint failures", () => {
  assert.match(deployScript, /AWS credentials could not be refreshed/);
  assert.match(
    deployScript,
    /AWS endpoint is unreachable; the login may still be valid/,
  );
  assert.doesNotMatch(
    deployScript,
    /get-caller-identity[^\n]+>\/dev\/null 2>&1 \|\| die "no AWS session/,
  );
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

test("checkout sync refuses tracked changes before fetching", () => {
  const dirtyCheck = deployScript.indexOf(
    'if ! repo_git "\\$dir" diff --quiet',
  );
  const fetch = deployScript.indexOf(
    'repo_git "\\$dir" fetch --depth 1 origin "\\$br"',
  );

  assert.ok(dirtyCheck > -1, "checkout sync must guard tracked changes");
  assert.ok(fetch > dirtyCheck, "the dirty check must happen before fetching");
});

test("deployment uses only current OpenELIS and analyzer runtime submodules", () => {
  assert.match(
    deployScript,
    /sync_checkout "\$AMR_DIR" "\$AMR_BRANCH" "\$APP_REPO"\nrepo_git "\$AMR_DIR" submodule update --init --depth 1 dataexport/,
  );
  assert.match(
    deployScript,
    /sync_checkout "\$ANALYZERS_DIR" "\$ANALYZERS_BRANCH" "\$APP_REPO"\nrepo_git "\$ANALYZERS_DIR" submodule update --init --depth 1 dataexport tools\/openelis-analyzer-bridge tools\/analyzer-mock-server/,
  );
  assert.match(
    appDeployScript,
    /repo_git "\$APP_DIR" submodule update --init --depth 1 dataexport\n/,
  );
});
test("targeted app deployment accepts only an exact SHA and explicit scope", () => {
  assert.match(deployScript, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(deployScript, /--scope must be frontend, backend, or app/);
  assert.match(deployScript, /app deploy amr --ref <sha>/);
  assert.match(deployScript, /app deploy phrases --ref <sha>/);
  assert.match(deployScript, /review deploy --ref <sha> --scope widget/);
  assert.match(deployScript, /data seed amr --fixture microbiology-mvp/);
});

test("targeted analyzer fixture setup uses only the existing analyzer harness", () => {
  const start = deployScript.indexOf("cmd_data_seed() {");
  const end = deployScript.indexOf("\ncmd_data() {", start);
  const dataSeedCommand = deployScript.slice(start, end);

  assert.match(dataSeedCommand, /analyzers:analyzer-mvp/);
  assert.match(dataSeedCommand, /projects\/analyzer-harness\/seed-analyzers\.sh/);
  assert.match(dataSeedCommand, /projects\/analyzer-harness\/seed-mvp-traffic\.sh/);
  assert.match(dataSeedCommand, /BASE_URL=https:\/\/\$ANALYZERS_DOMAIN/);
  assert.match(dataSeedCommand, /render_mock_url_setup "\$MOCK_URL"/);

  const resolverStart = deployScript.indexOf("render_mock_url_setup() {");
  const resolverEnd = deployScript.indexOf("\n}", resolverStart) + 2;
  const mockResolver = deployScript.slice(resolverStart, resolverEnd);
  assert.match(
    mockResolver,
    /docker inspect -f .*analyzers-openelis-astm-simulator/s,
  );
  assert.match(mockResolver, /mock_url="http:\/\/\$mock_ip:8080"/);
  assert.match(mockResolver, /curl -fsS "\$mock_url\/health"/);
  assert.doesNotMatch(dataSeedCommand, /cmd_seed/);
  assert.doesNotMatch(deployScript, /172\.21\.1\.100/);
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
    /compose up -d --build certs db\.openelis\.org oe\.openelis\.org fhir\.openelis\.org frontend\.openelis\.org/,
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
    /if \[ "\$bootstrap" = false \]; then\s+candidate_started=true\s+write_status verifying\s+compose up -d --no-deps --force-recreate/s,
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

test("targeted analyzer runtime deployment is exact and analyzer-only", () => {
  assert.match(
    deployScript,
    /analyzer-runtime deploy --ref <sha>/,
  );
  assert.match(
    deployScript,
    /cmd_analyzer_runtime_deploy/,
  );
  assert.match(
    analyzerRuntimeDeployScript,
    /repo_git "\$APP_DIR" rev-parse HEAD/,
  );
  assert.match(
    analyzerRuntimeDeployScript,
    /submodule update --init --depth 1/,
  );
  assert.match(
    analyzerRuntimeDeployScript,
    /tools\/openelis-analyzer-bridge tools\/analyzer-mock-server/,
  );
  assert.match(
    analyzerRuntimeDeployScript,
    /openelis-analyzer-bridge.*astm-simulator/s,
  );
  assert.match(
    analyzerRuntimeDeployScript,
    /compose build "\$\{services\[@\]\}"/,
  );
  assert.ok(
    analyzerRuntimeDeployScript.lastIndexOf("verify_ready_target") <
      analyzerRuntimeDeployScript.indexOf(
        'compose build "${services[@]}"',
      ),
  );
  assert.match(
    analyzerRuntimeDeployScript,
    /compose up -d --no-deps --force-recreate "\$\{services\[@\]\}"/,
  );
  assert.doesNotMatch(
    analyzerRuntimeDeployScript,
    /\bamr\b|grist\/bootstrap|oe-edge-router|db\.openelis\.org|fhir\.openelis\.org|frontend\.openelis\.org/,
  );
});

test("analyzer runtime deployment publishes exact component provenance after verification", () => {
  assert.match(
    analyzerRuntimeDeployScript,
    /analyzers-openelis-analyzer-bridge.*healthcheck\.sh/s,
  );
  assert.match(
    analyzerRuntimeDeployScript,
    /analyzers-openelis-astm-simulator.*healthy/s,
  );
  assert.match(
    analyzerRuntimeDeployScript,
    /"bridgeSha": bridge_sha/,
  );
  assert.match(
    analyzerRuntimeDeployScript,
    /"mockSha": mock_sha/,
  );
  assert.match(
    analyzerRuntimeDeployScript,
    /"profileCatalogSha": bridge_sha/,
  );
  assert.ok(
    analyzerRuntimeDeployScript.indexOf('"bridgeSha": bridge_sha') >
      analyzerRuntimeDeployScript.indexOf("verify_runtime"),
  );
  assert.ok(
    analyzerRuntimeDeployScript.indexOf('mv "$target_tmp" "$TARGET_FILE"') >
      analyzerRuntimeDeployScript.indexOf("write_status ready passed"),
  );
  assert.match(analyzerRuntimeDeployScript, /restore_previous_images/);
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
  for (const script of [
    deployScript,
    appDeployScript,
    appRollbackScript,
    analyzerRuntimeDeployScript,
  ]) {
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

test("failed app deployment restores the previous checkout and managed submodules", () => {
  assert.match(appDeployScript, /restore_previous_checkout\(\)/);
  assert.match(
    appDeployScript,
    /repo_git "\$APP_DIR" checkout --detach "\$previous_app_sha"/,
  );
  assert.match(
    appDeployScript,
    /restore_submodules=\("dataexport"\).*tools\/openelis-analyzer-bridge.*tools\/analyzer-mock-server/s,
  );
  assert.match(
    appDeployScript,
    /restore_previous_images\s+restore_previous_checkout\s+write_status failed failed/s,
  );
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
