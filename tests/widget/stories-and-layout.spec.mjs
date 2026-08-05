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

async function openStoryChecklist(widget) {
  const trigger = widget.getByRole("button", { name: "Choose story" });
  await trigger.click();
  const list = widget.getByRole("listbox", { name: /stories/i });
  await expect(list).toBeVisible();
  return list;
}

async function chooseStory(widget, name, { showAll = false } = {}) {
  const list = await openStoryChecklist(widget);
  if (showAll) {
    await widget
      .getByRole("button", { name: /show all .* server stories/i })
      .click();
  }
  await list.getByRole("option", { name }).click();
}

test("shows each Grist story separately instead of one aggregate review", async ({
  page,
}) => {
  await page.route("**/tests/widget/uat-index.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 2,
        stories: [
          {
            id: "amr--AMR-S01",
            review: "amr",
            key: "AMR-S01",
            title: "Find and route microbiology work",
            order: 0,
            steps: 2,
            required: 2,
            routes: ["/tests/widget/app-fixture.html"],
          },
          {
            id: "amr--AMR-S02",
            review: "amr",
            key: "AMR-S02",
            title: "Work the bacteriology case",
            order: 1,
            steps: 1,
            required: 1,
            routes: ["/Microbiology/worklist"],
          },
          {
            id: "analyzers--AN-S01",
            review: "analyzers",
            key: "AN-S01",
            title: "Configure an analyzer",
            order: 0,
            steps: 1,
            required: 1,
            routes: ["/analyzers"],
          },
        ],
      },
    }),
  );
  await page.route("**/tests/widget/uat-amr.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 2,
        checklistRevision: "amr-story-catalog",
        title: "Microbiology release review",
        instance: "amr",
        sections: [
          {
            key: "AMR-S01",
            title: "Find and route microbiology work",
            steps: [
              { key: "AMR-1", do: "Open the worklist" },
              { key: "AMR-2", do: "Route the order" },
            ],
          },
          {
            key: "AMR-S02",
            title: "Work the bacteriology case",
            steps: [{ key: "AMR-3", do: "Open the case" }],
          },
        ],
      },
    }),
  );

  const widget = await openPanel(page);
  const trigger = widget.getByRole("button", { name: "Choose story" });
  await expect(trigger).toContainText("Find and route microbiology work");
  await expect(widget.locator(".step")).toHaveCount(2);
  await expect(widget.getByRole("heading", { level: 2 })).toHaveText(
    "Find and route microbiology work - review",
  );
  await widget
    .locator(".step.current .detail")
    .getByRole("button", { name: "Pass" })
    .click();

  let list = await openStoryChecklist(widget);
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option").first()).toContainText(
    "1 of 2 complete",
  );
  await expect(
    list.getByRole("option", { name: /Work the bacteriology case/ }),
  ).toHaveCount(0);
  await widget
    .getByRole("button", { name: "Show all 2 server stories" })
    .click();
  await expect(list.getByRole("option")).toHaveCount(2);
  await list
    .getByRole("option", { name: /Work the bacteriology case/ })
    .click();
  await expect(widget.locator(".step")).toHaveCount(1);
  await expect(widget.locator(".step")).toHaveAttribute("data-state", "todo");
  await expect(widget.getByRole("heading", { level: 2 })).toHaveText(
    "Work the bacteriology case - review",
  );
  await expect(widget.getByRole("complementary")).toHaveAccessibleName(
    "Review checklist: Work the bacteriology case - review",
  );
  await expect(trigger).toBeFocused();

  list = await openStoryChecklist(widget);
  await list
    .getByRole("option", { name: /Find and route microbiology work/ })
    .click();
  await expect(widget.locator(".step").first().locator(".chip")).toHaveText(
    "Pass",
  );
});

test("shows only stories for the current URL by default", async ({ page }) => {
  const widget = await openPanel(page);
  const list = await openStoryChecklist(widget);

  await expect(widget.locator(".storyscope")).toHaveText(
    "Stories on this page",
  );
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option").first()).toContainText("Order entry");
  await expect(list.getByText("Microbiology MVP")).toHaveCount(0);
  await expect(
    widget.getByRole("button", { name: "Show all 2 server stories" }),
  ).toBeVisible();
});

test("re-groups the stories as the reviewer moves through the application", async ({
  page,
}) => {
  const widget = await openPanel(page);
  let list = await openStoryChecklist(widget);
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option").first()).toContainText("Order entry");
  await widget.getByRole("button", { name: "Choose story" }).click();

  // A single-page app routes without reloading, so nothing re-runs on its own.
  await page.getByRole("button", { name: "Go to worklist" }).click();

  list = await openStoryChecklist(widget);
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option").first()).toContainText(
    "Microbiology MVP",
  );
});

