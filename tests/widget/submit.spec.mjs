import { expect, test } from "@playwright/test";

const APP = "/tests/widget/fixture.html";
const widgetOf = (page) => page.locator("#oe-review-host");

// Carries what the shared fixture predates: a story version an author set and a
// content revision computed from the story. Both are what an answer is pinned
// to, so a checklist without them cannot exercise submitting at all.
const CHECKLIST = {
  schemaVersion: 2,
  checklistRevision: "rev-abc",
  title: "Analyzer QC review",
  instance: "analyzers",
  intro: "Review the analyzer flow.",
  sections: [
    {
      title: "Profiles",
      key: "AN-PROFILES",
      version: "2.1",
      revision: "9f8e7d6c5b4a",
      steps: [
        {
          key: "AN-QC-001",
          required: true,
          do: "Find a shipped profile",
          route: "/analyzers/types",
        },
        { key: "AN-QC-002", required: true, do: "Create an analyzer" },
      ],
    },
  ],
};

async function openPanel(
  page,
  {
    session = {
      authenticated: true,
      loginName: "mmwanza",
      firstName: "Mercy",
      lastName: "Mwanza",
    },
  } = {},
) {
  await page.route("**/session", (route) => route.fulfill({ json: session }));
  await page.route("**/tests/widget/uat.json", (route) =>
    route.fulfill({ json: CHECKLIST }),
  );
  await page.goto(APP);
  const widget = widgetOf(page);
  await widget.getByRole("button", { name: /review/i }).click();
  await expect(widget.locator(".panel")).toBeVisible();
  return widget;
}

// Answers the first step and returns the widget, so each test starts from a
// review that has something in it to hand in.
async function answerOneStep(widget, mark = "Fail") {
  await widget
    .locator(".step")
    .first()
    .locator(".stepnote")
    .fill("the list was empty");
  await widget
    .locator(".step")
    .first()
    .getByText(mark, { exact: true })
    .click();
  return widget;
}

// Located by class rather than by name: the button renames itself while a
// submission is in flight, and half these assertions are about that moment.
const submitButton = (widget) => widget.locator("button.submit");

// Captures the submission without answering it, so a test can assert on what was
// sent and then decide what the service says back.
async function captureSubmit(page, respond) {
  const sent = [];
  await page.route("**/__review/uat-analyzers/submissions", async (route) => {
    sent.push(JSON.parse(route.request().postData() || "{}"));
    await respond(route);
  });
  return sent;
}

const ok = (route) =>
  route.fulfill({
    status: 201,
    json: { id: 12, reviewer: { login: "mmwanza", name: "Mercy Mwanza" } },
  });

test("sends each answer pinned to the story version it was given against", async ({
  page,
}) => {
  const sent = await captureSubmit(page, ok);
  const widget = await answerOneStep(await openPanel(page));
  await expect(
    widget.getByRole("button", { name: "Submit review" }),
  ).toBeVisible();
  await submitButton(widget).click();

  await expect.poll(() => sent.length).toBe(1);
  const [body] = sent;
  expect(body.checklistRevision).toBe("rev-abc");
  expect(body.appSha).toBeTruthy();

  // Only what was answered. An unanswered step is not a "not yet" to record —
  // it is a step this review says nothing about.
  expect(body.answers).toHaveLength(1);
  const [answer] = body.answers;
  expect(answer.stepKey).toBe("AN-QC-001");
  expect(answer.mark).toBe("fail");
  expect(answer.note).toBe("the list was empty");
  expect(answer.storyKey).toBe("AN-PROFILES");
  expect(answer.storyVersion).toBe("2.1");
  expect(answer.storyRevision).toBe("9f8e7d6c5b4a");
  expect(answer.actualUrl).toContain("/tests/widget/fixture.html");
});

test("says the review went in, and whose name is on it", async ({ page }) => {
  await captureSubmit(page, ok);
  const widget = await answerOneStep(await openPanel(page));
  await submitButton(widget).click();
  await expect(widget.locator(".statusbox")).toContainText("Mercy Mwanza");
});

test("a reviewer the service will not vouch for is asked to sign in", async ({
  page,
}) => {
  // The local session probe can be out of date — a session expires while the
  // review is being worked. What the service says is the answer that counts.
  await captureSubmit(page, (route) =>
    route.fulfill({
      status: 401,
      json: { error: "sign in to submit this review", needsLogin: true },
    }),
  );
  const widget = await answerOneStep(await openPanel(page));
  await submitButton(widget).click();
  await expect(widget.locator(".signin")).toContainText(/sign in/i);
});

