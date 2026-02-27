import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildOpenApiSpec } from "../src/api/openapi.js";

const REQUIRED_TA_ERROR_CODES = [
  "X402_EXECUTION_INTENT_REQUIRED",
  "X402_EXECUTION_INTENT_IDEMPOTENCY_MISMATCH",
  "X402_EXECUTION_INTENT_CONFLICT"
];

const REQUIRED_VERIFY_ERROR_CODES = [
  "X402_REQUEST_BINDING_REQUIRED",
  "X402_REQUEST_BINDING_EVIDENCE_REQUIRED",
  "X402_REQUEST_BINDING_EVIDENCE_MISMATCH"
];

const REQUIRED_BINDING_INTEGRITY_ERROR_CODES = [
  "X402_REVERSAL_BINDING_EVIDENCE_REQUIRED",
  "X402_REVERSAL_BINDING_EVIDENCE_MISMATCH",
  "X402_DISPUTE_CLOSE_BINDING_EVIDENCE_REQUIRED",
  "X402_DISPUTE_CLOSE_BINDING_EVIDENCE_MISMATCH",
  "X402_ARBITRATION_VERDICT_BINDING_EVIDENCE_REQUIRED",
  "X402_ARBITRATION_VERDICT_BINDING_EVIDENCE_MISMATCH",
  "X402_ARBITRATION_CLOSE_BINDING_EVIDENCE_REQUIRED",
  "X402_ARBITRATION_CLOSE_BINDING_EVIDENCE_MISMATCH",
  "X402_ARBITRATION_APPEAL_BINDING_EVIDENCE_REQUIRED",
  "X402_ARBITRATION_APPEAL_BINDING_EVIDENCE_MISMATCH"
];

function readX402ErrorCatalog() {
  const file = path.resolve(process.cwd(), "docs/spec/x402-error-codes.v1.txt");
  const raw = fs.readFileSync(file, "utf8");
  return new Set(
    raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
  );
}

test("x402 error catalog publishes TA execution-intent error codes", () => {
  const catalog = readX402ErrorCatalog();
  for (const code of REQUIRED_TA_ERROR_CODES) {
    assert.ok(catalog.has(code), `missing ${code} in docs/spec/x402-error-codes.v1.txt`);
  }
});

test("x402 error catalog publishes verify/runtime binding error codes", () => {
  const catalog = readX402ErrorCatalog();
  for (const code of REQUIRED_VERIFY_ERROR_CODES) {
    assert.ok(catalog.has(code), `missing ${code} in docs/spec/x402-error-codes.v1.txt`);
  }
});

test("x402 error catalog publishes settlement/reversal binding integrity error codes", () => {
  const catalog = readX402ErrorCatalog();
  for (const code of REQUIRED_BINDING_INTEGRITY_ERROR_CODES) {
    assert.ok(catalog.has(code), `missing ${code} in docs/spec/x402-error-codes.v1.txt`);
  }
});

test("openapi + sdk expose TA execution-intent error codes for x402 authorize-payment", () => {
  const spec = buildOpenApiSpec();
  const operation = spec?.paths?.["/x402/gate/authorize-payment"]?.post ?? null;
  assert.ok(operation, "missing POST /x402/gate/authorize-payment");

  const known409 = operation?.responses?.["409"]?.["x-nooterra-known-error-codes"] ?? [];
  assert.ok(Array.isArray(known409), "409 response must expose x-nooterra-known-error-codes");
  for (const code of REQUIRED_TA_ERROR_CODES) {
    assert.ok(known409.includes(code), `OpenAPI 409 known codes missing ${code}`);
  }

  const dts = fs.readFileSync(path.resolve(process.cwd(), "packages/api-sdk/src/index.d.ts"), "utf8");
  assert.match(dts, /export type X402ExecutionIntentErrorCode\s*=/);
  for (const code of REQUIRED_TA_ERROR_CODES) {
    assert.match(dts, new RegExp(code));
  }
});

test("openapi + sdk expose verify known error codes for x402 verify", () => {
  const spec = buildOpenApiSpec();
  const operation = spec?.paths?.["/x402/gate/verify"]?.post ?? null;
  assert.ok(operation, "missing POST /x402/gate/verify");

  const known409 = operation?.responses?.["409"]?.["x-nooterra-known-error-codes"] ?? [];
  assert.ok(Array.isArray(known409), "409 response must expose x-nooterra-known-error-codes");
  for (const code of REQUIRED_VERIFY_ERROR_CODES) {
    assert.ok(known409.includes(code), `OpenAPI 409 known codes missing ${code}`);
  }

  const dts = fs.readFileSync(path.resolve(process.cwd(), "packages/api-sdk/src/index.d.ts"), "utf8");
  assert.match(dts, /export type X402GateVerifyErrorCode\s*=/);
  for (const code of REQUIRED_VERIFY_ERROR_CODES) {
    assert.match(dts, new RegExp(code));
  }
});

test("openapi exposes binding integrity conflict codes for dispute/arbitration routes", () => {
  const spec = buildOpenApiSpec();
  const checks = [
    {
      path: "/runs/{runId}/dispute/close",
      codes: [
        "X402_DISPUTE_CLOSE_BINDING_EVIDENCE_REQUIRED",
        "X402_DISPUTE_CLOSE_BINDING_EVIDENCE_MISMATCH"
      ]
    },
    {
      path: "/runs/{runId}/arbitration/verdict",
      codes: [
        "X402_ARBITRATION_VERDICT_BINDING_EVIDENCE_REQUIRED",
        "X402_ARBITRATION_VERDICT_BINDING_EVIDENCE_MISMATCH"
      ]
    },
    {
      path: "/runs/{runId}/arbitration/close",
      codes: [
        "X402_ARBITRATION_CLOSE_BINDING_EVIDENCE_REQUIRED",
        "X402_ARBITRATION_CLOSE_BINDING_EVIDENCE_MISMATCH"
      ]
    },
    {
      path: "/runs/{runId}/arbitration/appeal",
      codes: [
        "X402_ARBITRATION_APPEAL_BINDING_EVIDENCE_REQUIRED",
        "X402_ARBITRATION_APPEAL_BINDING_EVIDENCE_MISMATCH"
      ]
    }
  ];
  for (const row of checks) {
    const operation = spec?.paths?.[row.path]?.post ?? null;
    assert.ok(operation, `missing POST ${row.path}`);
    const known409 = operation?.responses?.["409"]?.["x-nooterra-known-error-codes"] ?? [];
    assert.ok(Array.isArray(known409), `${row.path} 409 must expose x-nooterra-known-error-codes`);
    for (const code of row.codes) {
      assert.ok(known409.includes(code), `${row.path} 409 known codes missing ${code}`);
    }
  }
});
