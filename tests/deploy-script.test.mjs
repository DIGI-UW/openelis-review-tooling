import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url).pathname;
const deployScript = readFileSync(`${repoRoot}/deploy.sh`, "utf8");

test("remote repository operations run as the checkout owner", () => {
  assert.match(
    deployScript,
    /repo_git\(\).*sudo -u "\\?\$REMOTE_USER" git -c safe\.directory=/s,
  );
  assert.doesNotMatch(deployScript, /\bgit -C "\\?\$dir/);
  assert.match(deployScript, /repo_git "\$EDGE_DIR" rev-parse HEAD/);
  assert.match(deployScript, /repo_git "\$ANALYZERS_DIR" rev-parse HEAD/);
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
