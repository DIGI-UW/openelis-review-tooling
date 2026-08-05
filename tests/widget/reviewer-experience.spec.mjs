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

  // The step being worked has to fit the scroll window, and the reviewer has to be
  // able to read it and answer it without going looking. The optional note field
  // is allowed to need a nudge — that is the panel's own stated tolerance, and on
  // a short screen it is what pays for a readable type scale.
  const scroller = widget.locator(".body");
  const [current, view, label, marks] = await Promise.all([
    widget.locator(".step.current").boundingBox(),
    scroller.boundingBox(),
    widget.locator(".step.current .steplabel").boundingBox(),
    widget.locator(".step.current .marks").boundingBox(),
  ]);
  expect(current.height).toBeLessThanOrEqual(view.height);
  expect(current.y).toBeGreaterThanOrEqual(view.y - 1);
  expect(label.y).toBeGreaterThanOrEqual(view.y - 1);
  expect(marks.y + marks.height).toBeLessThanOrEqual(view.y + view.height + 1);
});

test("does not leave a clipped review overview above the first task", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const [overview, body] = await Promise.all([
    widget.locator(".intro").boundingBox(),
    widget.locator(".body").boundingBox(),
  ]);

  expect(overview).not.toBeNull();
  expect(body).not.toBeNull();
  // The panel positions the first actionable task under its pinned heading. The
  // optional overview is either wholly visible before it or wholly out of view;
  // a truncated sentence is neither useful context nor quiet UI.
  expect(overview.y + overview.height).toBeLessThanOrEqual(body.y + 1);
});

test("answering a step moves the reviewer on to the next one", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const steps = widget.locator(".step");
  await expect(steps.nth(0)).toHaveClass(/current/);

  await steps.nth(0).getByRole("button", { name: "Pass" }).click();

  await expect(steps.nth(0)).not.toHaveClass(/current/);
  await expect(steps.nth(1)).toHaveClass(/current/);
  await expect(widget.locator(".step.current .expect")).toBeVisible();
});

test("does not cover the application's own right-hand drawer", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await page.getByRole("button", { name: "Open drawer" }).click();

  const drawer = page.locator(".slide-over-panel");
  await expect(drawer).toBeVisible();
  const [panelBox, drawerBox] = await Promise.all([
    widget.locator(".panel").boundingBox(),
    drawer.boundingBox(),
  ]);
  expect(boxesOverlap(panelBox, drawerBox)).toBe(false);
  await expect(
    page.getByRole("button", { name: "Drawer action" }),
  ).toBeVisible();
});

// What the panel declares and where it actually lands are different questions.
// A stacking context on the host scopes the z-index inside it, so the declared
// value can be exactly right while the panel sits under the whole application.
function topmostOverPanel(page) {
  return page.evaluate(() => {
    const host = document.getElementById("oe-review-host");
    const box = host.shadowRoot.querySelector(".panel").getBoundingClientRect();
    const hit = document.elementFromPoint(
      Math.round(box.left + 40),
      Math.round(box.top + box.height / 2),
    );
    return hit ? hit.id || hit.tagName + "." + hit.className : null;
  });
}

test("sits above the application's own furniture", async ({ page }) => {
  const widget = await openPanel(page);
  // Onto the left anchor, where the application pins its side nav at z-index 8000.
  await widget.getByRole("button", { name: "Move panel" }).click();
  await widget.getByRole("button", { name: "Move panel" }).click();
  await expect(widget.locator(".wrap")).toHaveClass(/anchor-left/);

  expect(await topmostOverPanel(page)).toBe("oe-review-host");
});

test("lets an application modal come over the top of the checklist", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const layer = await widget.evaluate(
    (host) => getComputedStyle(host.shadowRoot.querySelector(".wrap")).zIndex,
  );
  expect(Number(layer)).toBeLessThan(9000);

  await page.getByRole("button", { name: "Open modal" }).click();
  // Carbon modals sit at 9000: the dialog a step is asking the reviewer to use
  // has to be able to come over the checklist that asked for it.
  expect(await topmostOverPanel(page)).not.toBe("oe-review-host");
  await expect(
    page.getByRole("button", { name: "Modal action" }),
  ).toBeVisible();
});

