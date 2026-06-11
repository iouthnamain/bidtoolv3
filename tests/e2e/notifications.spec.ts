import { expect, test, type Locator } from "@playwright/test";

async function expectMinTouchTarget(locator: Locator, minSize = 40) {
  await expect(locator).toBeVisible();

  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(minSize);
  expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(minSize);
}

test("notification selection target is finger sized on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/notifications");
  await page.waitForLoadState("networkidle");

  const target = page.getByTestId("notification-select-target").first();
  await expectMinTouchTarget(target);

  const checkbox = target.getByRole("checkbox");
  await expect(checkbox).not.toBeChecked();
  await target.click();
  await expect(checkbox).toBeChecked();
});
