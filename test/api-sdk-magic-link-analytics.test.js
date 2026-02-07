import test from "node:test";
import assert from "node:assert/strict";

import { SettldClient } from "../packages/api-sdk/src/index.js";

function jsonResponse(body, { status = 200, requestId = "req_magic_link_1" } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId
    }
  });
}

test("api-sdk: tenant analytics + trust graph methods call expected endpoints", async () => {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ ok: true });
  };

  const client = new SettldClient({
    baseUrl: "https://magic-link.settld.local",
    tenantId: "tenant_sdk",
    xApiKey: "magic_key_test",
    fetch: fetchStub
  });

  await client.getTenantAnalytics("tenant_demo", { month: "2026-02", bucket: "week", limit: 10 });
  assert.equal(
    calls[0].url,
    "https://magic-link.settld.local/v1/tenants/tenant_demo/analytics?month=2026-02&bucket=week&limit=10"
  );
  assert.equal(calls[0].init?.method, "GET");
  assert.equal(calls[0].init?.headers?.["x-api-key"], "magic_key_test");

  await client.getTenantTrustGraph("tenant_demo", { month: "2026-02", minRuns: 3, maxEdges: 150 });
  assert.equal(
    calls[1].url,
    "https://magic-link.settld.local/v1/tenants/tenant_demo/trust-graph?month=2026-02&minRuns=3&maxEdges=150"
  );
  assert.equal(calls[1].init?.method, "GET");

  await client.listTenantTrustGraphSnapshots("tenant_demo", { limit: 25 });
  assert.equal(calls[2].url, "https://magic-link.settld.local/v1/tenants/tenant_demo/trust-graph/snapshots?limit=25");
  assert.equal(calls[2].init?.method, "GET");

  await client.createTenantTrustGraphSnapshot("tenant_demo", { month: "2026-02", minRuns: 5, maxEdges: 200 });
  assert.equal(calls[3].url, "https://magic-link.settld.local/v1/tenants/tenant_demo/trust-graph/snapshots");
  assert.equal(calls[3].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[3].init?.body ?? "{}")), { month: "2026-02", minRuns: 5, maxEdges: 200 });

  await client.diffTenantTrustGraph("tenant_demo", {
    baseMonth: "2026-01",
    compareMonth: "2026-02",
    limit: 50,
    minRuns: 2,
    maxEdges: 120,
    includeUnchanged: true
  });
  assert.equal(
    calls[4].url,
    "https://magic-link.settld.local/v1/tenants/tenant_demo/trust-graph/diff?baseMonth=2026-01&compareMonth=2026-02&limit=50&minRuns=2&maxEdges=120&includeUnchanged=true"
  );
  assert.equal(calls[4].init?.method, "GET");
});
