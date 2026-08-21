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

test("REST checklist authoring requires explicit stable keys", async () => {
  const contract = await read("docs/AGENTS.md");
  const skill = await read("skills/uat-authoring/SKILL.md");
  const schema = await read("skills/uat-authoring/references/schema.md");

  assert.match(contract, /REST creates must send[\s\S]*`story_key` and `step_key`/);
  assert.match(skill, /REST creates must provide stable keys explicitly/);
  assert.match(skill, /REST create MUST include an unused stable `story_key`/);
  assert.match(schema, /REST creates must send it explicitly/);
});

test("remote deploy commands never carry Grist or Dex secret values", async () => {
  const deploy = await read("deploy.sh");
  const localEnv = await read(".env.example");
  const hostEnv = await read("grist/.env.example");
  const bootstrap = await read("grist/bootstrap.sh");
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
  assert.match(
    bootstrap,
    /DEX_REVIEWER_PASSWORD_HASH must start with a supported bcrypt prefix/,
  );
});

test("ready target metadata is published only after successful health verification", async () => {
  const deploy = await read("deploy.sh");
  const healthFailure = deploy.indexOf('if [ "\\$healthy" != true ]');
  const targetPublish = deploy.indexOf("publish_target() {");

  assert.ok(
    healthFailure > -1,
    "deploy must fail closed after the health loop",
  );
  assert.ok(
    targetPublish > healthFailure,
    "target publication must happen after health verification",
  );
  assert.doesNotMatch(deploy, /runtime\/build-(amr|analyzers)\.json/);
  assert.match(
    deploy,
    /chmod 0644 "\\\$tmp"/,
    "published target metadata must be readable by the nginx worker",
  );

  const router = await read("router/nginx.conf.template");
  assert.match(router, /location = \/__review\/target\.json/);
  assert.match(router, /target-amr\.json/);
  assert.match(router, /target-analyzers\.json/);
  assert.match(router, /target-phrases\.json/);
  assert.match(router, /data-instance="phrases"/);
});

test("the dedicated phrases review verifies sessions against its own app", async () => {
  const compose = await read("grist/docker-compose.grist.yml");
  const router = await read("router/nginx.conf.template");

  assert.match(compose, /phrases=https:\/\/phrases-oe:8443/);
  assert.match(compose, /phrases-oe/);
  assert.match(router, /server_name \$\{PHRASES_DOMAIN\}/);
  assert.match(router, /data-instance="phrases"/);
});

test("the review router recompresses frontend responses after overlay injection", async () => {
  const router = await read("router/nginx.conf.template");

  assert.match(router, /\bgzip on;/);
  assert.match(router, /\bgzip_proxied any;/);
  assert.match(router, /\bgzip_vary on;/);
  assert.match(router, /gzip_types[\s\S]*application\/javascript/);
  assert.match(router, /gzip_types[\s\S]*text\/css/);
});

test("the public TLS review hosts use HTTP/2 for frontend assets", async () => {
  const router = await read("router/nginx.conf.template");

  for (const domain of ["PHRASES", "AMR", "ANALYZERS", "GRIST"]) {
    assert.match(
      router,
      new RegExp(
        `server \\{\\s+listen 443 ssl;\\s+http2 on;\\s+server_name \\$\\{${domain}_DOMAIN\\};`,
      ),
      `${domain.toLowerCase()} must multiplex review assets over HTTP/2`,
    );
  }
});

test("the deployed review surface remains inspectable by accessibility and UAT tools", async () => {
  const widget = await readFile(
    new URL("../widget/oe-review-widget.js", import.meta.url),
    "utf8",
  );
  assert.match(widget, /attachShadow\(\{ mode: "open" \}\)/);
  assert.doesNotMatch(widget, /__OE_REVIEW_TEST_OPEN_SHADOW__/);
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

test("Microbiology review data is provisioned through OpenELIS services", async () => {
  const seed = await read("scripts/seed-microbiology.sh");

  assert.match(seed, /\/rest\/microbiology\/uat\/scenarios/);
  assert.match(seed, /"AMR-S17:WORKLIST"/);
  assert.match(seed, /"AMR-S18:R1"/);
  assert.match(seed, /"AMR-S02:CASE"/);
  assert.match(seed, /"AMR-S19:CASE"/);
  assert.match(seed, /__review\/target\.json/);
  assert.match(seed, /review-amr-\$\{deployment_key\}/);
  assert.doesNotMatch(seed, /\bpsql\b/);
  assert.doesNotMatch(seed, /docker exec/);
  assert.doesNotMatch(seed, /\bINSERT\b/i);
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
        assert.equal(
          typeof step.expect,
          "string",
          `${file} step has an expectation`,
        );
        assert.ok(
          !keys.has(step.key),
          `${file} step key ${step.key} is unique`,
        );
        keys.add(step.key);
      }
    }
  }
});

test("bootstrap ships every module grist-sync imports", async () => {
  // bootstrap.sh copies the sync tool into a state directory and runs it there
  // from a container, so a module it does not copy is simply absent: every
  // command fails on the box with a resolution error, and nothing here would
  // notice, because nothing here runs bootstrap.
  const sync = await read("grist/grist-sync.mjs");
  const bootstrap = await read("grist/bootstrap.sh");
  const imports = [...sync.matchAll(/from\s+"\.\/([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(imports.length >= 2, "expected grist-sync to import its helpers");

  for (const relative of imports) {
    const shippedByName = bootstrap.includes(`/${relative}"`);
    const shippedByGlob =
      !relative.includes("/") && /\$HERE"\/\*\.mjs/.test(bootstrap);
    assert.ok(
      shippedByName || shippedByGlob,
      `bootstrap.sh must copy ${relative} — without it grist-sync cannot start`,
    );
  }
});

test("the checklist service image ships every module the service imports", async () => {
  // Same hazard as bootstrap, in a different shape: the Dockerfile names the
  // files it copies, so a module added beside server.mjs is absent from the
  // image and the container dies at import. Nothing here builds the image, so
  // nothing here would notice.
  const server = await read("grist/mcp/server.mjs");
  const dockerfile = await read("grist/mcp/Dockerfile");
  const imports = [...server.matchAll(/from\s+"\.\/([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(
    imports.length >= 1,
    "expected server.mjs to import at least one local module",
  );

  for (const relative of imports) {
    const byName = new RegExp(
      `COPY[^\\n]*\\b${relative.replace(".", "\\.")}\\b`,
    ).test(dockerfile);
    const byGlob =
      !relative.includes("/") && /COPY[^\n]*\*\.mjs/.test(dockerfile);
    assert.ok(
      byName || byGlob,
      `grist/mcp/Dockerfile must copy ${relative} — without it the service cannot start`,
    );
  }
});
