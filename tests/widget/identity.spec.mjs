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

// The application's own session endpoint supplies the authenticated account.
// The reviewer still enters their name separately because demo accounts may be
// shared.
async function session(page, body, status = 200) {
  await page.route("**/session", (route) =>
    status === 200
      ? route.fulfill({ json: body })
      : route.fulfill({ status, body: "" }),
  );
}

async function openPanel(page) {
  await page.goto(APP);
  const widget = widgetOf(page);
  await widget.getByRole("button", { name: /review/i }).click();
  await expect(widget.locator(".panel")).toBeVisible();
  return widget;
}

test("shows the signed-in account beside a required reviewer name", async ({
  page,
}) => {
  await session(page, {
    authenticated: true,
    loginName: "mmwanza",
    firstName: "Mercy",
    lastName: "Mwanza",
  });
  const widget = await openPanel(page);

  await expect(widget.locator(".whoami")).toContainText("Mercy Mwanza");
  const name = widget.getByLabel("Your name");
  await expect(name).toBeVisible();
  await expect(name).toHaveAttribute("required", "");
  await expect(name).toHaveValue("");
});

test("asks an anonymous reviewer to sign in", async ({ page }) => {
  await session(page, { authenticated: false });
  const widget = await openPanel(page);
  await expect(widget.locator(".signin")).toContainText(/sign in/i);
});

test("lets an anonymous reviewer work anyway", async ({ page }) => {
  // The prompt is about submitting, not about reviewing. Someone who opens the
  // panel before signing in has still done the work, and it has to count.
  await session(page, { authenticated: false });
  const widget = await openPanel(page);
  await widget
    .locator(".step")
    .first()
    .getByText("Pass", { exact: true })
    .click();
  await expect(widget.locator(".step").first()).toHaveAttribute(
    "data-state",
    "pass",
  );
});

test("keeps what was answered before signing in", async ({ page }) => {
  // The specific mistake this guards: keying saved answers by the reviewer. Doing
  // that would orphan everything the moment a session appeared — losing exactly
  // the work the sign-in prompt told them they could carry on doing.
  await deployed(page);
  await session(page, { authenticated: false });
  let widget = await openPanel(page);
  await widget.getByLabel("Your name").fill("Piotr Manko");
  await widget
    .locator(".step")
    .first()
    .locator(".stepnote")
    .fill("noticed before I signed in");
  await widget
    .locator(".step")
    .first()
    .getByText("Pass", { exact: true })
    .click();

  // They sign in, and the page reloads as OpenELIS does after login.
  await session(page, {
    authenticated: true,
    loginName: "mmwanza",
    firstName: "Mercy",
    lastName: "Mwanza",
  });
  await page.reload();
  widget = widgetOf(page);
  // The panel was open when they left, so it comes back open — no launcher to click.
  await expect(widget.locator(".panel")).toBeVisible();

  await expect(widget.locator(".whoami")).toContainText("Mercy Mwanza");
  await expect(widget.getByLabel("Your name")).toHaveValue("Piotr Manko");
  await expect(widget.locator(".step").first()).toHaveAttribute(
    "data-state",
    "pass",
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
  expect(first.mark).toBe("pass");
  expect(first.note).toBe("noticed before I signed in");
  expect(json.reviewer).toBe("Piotr Manko");
  expect(json.login).toBe("mmwanza");
});

test("still works where there is no session endpoint at all", async ({
  page,
}) => {
  // The widget is embeddable anywhere and runs standalone from a file with an
  // inline checklist. Identity is something it can borrow, never something it
  // requires — so a 404 leaves the typed name exactly as it was.
  await session(page, null, 404);
  const widget = await openPanel(page);
  await expect(widget.getByLabel("Your name")).toBeVisible();
  await expect(widget.locator(".signin")).not.toBeVisible();
});

test("requires a typed reviewer name before a report can be handed off", async ({
  page,
}) => {
  await session(page, null, 404);
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

test("carries the entered reviewer and authenticated login separately", async ({
  page,
}) => {
  await session(page, {
    authenticated: true,
    loginName: "mmwanza",
    firstName: "Mercy",
    lastName: "Mwanza",
  });
  const widget = await openPanel(page);
  await widget.getByLabel("Your name").fill("Piotr Manko");
  await widget
    .locator(".step")
    .first()
    .getByText("Pass", { exact: true })
    .click();
  const report = await page.evaluate(() =>
    window.__OE_REVIEW_TEST__.buildReport(),
  );
  const json = JSON.parse(report.json);
  expect(json.reviewer).toBe("Piotr Manko");
  // The authenticated account cannot be typed or changed by the reviewer.
  expect(json.login).toBe("mmwanza");
});
