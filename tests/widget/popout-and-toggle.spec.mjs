import { expect, test } from "@playwright/test";

// fixture.html carries the two-step "analyzers" checklist, whose first step routes
// to /analyzers/types. The fixture server answers an unknown path with a plain 404
// body, so following that route is a real navigation the opener can be caught at.
const APP = "/tests/widget/fixture.html";

const widgetOf = (page) => page.locator("#oe-review-host");

async function openPanel(page) {
  await page.goto(APP);
  const widget = widgetOf(page);
  await widget.getByRole("button", { name: /review/i }).click();
  await expect(widget.locator(".panel")).toBeVisible();
  return widget;
}

async function popOut(page) {
  const widget = await openPanel(page);
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    widget.getByRole("button", { name: /pop out/i }).click(),
  ]);
  await expect(popup.locator("#oe-review-host .panel")).toBeVisible();
  return { widget, popup };
}

test.describe("?oe-review", () => {
  test("opens the panel for whoever the link was shared with", async ({ page }) => {
    await page.goto(`${APP}?oe-review=open`);
    await expect(widgetOf(page).locator(".panel")).toBeVisible();
  });

  test("is consumed, so it cannot keep undoing the reviewer", async ({ page }) => {
    await page.goto(`${APP}?keep=1&oe-review=open`);
    const widget = widgetOf(page);
    await expect(widget.locator(".panel")).toBeVisible();

    // The application's own parameters survive; only ours is taken out.
    await expect(page).toHaveURL(/\?keep=1$/);

    // The point of consuming it: closing the panel now sticks. Left in the URL,
    // the parameter would reopen the panel on every reload.
    await widget.getByRole("button", { name: "Minimize" }).click();
    await page.reload();
    await expect(widget.locator(".tab")).toBeVisible();
    await expect(widget.locator(".panel")).toHaveCount(0);
  });

  test("=closed hands over a review without putting it on the screen", async ({
    page,
  }) => {
    await page.goto(`${APP}?oe-review=closed`);
    const widget = widgetOf(page);
    await expect(widget.locator(".tab")).toBeVisible();
    await expect(widget.locator(".panel")).toHaveCount(0);
  });

  test("=off unmounts the widget and keeps it gone as the reviewer moves", async ({
    page,
  }) => {
    await page.goto(`${APP}?oe-review=off`);
    await expect(widgetOf(page)).toHaveCount(0);

    // The checklist's own "Go to …" links drop the query string, so hiding has to
    // outlast the URL that asked for it or it lasts exactly one page.
    await page.goto(APP);
    await expect(widgetOf(page)).toHaveCount(0);

    await page.goto(`${APP}?oe-review=on`);
    await expect(widgetOf(page).locator(".panel")).toBeVisible();
  });

  test("says how to undo hiding, since the parameter is the only way back", async ({
    page,
  }) => {
    const said = [];
    page.on("console", (message) => said.push(message.text()));
    await page.goto(`${APP}?oe-review=off`);
    await expect(widgetOf(page)).toHaveCount(0);
    expect(said.join("\n")).toContain("?oe-review=on");
  });

  test("refuses a value it does not recognise instead of guessing", async ({
    page,
  }) => {
    const warnings = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });
    await page.goto(`${APP}?oe-review=maybe`);
    const widget = widgetOf(page);
    // Neither opened nor hidden: left exactly as the reviewer had it.
    await expect(widget.locator(".tab")).toBeVisible();
    expect(warnings.join("\n")).toContain("oe-review=maybe");
  });
});

