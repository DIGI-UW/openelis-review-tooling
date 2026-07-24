import { expect, test } from "@playwright/test";

async function openPanel(page) {
  await page.goto("/");
  const widget = page.locator("#oe-review-host");
  await widget.getByRole("button", { name: "Review" }).click();
  return widget;
}

test("keys answers by stable step key and includes provenance in reports", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await widget
    .locator(".step")
    .filter({ hasText: "Find a shipped profile" })
    .getByText("Pass", { exact: true })
    .click();

  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("oe-review:analyzers")),
  );
  expect(state.steps["AN-QC-001"].mark).toBe("pass");
  expect(state.steps["0.0"]).toBeUndefined();

  const report = await page.evaluate(() => window.__OE_REVIEW_TEST__.buildReport());
  const json = JSON.parse(report.json);
  expect(json.schemaVersion).toBe(2);
  expect(json.checklistRevision).toBe("revision-one");
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
  await widget
    .locator(".step")
    .filter({ hasText: "Find a shipped profile" })
    .getByText("Pass", { exact: true })
    .click();

  revision = "revision-two";
  firstInstruction = "Find and inspect a shipped profile";
  await widget.getByRole("button", { name: "Refresh checklist" }).click();

  await expect(widget.getByText("Find and inspect a shipped profile")).toBeVisible();
  await expect(widget.getByText("Review again")).toBeVisible();
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("oe-review:analyzers")),
  );
  expect(state.steps["AN-QC-001"].mark).toBe("pass");
  expect(state.steps["AN-QC-001"].stale).toBe(true);
});

test("shows checklist load failures instead of an empty checklist", async ({ page }) => {
  await page.route("**/tests/widget/uat.json", (route) =>
    route.fulfill({ status: 502, body: "unavailable" }),
  );
  const widget = await openPanel(page);
  await expect(widget.getByRole("alert")).toContainText("Could not load");
});
