import { expect, test } from "@playwright/test";

const APP = "/tests/widget/fixture.html";

async function openPanel(page) {
  await page.goto(APP);
  const widget = page.locator("#oe-review-host");
  await widget.getByRole("button", { name: /review/i }).click();
  await expect(widget.locator(".panel")).toBeVisible();
  return widget;
}

test("shows what a story came from, beside the story", async ({ page }) => {
  const widget = await openPanel(page);
  const links = widget.locator(".secrow").first().locator(".storylink");

  // A reviewer who can see the ticket, the change and the design can tell whether
  // what is on screen is what was asked for — which is the whole job.
  await expect(links.filter({ hasText: "OGC-1054" })).toHaveAttribute(
    "href",
    /OGC-1054/,
  );
  await expect(links.filter({ hasText: /PR/ })).toHaveAttribute("href", /pull\/3195/);
  await expect(links.filter({ hasText: /Mock/i })).toHaveAttribute("href", /figma/);
  for (const href of await links.evaluateAll((els) => els.map((e) => e.rel))) {
    expect(href).toContain("noopener");
  }
});

test("puts the user story in words rather than behind a link", async ({ page }) => {
  const widget = await openPanel(page);
  await expect(widget.locator(".userstory").first()).toContainText(
    "As a lab tech I want shipped profiles visible",
  );
  await expect(widget.locator(".userstory").first()).not.toHaveAttribute("href", /./);
});

test("says nothing where a story has nothing to point at", async ({ page }) => {
  const widget = await openPanel(page);
  // The second story in the fixture carries no links at all.
  const bare = widget.locator(".secrow").nth(1);
  await expect(bare.locator(".storylink")).toHaveCount(0);
});

test("hides a story that belongs to a different deployment", async ({ page }) => {
  const widget = await openPanel(page);
  // The fixture runs on 127.0.0.1; that story is limited to the analyzer host, so
  // it is not this reviewer's to answer and must not count against them.
  await expect(widget.getByText("Only on the analyzer host")).toHaveCount(0);
  await expect(widget.locator(".step")).toHaveCount(2);
});

test("counts only the steps the reviewer can actually reach", async ({ page }) => {
  const widget = await openPanel(page);
  // A hidden story's steps must stay out of the total, or the panel asks for
  // answers that cannot be given and the review never reads as finished.
  await widget.getByRole("button", { name: "Minimize" }).click();
  await expect(widget.locator(".tab")).toContainText("0/2");
});