test("falls back to every server story when the current URL has no match", async ({
  page,
}) => {
  await page.route("**/tests/widget/uat-index.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 2,
        stories: [
          {
            id: "amr--AMR-S01",
            review: "amr",
            key: "AMR-S01",
            title: "Route microbiology work",
            steps: 2,
            routes: ["/Dashboard"],
          },
          {
            id: "amr--AMR-S02",
            review: "amr",
            key: "AMR-S02",
            title: "Review AST results",
            steps: 3,
            routes: ["/Microbiology/worklist"],
          },
        ],
      },
    }),
  );

  const widget = await openPanel(page);
  const list = await openStoryChecklist(widget);
  await expect(widget.locator(".storyscope")).toHaveText("All server stories");
  await expect(widget.locator(".storynotice")).toContainText(
    "No stories target this page",
  );
  await expect(list.getByRole("option")).toHaveCount(2);
});

test("Escape closes the story checklist without minimizing the review", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const trigger = widget.getByRole("button", { name: "Choose story" });
  const list = await openStoryChecklist(widget);

  // Opening leaves focus on the disclosure button, which is where a keyboard
  // reviewer naturally presses Escape to dismiss it.
  await trigger.press("Escape");

  await expect(list).toBeHidden();
  await expect(widget.locator(".panel")).toBeVisible();
  await expect(trigger).toBeFocused();
});

test("supports arrow-key navigation through the story checklist", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const list = await openStoryChecklist(widget);
  await widget
    .getByRole("button", { name: /show all .* server stories/i })
    .click();
  const options = list.getByRole("option");

  await expect(options.first()).toBeFocused();
  await options.first().press("ArrowDown");
  await expect(options.nth(1)).toBeFocused();
  await options.nth(1).press("ArrowUp");
  await expect(options.first()).toBeFocused();
});

test("keeps the story checklist open while the current checklist refreshes", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const list = await openStoryChecklist(widget);

  await widget.getByRole("button", { name: "Refresh checklist" }).click();

  await expect(list).toBeVisible();
  await expect(widget.locator(".panel")).toBeVisible();
});

test("keeps story navigation usable in the mobile bottom sheet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const widget = await openPanel(page);
  const list = await openStoryChecklist(widget);
  const option = list.getByRole("option").first();

  await expect(option).toBeVisible();
  const layout = await widget.locator(".panel").evaluate((panel) => {
    const trigger = panel
      .querySelector(".storytrigger")
      .getBoundingClientRect();
    const menu = panel.querySelector(".storymenu").getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    return {
      overflow: panel.scrollWidth - panel.clientWidth,
      triggerInside:
        trigger.left >= panelBox.left && trigger.right <= panelBox.right,
      menuInside: menu.left >= panelBox.left && menu.right <= panelBox.right,
    };
  });
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.triggerInside).toBe(true);
  expect(layout.menuInside).toBe(true);
});

test("switching story loads its checklist and keeps the answers apart", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await widget
    .locator(".step.current .detail")
    .getByRole("button", { name: "Pass" })
    .click();
  await expect(widget.locator(".step").nth(0).locator(".chip")).toHaveText(
    "Pass",
  );

  await chooseStory(widget, /Order entry/);
  await expect(widget.getByRole("heading", { level: 2 })).toHaveText(
    "Order entry review",
  );
  await expect(widget.locator(".step")).toHaveCount(2);
  await expect(widget.locator(".step").nth(0)).toHaveAttribute(
    "data-state",
    "todo",
  );

  await chooseStory(widget, /Microbiology MVP/, { showAll: true });
  await expect(widget.locator(".step")).toHaveCount(10);
  await expect(widget.locator(".step").nth(0).locator(".chip")).toHaveText(
    "Pass",
  );
});

test("says a story is unreachable rather than quietly reviewing a different one", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await chooseStory(widget, /Order entry/);
  await expect(widget.locator(".step")).toHaveCount(2);

  await page.route("**/tests/widget/uat-orders.json", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await widget.getByRole("button", { name: "Refresh checklist" }).click();

  // Switching what is under review without saying so is the story-axis version
  // of losing the reviewer's answers to a transient outage.
  await expect(widget.getByRole("alert")).toContainText("503");
  await expect(
    widget.getByRole("button", { name: "Choose story" }),
  ).toContainText("Order entry");
});

