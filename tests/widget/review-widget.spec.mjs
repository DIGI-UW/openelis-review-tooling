import { expect, test } from "@playwright/test";

async function openPanel(page) {
  await page.goto("/");
  const widget = page.locator("#oe-review-host");
  await widget.getByRole("button", { name: "Review" }).click();
  return widget;
}

async function savedState(page) {
  return page.evaluate(() => {
    const key = window.__OE_REVIEW_TEST__.storageKey();
    return { key, value: JSON.parse(localStorage.getItem(key)) };
  });
}

test("keeps the minimized launcher clear of page actions", async ({ page }) => {
  await page.goto("/");
  const launcher = page
    .locator("#oe-review-host")
    .getByRole("button", { name: "Review" });
  const pageAction = page.getByRole("button", { name: "Save" });
  const [launcherBox, actionBox] = await Promise.all([
    launcher.boundingBox(),
    pageAction.boundingBox(),
  ]);

  expect(launcherBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  const overlaps =
    launcherBox.x < actionBox.x + actionBox.width &&
    launcherBox.x + launcherBox.width > actionBox.x &&
    launcherBox.y < actionBox.y + actionBox.height &&
    launcherBox.y + launcherBox.height > actionBox.y;
  expect(overlaps).toBe(false);
});

test("keys answers by stable step key and includes provenance in reports", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await widget
    .locator(".step")
    .filter({ hasText: "Find a shipped profile" })
    .getByText("Pass", { exact: true })
    .click();

  const stored = await savedState(page);
  expect(stored.key).toContain(
    "oe-review:v2:analyzers:abc123:revision-two",
  );
  expect(stored.value.steps["AN-QC-001"].mark).toBe("pass");
  expect(stored.value.steps["0.0"]).toBeUndefined();

  const report = await page.evaluate(() => window.__OE_REVIEW_TEST__.buildReport());
  const json = JSON.parse(report.json);
  expect(json.schemaVersion).toBe(2);
  expect(json.checklistRevision).toBe("revision-two");
  expect(json.deploymentId).toBe("deploy-analyzers-001");
  expect(json.build.appSha).toBe("abc123");
  expect(json.checklist[0].steps[0].key).toBe("AN-QC-001");
  expect(json.checklist[0].steps[0].markedAt).toBeTruthy();
  expect(json.checklist[0].steps[0].actualUrl).toContain("127.0.0.1");
  expect(report.md).toContain("route: /analyzers/types");
  expect(report.md).toContain("page: http://127.0.0.1:");
});

test("refresh preserves reordered answers and marks changed instructions stale", async ({
  page,
}) => {
  let revision = "revision-one";
  let firstInstruction = "Find a shipped profile";
  await page.route("**/tests/widget/uat.json", async (route) => {
    await route.fulfill({
      json: {
        schemaVersion: 2,
        checklistRevision: revision,
        title: "Analyzer QC review",
        instance: "analyzers",
        sections: [
          {
            title: "Profiles",
            steps: [
              {
                key: "AN-QC-002",
                required: true,
                do: "Create an analyzer",
                expect: "Setup opens inline",
              },
              {
                key: "AN-QC-001",
                required: true,
                do: firstInstruction,
                expect: "Protocol and readiness are visible",
              },
            ],
          },
        ],
      },
    });
  });

  const widget = await openPanel(page);
  const reordered = widget.locator(".step").filter({ hasText: "Find a shipped profile" });
  await reordered.locator(".steptop").click();
  await reordered.getByText("Pass", { exact: true }).click();

  revision = "revision-two";
  firstInstruction = "Find and inspect a shipped profile";
  await widget.getByRole("button", { name: "Refresh checklist" }).click();

  await expect(widget.getByText("Find and inspect a shipped profile")).toBeVisible();
  await expect(widget.getByText("Review again")).toBeVisible();
  const stored = await savedState(page);
  expect(stored.value.steps["AN-QC-001"].mark).toBe("pass");
  expect(stored.value.steps["AN-QC-001"].stale).toBe(true);
});

