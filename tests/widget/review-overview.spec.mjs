import { expect, test } from "@playwright/test";
import { panelAction } from "./helpers.mjs";

const APP = "/tests/widget/app-fixture.html";
test.use({ viewport: { width: 1440, height: 900 }, video: "on" });

async function open(page) {
  await page.goto(APP);
  const widget = page.locator("#oe-review-host");
  await widget.locator(".tab").click();
  await expect(widget.locator(".storymenu")).toBeVisible();
  return widget;
}

test("first open presents reviews before any checkpoint, even without configured suggestions", async ({
  page,
}) => {
  const widget = await open(page);
  await expect(widget.locator(".step").first()).toBeHidden();
  await expect(widget.locator(".storylist").getByRole("option")).toHaveCount(1);
  await expect(
    widget.getByRole("button", { name: "Browse all 4 reviews" }),
  ).toBeVisible();
  await widget.getByRole("button", { name: "Browse all 4 reviews" }).click();
  await widget.getByRole("searchbox", { name: "Find a story" }).fill("OGC-782");
  await expect(widget.locator(".storylist").getByRole("option")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
});

test("review overview offers saved work and preserves a problem draft through return and reload", async ({
  page,
}) => {
  const widget = await open(page);
  await widget.getByRole("option", { name: /Find and route/ }).click();
  await widget
    .locator(".step.current")
    .getByRole("button", { name: "There was a problem" })
    .click();
  await widget
    .getByRole("textbox", { name: "Explain this answer" })
    .fill("The workspace did not open.");
  await widget.getByRole("button", { name: "Choose story" }).click();
  await expect(widget.locator(".step").first()).toBeHidden();
  await expect(
    widget.getByRole("button", { name: /Continue:.*Find and route/ }),
  ).toBeVisible();
  await page.reload();
  await expect(widget.locator(".storymenu")).toBeVisible();
  await widget
    .getByRole("button", { name: /Continue:.*Find and route/ })
    .click();
  await expect(
    widget.getByRole("textbox", { name: "Explain this answer" }),
  ).toHaveValue("The workspace did not open.");
  await expect(widget.locator(".step.current")).toHaveAttribute(
    "data-state",
    "fail",
  );
});

test("reset returns to the review overview instead of starting the same story again", async ({
  page,
}) => {
  const widget = await open(page);
  await widget.getByRole("option", { name: /Find and route/ }).click();
  await widget
    .locator(".step.current")
    .getByRole("button", { name: "Worked as expected" })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await panelAction(widget, "Reset review");
  await expect(widget.locator(".storymenu")).toBeVisible();
  await expect(widget.locator(".step").first()).toBeHidden();
  await expect(widget.locator(".storycontinue")).toBeHidden();
});

test("following an application link preserves the chosen review", async ({
  page,
}) => {
  const widget = await open(page);
  await widget.getByRole("option", { name: /Find and route/ }).click();
  await widget
    .locator(".step.current")
    .getByRole("button", { name: "Worked as expected" })
    .click();
  await page.getByRole("button", { name: "Go to worklist" }).click();
  await expect(widget.locator(".storytriggertitle")).toContainText(
    "Find and route",
  );
  await expect(widget.locator(".step.current")).toContainText(
    "Set Workflow to Bacteriology",
  );
  await widget.getByRole("button", { name: "Choose story" }).click();
  await widget
    .getByRole("button", { name: "In progress (1)", exact: true })
    .click();
  await expect(widget.locator(".storylist").getByRole("option")).toHaveCount(1);
  await expect(widget.locator(".storylist")).toContainText("Find and route");
});

test("a popped-out overview returns without opening an unchosen checklist", async ({
  page,
}) => {
  const widget = await open(page);
  const opened = page.waitForEvent("popup");
  await widget.getByRole("button", { name: /Pop out/ }).click();
  const popup = await opened;
  const review = popup.locator("#oe-review-host");
  await expect(review.locator(".storymenu")).toBeVisible();
  await expect(review.locator(".step").first()).toBeHidden();
  await review
    .getByRole("button", { name: "Return the checklist to the page" })
    .click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(widget.locator(".storymenu")).toBeVisible();
  await expect(widget.locator(".step").first()).toBeHidden();
});

test("the overview remains usable in either side dock and the bottom split", async ({
  page,
}, testInfo) => {
  const widget = await open(page);
  for (const placement of ["right", "left", "bottom"]) {
    await widget.getByLabel("Review placement").selectOption(placement);
    await expect(
      widget.getByRole("searchbox", { name: "Find a story" }),
    ).toBeInViewport();
    await expect(
      widget.getByRole("button", { name: "Browse all 4 reviews" }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath("overview-" + placement + ".png"),
    });
  }
  const divider = widget.getByRole("separator", {
    name: "Resize review panel",
  });
  const before = await widget.locator(".panel").boundingBox();
  await divider.focus();
  await divider.press("ArrowUp");
  const after = await widget.locator(".panel").boundingBox();
  expect(after.height).toBeGreaterThan(before.height);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeInViewport();
});
