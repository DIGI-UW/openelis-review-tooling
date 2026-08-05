import { expect, test } from "@playwright/test";

// app-fixture.html uses the same schema-v2 split as production: uat-index.json
// identifies individual stories while uat-amr.json remains their aggregate
// transport document. Routes leave exactly one story relevant to each test page.
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

test("uses the production catalog to show one story without aggregate fallback", async ({
  page,
}) => {
  const checklistRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/uat-")) checklistRequests.push(request.url());
  });
  let widget = await openPanel(page);
  let trigger = widget.getByRole("button", { name: "Choose story" });
  await expect(trigger).toContainText("M1 - Find and route microbiology work");
  await expect(widget.locator(".step")).toHaveCount(3);
  await expect(widget.getByRole("heading", { level: 2 })).toHaveText(
    "M1 - Find and route microbiology work - review",
  );
  await expect(
    widget.getByText("From a filtered worklist, open the seeded bacteriology case."),
  ).toHaveCount(0);
  let list = await openStoryChecklist(widget);
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option").first()).toContainText(
    "0 of 3 complete",
  );
  await page.evaluate(() => {
    const key = "oe-review:v2:amr:prefs";
    const prefs = JSON.parse(localStorage.getItem(key) || "{}");
    prefs.story = "undefined";
    const value = JSON.stringify(prefs);
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  });
  await expect(list).toBeVisible();
  await expect(trigger).toContainText("M1 - Find and route microbiology work");
  expect(
    checklistRequests.filter((url) => url.includes("uat-undefined")),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("oe-review:v2:amr:prefs") || "{}").story,
    ),
  ).toBe("amr--AMR-S01");
  await expect(
    list.getByRole("option", { name: /Work the seeded bacteriology case/ }),
  ).toHaveCount(0);
  await widget
    .getByRole("button", { name: "Show all 4 server stories" })
    .click();
  await expect(list.getByRole("option")).toHaveCount(4);
  await list
    .getByRole("option", { name: /Work the seeded bacteriology case/ })
    .click();
  await expect(widget.locator(".step")).toHaveCount(3);
  await expect(widget.locator(".step").first()).toHaveAttribute("data-state", "todo");
  await expect(widget.getByRole("heading", { level: 2 })).toHaveText(
    "M1 - Work the seeded bacteriology case - review",
  );
  await expect(widget.getByRole("complementary")).toHaveAccessibleName(
    "Review checklist: M1 - Work the seeded bacteriology case - review",
  );
  await expect(trigger).toBeFocused();

  await widget.getByRole("button", { name: "Refresh checklist" }).click();
  await expect(trigger).toContainText("M1 - Work the seeded bacteriology case");
  await expect(widget.locator(".step")).toHaveCount(3);
  expect(
    checklistRequests.filter((url) => url.includes("uat-undefined")),
  ).toEqual([]);

  await page.reload();
  widget = page.locator("#oe-review-host");
  trigger = widget.getByRole("button", { name: "Choose story" });
  await expect(widget.getByRole("heading", { level: 2 })).toHaveText(
    "M1 - Work the seeded bacteriology case - review",
  );
  await expect(widget.locator(".step")).toHaveCount(3);

  list = await openStoryChecklist(widget);
  await list
    .getByRole("option", { name: /M1 - Find and route microbiology work/ })
    .click();
  const overview = widget.locator(".storydescription");
  await expect(overview).toBeVisible();
  expect(
    await overview.evaluate((node) => {
      const body = node.closest(".body");
      const description = node.getBoundingClientRect();
      const viewport = body.getBoundingClientRect();
      return (
        body.scrollTop > 0 &&
        description.top >= viewport.top &&
        description.bottom <= viewport.bottom
      );
    }),
  ).toBe(true);
  await widget.getByRole("button", { name: "Refresh checklist" }).click();
  await expect(trigger).toContainText("M1 - Find and route microbiology work");
  await expect(widget.locator(".step")).toHaveCount(3);
  expect(
    checklistRequests.filter((url) => url.includes("uat-undefined")),
  ).toEqual([]);
  await widget
    .locator(".step.current .detail")
    .getByRole("button", { name: "Pass" })
    .click();
  await expect(widget.locator(".step").first()).toHaveAttribute(
    "data-state",
    "pass",
  );
});

