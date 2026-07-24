import { expect, test } from "@playwright/test";

test("answers stay with unchanged steps after reorder, insert, and delete", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/fixtures/widget.html?version=before");
  await page.getByRole("button", { name: "Review" }).click();

  await page
    .locator('[data-step-id="grist:101"]')
    .getByRole("button", { name: "Pass" })
    .click();
  await page
    .locator('[data-step-id="grist:102"]')
    .getByRole("button", { name: "Fail" })
    .click();

  await page.goto("/tests/fixtures/widget.html?version=after");

  await expect(page.locator(".notice")).toContainText("2 unchanged answers carried forward");
  await expect(page.locator('[data-step-id="grist:101"] .mark.pass')).toHaveClass(/on/);
  await expect(page.locator('[data-step-id="grist:102"] .mark.fail')).toHaveClass(/on/);
  await expect(page.locator('[data-step-id="grist:104"] .mark.on')).toHaveCount(0);
  await expect(page.locator('[data-step-id="grist:103"]')).toHaveCount(0);

  const topScreenshot = testInfo.outputPath("stable-review-identity-top.png");
  await page.screenshot({ path: topScreenshot, fullPage: true });
  await testInfo.attach("stable review identity - reordered step", {
    path: topScreenshot,
    contentType: "image/png",
  });

  await page.locator(".body").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const bottomScreenshot = testInfo.outputPath("stable-review-identity-bottom.png");
  await page.screenshot({ path: bottomScreenshot, fullPage: true });
  await testInfo.attach("stable review identity - carried pass", {
    path: bottomScreenshot,
    contentType: "image/png",
  });
});

test("legacy position-based answers are not reused and reset removes them", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "oe-review:amr",
      JSON.stringify({
        reviewer: "Legacy reviewer",
        minimized: false,
        steps: { "0.0": { mark: "pass" } },
        notes: [],
      }),
    );
  });
  await page.goto("/tests/fixtures/widget.html?version=before");
  await page.getByRole("button", { name: "Review" }).click();

  await expect(page.locator(".notice")).toContainText(
    "Older position-based answers were not reused",
  );
  await expect(page.locator(".mark.on")).toHaveCount(0);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("oe-review:amr")))
    .toBeNull();
});
