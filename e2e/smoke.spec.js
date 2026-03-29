import { test, expect } from "@playwright/test";

test.describe("Smoke tests", () => {
  test("homepage loads and shows hero", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    // The landing page should contain the brand name somewhere
    await expect(page.locator("body")).toContainText(/nooterra/i);
  });

  test("product page loads", async ({ page }) => {
    await page.goto("/product");
    await expect(page.locator("body")).toBeVisible();
  });

  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("body")).toBeVisible();
  });

  test("404 page for unknown route", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-12345");
    await expect(page.locator("body")).toBeVisible();
  });
});
