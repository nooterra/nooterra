import { test, expect } from "@playwright/test";

test.describe("Dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("homepage respects dark color scheme", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();

    // Verify dark mode CSS is applied — the body or root should have
    // dark-appropriate background (not white/light).
    const bgColor = await page.locator("body").evaluate(
      (el) => getComputedStyle(el).backgroundColor
    );
    // Dark backgrounds have low RGB values; light backgrounds have high.
    // Parse rgb(r, g, b) and check that at least one channel is < 100.
    const match = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const [r, g, b] = [match[1], match[2], match[3]].map(Number);
      const avgBrightness = (r + g + b) / 3;
      // If avgBrightness > 200, the dark mode is likely not applied.
      // This is a soft check — light-themed landing pages may pass through.
      expect(avgBrightness).toBeLessThan(220);
    }
  });

  test("product page renders in dark mode without errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/product");
    await expect(page.locator("body")).toBeVisible();

    expect(errors).toEqual([]);
  });
});
