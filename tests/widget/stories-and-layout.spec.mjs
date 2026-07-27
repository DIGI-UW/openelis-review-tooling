import { expect, test } from "@playwright/test";

// app-fixture.html is served at /tests/widget/app-fixture.html and its checklist
// at /tests/widget/uat-amr.json, so the catalog sits alongside at uat-index.json.
// The "orders" story claims the fixture's own path; "amr" claims /Dashboard and
// /Microbiology/worklist, so exactly one of them covers the page under test.
const APP = "/tests/widget/app-fixture.html";

async function openPanel(page) {
  await page.goto(APP);
  const widget = page.locator("#oe-review-host");
  await widget.getByRole("button", { name: /review/i }).click();
  await expect(widget.locator(".panel")).toBeVisible();
  return widget;
}

test("separates the stories that cover this page from the rest", async ({ page }) => {
  const widget = await openPanel(page);
  const picker = widget.getByLabel("Story");
  await expect(picker).toBeVisible();

  const groups = await picker.locator("optgroup").evaluateAll((nodes) =>
    nodes.map((node) => ({
      label: node.label,
      options: [...node.querySelectorAll("option")].map((option) => option.value),
    })),
  );
  expect(groups).toEqual([
    { label: "On this page", options: ["orders"] },
    { label: "Other stories", options: ["amr"] },
  ]);
  await expect(picker).toHaveValue("amr");
});

test("switching story loads its checklist and keeps the answers apart", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await widget.locator(".step.current .detail").getByRole("button", { name: "Pass" }).click();
  await expect(widget.locator(".step").nth(0).locator(".chip")).toHaveText("Pass");

  await widget.getByLabel("Story").selectOption("orders");
  await expect(widget.getByRole("heading", { level: 2 })).toHaveText("Order entry review");
  await expect(widget.locator(".step")).toHaveCount(2);
  await expect(widget.locator(".step").nth(0).locator(".chip")).toHaveText("To do");

  await widget.getByLabel("Story").selectOption("amr");
  await expect(widget.locator(".step")).toHaveCount(10);
  await expect(widget.locator(".step").nth(0).locator(".chip")).toHaveText("Pass");
});

test("remembers the story the reviewer was last working on", async ({ page }) => {
  const widget = await openPanel(page);
  await widget.getByLabel("Story").selectOption("orders");
  await expect(widget.locator(".step")).toHaveCount(2);

  await page.reload();
  const reopened = page.locator("#oe-review-host");
  await expect(reopened.getByRole("heading", { level: 2 })).toHaveText("Order entry review");
  await expect(reopened.getByLabel("Story")).toHaveValue("orders");
});

test("expands to show every step in full, and comes back", async ({ page }) => {
  const widget = await openPanel(page);
  const compact = await widget.locator(".panel").boundingBox();
  await expect(widget.locator(".expect")).toHaveCount(1);

  await widget.getByRole("button", { name: "Expand panel" }).click();
  const expanded = await widget.locator(".panel").boundingBox();
  expect(expanded.width).toBeGreaterThan(compact.width);
  await expect(widget.locator(".expect")).toHaveCount(10);
  await expect(
    widget.locator(".step").nth(9).getByRole("button", { name: "Pass" }),
  ).toBeVisible();

  // Expanding is worth nothing if each step simply gets taller: the extra width
  // has to buy a shorter step, so more of the checklist is on screen.
  const compactStep = await widget.locator(".step.current").boundingBox();
  await widget.getByRole("button", { name: "Collapse panel" }).click();
  await expect(widget.locator(".expect")).toHaveCount(1);
  const collapsedStep = await widget.locator(".step.current").boundingBox();
  expect(compactStep.height).toBeLessThan(collapsedStep.height);
});

test("never grows its own header off the top of the screen", async ({ page }) => {
  const widget = await openPanel(page);
  await widget.getByRole("button", { name: "Expand panel" }).click();

  const [panel, appHeader] = await Promise.all([
    widget.locator(".panel").boundingBox(),
    page.locator(".cds--header").boundingBox(),
  ]);
  // Anchored to the bottom, a panel taller than the viewport slides its own
  // controls up under the application's fixed header, where they cannot be
  // clicked at all.
  expect(panel.y).toBeGreaterThanOrEqual(appHeader.y + appHeader.height);
  await expect(widget.getByRole("button", { name: "Collapse panel" })).toBeInViewport();
});

test("shows how far each section has got", async ({ page }) => {
  const widget = await openPanel(page);
  const first = widget.locator(".secrow").first();
  await expect(first.locator(".seccount")).toHaveText("0/3");

  await widget.locator(".step.current .detail").getByRole("button", { name: "Pass" }).click();
  await expect(first.locator(".seccount")).toHaveText("1/3");
});

test("filters down to what still needs doing, and to what failed", async ({ page }) => {
  const widget = await openPanel(page);
  const steps = widget.locator(".step");
  await steps.nth(0).locator(".steptop").click();
  await widget.locator(".step.current .detail").getByRole("button", { name: "Pass" }).click();
  await steps.nth(1).locator(".steptop").click();
  await widget.locator(".step.current .detail").getByRole("button", { name: "Fail" }).click();

  await widget.getByRole("button", { name: "To do", exact: true }).click();
  await expect(steps.nth(0)).toBeHidden();
  await expect(steps.nth(1)).toBeHidden();
  await expect(steps.nth(2)).toBeVisible();

  await widget.getByRole("button", { name: "Failed", exact: true }).click();
  await expect(steps.nth(0)).toBeHidden();
  await expect(steps.nth(1)).toBeVisible();
  await expect(steps.nth(2)).toBeHidden();

  await widget.getByRole("button", { name: "All", exact: true }).click();
  await expect(steps.nth(0)).toBeVisible();
  await expect(steps.nth(2)).toBeVisible();
});

test("keeps how the panel was set up across a reload", async ({ page }) => {
  const widget = await openPanel(page);
  await widget.getByRole("button", { name: "Expand panel" }).click();
  await widget.getByRole("button", { name: /move/i }).click();
  const arranged = await widget.locator(".panel").boundingBox();

  await page.reload();
  const reopened = page.locator("#oe-review-host");
  await expect(reopened.locator(".expect")).toHaveCount(10);
  const restored = await reopened.locator(".panel").boundingBox();
  expect(restored.x).toBeCloseTo(arranged.x, 0);
  expect(restored.width).toBeCloseTo(arranged.width, 0);
});

test("offers no story switcher when there is no catalog to switch between", async ({
  page,
}) => {
  // The analyzers fixture points data-src at uat.json, which is not the
  // uat-<story>.json shape a catalog can be derived from.
  await page.goto("/");
  const widget = page.locator("#oe-review-host");
  await widget.getByRole("button", { name: /review/i }).click();
  await expect(widget.locator(".panel")).toBeVisible();
  await expect(widget.locator(".stories")).toHaveCount(0);
});
