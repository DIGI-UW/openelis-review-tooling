import { expect, test } from "@playwright/test";

// The reviewer works a real application with the checklist on top of it. These
// tests run against app-fixture.html, which reproduces the layers measured on
// amr.openelis-global.org: a fixed Carbon header and side nav at z-index 8000,
// modals at 9000, and the application's own right-hand drawer at 1000.
const APP = "/tests/widget/app-fixture.html";

async function openPanel(page) {
  await page.goto(APP);
  const widget = page.locator("#oe-review-host");
  await widget.getByRole("button", { name: /review/i }).click();
  await expect(widget.locator(".panel")).toBeVisible();
  return widget;
}

function boxesOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

test("keeps the reviewer's place in the checklist when a step is marked", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const step = widget.locator(".step").nth(6);
  await step.locator(".steptop").click();
  await expect(step).toHaveClass(/current/);
  const before = await step.boundingBox();

  await step.getByRole("button", { name: "Pass" }).click();

  const after = await step.boundingBox();
  expect(after).not.toBeNull();
  // The panel may reflow as the step collapses, but the step the reviewer just
  // answered has to stay where they can see it. Being returned to step one after
  // every mark is what makes a ten-step review unworkable.
  expect(Math.abs(after.y - before.y)).toBeLessThan(120);
  await expect(step).toBeInViewport();
});

test("shows one step at a time instead of a keyhole onto all of them", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const steps = widget.locator(".step");
  await expect(steps).toHaveCount(10);

  // Every step is listed, so the reviewer can see the scope of the review…
  await expect(steps.first()).toBeVisible();
  await expect(steps.last()).toBeVisible();

  // …but only the step they are on spells out what to do and what to expect.
  const expectations = widget.locator(".expect");
  await expect(expectations).toHaveCount(1);
  await expect(expectations.first()).toContainText("/Microbiology/worklist");

  // The step being worked has to fit in the scroll window in one piece.
  const scroller = widget.locator(".body");
  const [current, view] = await Promise.all([
    widget.locator(".step.current").boundingBox(),
    scroller.boundingBox(),
  ]);
  expect(current.height).toBeLessThanOrEqual(view.height);
  expect(current.y).toBeGreaterThanOrEqual(view.y - 1);
  expect(current.y + current.height).toBeLessThanOrEqual(view.y + view.height + 1);
});

test("answering a step moves the reviewer on to the next one", async ({ page }) => {
  const widget = await openPanel(page);
  const steps = widget.locator(".step");
  await expect(steps.nth(0)).toHaveClass(/current/);

  await steps.nth(0).getByRole("button", { name: "Pass" }).click();

  await expect(steps.nth(0)).not.toHaveClass(/current/);
  await expect(steps.nth(1)).toHaveClass(/current/);
  await expect(widget.locator(".step.current .expect")).toBeVisible();
});

test("does not cover the application's own right-hand drawer", async ({ page }) => {
  const widget = await openPanel(page);
  await page.getByRole("button", { name: "Open drawer" }).click();

  const drawer = page.locator(".slide-over-panel");
  await expect(drawer).toBeVisible();
  const [panelBox, drawerBox] = await Promise.all([
    widget.locator(".panel").boundingBox(),
    drawer.boundingBox(),
  ]);
  expect(boxesOverlap(panelBox, drawerBox)).toBe(false);
  await expect(page.getByRole("button", { name: "Drawer action" })).toBeVisible();
});

test("lets an application modal come over the top of the checklist", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await page.getByRole("button", { name: "Open modal" }).click();

  // Carbon modals sit at z-index 9000. A checklist pinned to the maximum z-index
  // floats over the dialog the step is asking the reviewer to use.
  const layer = await widget.evaluate(
    (host) => getComputedStyle(host.shadowRoot.querySelector(".wrap")).zIndex,
  );
  expect(Number(layer)).toBeLessThan(9000);
  await expect(page.getByRole("button", { name: "Modal action" })).toBeVisible();
});

test("can be moved off whatever it is covering, and remembers where", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const before = await widget.locator(".panel").boundingBox();

  await widget.getByRole("button", { name: /move/i }).click();
  const moved = await widget.locator(".panel").boundingBox();
  expect(moved.x).not.toBeCloseTo(before.x, 0);

  await page.reload();
  await widget.getByRole("button", { name: /review/i }).click();
  const restored = await widget.locator(".panel").boundingBox();
  expect(restored.x).toBeCloseTo(moved.x, 0);
});

