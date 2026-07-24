import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("agent and operator docs preserve the native MCP boundary", async () => {
  const root = await read("AGENTS.md");
  const contract = await read("docs/AGENTS.md");
  const operations = await read("docs/OPERATIONS.md");
  const readService = await read("grist/mcp/README.md");

  assert.match(root, /native MCP at `\/api\/mcp`/);
  assert.match(contract, /Source of truth:\*\* a Grist document/);
  assert.match(operations, /no publish step/i);
  assert.match(readService, /no authoring endpoint/);
});

test("remote deploy commands never carry Grist or Dex secret values", async () => {
  const deploy = await read("deploy.sh");
  const localEnv = await read(".env.example");
  const hostEnv = await read("grist/.env.example");
  const runnerStart = deploy.indexOf("_runner_script() {");
  const runnerEnd = deploy.indexOf("\n_poll() {", runnerStart);
  const runner = deploy.slice(runnerStart, runnerEnd);

  assert.ok(runnerStart > -1 && runnerEnd > runnerStart);
  assert.doesNotMatch(runner, /DEX_GRIST_CLIENT_SECRET/);
  assert.doesNotMatch(runner, /DEX_REVIEWER_PASSWORD_HASH/);
  assert.match(runner, /ENV_FILE="\$EDGE_DIR\/\.env"/);
  assert.doesNotMatch(localEnv, /^DEX_/m);
  assert.match(hostEnv, /^DEX_GRIST_CLIENT_SECRET=/m);
  assert.match(hostEnv, /^DEX_REVIEWER_PASSWORD_HASH=/m);
});

test("ready target metadata is published only after successful health verification", async () => {
  const deploy = await read("deploy.sh");
  const healthFailure = deploy.indexOf('if [ "\\$healthy" != true ]');
  const targetPublish = deploy.indexOf("publish_target() {");

  assert.ok(healthFailure > -1, "deploy must fail closed after the health loop");
  assert.ok(
    targetPublish > healthFailure,
    "target publication must happen after health verification",
  );
  assert.doesNotMatch(deploy, /runtime\/build-(amr|analyzers)\.json/);

  const router = await read("router/nginx.conf.template");
  assert.match(router, /location = \/__review\/target\.json/);
  assert.match(router, /target-amr\.json/);
  assert.match(router, /target-analyzers\.json/);
});

test("Grist replacement requires an explicit destructive flag", async () => {
  const bootstrap = await read("grist/bootstrap.sh");
  const sync = await read("grist/grist-sync.mjs");

  assert.match(bootstrap, /seed-examples --replace-all/);
  assert.match(sync, /process\.argv\.includes\("--replace-all"\)/);
  assert.doesNotMatch(bootstrap, /seed-force/);
  assert.doesNotMatch(sync, /--force/);
});

test("committed Microbiology review routes use the stable route family", async () => {
  const checklist = await read("widget/examples/uat-amr.json");
  const seed = await read("scripts/seed-microbiology.sh");

  assert.doesNotMatch(checklist, /MicrobiologyWorklist/);
  assert.match(checklist, /\/Microbiology\/worklist/);
  assert.match(seed, /\/Microbiology\/worklist/);
});

test("static checklist examples have complete stable steps", async () => {
  for (const file of [
    "widget/examples/uat-amr.json",
    "widget/examples/uat-analyzers.json",
    "widget/examples/uat-sample.json",
  ]) {
    const checklist = JSON.parse(await read(file));
    assert.equal(checklist.schemaVersion, 2, `${file} uses schema v2`);
    assert.ok(checklist.checklistRevision, `${file} has a revision`);
    assert.ok(checklist.sections.length > 0, `${file} has sections`);
    const keys = new Set();
    for (const section of checklist.sections) {
      assert.ok(section.steps.length > 0, `${file} section has steps`);
      for (const step of section.steps) {
        assert.equal(typeof step.key, "string", `${file} step has a key`);
        assert.equal(typeof step.do, "string", `${file} step has an action`);
        assert.equal(typeof step.expect, "string", `${file} step has an expectation`);
        assert.ok(!keys.has(step.key), `${file} step key ${step.key} is unique`);
        keys.add(step.key);
      }
    }
  }
});
