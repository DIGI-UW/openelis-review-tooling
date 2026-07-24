import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("root agent guidance points to the authoritative contract", async () => {
  const root = await read("AGENTS.md");
  const contract = await read("docs/AGENTS.md");

  assert.match(root, /docs\/AGENTS\.md/);
  assert.match(root, /native MCP at `\/api\/mcp`/);
  assert.match(contract, /Source of truth:\*\* a Grist document/);
});

test("operator docs describe live authoring without a publish step", async () => {
  const readme = await read("README.md");
  const grist = await read("grist/README.md");
  const operations = await read("docs/OPERATIONS.md");

  for (const contents of [readme, grist, operations]) {
    assert.match(contents, /native MCP/);
    assert.match(contents, /(no|without a) publish step/i);
  }

  assert.doesNotMatch(grist, /generator turns the table back/);
  assert.doesNotMatch(grist, /basic-auth-gated/);
});

test("custom bridge is documented as deprecated compatibility", async () => {
  const contract = await read("docs/AGENTS.md");
  const bridge = await read("grist/mcp/README.md");

  assert.match(contract, /deprecated compatibility/i);
  assert.match(bridge, /deprecated compatibility/i);
  assert.match(bridge, /GET `\/uat\/<instance>\.json`/);
});

test("router lifecycle includes every public review domain", async () => {
  const deploy = await read("deploy.sh");
  const certs = await read("scripts/generate-certs.sh");

  assert.match(deploy, /"\$AMR_DOMAIN" "\$ANALYZERS_DOMAIN" "\$GRIST_DOMAIN"/);
  assert.match(deploy, /GRIST_DOMAIN=\$GRIST_DOMAIN/);
  assert.match(certs, /issue_one "\$GRIST_DOMAIN"/);
});

test("static checklist examples have complete reviewable steps", async () => {
  for (const file of [
    "widget/examples/uat-amr.json",
    "widget/examples/uat-analyzers.json",
    "widget/examples/uat-sample.json",
  ]) {
    const checklist = JSON.parse(await read(file));
    assert.equal(typeof checklist.title, "string", `${file} has a title`);
    assert.ok(checklist.sections.length > 0, `${file} has sections`);
    for (const section of checklist.sections) {
      assert.equal(typeof section.title, "string", `${file} section has a title`);
      assert.ok(section.steps.length > 0, `${file} section has steps`);
      for (const step of section.steps) {
        assert.equal(typeof step.do, "string", `${file} step has an action`);
        assert.equal(typeof step.expect, "string", `${file} step has an expectation`);
      }
    }
  }
});