test.describe("popping the panel out", () => {
  test("moves the review into a window of its own", async ({ page }) => {
    const { widget, popup } = await popOut(page);
    await expect(
      popup.locator("#oe-review-host").getByText("Analyzer QC review"),
    ).toBeVisible();
    // One review, one panel: the page keeps only its launcher.
    await expect(widget.locator(".panel")).toHaveCount(0);
    await expect(widget.locator(".tab")).toBeVisible();
  });

  test("drops the controls that only mean something to an overlay", async ({
    page,
  }) => {
    const { popup } = await popOut(page);
    const head = popup.locator("#oe-review-host .head");
    // Nothing to move it away from, and nothing to minimize it back into.
    await expect(head.getByRole("button", { name: "Move panel" })).toHaveCount(0);
    await expect(head.getByRole("button", { name: "Minimize" })).toHaveCount(0);
    await expect(head.getByRole("button", { name: /pop out/i })).toHaveCount(0);
    await expect(head.getByRole("button", { name: "Return the checklist to the page" })).toBeVisible();
  });

  test("turns the launcher into a way back to that window", async ({ page }) => {
    const { widget } = await popOut(page);
    const tab = widget.locator(".tab");
    await expect(tab).toHaveAttribute("title", /front|window/i);
    // Clicking must raise the window that already has the review, not start a
    // second panel over the application.
    await tab.click();
    await expect(widget.locator(".panel")).toHaveCount(0);
  });

  test("opens a sized window by default, and a tab only on ⌘/Ctrl", async ({
    page,
  }) => {
    // A window is asked for with explicit dimensions; a tab is asked for by
    // passing no features at all and inherits the browser's. Measuring the width
    // is therefore the difference between the two.
    const widthFor = async (modifiers) => {
      await page.goto(APP);
      const widget = widgetOf(page);
      await widget.getByRole("button", { name: /review/i }).click();
      await expect(widget.locator(".panel")).toBeVisible();
      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        widget.getByRole("button", { name: /pop out/i }).click({ modifiers }),
      ]);
      await expect(popup.locator("#oe-review-host .panel")).toBeVisible();
      const width = await popup.evaluate(() => innerWidth);
      await popup.close();
      await expect(widgetOf(page).locator(".tab.away")).toHaveCount(0);
      return width;
    };

    const plain = await widthFor([]);
    expect(plain).toBe(460);
    // Shift means "new window" everywhere else in the browser, which is what a
    // plain click already does — so it must not be a second way to ask for a tab.
    expect(await widthFor(["Shift"])).toBe(plain);
    expect(await widthFor(["ControlOrMeta"])).not.toBe(plain);
  });

  test("keeps the pop-out glyph out of the launcher's name", async ({ page }) => {
    const { widget } = await popOut(page);
    // ⧉ says "elsewhere" to the eye. To a screen reader it is an unpronounceable
    // character in the middle of the button's name, and the title already says
    // where the review went.
    await expect(
      widget.getByRole("button", { name: "Review 0/2", exact: true }),
    ).toBeVisible();
  });

  test("comes back to the launcher when the window is restored, not just opened", async ({
    page,
  }) => {
    const { widget, popup } = await popOut(page);
    await expect(widget.locator(".tab.away")).toHaveCount(1);

    // Simulates the browser putting the popped-out tab into the back/forward
    // cache and taking it out again. A restore does not re-run the script, so
    // whatever pagehide cleared has to be re-asserted on pageshow — otherwise the
    // page offers to open a second panel over a review that is still on screen.
    await popup.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    });
    await expect(widget.locator(".tab.away")).toHaveCount(0);

    await popup.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await expect(widget.locator(".tab.away")).toHaveCount(1);
  });

  test("severs the opener on the link it can only open blind", async ({ page }) => {
    const { popup } = await popOut(page);
    const go = popup.locator("#oe-review-host").getByRole("link", { name: /Go to/ });
    // Only reached when the opener is gone, so the tab it opens has no business
    // holding a handle back to this window.
    await expect(go).toHaveAttribute("target", "_blank");
    await expect(go).toHaveAttribute("rel", /noopener/);
  });

  test("leaves the in-page route link an ordinary same-window link", async ({
    page,
  }) => {
    const widget = await openPanel(page);
    const go = widget.getByRole("link", { name: /Go to/ });
    await expect(go).toHaveAttribute("href", "/analyzers/types");
    await expect(go).not.toHaveAttribute("target", "_blank");
  });

  test("carries a mark back to the page it was popped out of", async ({ page }) => {
    const { widget, popup } = await popOut(page);
    await popup
      .locator("#oe-review-host")
      .getByRole("button", { name: "Pass", exact: true })
      .click();
    // The two windows share one store, so the page's launcher counts the answer
    // given in the other window.
    await expect(widget.locator(".tab")).toContainText("Review 1/2");
  });

  test("fills its window rather than floating in a corner of it", async ({ page }) => {
    const { popup } = await popOut(page);
    const panel = popup.locator("#oe-review-host .panel");
    const box = await panel.boundingBox();
    const window = await popup.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    // A 360px card adrift in an empty window is the failure this guards: nothing
    // is being floated over any more, so there is nothing to leave room for.
    expect(box.width).toBeGreaterThanOrEqual(window.width - 2);
    expect(box.height).toBeGreaterThanOrEqual(window.height - 2);
  });

  test("records where the reviewer is now, not where the panel is", async ({
    page,
  }) => {
    const { popup } = await popOut(page);
    // The reviewer works through the application while the panel stays put. What a
    // mark is evidence about is the page they have reached — not the URL the panel
    // was popped out from, and certainly not the panel's own about:blank.
    await page.goto("/analyzers/types");
    await popup
      .locator("#oe-review-host")
      .getByRole("button", { name: "Pass", exact: true })
      .click();

    // Back to a page carrying the widget, which reloads the answer from the store
    // the two windows share.
    await page.goto(APP);
    await expect(widgetOf(page).locator(".tab")).toContainText("Review 1/2");
    const report = await page.evaluate(() => window.__OE_REVIEW_TEST__.buildReport());
    const marked = JSON.parse(report.json)
      .checklist.flatMap((section) => section.steps)
      .find((step) => step.mark === "pass");
    expect(marked.actualUrl).toContain("/analyzers/types");
    expect(marked.actualUrl).not.toContain("about:blank");
  });

  test("sends a route link to the window under review", async ({ page }) => {
    const { popup } = await popOut(page);
    const opened = [];
    page.context().on("page", (extra) => opened.push(extra));
    const panelUrl = popup.url();
    await popup
      .locator("#oe-review-host")
      .getByRole("link", { name: /Go to/ })
      .click();
    // The application is in the opener, so that is what navigates — not the panel,
    // and not a third window nobody asked for.
    await expect(page).toHaveURL(/\/analyzers\/types$/);
    expect(popup.isClosed()).toBe(false);
    expect(popup.url()).toBe(panelUrl);
    expect(opened).toHaveLength(0);
  });

  test("puts the panel back in the page when the window is handed back", async ({
    page,
  }) => {
    const { widget, popup } = await popOut(page);
    await popup
      .locator("#oe-review-host")
      .getByRole("button", { name: "Return the checklist to the page" })
      .click()
      // The button closes the window it is in, so the click can lose the page
      // before Playwright finishes confirming the action. That is the behaviour
      // under test rather than a failure of it; anything else still throws, and
      // what the click actually left behind is asserted below.
      .catch((error) => {
        if (!/closed/i.test(error.message)) throw error;
      });
    // isClosed is polled rather than awaited as an event: the click closes the
    // window synchronously, so a waitForEvent subscribed afterwards never fires.
    await expect.poll(() => popup.isClosed()).toBe(true);
    await expect(widget.locator(".panel")).toBeVisible();
    await expect(widget.locator(".tab")).toHaveCount(0);
  });
});