test("refuses a schema-v1 catalog instead of rendering its aggregate checklist", async ({
  page,
}) => {
  await page.route("**/tests/widget/uat-index.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        stories: [
          {
            instance: "amr",
            title: "Legacy aggregate review",
            steps: 10,
          },
        ],
      },
    }),
  );

  const widget = await openPanel(page);
  await expect(widget.getByRole("alert")).toContainText(
    "Story catalog schemaVersion 2 is required",
  );
  await expect(widget.locator(".step")).toHaveCount(0);
  await expect(widget.locator(".stories")).toHaveCount(0);
  await expect(widget.getByText("Open the microbiology worklist")).toHaveCount(0);
});

test("refuses catalog and checklist drift instead of showing aggregate rows", async ({
  page,
}) => {
  await page.route("**/tests/widget/uat-index.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 2,
        warnings: [],
        stories: [
          {
            id: "amr--AMR-S99",
            review: "amr",
            key: "AMR-S99",
            title: "Missing story",
            jira: "OGC-782",
            order: 99,
            steps: 1,
            required: 1,
            routes: ["/tests/widget/app-fixture.html"],
            hosts: null,
          },
        ],
      },
    }),
  );

  const widget = await openPanel(page);
  await expect(widget.getByRole("alert")).toContainText(
    "does not resolve to exactly one checklist section",
  );
  await expect(widget.locator(".step")).toHaveCount(0);
  await expect(
    widget.getByText("Sign in, open the main navigation"),
  ).toHaveCount(0);
});

test("shows only stories for the current URL by default", async ({ page }) => {
  const widget = await openPanel(page);
  const list = await openStoryChecklist(widget);

  await expect(widget.locator(".storyscope")).toHaveText(
    "Stories on this page",
  );
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option").first()).toContainText(
    "M1 - Find and route microbiology work",
  );
  await expect(list.getByText("Order entry")).toHaveCount(0);
  await expect(
    widget.getByRole("button", { name: "Show all 4 server stories" }),
  ).toBeVisible();
});

test("re-groups the stories as the reviewer moves through the application", async ({
  page,
}) => {
  const widget = await openPanel(page);
  let list = await openStoryChecklist(widget);
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option").first()).toContainText(
    "M1 - Find and route microbiology work",
  );
  await widget.getByRole("button", { name: "Choose story" }).click();

  // A single-page app routes without reloading, so nothing re-runs on its own.
  await page.getByRole("button", { name: "Go to worklist" }).click();

  list = await openStoryChecklist(widget);
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option").first()).toContainText(
    "M1 - Work the seeded bacteriology case",
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
            required: 2,
            routes: ["/Dashboard"],
          },
          {
            id: "amr--AMR-S02",
            review: "amr",
            key: "AMR-S02",
            title: "Review AST results",
            steps: 3,
            required: 3,
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

test("keeps the newest checklist when an older refresh finishes late", async ({
  page,
}) => {
  const widget = await openPanel(page);
  let releaseFirst;
  let finishFirst;
  const firstRelease = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const firstFinished = new Promise((resolve) => {
    finishFirst = resolve;
  });
  let requestCount = 0;

  await page.route("**/tests/widget/uat-amr.json", async (route) => {
    requestCount += 1;
    const requestNumber = requestCount;
    const response = await route.fetch();
    const checklist = await response.json();
    checklist.checklistRevision = `refresh-${requestNumber}`;
    checklist.sections[0].steps[0].do =
      requestNumber === 1 ? "Stale refresh" : "Latest refresh";
    if (requestNumber === 1) await firstRelease;
    await route.fulfill({ json: checklist });
    if (requestNumber === 1) finishFirst();
  });

  const refresh = widget.getByRole("button", { name: "Refresh checklist" });
  await refresh.click();
  await expect.poll(() => requestCount).toBe(1);
  await refresh.click();
  await expect.poll(() => requestCount).toBe(2);
  await expect(widget.getByText("Latest refresh")).toBeVisible();

  releaseFirst();
  await firstFinished;
  await expect(widget.getByText("Latest refresh")).toBeVisible();
  await expect(widget.getByText("Stale refresh")).toHaveCount(0);
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
  await widget.locator(".step.current .detail").getByRole("button", { name: "Pass" }).click();
  await expect(widget.locator(".step").nth(0)).toHaveAttribute("data-state", "pass");

  await chooseStory(widget, /Work the seeded bacteriology case/, { showAll: true });
  await expect(widget.getByRole("heading", { level: 2 })).toHaveText(
    "M1 - Work the seeded bacteriology case - review",
  );
  await expect(widget.locator(".step")).toHaveCount(3);
  await expect(widget.locator(".step").nth(0)).toHaveAttribute(
    "data-state",
    "todo",
  );

  await chooseStory(widget, /Find and route microbiology work/);
  await expect(widget.locator(".step")).toHaveCount(3);
  await expect(widget.locator(".step").nth(0)).toHaveAttribute("data-state", "pass");
});

test("says a story is unreachable rather than quietly reviewing a different one", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await chooseStory(widget, /Work the seeded bacteriology case/, { showAll: true });
  await expect(widget.locator(".step")).toHaveCount(3);

  await page.route("**/tests/widget/uat-amr.json", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await widget.getByRole("button", { name: "Refresh checklist" }).click();

  // Switching what is under review without saying so is the story-axis version
  // of losing the reviewer's answers to a transient outage.
  await expect(widget.getByRole("alert")).toContainText("503");
  await expect(
    widget.getByRole("button", { name: "Choose story" }),
  ).toContainText("M1 - Work the seeded bacteriology case");
});

test("reports a checklist it refuses instead of swallowing the reason", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await page.route("**/tests/widget/uat-amr.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 2,
        checklistRevision: "amr-bad",
        title: "Microbiology MVP - review",
        instance: "amr",
        sections: [
          {
            title: "M1 - Work the seeded bacteriology case",
            key: "AMR-S02",
            // Resolves off-origin: the URL parser reads the backslash as an
            // authority separator.
            steps: [
              { key: "AMR-4", do: "Open the case", route: "/\\evil.example" },
            ],
          },
        ],
      },
    }),
  );

  await chooseStory(widget, /Work the seeded bacteriology case/, { showAll: true });
  await expect(widget.getByRole("alert")).toContainText("same-origin");
  await expect(widget.getByRole("heading", { level: 2 })).toHaveText(
    "M1 - Find and route microbiology work - review",
  );
  await expect(
    widget.getByRole("button", { name: "Choose story" }),
  ).toContainText("M1 - Find and route microbiology work");
  await expect(widget.locator(".step")).toHaveCount(3);
});