test("can be moved off whatever it is covering, and remembers where", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const before = await widget.locator(".panel").boundingBox();

  await widget.getByRole("button", { name: /move/i }).click();
  const moved = await widget.locator(".panel").boundingBox();
  expect(moved.x).not.toBeCloseTo(before.x, 0);

  // Nothing to click: the panel was open when the page reloaded, so it comes
  // back open. It has to come back where the reviewer put it, too.
  await page.reload();
  await expect(widget.locator(".panel")).toBeVisible();
  const restored = await widget.locator(".panel").boundingBox();
  expect(restored.x).toBeCloseTo(moved.x, 0);
});

test("hands keyboard focus on to the next step after answering", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await widget
    .locator(".step.current .detail")
    .getByRole("button", { name: "Pass" })
    .focus();
  await page.keyboard.press("Enter");

  const landed = await page.evaluate(() => {
    const host = document.getElementById("oe-review-host");
    const inner = host.shadowRoot.activeElement;
    const step = inner && inner.closest(".step");
    return {
      stillInPanel: document.activeElement === host,
      onA: inner ? inner.className : null,
      atStep: step ? step.querySelector(".num").textContent : null,
    };
  });

  // Answering unmounts the button that was focused. Without carrying the focus
  // over, a keyboard reviewer re-tabs from the top of the host application after
  // every single answer.
  expect(landed.stillInPanel).toBe(true);
  expect(landed.onA).toContain("mark");
  expect(landed.atStep).toBe("2");
});

test("numbers every step and says where each one stands", async ({ page }) => {
  const widget = await openPanel(page);
  const steps = widget.locator(".step");

  // A reviewer reporting a problem needs to be able to name the step, and a
  // reviewer scanning the list needs to see its state without reading it.
  await expect(steps.nth(0).locator(".num")).toHaveText("1");
  await expect(steps.nth(9).locator(".num")).toHaveText("10");
  await expect(steps.nth(0)).toHaveAttribute("data-state", "todo");

  await widget
    .locator(".step.current .detail")
    .getByRole("button", { name: "Pass" })
    .click();
  await expect(steps.nth(0)).toHaveAttribute("data-state", "pass");
  await expect(steps.nth(1)).toHaveAttribute("data-state", "todo");

  // Colour alone must not be the answer for a screen reader.
  await expect(steps.nth(0).locator(".steptop")).toHaveAttribute(
    "aria-label",
    /^Step 1, passed: Sign in/,
  );
  await expect(steps.nth(1).locator(".steptop")).toHaveAttribute(
    "aria-label",
    /^Step 2, not answered: /,
  );
});

test("tells the action and the expected result apart", async ({ page }) => {
  const widget = await openPanel(page);
  const detail = widget.locator(".step.current .detail");

  // "Expected: …" run together with the instruction is one long sentence to
  // parse; the reviewer does one of these and checks the other.
  const expected = detail.locator(".expect");
  await expect(expected.locator(".expectlabel")).toHaveText("Expect");
  await expect(expected.locator(".expecttext")).toContainText(
    "The worklist opens at /Microbiology/worklist",
  );
  await expect(expected.locator(".expecttext")).not.toContainText("Expected:");

  // A task should not include a deep link that lets the reviewer skip the
  // navigation it is supposed to assess.
  await expect(detail.getByRole("link")).toHaveCount(0);
});