test("reports a checklist it refuses instead of swallowing the reason", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await page.route("**/tests/widget/uat-orders.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 2,
        checklistRevision: "orders-bad",
        title: "Order entry review",
        instance: "orders",
        sections: [
          {
            title: "Add an order",
            // Resolves off-origin: the URL parser reads the backslash as an
            // authority separator.
            steps: [
              { key: "ORD-1", do: "Open add order", route: "/\\evil.example" },
            ],
          },
        ],
      },
    }),
  );

  await chooseStory(widget, /Order entry/);
  await expect(widget.getByRole("alert")).toContainText("same-origin");
});

test("falls back to the injected story when one is retired from the catalog", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await chooseStory(widget, /Order entry/);
  await expect(widget.locator(".step")).toHaveCount(2);

  await page.route("**/tests/widget/uat-orders.json", (route) =>
    route.fulfill({ status: 404, body: "gone" }),
  );
  await page.reload();

  const reopened = page.locator("#oe-review-host");
  await expect(reopened.getByRole("heading", { level: 2 })).toHaveText(
    "Microbiology MVP - review",
  );
  await expect(reopened.locator(".step")).toHaveCount(10);
});

test("remembers the story the reviewer was last working on", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await chooseStory(widget, /Order entry/);
  await expect(widget.locator(".step")).toHaveCount(2);

  await page.reload();
  const reopened = page.locator("#oe-review-host");
  await expect(reopened.getByRole("heading", { level: 2 })).toHaveText(
    "Order entry review",
  );
  await expect(
    reopened.getByRole("button", { name: "Choose story" }),
  ).toContainText("Order entry");
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

test("never grows its own header off the top of the screen", async ({
  page,
}) => {
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
  await expect(
    widget.getByRole("button", { name: "Collapse panel" }),
  ).toBeInViewport();
});

test("shows how far each section has got", async ({ page }) => {
  const widget = await openPanel(page);
  const first = widget.locator(".secrow").first();
  await expect(first.locator(".seccount")).toHaveText("0/3");

  await widget
    .locator(".step.current .detail")
    .getByRole("button", { name: "Pass" })
    .click();
  await expect(first.locator(".seccount")).toHaveText("1/3");
});

test("filters down to what still needs doing, and to what failed", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const steps = widget.locator(".step");
  await steps.nth(0).locator(".steptop").click();
  await widget
    .locator(".step.current .detail")
    .getByRole("button", { name: "Pass" })
    .click();
  await steps.nth(1).locator(".steptop").click();
  await widget
    .locator(".step.current .detail")
    .getByRole("button", { name: "Fail" })
    .click();

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

test("leaves the end of a long story overview reachable", async ({ page }) => {
  const widget = await openPanel(page);
  const intro = widget.locator(".intro");
  await expect(intro).toBeVisible();

  const reach = await intro.evaluate((el) => {
    // Deliberately not scrolled first. scrollHeight cannot answer this either:
    // -webkit-line-clamp truncates the layout, and an overflow:hidden box still
    // scrolls under script while a reviewer has no way to move it.
    const node = el.firstChild;
    const range = document.createRange();
    range.setStart(node, Math.max(0, node.length - 12));
    range.setEnd(node, node.length);
    const last = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return {
      text: el.textContent.trim(),
      painted: last.height > 0,
      fits: last.bottom - box.bottom <= 1,
      scrollable: ["auto", "scroll"].includes(getComputedStyle(el).overflowY),
    };
  });

  expect(reach.text).toContain("confusing or broken");
  expect(reach.painted).toBe(true);
  // The overview may be capped — it has to give room back to the checklist — so
  // what is required is that the reviewer can get to the end of it, by its
  // fitting or by their scrolling. Clamped and hidden it was neither.
  expect(reach.fits || reach.scrollable).toBe(true);
});

test("does not park the current step under the pinned section heading", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await expect(widget.locator(".step.current")).toBeVisible();

  const overlap = await widget.locator(".panel").evaluate((panel) => {
    const step = panel.querySelector(".step.current");
    const heading = step.parentNode.querySelector(".secrow");
    const label = step.querySelector(".steplabel").getBoundingClientRect();
    // The heading is sticky, so it paints over whatever scrolls beneath it. What
    // the reviewer needs to be able to read is the instruction.
    return Math.round(heading.getBoundingClientRect().bottom - label.top);
  });

  expect(overlap).toBeLessThanOrEqual(0);
});
