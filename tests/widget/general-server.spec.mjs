import { expect, test } from "@playwright/test";

async function generalServer(
  page,
  buildSource = "/__review/target.json",
  gristOwned = false,
) {
  const stories = [
    {
      id: "amr--AMR-S01",
      review: "amr",
      key: "AMR-S01",
      title: "Microbiology story",
      routes: ["/general"],
      hosts: ["amr.example.org"],
      steps: 1,
      required: 1,
    },
    {
      id: "orders--ORD-S01",
      review: "orders",
      key: "ORD-S01",
      title: "Order story",
      routes: ["/orders"],
      hosts: ["orders.example.org"],
      steps: 1,
      required: 1,
    },
  ];
  await page.route("**/general", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><main>General testing</main><script src="/widget/oe-review-widget.js" data-instance="testing" ${gristOwned ? "" : 'data-story-scope="all"'} data-src="/uat/testing.json" data-build-src="${buildSource}"></script></body></html>`,
    }),
  );
  await page.route("**/uat/index.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 2,
        deployments: gristOwned
          ? [
              {
                instance: "testing",
                storyScope: "all",
                suggestedStories: ["orders--ORD-S01"],
              },
            ]
          : [],
        stories,
      },
    }),
  );
  for (const story of stories) {
    await page.route(`**/uat/${story.review}.json`, (route) =>
      route.fulfill({
        json: {
          schemaVersion: 2,
          checklistRevision: `revision-${story.review}`,
          instance: story.review,
          title: story.title,
          sections: [
            {
              key: story.key,
              title: story.title,
              hosts: story.hosts,
              steps: [
                {
                  key: story.key + "-001",
                  required: true,
                  do: "Check " + story.title,
                },
              ],
            },
          ],
        },
      }),
    );
  }
  await page.route("**/session", (route) =>
    route.fulfill({ json: { authenticated: true, loginName: "qa" } }),
  );
  // Reproduce the production SPA fallback: HTTP 200 with HTML instead of JSON.
  await page.route("**/__review/target.json", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html>Application shell</html>",
    }),
  );
  await page.goto("/general");
  const widget = page.locator("#oe-review-host");
  await widget.getByRole("button", { name: /review/i }).click();
  await expect(widget.locator(".step")).toContainText(
    "Check Microbiology story",
  );
  return widget;
}

test("general server lists every published source despite host and page filters and submits to its own session route", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const widget = await generalServer(page);
  await expect(widget.locator(".storymenu")).toBeVisible();
  const list = widget.getByRole("listbox", { name: "Available reviews" });
  await expect(list.getByRole("option")).toHaveCount(2);
  await list.getByRole("option", { name: /Order story/ }).click();
  await expect(widget.locator(".step")).toContainText("Check Order story");
  await widget.getByLabel("Your name").fill("General QA");
  await widget
    .locator(".step")
    .getByRole("button", { name: "Worked as expected", exact: true })
    .click();
  let sent;
  await page.route(
    "**/api/OpenELIS-Global/__review/uat-testing/submissions",
    async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        json: { id: 1, reviewer: { name: "General QA" } },
      });
    },
  );
  await widget.locator("button.submit").click();
  await expect(widget.locator(".statusbox")).toContainText("Review submitted");
  expect(sent.reviewInstance).toBe("orders");
  expect(sent.answers[0].storyKey).toBe("ORD-S01");
  expect(sent.answers[0].stepKey).toBe("ORD-S01-001");
  await page.reload();
  await expect(widget.locator(".step")).toContainText("Check Order story");
  expect(errors).toEqual([]);
});

test("a site can disable optional build metadata without making a failing request", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await generalServer(page, "none");
  expect(
    requests.some(
      (url) => url.endsWith("/__review/target.json") || url.endsWith("/none"),
    ),
  ).toBe(false);
});

test("Grist all-scope can bootstrap a site with no checklist of its own", async ({
  page,
}) => {
  const widget = await generalServer(page, "none", true);
  await expect(widget.locator(".storymenutitle")).toHaveText(
    "Suggested reviews for this deployment",
  );
  const list = widget.getByRole("listbox", {
    name: "Suggested reviews for this deployment",
  });
  await expect(list).toBeVisible();
  await expect(list.getByRole("option").first()).toContainText("Order story");
});