test("keeps the section a step belongs to visible while scrolling", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await widget.getByRole("button", { name: "Expand panel" }).click();
  const scroller = widget.locator(".body");
  // Into the middle of the list rather than the very end: the last section is a
  // single step, and a section shorter than the window legitimately has nothing
  // left to pin.
  await scroller.evaluate((node) => {
    node.scrollTop = Math.round(node.scrollHeight / 2);
  });

  const view = await scroller.boundingBox();
  const headings = await widget
    .locator(".secrow:not([hidden])")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().top),
    );
  // Scrolled deep into the list, the heading for the section the reviewer is
  // inside has to be pinned to the top of the scroller — not merely somewhere on
  // screen, which is true of an ordinary heading that happens to be nearby.
  const pinned = headings.filter((top) => Math.abs(top - view.y) < 3);
  expect(pinned).toHaveLength(1);
});

test("stands the preamble down once, not every time the count changes", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const intro = widget.locator(".intro");
  await expect(intro).toBeVisible();

  const pass = widget
    .locator(".step.current .detail")
    .getByRole("button", { name: "Pass" });
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
  const launcher = await widget
    .getByRole("button", { name: /review/i })
    .boundingBox();
  expect(launcher.width).toBeLessThan(200);
});

test("shows progress on the collapsed launcher", async ({ page }) => {
  const widget = await openPanel(page);
  await widget
    .locator(".step.current")
    .getByRole("button", { name: "Pass" })
    .click();
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

  const pass = widget
    .locator(".step.current .detail")
    .getByRole("button", { name: "Pass" });
  await expect(pass).toHaveAttribute("aria-pressed", "false");
  await pass.click();

  // Coming back to an answered step has to show which answer it holds, and to a
  // screen reader that is the pressed state rather than the button's colour.
  await widget.locator(".step").nth(0).locator(".steptop").click();
  await expect(
    widget
      .locator(".step.current .detail")
      .getByRole("button", { name: "Pass" }),
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
  await widget
    .locator(".step.current")
    .getByRole("button", { name: "Fail" })
    .click();

  await widget.getByLabel(/Your name/).fill("Piotr Manko");

  await widget.getByRole("button", { name: "More review actions" }).click();
  const downloadPromise = page.waitForEvent("download");
  await widget.getByRole("button", { name: "Download report" }).click();
  const download = await downloadPromise;

  // Two blob downloads from one click trips Chrome's automatic-downloads
  // permission, and a reviewer who dismisses it silently loses half the review.
  expect(download.suggestedFilename()).toMatch(/\.md$/);

  const report = await page.evaluate(() =>
    window.__OE_REVIEW_TEST__.buildReport(),
  );
  expect(report.md).toContain("```json");
  expect(report.md).toContain('"schemaVersion": 2');
  await expect(widget.getByRole("button", { name: "More review actions" })).toBeVisible();
});

test("keeps secondary review actions out of the primary footer", async ({ page }) => {
  const widget = await openPanel(page);
  const footer = widget.locator(".foot");

  await expect(footer.getByRole("button")).toHaveCount(2);
  await expect(footer.getByRole("button", { name: "Submit review" })).toBeVisible();
  const more = footer.getByRole("button", { name: "More review actions" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(widget.getByRole("button", { name: "Download report" })).toHaveCount(0);

  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(widget.getByRole("button", { name: "Copy report" })).toBeVisible();
  await expect(widget.getByRole("button", { name: "Download report" })).toBeVisible();
  await expect(widget.getByRole("button", { name: "Reset review" })).toBeVisible();
  await expect(widget.getByRole("button", { name: "All steps" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await widget.getByRole("button", { name: "To do" }).click();
  await expect(more).toHaveAttribute("aria-expanded", "false");
});

test("records the page and console errors behind a failure", async ({
  page,
}) => {
  const widget = await openPanel(page);
  await page.evaluate(() => console.error("worklist filter blew up"));
  await widget
    .locator(".step.current")
    .getByRole("button", { name: "Fail" })
    .click();

  const report = await page.evaluate(() =>
    JSON.parse(window.__OE_REVIEW_TEST__.buildReport().json),
  );
  const failed = report.checklist[0].steps[0];
  expect(failed.mark).toBe("fail");
  expect(failed.actualUrl).toContain("app-fixture.html");
  expect(failed.consoleErrors.join(" ")).toContain("worklist filter blew up");
});