test("falls back to the injected story when one is retired from the catalog", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await chooseStory(widget, /Work the seeded bacteriology case/, { showAll: true });
  await expect(widget.locator(".step")).toHaveCount(3);

  await page.route("**/tests/widget/uat-index.json", async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    await route.fulfill({
      json: {
        ...catalog,
        stories: catalog.stories.filter((story) => story.id !== "amr--AMR-S02"),
      },
    });
  });
  await page.reload();

  const reopened = page.locator("#oe-review-host");
  await expect(reopened.getByRole("heading", { level: 2 })).toHaveText(
    "M1 - Find and route microbiology work - review",
  );
  await expect(reopened.locator(".step")).toHaveCount(3);
});

test("remembers the story the reviewer was last working on", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await chooseStory(widget, /Work the seeded bacteriology case/, { showAll: true });
  await expect(widget.locator(".step")).toHaveCount(3);

  await page.reload();
  const reopened = page.locator("#oe-review-host");
  await expect(reopened.getByRole("heading", { level: 2 })).toHaveText(
    "M1 - Work the seeded bacteriology case - review",
  );
  await expect(
    reopened.getByRole("button", { name: "Choose story" }),
  ).toContainText("M1 - Work the seeded bacteriology case");
});

test("expands to show every step in full, and comes back", async ({ page }) => {
  const widget = await openPanel(page);
  const compact = await widget.locator(".panel").boundingBox();
  await expect(widget.locator(".expect")).toHaveCount(1);

  await widget.getByRole("button", { name: "Expand panel" }).click();
  const expanded = await widget.locator(".panel").boundingBox();
  expect(expanded.width).toBeGreaterThan(compact.width);
  await expect(widget.locator(".expect")).toHaveCount(3);
  await expect(
    widget.locator(".step").nth(2).getByRole("button", { name: "Pass" }),
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

  await widget.getByRole("button", { name: "More review actions" }).click();
  await widget.getByRole("button", { name: "To do" }).click();
  await expect(steps.nth(0)).toBeHidden();
  await expect(steps.nth(1)).toBeHidden();
  await expect(steps.nth(2)).toBeVisible();

  await widget.getByRole("button", { name: "More review actions" }).click();
  await widget.getByRole("button", { name: "Failed" }).click();
  await expect(steps.nth(0)).toBeHidden();
  await expect(steps.nth(1)).toBeVisible();
  await expect(steps.nth(2)).toBeHidden();

  await widget.getByRole("button", { name: "More review actions" }).click();
  await widget.getByRole("button", { name: "All steps" }).click();
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
  await expect(reopened.locator(".expect")).toHaveCount(3);
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
