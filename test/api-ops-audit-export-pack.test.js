import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createStore } from "../src/api/store.js";
import { request } from "./api-test-harness.js";

test("ops audit export: deterministic row-chain hashes are stable across reruns", async () => {
  const store = createStore();
  store.listOpsAudit = async () => [
    {
      id: 11,
      at: "2026-02-01T00:00:00.000Z",
      action: "EMERGENCY_CONTROL_REVOKE",
      targetType: "emergency_control",
      targetId: "emc_det_1",
      detailsHash: "a".repeat(64),
      actorKeyId: "signer_ops_det_1",
      actorPrincipalId: "ops_det_1",
      details: { reasonCode: "OPS_EMERGENCY_REVOKE", reason: "deterministic check" }
    },
    {
      id: 12,
      at: "2026-02-01T00:01:00.000Z",
      action: "DELEGATION_GRANT_REVOKE",
      targetType: "delegation_grant",
      targetId: "dgrant_det_1",
      detailsHash: "b".repeat(64),
      actorKeyId: "signer_ops_det_2",
      actorPrincipalId: "ops_det_2",
      details: { reasonCode: "OPS_DELEGATION_REVOKE", reason: "delegation revoke check" }
    }
  ];
  const api = createApi({ store, opsTokens: "tok_opsr:ops_read" });

  const first = await request(api, {
    method: "GET",
    path: "/ops/audit/export?domain=governance&limit=200",
    headers: { "x-proxy-ops-token": "tok_opsr" }
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json?.export?.schemaVersion, "OpsAuditExport.v1");
  assert.equal(first.json?.export?.count, 2);
  assert.match(String(first.json?.export?.exportHash ?? ""), /^[a-f0-9]{64}$/);
  assert.match(String(first.json?.export?.rowChainHeadHash ?? ""), /^[a-f0-9]{64}$/);

  const rows = first.json?.export?.rows ?? [];
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.prevRowHash, null);
  assert.match(String(rows[0]?.rowHash ?? ""), /^[a-f0-9]{64}$/);
  assert.equal(rows[1]?.prevRowHash, rows[0]?.rowHash);
  assert.equal(rows[1]?.rowHash, first.json?.export?.rowChainHeadHash);

  const second = await request(api, {
    method: "GET",
    path: "/ops/audit/export?domain=governance&limit=200",
    headers: { "x-proxy-ops-token": "tok_opsr" }
  });
  assert.equal(second.statusCode, 200, second.body);
  assert.deepEqual(second.json?.export, first.json?.export);
});

test("ops audit export: missing required lineage bindings fail closed", async () => {
  const store = createStore();
  store.listOpsAudit = async () => [
    {
      id: 41,
      at: "2026-02-01T00:00:00.000Z",
      action: "EMERGENCY_CONTROL_REVOKE",
      targetType: null,
      targetId: null,
      detailsHash: "c".repeat(64),
      actorKeyId: "signer_ops_missing_ref",
      actorPrincipalId: "ops_missing_ref",
      details: { reasonCode: "OPS_EMERGENCY_REVOKE" }
    }
  ];
  const api = createApi({ store, opsTokens: "tok_opsr:ops_read" });

  const res = await request(api, {
    method: "GET",
    path: "/ops/audit/export?domain=governance&limit=200",
    headers: { "x-proxy-ops-token": "tok_opsr" }
  });
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json?.code, "AUDIT_EXPORT_BINDING_REQUIRED");
  assert.equal(res.json?.details?.requiredRef, "emergencyControlRef");
});
