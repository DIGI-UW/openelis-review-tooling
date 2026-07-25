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
test("targeted AMR deployment accepts only an exact SHA and explicit scope", () => {
  assert.match(deployScript, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(deployScript, /--scope must be frontend, backend, or app/);
  assert.match(deployScript, /app deploy amr --ref <sha>/);
  assert.match(deployScript, /data seed amr --fixture microbiology-mvp/);
});

test("targeted AMR deployment preserves unrelated review infrastructure", () => {
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
  assert.doesNotMatch(appDeployScript, /\bdb\.openelis\.org\b/);
  assert.doesNotMatch(appDeployScript, /\bfhir\.openelis\.org\b/);
});

test("targeted lifecycle resolves the active Compose paths from the running app", () => {
  for (const script of [appDeployScript, appRollbackScript]) {
    assert.match(script, /com\.docker\.compose\.project\.working_dir/);
    assert.match(script, /com\.docker\.compose\.project\.config_files/);
    assert.match(
      script,
      /EDGE_DIR="\$\{running_override%\/amr\/docker-compose\.override\.yml\}"/,
    );
  }
});

test("full and targeted deployment runners share an exclusive host lock", () => {
  for (const script of [deployScript, appDeployScript, appRollbackScript]) {
    assert.match(script, /\/var\/lock\/openelis-review-deploy\.lock/);
    assert.match(script, /flock -n 9/);
  }
});

test("ready metadata is published only after health and route smoke checks", () => {
  const healthCheck = appDeployScript.indexOf(
    ".State.Health.Status",
  );
  const routeSmoke = appDeployScript.indexOf(
    "Microbiology/worklist",
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