test("shows checklist load failures instead of an empty checklist", async ({ page }) => {
  await page.route("**/tests/widget/uat.json", (route) =>
    route.fulfill({ status: 502, body: "unavailable" }),
  );
  const widget = await openPanel(page);
  await expect(widget.getByRole("alert")).toContainText("Could not load");
});

test("keeps the panel open when an initial checklist refresh finishes late", async ({
  page,
}) => {
  await page.route("**/tests/widget/uat.json", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });

  await page.goto("/");
  const widget = page.locator("#oe-review-host");
  await widget.getByRole("button", { name: "Review" }).click();
  await expect(widget.getByText("Analyzer QC review")).toBeVisible();
  await expect(widget.getByRole("button", { name: "Minimize" })).toBeVisible();
});

test("drops position-based legacy answers instead of announcing them", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "oe-review:analyzers",
      JSON.stringify({
        reviewer: "Legacy reviewer",
        minimized: true,
        steps: { "0.0": { mark: "pass" } },
        notes: [],
      }),
    );
  });

  const widget = await openPanel(page);
  // The invariant that matters: answers keyed by position predate stable step
  // keys, so none of them can be matched to a step and none may be shown as one.
  await expect(
    widget
      .locator(".step")
      .filter({ hasText: "Find a shipped profile" })
      .locator(".mark.pass"),
  ).not.toHaveClass(/on/);

  // Cleared on sight rather than reported. Nothing writes this key any more, so
  // the warning could never clear itself, and the only remedy it could offer was
  // Reset — which throws away the answers the reviewer has now to be rid of data
  // from a version of the widget they cannot still be using.
  await expect(widget.locator(".legacy")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("oe-review:analyzers")))
    .toBeNull();
});

test("does not carry answers into a different deployment", async ({ page }) => {
  let deploymentId = "deploy-analyzers-001";
  await page.route("**/tests/widget/target.json", (route) =>
    route.fulfill({
      json: {
        instance: "analyzers",
        deploymentId,
        state: "ready",
        appSha: deploymentId === "deploy-analyzers-001" ? "abc123" : "xyz789",
        harnessSha: "def456",
        verification: { health: "passed" },
      },
    }),
  );

  let widget = await openPanel(page);
  await widget
    .locator(".step")
    .filter({ hasText: "Find a shipped profile" })
    .getByText("Pass", { exact: true })
    .click();

  deploymentId = "deploy-analyzers-002";
  await page.reload();
  widget = page.locator("#oe-review-host");
  await widget.getByRole("button", { name: "Review" }).click();
  await expect(
    widget
      .locator(".step")
      .filter({ hasText: "Find a shipped profile" })
      .locator(".mark.pass"),
  ).not.toHaveClass(/on/);
});

test("keeps answers when the target fetch fails after a mark", async ({ page }) => {
  let targetAvailable = true;
  await page.route("**/tests/widget/target.json", (route) => {
    if (!targetAvailable) return route.fulfill({ status: 503, body: "unavailable" });
    return route.fulfill({
      json: {
        instance: "analyzers",
        deploymentId: "deploy-analyzers-001",
        state: "ready",
        appSha: "abc123",
        harnessSha: "def456",
        verification: { health: "passed" },
      },
    });
  });

  let widget = await openPanel(page);
  await widget
    .locator(".step")
    .filter({ hasText: "Find a shipped profile" })
    .getByText("Pass", { exact: true })
    .click();

  // The deployment identity is part of the storage key. A transient target
  // outage must not re-key the panel and hide answers already given.
  targetAvailable = false;
  await page.reload();
  widget = page.locator("#oe-review-host");
  const marked = widget.locator(".step").filter({ hasText: "Find a shipped profile" });
  await expect(marked.locator(".chip")).toHaveText("Pass");

  const stored = await savedState(page);
  expect(stored.key).toContain("oe-review:v2:analyzers:abc123:");
  expect(stored.value.steps["AN-QC-001"].mark).toBe("pass");
});
