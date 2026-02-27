import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";

test("governance templates: list denies callers without governance/finance read scope", async () => {
  const api = createApi({ opsTokens: "tok_opsr:ops_read" });

  const res = await request(api, {
    method: "GET",
    path: "/ops/governance/templates",
    headers: {
      "x-proxy-tenant-id": "tenant_gov_tpl_deny",
      "x-proxy-ops-token": "tok_opsr"
    }
  });

  assert.equal(res.statusCode, 403, res.body);
});

test("governance templates: create fails closed on invalid payload", async () => {
  const api = createApi({ opsTokens: "tok_finw:finance_write" });

  const res = await request(api, {
    method: "POST",
    path: "/ops/governance/templates",
    headers: {
      "x-proxy-tenant-id": "tenant_gov_tpl_invalid",
      "x-proxy-ops-token": "tok_finw",
      "x-idempotency-key": "idem_gov_tpl_invalid_1"
    },
    body: {
      templateId: "ops.safe-default",
      name: "Ops Safe Default",
      policy: "not-an-object"
    }
  });

  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json?.code, "SCHEMA_INVALID");
});

test("governance templates: create/list/get/apply success path", async () => {
  const api = createApi({ opsTokens: "tok_finw:finance_write;tok_finr:finance_read" });
  const tenantId = "tenant_gov_tpl_success";

  const created = await request(api, {
    method: "POST",
    path: "/ops/governance/templates",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finw",
      "x-idempotency-key": "idem_gov_tpl_create_1"
    },
    body: {
      templateId: "ops.safe-default",
      templateVersion: 1,
      name: "Ops Safe Default",
      description: "Baseline hold policy",
      policy: {
        finance: {
          monthCloseHoldPolicy: "ALLOW_WITH_DISCLOSURE"
        }
      },
      metadata: {
        owner: "ops"
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.template?.schemaVersion, "GovernanceTemplate.v1");
  assert.equal(created.json?.template?.templateId, "ops.safe-default");
  assert.equal(created.json?.template?.templateVersion, 1);

  const listed = await request(api, {
    method: "GET",
    path: "/ops/governance/templates?latest=true",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finr"
    }
  });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json?.total, 1);
  assert.equal(listed.json?.templates?.[0]?.templateId, "ops.safe-default");

  const fetched = await request(api, {
    method: "GET",
    path: "/ops/governance/templates/ops.safe-default?templateVersion=1",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finr"
    }
  });
  assert.equal(fetched.statusCode, 200, fetched.body);
  assert.equal(fetched.json?.template?.templateHash, created.json?.template?.templateHash);

  const applied = await request(api, {
    method: "POST",
    path: "/ops/governance/templates/ops.safe-default/apply",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finw",
      "x-proxy-expected-prev-chain-hash": "null",
      "x-idempotency-key": "idem_gov_tpl_apply_1"
    },
    body: {
      templateVersion: 1,
      effectiveFrom: "2026-01-01T00:00:00.000Z"
    }
  });
  assert.equal(applied.statusCode, 201, applied.body);
  assert.equal(applied.json?.event?.type, "TENANT_POLICY_UPDATED");
  assert.deepEqual(applied.json?.event?.payload?.policy, {
    finance: {
      monthCloseHoldPolicy: "ALLOW_WITH_DISCLOSURE"
    }
  });

  const replayed = await request(api, {
    method: "POST",
    path: "/ops/governance/templates/ops.safe-default/apply",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finw",
      "x-proxy-expected-prev-chain-hash": String(applied.json?.event?.chainHash ?? ""),
      "x-idempotency-key": "idem_gov_tpl_apply_2"
    },
    body: {
      templateVersion: 1,
      effectiveFrom: "2026-01-01T00:00:00.000Z"
    }
  });
  assert.equal(replayed.statusCode, 200, replayed.body);
  assert.equal(replayed.json?.alreadyExists, true);
  assert.equal(replayed.json?.event?.id, applied.json?.event?.id);
});
