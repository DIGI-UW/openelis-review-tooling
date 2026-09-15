import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const longReportingStep = JSON.parse(
  readFileSync(new URL("./long-reporting-step.json", import.meta.url), "utf8"),
);

for (const entry of ["select", "advance"]) {
  test(`keeps a long checkpoint's beginning visible on ${entry}`, async ({
    page,
  }, testInfo) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/tests/widget/uat-amr.json", async (route) => {
      const response = await route.fetch();
      const checklist = await response.json();
      Object.assign(checklist.sections[0].steps[1], longReportingStep);
      await route.fulfill({ response, json: checklist });
    });
    const widget = await open(page, 1280, 720);
    await widget.getByLabel("Review placement").selectOption("bottom");
    const appScroll = await page.evaluate(() => window.scrollY);
    if (entry === "select") {
      await widget.locator(".step").nth(1).locator(".steptop").click();
    } else {
      await widget.locator(".step.current .steptop").click();
      await widget
        .locator(".step.current")
        .getByRole("button", {
          name: "Worked as expected",
          exact: true,
        })
        .click();
    }
    const current = widget.locator(".step.current");
    await expect(current).toContainText("Non-Conformance");
    const [view, start, step] = await Promise.all([
      widget.locator(".body").boundingBox(),
      current
        .locator(".steplabel .instructionlist")
        .getByRole("listitem")
        .first()
        .boundingBox(),
      current.boundingBox(),
    ]);
    expect(step.height).toBeGreaterThan(view.height);
    // A 340px bottom pane must leave room for several instruction lines;
    // collecting a name and optional notes must not pin them over the task.
    expect(view.height).toBeGreaterThanOrEqual(140);
    expect(start.y).toBeGreaterThanOrEqual(view.y);
    expect(start.y + start.height).toBeLessThanOrEqual(view.y + view.height);
    await expect(current.locator(".steptop")).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(appScroll);
    await expect(
      current.locator(".expecttext .instructionlist").getByRole("listitem"),
    ).toHaveCount(6);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("checkpoint-visible.png"),
    });
  });
}

async function open(page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto("/tests/widget/app-fixture.html");
  const widget = page.locator("#oe-review-host");
  await widget.getByRole("button", { name: "Review", exact: false }).click();
  await expect(widget.locator(".panel")).toBeVisible();
  await widget
    .getByRole("option", { name: /Find and route microbiology/ })
    .click();
  return widget;
}

test("uses a reserved right pane on a wide screen", async ({ page }) => {
  const widget = await open(page);
  await expect(widget.locator(".wrap")).toHaveClass(/dock-right/);
  await expect(widget.getByLabel("Review placement")).toHaveValue("right");
  const [panel, body, header] = await Promise.all([
    widget.locator(".panel").boundingBox(),
    page.locator("body").boundingBox(),
    page.locator(".cds--header").boundingBox(),
  ]);
  expect(panel).toEqual({ x: 1040, y: 0, width: 400, height: 900 });
  expect(body.width).toBe(1040);
  expect(header.width).toBe(1040);
});

test("uses a reserved bottom pane when side-by-side would be cramped", async ({
  page,
}) => {
  const widget = await open(page, 625, 844);
  await expect(widget.locator(".wrap")).toHaveClass(/dock-bottom/);
  const [panel, body, save] = await Promise.all([
    widget.locator(".panel").boundingBox(),
    page.locator("body").boundingBox(),
    page.getByRole("button", { name: "Save" }).boundingBox(),
  ]);
  expect(panel).toEqual({ x: 0, y: 504, width: 625, height: 340 });
  expect(body.height).toBe(504);
  expect(save.y + save.height).toBeLessThanOrEqual(504);
});

test("keeps placement compact and secondary actions in one menu", async ({
  page,
}) => {
  const widget = await open(page);
  const placement = widget.getByLabel("Review placement");
  await expect(placement.locator("option")).toHaveText([
    "Right",
    "Left",
    "Bottom",
  ]);
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
  await expect(widget.getByRole("button", { name: "Move panel" })).toHaveCount(
    0,
  );
});

test("moves between every dock and remembers the choice", async ({ page }) => {
  const widget = await open(page);
  const placement = widget.getByLabel("Review placement");
  await placement.selectOption("left");
  await expect(widget.locator(".wrap")).toHaveClass(/dock-left/);
  await expect(page.locator("body")).toHaveCSS("margin-left", "400px");
  await placement.selectOption("bottom");
  await expect(widget.locator(".wrap")).toHaveClass(/dock-bottom/);
  await page.reload();
  await expect(widget.locator(".panel")).toBeVisible();
  await expect(widget.getByLabel("Review placement")).toHaveValue("bottom");
});

