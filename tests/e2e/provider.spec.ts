import { test, expect } from "@playwright/test";
test("explicit live provider check: grounded cards or a clear billing error", async ({
  page,
}) => {
  test.skip(
    process.env.RUN_LIVE_PROVIDER_CHECK !== "1",
    "Only an explicit provider check uses the real API.",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator(".context-header .runtime-label")).toHaveText(
    "Gemini 3.1 Flash-Lite",
  );
  await page.getByRole("button", { name: /이야기가 움직이는 순간/ }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".scene-card") ||
      document.querySelector(".request-error"),
    undefined,
    { timeout: 60_000 },
  );
  if (await page.locator(".request-error").count()) {
    await expect(page.locator(".request-error")).toContainText("HTTP 402");
    await expect(page.locator(".scene-card")).toHaveCount(0);
    await page.screenshot({ path: "test-results/live-provider-billing.png" });
    console.log(
      "Live provider reached: HTTP 402 / prepayment credits depleted; no successful generation claimed.",
    );
    return;
  }
  expect(await page.locator(".scene-card").count()).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "이 장면으로 쇼츠 기획하기" }).click();
  await expect(page.locator(".plan-card")).toHaveCount(3, { timeout: 60_000 });
  await page
    .locator(".plan-card")
    .nth(1)
    .getByRole("button", { name: "이 초안 만들기", exact: true })
    .click();
  await expect(page.locator(".draft-result")).toBeVisible();
});