test("stands the preamble down once, not every time the count changes", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const intro = widget.locator(".intro");
  await expect(intro).toBeVisible();

  const pass = widget.locator(".step.current .detail").getByRole("button", { name: "Pass" });
  await pass.click();
  await expect(intro).toBeHidden();

  // Clearing the answer must not shove the checklist back down the panel.
  await widget.locator(".step").nth(0).locator(".steptop").click();
  await widget
    .locator(".step.current .detail")
    .getByRole("button", { name: "Pass" })
    .click();
  await expect(intro).toBeHidden();
});

test("stays usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const widget = await openPanel(page);

  const panel = await widget.locator(".panel").boundingBox();
  expect(panel.width).toBeLessThanOrEqual(375);
  // A sheet, not a takeover: the reviewer has to still see the application they
  // are reviewing above it.
  expect(panel.y).toBeGreaterThan(120);
  await expect(page.locator(".cds--header")).toBeVisible();
  await expect(widget.locator(".step.current .detail")).toBeVisible();

  await widget.getByRole("button", { name: /minimi[sz]e/i }).click();
  // The launcher has to stay a corner pill: stretched across the bottom it lands
  // under whatever the application pins there.
  await expect(widget.getByRole("button", { name: /review/i })).toBeVisible();
  const launcher = await widget.getByRole("button", { name: /review/i }).boundingBox();
  expect(launcher.width).toBeLessThan(200);
});

test("shows progress on the collapsed launcher", async ({ page }) => {
  const widget = await openPanel(page);
  await widget.locator(".step.current").getByRole("button", { name: "Pass" }).click();
  await widget.getByRole("button", { name: /minimi[sz]e/i }).click();

  const launcher = widget.getByRole("button", { name: /review/i });
  await expect(launcher).toBeVisible();
  await expect(launcher).toContainText("1/10");
});

test("is reachable and operable without a mouse", async ({ page }) => {
  const widget = await openPanel(page);

  const panel = widget.locator(".panel");
  await expect(panel).toHaveAttribute("role", "complementary");
  await expect(panel).toHaveAttribute("aria-label", /review/i);
  await expect(widget.getByRole("heading", { level: 2 })).toHaveCount(1);
  await expect(widget.getByRole("heading", { level: 3 })).toHaveCount(4);

  const pass = widget.locator(".step.current .detail").getByRole("button", { name: "Pass" });
  await expect(pass).toHaveAttribute("aria-pressed", "false");
  await pass.click();

  // Coming back to an answered step has to show which answer it holds, and to a
  // screen reader that is the pressed state rather than the button's colour.
  await widget.locator(".step").nth(0).locator(".steptop").click();
  await expect(
    widget.locator(".step.current .detail").getByRole("button", { name: "Pass" }),
  ).toHaveAttribute("aria-pressed", "true");

  await expect(widget.getByLabel("Your name")).toBeVisible();
  await expect(
    widget.locator(".step.current").getByLabel(/note/i),
  ).toBeVisible();
});

test("hands the review over as a single document the reviewer can paste", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await widget.locator(".step.current").getByRole("button", { name: "Fail" }).click();

  const downloads = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await widget.getByRole("button", { name: /download/i }).click();
  await page.waitForTimeout(750);

  // Two blob downloads from one click trips Chrome's automatic-downloads
  // permission, and a reviewer who dismisses it silently loses half the review.
  expect(downloads).toHaveLength(1);
  expect(downloads[0]).toMatch(/\.md$/);

  const report = await page.evaluate(() => window.__OE_REVIEW_TEST__.buildReport());
  expect(report.md).toContain("```json");
  expect(report.md).toContain('"schemaVersion": 2');
  await expect(widget.getByRole("button", { name: /copy/i })).toBeVisible();
});

test("records the page and console errors behind a failure", async ({ page }) => {
  const widget = await openPanel(page);
  await page.evaluate(() => console.error("worklist filter blew up"));
  await widget.locator(".step.current").getByRole("button", { name: "Fail" }).click();

  const report = await page.evaluate(() =>
    JSON.parse(window.__OE_REVIEW_TEST__.buildReport().json),
  );
  const failed = report.checklist[0].steps[0];
  expect(failed.mark).toBe("fail");
  expect(failed.actualUrl).toContain("app-fixture.html");
  expect(failed.consoleErrors.join(" ")).toContain("worklist filter blew up");
});
