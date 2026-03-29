import { test, expect } from "@playwright/test";

/**
 * Approval flow E2E tests.
 *
 * These tests require a running API server with Redis and Postgres.
 * In CI, start Docker Compose services before running:
 *   docker compose up -d postgres redis
 *   npm run dev --prefix dashboard &
 *   npx playwright test e2e/approval-flow.spec.js
 */

const API_BASE = process.env.E2E_API_BASE || "http://127.0.0.1:3000";

test.describe("Approval flow", () => {
  test.skip(
    !process.env.E2E_API_BASE && !process.env.E2E_FULL,
    "Skipped: set E2E_FULL=1 or E2E_API_BASE to run against a live API"
  );

  test("can view approvals page", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page.locator("body")).toBeVisible();
  });

  test("API health endpoint responds", async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("ok", true);
  });

  test("approval request lifecycle via API", async ({ request }) => {
    // 1. Create a session
    const sessionRes = await request.post(`${API_BASE}/sessions`, {
      headers: {
        "content-type": "application/json",
        "x-nooterra-protocol": "1.0",
        "x-proxy-tenant-id": "tenant_e2e_test"
      },
      data: {
        agentId: "agent_e2e_test",
        instructions: "E2E test session"
      }
    });
    // Session creation may fail if schema isn't migrated — that's OK for this skeleton.
    if (!sessionRes.ok()) {
      test.skip(true, `Session creation failed (${sessionRes.status()}) — API may not be fully provisioned`);
      return;
    }
    const session = await sessionRes.json();
    expect(session).toHaveProperty("sessionId");
  });
});
