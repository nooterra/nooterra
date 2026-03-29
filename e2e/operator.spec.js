import { test, expect } from "@playwright/test";

test.describe("Operator console", () => {
  test("loads without JS errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/operator");
    await expect(page.locator("body")).toBeVisible();

    // Should show the operator console header
    await expect(page.locator("text=Nooterra Operator Console")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("tab navigation works", async ({ page }) => {
    await page.goto("/operator");

    // Default tab is Rescue Queue
    await expect(page.locator("h1")).toContainText("Rescue Queue");

    // Click each tab and verify heading changes
    for (const [tab, heading] of [
      ["Launch Metrics", "Action Wallet Launch Metrics"],
      ["Audit Feed", "Audit Feed"],
      ["Emergency Controls", "Emergency Controls"],
      ["Spend Escalations", "Spend Escalations"],
      ["Rescue Queue", "Rescue Queue"]
    ]) {
      await page.getByRole("button", { name: tab }).click();
      await expect(page.locator("h1")).toContainText(heading);
    }
  });

  test("config inputs are editable", async ({ page }) => {
    await page.goto("/operator");

    const tenantInput = page.locator('input[placeholder="tenant_default"]');
    await expect(tenantInput).toBeVisible();
    await tenantInput.fill("tenant_e2e");
    await expect(tenantInput).toHaveValue("tenant_e2e");
  });
});
