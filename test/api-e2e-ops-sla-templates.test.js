import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";

test("API e2e: /ops/sla-templates returns catalog for ops_read", async () => {
  const api = createApi({ opsTokens: "tok:ops_read" });
  const res = await request(api, { method: "GET", path: "/ops/sla-templates", headers: { "x-proxy-ops-token": "tok" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json?.schemaVersion, "SlaPolicyTemplateCatalog.v1");
  assert.equal(res.json?.tenantId, "tenant_default");
  assert.deepEqual(
    res.json?.templates?.map((item) => item.templateId),
    [
      "delivery_standard_v1",
      "delivery_priority_v1",
      "delivery_bulk_route_v1",
      "delivery_cold_chain_v1",
      "security_patrol_strict_v1",
      "security_patrol_compliance_v1",
      "security_perimeter_watch_v1"
    ]
  );
});

test("API e2e: /ops/sla-templates supports vertical filter and rejects invalid values", async () => {
  const api = createApi({ opsTokens: "tok:ops_read" });

  const filtered = await request(api, {
    method: "GET",
    path: "/ops/sla-templates?vertical=security",
    headers: { "x-proxy-ops-token": "tok" }
  });
  assert.equal(filtered.statusCode, 200);
  assert.deepEqual(
    filtered.json?.templates?.map((item) => item.templateId),
    ["security_patrol_strict_v1", "security_patrol_compliance_v1", "security_perimeter_watch_v1"]
  );

  const invalid = await request(api, {
    method: "GET",
    path: "/ops/sla-templates?vertical=healthcare",
    headers: { "x-proxy-ops-token": "tok" }
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json?.code, "SCHEMA_INVALID");
});
