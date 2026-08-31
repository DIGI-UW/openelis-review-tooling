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

test("mounts while the host application is still loading", async ({ page }) => {
  let releaseHostModule;
  const hostModuleReady = new Promise((resolve) => {
    releaseHostModule = resolve;
  });

  await page.route("**/tests/widget/pending-host-app.js", async (route) => {
    await hostModuleReady;
    await route.fulfill({
      contentType: "application/javascript",
      body: "export {};",
    });
  });
  await page.route("**/loading-host", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html>
        <html lang="en">
          <body>
            <main>Host application shell</main>
            <script type="module" src="/tests/widget/pending-host-app.js"></script>
            <script
              src="/widget/oe-review-widget.js"
              data-instance="analyzers"
              data-label="Analyzer QC"
              data-src="/tests/widget/uat.json"
              data-build-src="/tests/widget/target.json"
            ></script>
          </body>
        </html>`,
    }),
  );

  try {
    await page.goto("/loading-host", { waitUntil: "commit" });
    await expect(
      page.locator("#oe-review-host").getByRole("button", { name: "Review" }),
    ).toBeVisible();
  } finally {
    releaseHostModule();
  }
});

test("keeps the minimized launcher clear of page content and actions", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const table = document.createElement("table");
    Object.assign(table.style, {
      position: "fixed",
      left: "0",
      right: "0",
      bottom: "64px",
      width: "100%",
      height: "48px",
    });
    const row = table.insertRow();
    const cell = row.insertCell();
    cell.textContent = "Bridge connection configured";
    document.body.append(table);
  });
  const launcher = page
    .locator("#oe-review-host")
    .getByRole("button", { name: "Review" });
  const pageContent = [
    page.getByRole("button", { name: "Save" }),
    page.getByRole("button", { name: "Analyzer row actions" }),
    page.getByRole("cell", { name: "Bridge connection configured" }),
  ];
  const launcherBox = await launcher.boundingBox();

  expect(launcherBox).not.toBeNull();
  for (const pageElement of pageContent) {
    const elementBox = await pageElement.boundingBox();
    expect(elementBox).not.toBeNull();
    const overlaps =
      launcherBox.x < elementBox.x + elementBox.width &&
      launcherBox.x + launcherBox.width > elementBox.x &&
      launcherBox.y < elementBox.y + elementBox.height &&
      launcherBox.y + launcherBox.height > elementBox.y;
    expect(overlaps).toBe(false);
  }
});

test("raises the minimized launcher above a Carbon-style action row", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "carbon-action";
    input.type = "checkbox";
    input.disabled = true;
    Object.assign(input.style, {
      position: "fixed",
      width: "1px",
      height: "1px",
      overflow: "hidden",
    });
    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.textContent = "Carbon-style page action";
    Object.assign(label.style, {
      position: "fixed",
      left: "0",
      right: "0",
      bottom: "64px",
      height: "48px",
      pointerEvents: "none",
    });
    document.body.append(input, label);
  });

  const launcher = page
    .locator("#oe-review-host")
    .getByRole("button", { name: "Review" });
  const action = page.getByText("Carbon-style page action");

  await expect
    .poll(async () => {
      const launcherBox = await launcher.boundingBox();
      const actionBox = await action.boundingBox();
      if (!launcherBox || !actionBox) return true;
      return (
        launcherBox.x < actionBox.x + actionBox.width &&
        launcherBox.x + launcherBox.width > actionBox.x &&
        launcherBox.y < actionBox.y + actionBox.height &&
        launcherBox.y + launcherBox.height > actionBox.y
      );
    })
    .toBe(false);
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
  expect(json.build.bridgeSha).toBe("bridge789");
  expect(json.build.mockSha).toBe("mock012");
  expect(json.build.profileCatalogSha).toBe("bridge789");
  expect(json.checklist[0].steps[0].key).toBe("AN-QC-001");
  expect(json.checklist[0].steps[0].markedAt).toBeTruthy();
  expect(json.checklist[0].steps[0].actualUrl).toContain("127.0.0.1");
  expect(report.md).toContain("route: /analyzers/types");
  expect(report.md).toContain("page: http://127.0.0.1:");
  expect(report.md).toContain("Analyzer Bridge: `bridge789`");
  expect(report.md).toContain("Analyzer mock: `mock012`");
  expect(report.md).toContain("Profile catalog: `bridge789`");
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
  await expect(
    widget
      .locator(".step")
      .filter({ hasText: "Find and inspect a shipped profile" })
      .locator(".steptop"),
  ).toHaveAttribute("aria-label", /^Step 2, needs another look:/);
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
  await expect(marked.locator(".chip")).toHaveCount(0);
  await expect(marked.locator(".steptop")).toHaveAttribute(
    "aria-label",
    /^Step 1, passed:/,
  );

  const stored = await savedState(page);
  expect(stored.key).toContain("oe-review:v2:analyzers:abc123:");
  expect(stored.value.steps["AN-QC-001"].mark).toBe("pass");
});