test("a deployment that does not take submissions says so, and what to do instead", async ({
  page,
}) => {
  await captureSubmit(page, (route) =>
    route.fulfill({
      status: 501,
      json: { error: "this deployment cannot verify who is reviewing" },
    }),
  );
  const widget = await answerOneStep(await openPanel(page));
  await submitButton(widget).click();
  // Not a dead end: the downloadable report is the whole point of the widget
  // being usable with no backend at all.
  await expect(widget.locator(".statusbox")).toContainText(/download/i);
});

test("a review that failed to send is still there to send again", async ({
  page,
}) => {
  // The specific mistake this guards: treating the click as the handover and
  // clearing up after it. A reviewer whose answers vanished into a 502 has lost
  // the entire session's work and has no way to know what was in it.
  await captureSubmit(page, (route) =>
    route.fulfill({
      status: 502,
      json: { error: "the review could not be saved" },
    }),
  );
  const widget = await answerOneStep(await openPanel(page));
  await submitButton(widget).click();

  await expect(widget.locator(".statusbox")).toContainText(
    /could not|try again/i,
  );
  await expect(widget.locator(".step").first()).toHaveAttribute(
    "data-state",
    "fail",
  );
  await expect(submitButton(widget)).toBeEnabled();

  const json = JSON.parse(
    await page.evaluate(() => window.__OE_REVIEW_TEST__.buildReport().json),
  );
  expect(json.checklist[0].steps[0].note).toBe("the list was empty");
});

test("there is nothing to submit until something has been answered", async ({
  page,
}) => {
  const sent = await captureSubmit(page, ok);
  const widget = await openPanel(page);
  await expect(submitButton(widget)).toBeDisabled();
  expect(sent).toHaveLength(0);
});

test("an impatient second click does not file the review twice", async ({
  page,
}) => {
  // Two rows for one review is not a duplicate to clean up later: each carries a
  // timestamp and a reviewer, so both read as real, and neither says which one
  // the person meant.
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const sent = await captureSubmit(page, async (route) => {
    await held;
    await ok(route);
  });

  const widget = await answerOneStep(await openPanel(page));
  await submitButton(widget).click();
  // Renamed and disabled together, so the reviewer can see why a second click
  // does nothing rather than being left wondering whether the first one landed.
  await expect(submitButton(widget)).toBeDisabled();
  await expect(submitButton(widget)).toHaveText("Sending…");
  await submitButton(widget)
    .click({ force: true, timeout: 2000 })
    .catch(() => {});

  release();
  await expect(widget.locator(".statusbox")).toContainText("Mercy Mwanza");
  expect(sent).toHaveLength(1);
});

test("the fourth button in the row still fits the narrowest panel", async ({
  page,
}) => {
  // The popped-out window is 460px and the compact overlay is not much wider.
  // A footer that overflows does not wrap — it clips, and the button that goes
  // missing is the one at the end, which is this one.
  await page.setViewportSize({ width: 460, height: 700 });
  const widget = await answerOneStep(await openPanel(page));

  const foot = widget.locator(".foot");
  const overflow = await foot.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const button = await submitButton(widget).boundingBox();
  const panel = await widget.locator(".panel").boundingBox();
  expect(button.x + button.width).toBeLessThanOrEqual(
    panel.x + panel.width + 1,
  );
});

test("a page with no submission endpoint at all says so the same way", async ({
  page,
}) => {
  // The widget's headline property is that it runs with no backend — index.html
  // is a live demo of exactly that, and there a submission 404s. That is the
  // same fact as a 501: there is nowhere to hand this in, download it instead.
  // Reading it as a fault makes the backend-free demo look broken.
  await page.route("**/__review/uat-analyzers/submissions", (route) =>
    route.fulfill({ status: 404, body: "Not found" }),
  );
  const widget = await answerOneStep(await openPanel(page));
  await submitButton(widget).click();
  await expect(widget.locator(".statusbox")).toContainText(/download/i);
});

test("carries the session cookie the application scoped to its own path", async ({
  page,
  context,
}) => {
  // OpenELIS is a servlet app: Tomcat scopes JSESSIONID to the context path, so
  // the cookie only travels to URLs under it. `secure` is off here only because
  // the fixture is served over http; the property under test is the path.
  await context.addCookies([
    {
      name: "JSESSIONID",
      value: "session-token",
      domain: "127.0.0.1",
      path: "/api/OpenELIS-Global",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const seen = [];
  await page.route("**/submissions", async (route) => {
    seen.push(route.request().headers().cookie || "");
    await ok(route);
  });

  const widget = await answerOneStep(await openPanel(page));
  await submitButton(widget).click();

  await expect.poll(() => seen.length).toBe(1);
  // Same-origin is not enough. A submission sent outside the cookie's path
  // arrives anonymous, and the service can only answer 401 — however signed in
  // the reviewer is, and however confidently the panel says so.
  expect(seen[0]).toContain("JSESSIONID=session-token");
});
