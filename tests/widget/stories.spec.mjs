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
  await expect(links.filter({ hasText: /PR/ })).toHaveAttribute(
    "href",
    /pull\/3195/,
  );
  await expect(links.filter({ hasText: /Mock/i })).toHaveAttribute(
    "href",
    /figma/,
  );
  for (const href of await links.evaluateAll((els) => els.map((e) => e.rel))) {
    expect(href).toContain("noopener");
  }
});

test("formats the user story as a prominent readable description", async ({
  page,
}) => {
  const widget = await openPanel(page);
  const description = widget.locator(".storydescription").first();
  await expect(description.getByText("Story", { exact: true })).toBeVisible();
  await expect(description.locator(".userstory")).toContainText(
    "As a lab tech I want shipped profiles visible",
  );
  await expect(description.locator(".userstory")).not.toHaveAttribute(
    "href",
    /./,
  );
  await expect(description).toBeInViewport();
  const style = await description.locator(".userstory").evaluate((node) => ({
    fontSize: Number.parseFloat(getComputedStyle(node).fontSize),
    lineHeight: Number.parseFloat(getComputedStyle(node).lineHeight),
    fontStyle: getComputedStyle(node).fontStyle,
  }));
  expect(style.fontSize).toBeGreaterThanOrEqual(16);
  expect(style.lineHeight).toBeGreaterThanOrEqual(24);
  expect(style.fontStyle).toBe("normal");
});

test("says nothing where a story has nothing to point at", async ({ page }) => {
  const widget = await openPanel(page);
  // The second story in the fixture carries no links at all.
  const bare = widget.locator(".secrow").nth(1);
  await expect(bare.locator(".storylink")).toHaveCount(0);
});

test("hides a story that belongs to a different deployment", async ({
  page,
}) => {
  const widget = await openPanel(page);
  // The fixture runs on 127.0.0.1; that story is limited to the analyzer host, so
  // it is not this reviewer's to answer and must not count against them.
  await expect(widget.getByText("Only on the analyzer host")).toHaveCount(0);
  await expect(widget.locator(".step")).toHaveCount(2);
});

test("counts only the steps the reviewer can actually reach", async ({
  page,
}) => {
  const widget = await openPanel(page);
  // A hidden story's steps must stay out of the total, or the panel asks for
  // answers that cannot be given and the review never reads as finished.
  await widget.getByRole("button", { name: "Minimize" }).click();
  await expect(widget.locator(".tab")).toContainText("0/2");
});

test("does not send a malformed pr or mock to the issue tracker", async ({
  page,
}) => {
  // Served just for this test rather than added to the shared fixture: a story
  // there changes the step counts a dozen other tests assert on.
  await page.route("**/tests/widget/uat.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 2,
        checklistRevision: "malformed-links",
        title: "Analyzer QC review",
        instance: "analyzers",
        sections: [
          {
            title: "Links an author got wrong",
            key: "AN-BADLINKS",
            // What an author who types a PR number rather than its URL produces.
            links: { jira: "OGC-1054", pr: "3195", mock: "the-figma-one" },
            steps: [
              { key: "AN-QC-800", required: true, do: "A step under it" },
            ],
          },
        ],
      },
    }),
  );

  const widget = await openPanel(page);
  const links = widget.locator(".secrow").first().locator(".storylink");

  // A bare Jira key is the common case and worth resolving. A bare pr or mock is
  // not a Jira key — pointing it at the tracker sends the reviewer somewhere
  // confidently wrong, which is worse than not offering the link at all.
  await expect(links.filter({ hasText: /^PR$/ })).toHaveCount(0);
  await expect(links.filter({ hasText: /^Mock$/ })).toHaveCount(0);
  for (const href of await links.evaluateAll((els) =>
    els.map((e) => e.getAttribute("href")),
  )) {
    expect(href).not.toMatch(/browse\/(3195|the-figma-one)/);
  }
  // The Jira key still resolves against the tracker.
  await expect(links.filter({ hasText: "OGC-1054" })).toHaveAttribute(
    "href",
    /browse\/OGC-1054/,
  );
});