test("resizes a bottom split with the keyboard and remembers it", async ({
  page,
}) => {
  const widget = await open(page);
  await widget.getByLabel("Review placement").selectOption("bottom");
  const before = await widget.locator(".panel").boundingBox();
  const splitter = widget.getByRole("separator", {
    name: "Resize review panel",
  });
  await splitter.focus();
  await splitter.press("ArrowUp");
  const after = await widget.locator(".panel").boundingBox();
  expect(after.height).toBe(before.height + 10);
  await page.reload();
  await expect(widget.locator(".panel")).toHaveCSS(
    "height",
    `${after.height}px`,
  );
});

test("requires an explanation for problems and preserves unfinished drafts", async ({
  page,
}) => {
  const widget = await open(page);
  const current = widget.locator(".step.current");
  await current.getByRole("button", { name: "There was a problem" }).click();
  await expect(current).toHaveClass(/current/);
  const explanation = current.getByLabel("Explain this answer");
  await expect(explanation).toBeFocused();
  await expect(
    current.getByRole("button", { name: "Continue" }),
  ).toBeDisabled();
  await explanation.fill("The expected result did not appear");
  await expect(current.getByRole("button", { name: "Continue" })).toBeEnabled();

  await widget.getByRole("button", { name: "+ Note about this page" }).click();
  await widget.getByLabel("Note about this page").fill("unfinished page note");
  await page.reload();
  await expect(widget.locator(".panel")).toBeVisible();
  await expect(widget.locator(".step").first()).toHaveAttribute(
    "data-state",
    "fail",
  );
  await expect(widget.getByLabel("Explain this answer")).toHaveValue(
    "The expected result did not appear",
  );
  await expect(widget.getByLabel("Note about this page")).toHaveValue(
    "unfinished page note",
  );
});

test("renders newline-separated instructions as compact labelled lists", async ({
  page,
}) => {
  await page.route("**/tests/widget/uat-amr.json", async (route) => {
    const response = await route.fetch();
    const checklist = await response.json();
    checklist.sections[0].steps[0].do =
      "Report type: Select Referrals.\nFields: Add Accession Number and Referral ID.\nDate range: Use May 7, 2026.\nNext: Continue to Review.";
    checklist.sections[0].steps[0].expect =
      "Fields: The chosen fields appear in order.\nScope: The review only includes referrals.";
    await route.fulfill({ response, json: checklist });
  });

  const widget = await open(page);
  const current = widget.locator(".step.current");
  const actions = current.locator(".steplabel .instructionlist");
  const outcomes = current.locator(".expecttext .instructionlist");

  await expect(actions).toBeVisible();
  await expect(actions.getByRole("listitem")).toHaveCount(4);
  await expect(actions.locator(".instructionlabel")).toHaveText([
    "Report type:",
    "Fields:",
    "Date range:",
    "Next:",
  ]);
  await expect(outcomes.getByRole("listitem")).toHaveCount(2);
  await expect(outcomes.locator(".instructionlabel")).toHaveText([
    "Fields:",
    "Scope:",
  ]);
  await expect(current.locator(".instructionsummary")).toHaveCount(2);
  await expect(current.locator(".instructionsummary:visible")).toHaveCount(0);
});

test("story search matches ticket and stable key and supports keyboard selection", async ({
  page,
}) => {
  const widget = await open(page);
  const menu = widget.locator(".storymenu");
  if (!(await menu.isVisible())) {
    await widget.getByRole("button", { name: "Choose story" }).click();
  }
  const browse = widget.getByRole("button", { name: /Browse all/ });
  if (await browse.isVisible()) await browse.click();
  const search = widget.getByRole("searchbox", { name: "Find a story" });
  await search.fill("no such story");
  await expect(
    widget.getByText("No matching stories. Try another search."),
  ).toBeVisible();
  await search.fill("AMR-S03");
  await expect(widget.locator(".storylist").getByRole("option")).toHaveCount(1);
  await search.press("ArrowDown");
  await expect(widget.locator(".storylist").getByRole("option")).toBeFocused();
});

test("opens on deployment suggestions and keeps browsing secondary", async ({
  page,
}) => {
  await page.goto("/tests/widget/suggested-fixture.html");
  const widget = page.locator("#oe-review-host");
  await widget.getByRole("button", { name: /review/i }).click();
  await expect(widget.locator(".storymenu")).toBeVisible();
  await expect(widget.locator(".storymenutitle")).toHaveText(
    "Suggested reviews for this deployment",
  );
  await expect(widget.locator(".storylist").getByRole("option")).toHaveCount(2);
  await expect(widget.locator(".storynotice")).toBeHidden();
  await expect(
    widget.getByRole("button", { name: "Browse all 4 reviews" }),
  ).toBeVisible();
});
