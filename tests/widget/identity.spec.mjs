import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const APP = "/tests/widget/fixture.html";
const widgetOf = (page) => page.locator("#oe-review-host");

// A deployed target names the build under review, and answers are keyed by it.
// Without one everything lands under the "unbound" prefix, whose fallback scan is
// broad enough to find answers filed under a key they should never have had — so a
// test that leaves it out cannot tell a sound storage key from a broken one.
async function deployed(page) {
  await page.route("**/target.json", (route) =>
    route.fulfill({
      json: { appSha: "abc1234", deploymentId: "2026-07-28T10:00:00Z" },
    }),
  );
}

// Authentication belongs to the submission service. Merely mounting Review must
// not initialize an application session or race its CSRF token setup.
async function rejectSubmission(page) {
  await page.route("**/__review/uat-analyzers/submissions", (route) =>
    route.fulfill({ status: 401, json: { needsLogin: true } }),
  );
}

async function openPanel(page) {
  await page.goto(APP);
  const widget = widgetOf(page);
  await widget.getByRole("button", { name: /review/i }).click();
  await expect(widget.locator(".panel")).toBeVisible();
  return widget;
}

test("does not compete with application session initialization on load, reload or popout", async ({
  page,
}) => {
  const sessions = [];
  page.context().on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/session"))
      sessions.push(request.url());
  });
  await page.route("**/session", async (route) => {
    await route.fulfill({
      json: { authenticated: true, csrf: "fixture-token" },
    });
  });
  // The app makes its own startup request. The widget must add none of its own.
  const fixture = readFileSync(
    new URL("./fixture.html", import.meta.url),
    "utf8",
  );
  await page.route("**/tests/widget/fixture.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: fixture.replace(
        "<script>",
        '<script>fetch("/api/OpenELIS-Global/session", { credentials: "include" });',
      ),
    }),
  );
  let widget = await openPanel(page);
  await expect(widget.locator(".step").first()).toBeVisible();
  expect(sessions).toHaveLength(1);
  await page.reload();
  widget = widgetOf(page);
  await expect(widget.locator(".step").first()).toBeVisible();
  expect(sessions).toHaveLength(2);
  // Release startup mocks before document.write opens a real popup document;
  // the context request listener still observes both windows.
  await page.unrouteAll({ behavior: "wait" });
  const popupPromise = page.waitForEvent("popup");
  await widget
    .getByRole("button", { name: /Pop out into its own window/ })
    .click();
  const popup = await popupPromise;
  await expect(widgetOf(popup).locator(".step").first()).toBeVisible();
  expect(sessions).toHaveLength(2);
  await popup.close();
});

test("asks a reviewer to sign in when submission requires it, retaining their answer", async ({
  page,
}) => {
  await rejectSubmission(page);
  const widget = await openPanel(page);
  await widget.getByLabel("Your name").fill("Piotr Manko");
  await widget
    .locator(".step")
    .first()
    .getByText("Worked as expected", { exact: true })
    .click();
  await widget.locator("button.submit").click();
  await expect(widget.locator(".signin")).toContainText(/sign in/i);
  await expect(widget.locator(".step").first()).toHaveAttribute(
    "data-state",
    "pass",
  );
});

test("lets an anonymous reviewer work anyway", async ({ page }) => {
  // The prompt is about submitting, not about reviewing. Someone who opens the
  // panel before signing in has still done the work, and it has to count.
  const widget = await openPanel(page);
  await widget
    .locator(".step")
    .first()
    .getByText("Worked as expected", { exact: true })
    .click();
  await expect(widget.locator(".step").first()).toHaveAttribute(
    "data-state",
    "pass",
  );
});

test("keeps what was answered before signing in", async ({
  page,
}, testInfo) => {
  // The specific mistake this guards: keying saved answers by the reviewer. Doing
  // that would orphan everything the moment a session appeared — losing exactly
  // the work the sign-in prompt told them they could carry on doing.
  await deployed(page);
  await rejectSubmission(page);
  let widget = await openPanel(page);
  await widget.getByLabel("Your name").fill("Piotr Manko");
  await widget
    .locator(".step")
    .first()
    .getByText("There was a problem", { exact: true })
    .click();
  await widget
    .locator(".step")
    .first()
    .locator(".stepnote")
    .fill("noticed before I signed in");

  await widget.locator("button.submit").click();
  await expect(widget.locator(".signin")).toContainText(/sign in/i);

  // They sign in, and the page reloads as OpenELIS does after login.
  await page.route("**/__review/uat-analyzers/submissions", (route) =>
    route.fulfill({
      status: 201,
      json: { id: 12, reviewer: { login: "mmwanza", name: "Piotr Manko" } },
    }),
  );
  await page.reload();
  widget = widgetOf(page);
  // The panel was open when they left, so it comes back open — no launcher to click.
  await expect(widget.locator(".panel")).toBeVisible();

  await expect(widget.getByLabel("Your name")).toHaveValue("Piotr Manko");
  await expect(widget.locator(".step").first()).toHaveAttribute(
    "data-state",
    "fail",
  );

  // Only the step being worked on shows its note, so going back to that one is
  // how a reviewer finds out whether what they wrote is still there.
  await widget.locator(".step").first().locator(".steplabel").click();
  await expect(
    widget.locator(".step").first().locator(".stepnote"),
  ).toHaveValue("noticed before I signed in");

  // And it reaches the artifact, which is what a submission is made of.
  const json = JSON.parse(
    await page.evaluate(() => window.__OE_REVIEW_TEST__.buildReport().json),
  );
  const first = json.checklist[0].steps[0];
  expect(first.mark).toBe("fail");
  expect(first.note).toBe("noticed before I signed in");
  expect(json.reviewer).toBe("Piotr Manko");
  expect(json.login).toBeNull();
  await widget.locator("button.submit").click();
  await expect(widget.locator(".statusbox")).toContainText("account mmwanza");
  await expect(widget.locator(".signin")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("submitted-account.png") });
});

test("still works where there is no session endpoint at all", async ({
  page,
}) => {
  // The widget is embeddable anywhere and runs standalone from a file with an
  // inline checklist. Entering a name and reviewing need no application endpoint.
  const widget = await openPanel(page);
  await expect(widget.getByLabel("Your name")).toBeVisible();
  await expect(widget.locator(".signin")).not.toBeVisible();
});

test("requires a typed reviewer name before a report can be handed off", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const name = widget.getByLabel(/Your name/);
  await expect(name).toHaveAttribute("required", "");
  await expect(name).toHaveAttribute("aria-required", "true");

  const downloads = [];
  page.on("download", (download) => downloads.push(download));
  const more = widget.getByRole("button", { name: "More review actions" });
  await more.click();
  await widget.getByRole("button", { name: "Download report" }).click();

  await expect(widget.getByRole("alert")).toHaveText(
    "Enter your name before sharing this review.",
  );
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toBeFocused();
  expect(downloads).toHaveLength(0);

  await name.fill("Piotr Manko");
  await expect(widget.getByRole("alert")).toBeHidden();
  await more.click();
  const download = page.waitForEvent("download");
  await widget.getByRole("button", { name: "Download report" }).click();
  await download;
});

test("download identifies the entered reviewer without claiming an unverified account", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await widget.getByLabel("Your name").fill("Piotr Manko");
  const report = await page.evaluate(() =>
    window.__OE_REVIEW_TEST__.buildReport(),
  );
  const json = JSON.parse(report.json);
  expect(json.reviewer).toBe("Piotr Manko");
  expect(json.login).toBeNull();
  expect(report.md).not.toContain("Authenticated login:");
});
