import { expect, test } from "@playwright/test";

test("chat is usable at phone width with no horizontal scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Welcome to Physiotherapy Treatment at Home")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.locator("#chat").scrollIntoViewIfNeeded();
  await page.getByRole("group", { name: "Suggested replies" }).getByRole("button", { name: "Request a home physiotherapy appointment" }).click();
  await expect(page.getByText("What is the patient's full name?")).toBeVisible();
  await page.waitForTimeout(700);
  if (process.env.E2E_SHOTS_DIR) await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/10-mobile.png` });
});
