import { expect, test } from "@playwright/test";

const widgetOf = (page) => page.locator("#oe-review-host");
async function open(page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/tests/widget/fixture.html");
  const widget = widgetOf(page);
  await widget.locator(".tab").click();
  await widget.getByLabel("Review placement").selectOption("bottom");
  return widget;
}

async function pass(widget) {
  await widget
    .locator(".step.current")
    .getByRole("button", {
      name: "Worked as expected",
      exact: true,
    })
    .click();
}

test("partial feedback includes a summary and overall note, preserved after failure and reload", async ({
  page,
}, testInfo) => {
  const sent = [];
  await page.route("**/__review/uat-analyzers/submissions", (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({
      status: 502,
      json: { error: "Could not save feedback" },
    });
  });
  let widget = await open(page);
  await pass(widget);
  await expect(widget.locator(".completionsummary")).toHaveText(
    "1 of 2 checkpoints answered · 1 unanswered.",
  );
  await widget
    .getByLabel("Overall review note")
    .fill("I could only try the first checkpoint today.");
  await widget.getByLabel("Your name", { exact: false }).fill("New reviewer");
  await widget
    .getByRole("button", { name: "Submit partial feedback", exact: true })
    .click();
  await expect(widget.getByText(/Your answers are still here/)).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0].answers).toHaveLength(1);
  expect(sent[0].note).toContain(
    "I could only try the first checkpoint today.",
  );
  await page.reload();
  widget = widgetOf(page);
  await expect(widget.getByLabel("Overall review note")).toHaveValue(
    "I could only try the first checkpoint today.",
  );
  await expect(widget.getByLabel("Your name", { exact: false })).toHaveValue(
    "New reviewer",
  );
  await expect(widget.locator(".completionsummary")).toHaveText(
    "1 of 2 checkpoints answered · 1 unanswered.",
  );
  await widget.getByLabel("Overall review note").focus();
  await page.screenshot({ path: testInfo.outputPath("partial-summary.png") });
});

test("finishing a review leaves room to revisit checkpoints in the bottom split", async ({
  page,
}, testInfo) => {
  const widget = await open(page);
  await pass(widget);
  await pass(widget);
  await expect(widget.locator(".completionsummary")).toHaveText(
    "2 of 2 checkpoints answered · 0 unanswered.",
  );
  await expect(
    widget.getByRole("button", { name: "Submit feedback", exact: true }),
  ).toBeEnabled();
  const reading = await widget.locator(".body").boundingBox();
  expect(reading.height).toBeGreaterThanOrEqual(140);
  await widget.locator(".step").first().locator(".steptop").click();
  await expect(widget.locator(".step.current")).toContainText(
    "Find a shipped profile",
  );
  const instruction = await widget
    .locator(".step.current .steptop")
    .boundingBox();
  expect(instruction.y).toBeGreaterThanOrEqual(reading.y);
  expect(instruction.y + instruction.height).toBeLessThanOrEqual(
    reading.y + reading.height,
  );
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("completed-checkpoint.png"),
  });
});

test("Continue appears only when an explanation is needed", async ({
  page,
}) => {
  const widget = await open(page);
  await expect(
    widget
      .locator(".step.current")
      .getByRole("button", { name: "Continue", exact: true }),
  ).toBeHidden();
  await pass(widget);
  const current = widget.locator(".step.current");
  await expect(
    current.getByRole("button", { name: "Continue", exact: true }),
  ).toBeHidden();
  await current
    .getByRole("button", { name: "I couldn't try this", exact: true })
    .click();
  await expect(
    current.getByRole("button", { name: "Continue", exact: true }),
  ).toBeVisible();
  await expect(
    current.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  await current
    .getByLabel("Explain this answer")
    .fill("I do not have the required fixture.");
  await expect(
    current.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
});
