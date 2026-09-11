import { expect, test } from "@playwright/test";

async function open(page) {
  await page.goto("/tests/widget/app-fixture.html");
  const widget = page.locator("#oe-review-host");
  await widget.getByRole("button", { name: "Review", exact: false }).click();
  await expect(widget.locator(".panel")).toBeVisible();
  return widget;
}

test("desktop compact panel leaves room for the app and expands to the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const widget = await open(page);
  const compact = await widget.locator(".panel").boundingBox();
  expect(compact.width).toBe(720);
  expect(compact.height).toBe(520);
  await widget.getByRole("button", { name: "Expand panel" }).click();
  const expanded = await widget.locator(".panel").boundingBox();
  expect(expanded).toEqual({ x: 16, y: 16, width: 1408, height: 868 });
  await widget.getByRole("button", { name: "Collapse panel" }).press("Escape");
  await expect(widget.locator(".panel")).not.toHaveClass(/expanded/);
  await expect(
    widget.getByRole("button", { name: "Expand panel" }),
  ).toBeFocused();
});

test("mobile expansion gains height and every answer control stays within its panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const widget = await open(page);
  const compact = await widget.locator(".panel").boundingBox();
  await widget.getByRole("button", { name: "Expand panel" }).click();
  const expanded = await widget.locator(".panel").boundingBox();
  expect(expanded.height).toBeGreaterThan(compact.height + 250);
  expect(expanded).toEqual({ x: 8, y: 8, width: 374, height: 828 });
  const overflows = await widget.locator(".panel").evaluate((panel) => {
    const edge = panel.getBoundingClientRect();
    return [...panel.querySelectorAll(".mark,.stepnote,.expect")].some(
      (node) => {
        const box = node.getBoundingClientRect();
        return box.left < edge.left || box.right > edge.right;
      },
    );
  });
  expect(overflows).toBe(false);
});

test("secondary panel controls remain reachable through one labelled menu", async ({
  page,
}) => {
  const widget = await open(page);
  await expect(widget.locator(".head").getByRole("button")).toHaveCount(3);
  await expect(
    widget.locator(".head").getByRole("button", { name: /Pop out/ }),
  ).toBeVisible();
  await expect(
    widget.getByRole("button", { name: "Refresh checklist" }),
  ).toBeHidden();
  await widget.getByRole("button", { name: "More review actions" }).click();
  await expect(
    widget.getByRole("button", { name: "Refresh checklist" }),
  ).toBeVisible();
  await expect(
    widget.getByRole("button", { name: "Move panel" }),
  ).toBeVisible();
  await expect(
    widget.locator(".moremenu").getByRole("button", { name: /Pop out/ }),
  ).toHaveCount(0);
});

test("expansion and menu dismissal retain the reviewer's name, notes, and answers", async ({
  page,
}) => {
  const widget = await open(page);
  await widget.getByLabel("Your name").fill("QA reviewer");
  const first = widget.locator(".step").first();
  await first.locator(".stepnote").fill("Recorded in compact view");
  await first.getByRole("button", { name: "Fail", exact: true }).click();
  await widget.getByRole("button", { name: "Expand panel" }).click();
  await widget.getByRole("button", { name: "More review actions" }).click();
  await widget.locator(".moremenu").press("Escape");
  await expect(widget.locator(".moremenu")).toBeHidden();
  await expect(widget.locator(".panel")).toHaveClass(/expanded/);
  await expect(first.locator(".stepnote")).toHaveValue(
    "Recorded in compact view",
  );
  await widget.getByRole("button", { name: "Collapse panel" }).click();
  await expect(first).toHaveAttribute("data-state", "fail");
  await expect(widget.getByLabel("Your name")).toHaveValue("QA reviewer");
});

test("story search matches stable keys, explains empty results, and supports keyboard selection", async ({
  page,
}) => {
  const widget = await open(page);
  await widget.getByRole("button", { name: "Choose story" }).click();
  await widget
    .getByRole("button", { name: /Show all .* server stories/ })
    .click();
  const search = widget.getByRole("searchbox", { name: "Find a story" });
  await search.fill("no such story");
  await expect(
    widget.getByText("No matching stories. Try another search."),
  ).toBeVisible();
  await search.fill("AMR-S03");
  await expect(widget.getByRole("option")).toHaveCount(1);
  await search.press("ArrowDown");
  await expect(widget.getByRole("option")).toBeFocused();
  await widget.getByRole("option").press("Enter");
  await expect(widget.locator(".storytrigger")).toContainText(
    "AST, critical communication, and reporting",
  );
  await expect(widget.locator(".step")).toHaveCount(3);
});
