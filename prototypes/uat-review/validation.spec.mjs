import { expect, test } from "@playwright/test";

const ROUTINE = "Download a routine report";
const NAVIGATION = "Find reports and keep your place";

function guide(page) {
  return page.getByRole("complementary", { name: "Review guide" });
}

async function open(page) {
  await page.goto("/");
  await expect(
    guide(page).getByRole("heading", { name: "Choose a review" }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator("iframe")
      .getByRole("heading", { name: "Custom Data Export", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  return guide(page);
}

async function start(page, title = ROUTINE) {
  const panel = await open(page);
  await panel.getByRole("button", { name: `Start review: ${title}` }).click();
  return panel;
}

async function visibleOutcomes(panel) {
  for (const name of [
    "Worked as expected",
    "There was a problem",
    "I couldn’t try this",
  ]) {
    await expect(
      panel.getByRole("button", { name, exact: true }),
    ).toBeInViewport({ ratio: 1 });
  }
}

async function lastNavigationStep(page) {
  const response = await page.request.get("/stories.json");
  expect(response.ok()).toBe(true);
  const catalog = await response.json();
  return catalog.stories
    .find((story) => story.title === NAVIGATION)
    .steps.at(-1);
}

async function bounds(page, direction) {
  const [app, panel] = await Promise.all([
    page.getByTitle("Approved OpenELIS Reporting design").boundingBox(),
    guide(page).boundingBox(),
  ]);
  expect(app.width).toBeGreaterThan(0);
  expect(app.height).toBeGreaterThan(0);
  expect(panel.width).toBeGreaterThan(0);
  expect(panel.height).toBeGreaterThan(0);
  if (direction === "right")
    expect(app.x + app.width).toBeLessThanOrEqual(panel.x);
  if (direction === "left")
    expect(panel.x + panel.width).toBeLessThanOrEqual(app.x);
  if (direction === "bottom")
    expect(app.y + app.height).toBeLessThanOrEqual(panel.y);
  expect(panel.x + panel.width).toBeLessThanOrEqual(
    page.viewportSize().width + 1,
  );
  expect(panel.y + panel.height).toBeLessThanOrEqual(
    page.viewportSize().height + 1,
  );
  return { app, panel };
}

test.beforeEach(async ({ page }, testInfo) => {
  const errors = [];
  const uncaught = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    uncaught.push(error.message);
  });
  page.on("console", (entry) => {
    if (entry.type() === "error") errors.push(entry.text());
  });
  testInfo.consoleErrors = errors;
  testInfo.uncaughtErrors = uncaught;
});

test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach("browser-errors", {
    body: testInfo.consoleErrors.join("\n") || "No browser errors recorded.",
    contentType: "text/plain",
  });
  if (testInfo.status === "passed") {
    await expect(
      page
        .frameLocator("iframe")
        .getByRole("heading", { name: "Custom Data Export", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  }
  await testInfo.attach("review-state", {
    body: await page.screenshot({ fullPage: false }),
    contentType: "image/png",
  });
  expect(
    testInfo.uncaughtErrors,
    "Neither the guide nor its application reference should throw",
  ).toEqual([]);
});

test("suggested reviews explain their purpose, support search, and resume unfinished work", async ({
  page,
}) => {
  const panel = await open(page);
  await expect(
    panel.getByText("Suggested for this preview", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText(
      "Check a sample report from choosing columns to downloading and revisiting it.",
    ),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Browse all reviews or search", exact: true })
    .click();
  await panel.getByLabel("Find a review").fill("OGC-479");
  await expect(
    panel.getByRole("button", { name: `Start review: ${ROUTINE}` }),
  ).toBeVisible();
  await panel.getByLabel("Find a review").fill("keep your place");
  await expect(
    panel.getByRole("button", { name: `Start review: ${NAVIGATION}` }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: `Start review: ${ROUTINE}` }),
  ).toHaveCount(0);
  await panel.getByLabel("Find a review").fill("no matching review");
  await expect(panel.getByText(/No matching reviews/)).toBeVisible();
  await panel.getByLabel("Find a review").fill("");
  await panel.getByRole("button", { name: `Start review: ${ROUTINE}` }).click();
  await panel
    .getByRole("button", { name: "Worked as expected", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Choose and arrange columns" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: /Choose another review/ }).click();
  await panel
    .getByRole("button", { name: `Continue review: ${ROUTINE}` })
    .first()
    .click();
  await expect(
    panel.getByRole("heading", { name: "Choose and arrange columns" }),
  ).toBeVisible();
});

test("a long checkpoint retains all criteria and pauses on problems until explained", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const panel = await start(page, NAVIGATION);
  await visibleOutcomes(panel);
  await panel
    .getByRole("button", { name: "Worked as expected", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Worked as expected", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Use reporting controls with the keyboard",
    }),
  ).toBeVisible();
  await visibleOutcomes(panel);
  const checkpoint = await lastNavigationStep(page);
  for (const text of checkpoint.expectations) {
    await expect(panel.getByText(text, { exact: true })).toHaveCount(1);
    await panel.getByText(text, { exact: true }).scrollIntoViewIfNeeded();
    await expect(panel.getByText(text, { exact: true })).toBeInViewport({
      ratio: 1,
    });
  }
  await panel.getByText("Need a little guidance?", { exact: true }).click();
  await expect(
    panel.getByText(checkpoint.help.paragraphs.at(-1), { exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "There was a problem", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Use reporting controls with the keyboard",
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  await panel
    .getByLabel("What happened?")
    .fill("The sidebar covers the page heading.");
  await expect(
    panel.getByRole("button", { name: "Continue", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await panel.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "Review summary" }),
  ).toBeVisible();
  await panel
    .getByRole("button", {
      name: "Use reporting controls with the keyboard",
      exact: true,
    })
    .click();
  await expect(panel.getByLabel("What happened?")).toHaveValue(
    "The sidebar covers the page heading.",
  );
  await expect(
    panel.getByRole("button", { name: "Continue", exact: true }),
  ).toBeInViewport({ ratio: 1 });
});

test("unable to try stays distinct from success and keeps its explanation", async ({
  page,
}) => {
  const panel = await start(page);
  await panel
    .getByRole("button", { name: "I couldn’t try this", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Start a report" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  await panel
    .getByLabel("What happened?")
    .fill("I could not find the supplied demonstration account.");
  await panel.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "Choose and arrange columns" }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Review summary", exact: true })
    .click();
  await expect(panel.getByText("Couldn’t try", { exact: true })).toBeVisible();
  await expect(panel.getByText("Not applicable", { exact: true })).toHaveCount(
    0,
  );
  await panel
    .getByRole("button", { name: "Start a report", exact: true })
    .click();
  await expect(panel.getByLabel("What happened?")).toHaveValue(
    "I could not find the supplied demonstration account.",
  );
});

test("partial feedback survives failed submission and reload before successful demo save", async ({
  page,
}) => {
  const panel = await start(page);
  await panel
    .getByRole("button", { name: "Worked as expected", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Review summary", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Review summary" }),
  ).toBeVisible();
  await expect(
    panel.getByText(
      "1 of 6 checkpoints answered. You can send partial feedback.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(panel.getByText("Not answered", { exact: true })).toHaveCount(5);
  await panel.getByLabel("Reviewer name").fill("Prototype Reviewer");
  await panel
    .getByLabel("Overall note")
    .fill("Please retain this draft until the submission succeeds.");
  await page.getByText("Preview tools", { exact: true }).click();
  await page.getByLabel("Simulate a submission failure").check();
  await page.getByText("Preview tools", { exact: true }).click();
  await panel
    .getByRole("button", { name: "Submit feedback", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "Demo feedback saved" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(panel.getByLabel("Reviewer name")).toHaveValue(
    "Prototype Reviewer",
  );
  await expect(panel.getByLabel("Overall note")).toHaveValue(
    "Please retain this draft until the submission succeeds.",
  );
  await expect(
    panel.getByText(
      "1 of 6 checkpoints answered. You can send partial feedback.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(panel.getByText("Not answered", { exact: true })).toHaveCount(5);
  await page.getByText("Preview tools", { exact: true }).click();
  await page.getByLabel("Simulate a submission failure").uncheck();
  await page.getByText("Preview tools", { exact: true }).click();
  await panel
    .getByRole("button", { name: "Submit feedback", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Demo feedback saved" }),
  ).toBeVisible();
});

test("left and right docks reserve application space and allow app navigation", async ({
  page,
}) => {
  const panel = await open(page);
  await bounds(page, "right");
  const app = page.frameLocator("iframe");
  await expect(
    app.getByRole("heading", { name: "Custom Data Export", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Left", exact: true }).click();
  await bounds(page, "left");
  await app
    .getByRole("button", { name: "Start a new export", exact: true })
    .click();
  await app.getByRole("radio", { name: /Sample & Testing/ }).click();
  await expect(
    app.getByRole("searchbox", { name: "Find a field", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Right", exact: true }).click();
  await bounds(page, "right");
  await app
    .getByRole("button", { name: "My Report Queue", exact: true })
    .click();
  await expect(
    app.getByRole("heading", { name: "My Report Queue", exact: true }),
  ).toBeVisible();
  await app
    .getByRole("button", { name: "Continue current export", exact: true })
    .click();
  await expect(
    app.getByRole("searchbox", { name: "Find a field", exact: true }),
  ).toBeVisible();
});

test("bottom split resizes by keyboard and pointer without losing the current note", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1128, height: 927 });
  const panel = await start(page);
  await panel.getByRole("button", { name: "Bottom", exact: true }).click();
  await panel
    .getByRole("button", { name: "There was a problem", exact: true })
    .click();
  await panel
    .getByLabel("What happened?")
    .fill("Draft written before moving the divider.");
  const initial = await bounds(page, "bottom");
  const splitter = page.getByRole("separator", { name: "Resize review guide" });
  await expect(splitter).toHaveAttribute("aria-orientation", "horizontal");
  await splitter.focus();
  await splitter.press("ArrowUp");
  const enlarged = await bounds(page, "bottom");
  expect(enlarged.panel.height).toBeGreaterThan(initial.panel.height);
  const handle = await splitter.boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 70, {
    steps: 5,
  });
  await page.mouse.up();
  const dragged = await bounds(page, "bottom");
  expect(dragged.panel.height).toBeGreaterThan(enlarged.panel.height + 40);
  await expect(panel.getByLabel("What happened?")).toHaveValue(
    "Draft written before moving the divider.",
  );
  await page.reload();
  await expect(
    panel.getByRole("heading", { name: "Start a report" }),
  ).toBeVisible();
  await expect(panel.getByLabel("What happened?")).toHaveValue(
    "Draft written before moving the divider.",
  );
  const restored = await bounds(page, "bottom");
  expect(
    Math.abs(restored.panel.height - dragged.panel.height),
  ).toBeLessThanOrEqual(1);
});

test("popout and return preserve the current checkpoint and unsent notes", async ({
  page,
}) => {
  const panel = await start(page);
  await panel
    .getByRole("button", { name: "Worked as expected", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "There was a problem", exact: true })
    .click();
  await panel
    .getByLabel("What happened?")
    .fill("Draft before opening another window.");
  const popupPromise = page.waitForEvent("popup");
  await panel
    .getByRole("button", { name: "Open in separate window", exact: true })
    .click();
  const popup = await popupPromise;
  const popped = guide(popup);
  await expect(
    popped.getByRole("heading", { name: "Choose and arrange columns" }),
  ).toBeVisible();
  await expect(popped.getByLabel("What happened?")).toHaveValue(
    "Draft before opening another window.",
  );
  await popped
    .getByLabel("What happened?")
    .fill("Edited in the separate window.");
  await popped
    .getByRole("button", { name: "Return to application", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Choose and arrange columns" }),
  ).toBeVisible();
  await expect(panel.getByLabel("What happened?")).toHaveValue(
    "Edited in the separate window.",
  );
  await panel.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "Download the spreadsheet" }),
  ).toBeVisible();
});

test("application and review content scroll independently in the bottom split", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1128, height: 927 });
  const panel = await start(page, NAVIGATION);
  await panel.getByRole("button", { name: "Bottom", exact: true }).click();
  await panel
    .getByRole("button", { name: "Worked as expected", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Worked as expected", exact: true })
    .click();
  await panel.getByText("Need a little guidance?", { exact: true }).click();
  const checkpoint = await lastNavigationStep(page);
  const app = page.frameLocator("iframe");
  await app
    .getByRole("button", { name: "Start a new export", exact: true })
    .click();
  await app.getByRole("radio", { name: /Sample & Testing/ }).click();
  const reviewScroller = panel.locator("#guide-content");
  const appScroller = app.locator(".main-content:visible");
  const guideBefore = await reviewScroller.evaluate(
    (element) => element.scrollTop,
  );
  await app
    .getByRole("button", { name: /Next: Set Filters/ })
    .scrollIntoViewIfNeeded();
  await expect
    .poll(() => appScroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await reviewScroller.evaluate((element) => element.scrollTop)).toBe(
    guideBefore,
  );
  const appBefore = await appScroller.evaluate((element) => element.scrollTop);
  await panel
    .getByText(checkpoint.help.paragraphs.at(-1), { exact: true })
    .scrollIntoViewIfNeeded();
  expect(await appScroller.evaluate((element) => element.scrollTop)).toBe(
    appBefore,
  );
  await bounds(page, "bottom");
});

test("changed instructions require a fresh answer while preserving earlier feedback", async ({
  page,
}) => {
  const panel = await start(page);
  await panel
    .getByRole("button", { name: "There was a problem", exact: true })
    .click();
  await panel
    .getByLabel("What happened?")
    .fill("The original instructions were unclear here.");
  await panel
    .getByRole("button", { name: "Review summary", exact: true })
    .click();
  await panel.getByLabel("Reviewer name").fill("Revision Reviewer");
  await panel
    .getByLabel("Overall note")
    .fill("Keep the earlier review for comparison.");
  await panel
    .getByRole("button", { name: "Submit feedback", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Demo feedback saved" }),
  ).toBeVisible();

  const response = await page.request.get("/stories.json");
  const revised = await response.json();
  const item = revised.stories.find((story) => story.title === ROUTINE);
  item.source.instructionRevision += "-new-instructions";
  item.steps[0].expectations.push(
    "The review now includes this additional visible criterion.",
  );
  await page.route("**/stories.json", (route) =>
    route.fulfill({ json: revised }),
  );
  await page.reload();

  await expect(panel.getByText(/The demo instructions changed/)).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "Demo feedback saved" }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("heading", { name: "Review summary" }),
  ).toBeVisible();
  await expect(panel.getByText("Not answered", { exact: true })).toHaveCount(6);
  await expect(panel.getByLabel("Overall note")).toHaveValue(
    "Keep the earlier review for comparison.",
  );
  await panel
    .getByRole("button", { name: "Start a report", exact: true })
    .click();
  await panel.getByText("Your previous response", { exact: true }).click();
  await expect(
    panel.getByText("Problem reported — earlier instructions", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("The original instructions were unclear here.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "Expected result" }),
  ).toContainText("The review now includes this additional visible criterion.");
  await panel
    .getByRole("button", { name: "Worked as expected", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Review summary", exact: true })
    .click();
  await expect(
    panel.getByText(
      "1 of 6 checkpoints answered. You can send partial feedback.",
      { exact: true },
    ),
  ).toBeVisible();
});
