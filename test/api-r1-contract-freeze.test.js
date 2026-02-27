import test from "node:test";
import assert from "node:assert/strict";

import { buildOpenApiSpec } from "../src/api/openapi.js";

function assertOperation(spec, path, method, { scopes = null } = {}) {
  const op = spec?.paths?.[path]?.[method] ?? null;
  assert.ok(op, `missing operation ${method.toUpperCase()} ${path}`);
  if (scopes) {
    const gotScopes = op["x-nooterra-scopes"] ?? [];
    assert.deepEqual(gotScopes, scopes, `scope mismatch for ${method.toUpperCase()} ${path}`);
  }
}

function assertObjectSchema(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object schema`);
}

test("R1 API contract freeze: required operations remain published", () => {
  const spec = buildOpenApiSpec();
  assert.equal(spec?.openapi, "3.0.3");

  assertOperation(spec, "/agents/register", "post");
  assertOperation(spec, "/agents/{agentId}/passport", "get");
  assertOperation(spec, "/agents/{agentId}/passport", "post");
  assertOperation(spec, "/agents/{agentId}/passport/revoke", "post");
  assertOperation(spec, "/agents/{agentId}/wallet/credit", "post");
  assertOperation(spec, "/agents/{agentId}/runs", "post");
  assertOperation(spec, "/agents/{agentId}/runs/{runId}/events", "post");

  assertOperation(spec, "/marketplace/rfqs", "post");
  assertOperation(spec, "/marketplace/rfqs", "get");
  assertOperation(spec, "/marketplace/rfqs/{rfqId}/bids", "post");
  assertOperation(spec, "/marketplace/rfqs/{rfqId}/accept", "post");

  assertOperation(spec, "/runs/{runId}/settlement", "get");
  assertOperation(spec, "/runs/{runId}/settlement/policy-replay", "get");
  assertOperation(spec, "/runs/{runId}/settlement/resolve", "post");
  assertOperation(spec, "/runs/{runId}/dispute/open", "post");
  assertOperation(spec, "/runs/{runId}/dispute/close", "post");
  assertOperation(spec, "/runs/{runId}/dispute/evidence", "post");
  assertOperation(spec, "/runs/{runId}/dispute/escalate", "post");
  assertOperation(spec, "/ops/tool-calls/replay-evaluate", "get", { scopes: ["ops_read"] });

  assertOperation(spec, "/ops/payouts/{partyId}/{period}/enqueue", "post", { scopes: ["finance_write"] });
  assertOperation(spec, "/ops/money-rails/{providerId}/operations/{operationId}", "get", { scopes: ["finance_read"] });
  assertOperation(spec, "/ops/money-rails/{providerId}/operations/{operationId}/cancel", "post", { scopes: ["finance_write"] });
  assertOperation(spec, "/x402/gate/authorize-payment", "post");
});

test("R1 API contract freeze: dispute lifecycle semantics remain encoded", () => {
  const spec = buildOpenApiSpec();

  const acceptRequest =
    spec?.paths?.["/marketplace/rfqs/{rfqId}/accept"]?.post?.requestBody?.content?.["application/json"]?.schema ?? null;
  assertObjectSchema(acceptRequest, "accept request");
  assert.ok(
    Object.prototype.hasOwnProperty.call(acceptRequest.properties ?? {}, "disputeWindowDays"),
    "accept request must expose disputeWindowDays"
  );

  const disputeOpen = spec?.paths?.["/runs/{runId}/dispute/open"]?.post ?? null;
  assertObjectSchema(disputeOpen, "dispute open operation");
  assert.match(
    String(disputeOpen.summary ?? ""),
    /within dispute window/i,
    "dispute open summary must document dispute-window gating"
  );
  assert.ok(disputeOpen.responses?.["409"], "dispute open must publish 409 conflict response");

  const disputeOpenResponse =
    disputeOpen?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.settlement ?? null;
  assertObjectSchema(disputeOpenResponse, "dispute open settlement schema");
  const settlementProperties = disputeOpenResponse.properties ?? {};
  assert.ok(
    Object.prototype.hasOwnProperty.call(settlementProperties, "disputeWindowDays"),
    "settlement schema must include disputeWindowDays"
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(settlementProperties, "disputeWindowEndsAt"),
    "settlement schema must include disputeWindowEndsAt"
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(settlementProperties, "disputeStatus"),
    "settlement schema must include disputeStatus"
  );
  assert.ok(
    Array.isArray(settlementProperties.decisionStatus?.enum) &&
      settlementProperties.decisionStatus.enum.includes("manual_review_required") &&
      settlementProperties.decisionStatus.enum.includes("manual_resolved"),
    "settlement decisionStatus enum must include manual review lifecycle states"
  );

  const disputeCloseRequest =
    spec?.paths?.["/runs/{runId}/dispute/close"]?.post?.requestBody?.content?.["application/json"]?.schema ?? null;
  assertObjectSchema(disputeCloseRequest, "dispute close request");
  assert.ok(
    Object.prototype.hasOwnProperty.call(disputeCloseRequest.properties ?? {}, "resolution"),
    "dispute close request must support structured resolution payloads"
  );
});

test("R1 API contract freeze: x402 authorize-payment publishes known execution-intent error codes", () => {
  const spec = buildOpenApiSpec();
  const operation = spec?.paths?.["/x402/gate/authorize-payment"]?.post ?? null;
  assert.ok(operation, "missing POST /x402/gate/authorize-payment");

  const knownConflictCodes = operation?.responses?.["409"]?.["x-nooterra-known-error-codes"] ?? [];
  assert.ok(Array.isArray(knownConflictCodes), "x402 authorize-payment 409 must expose known error codes");
  assert.ok(knownConflictCodes.includes("X402_EXECUTION_INTENT_REQUIRED"));
  assert.ok(knownConflictCodes.includes("X402_EXECUTION_INTENT_IDEMPOTENCY_MISMATCH"));
  assert.ok(knownConflictCodes.includes("X402_EXECUTION_INTENT_CONFLICT"));
});

test("R1 API contract freeze: x402 verify publishes known request-binding conflict error codes", () => {
  const spec = buildOpenApiSpec();
  const operation = spec?.paths?.["/x402/gate/verify"]?.post ?? null;
  assert.ok(operation, "missing POST /x402/gate/verify");

  const knownConflictCodes = operation?.responses?.["409"]?.["x-nooterra-known-error-codes"] ?? [];
  assert.ok(Array.isArray(knownConflictCodes), "x402 verify 409 must expose known error codes");
  assert.ok(knownConflictCodes.includes("X402_REQUEST_BINDING_REQUIRED"));
  assert.ok(knownConflictCodes.includes("X402_REQUEST_BINDING_EVIDENCE_REQUIRED"));
  assert.ok(knownConflictCodes.includes("X402_REQUEST_BINDING_EVIDENCE_MISMATCH"));
});

test("R1 API contract freeze: dispute/arbitration routes publish binding integrity conflict error codes", () => {
  const spec = buildOpenApiSpec();
  const checks = [
    {
      path: "/runs/{runId}/arbitration/open",
      codes: [
        "X402_ARBITRATION_OPEN_BINDING_EVIDENCE_REQUIRED",
        "X402_ARBITRATION_OPEN_BINDING_EVIDENCE_MISMATCH"
      ]
    },
    {
      path: "/runs/{runId}/arbitration/assign",
      codes: [
        "X402_ARBITRATION_ASSIGN_BINDING_EVIDENCE_REQUIRED",
        "X402_ARBITRATION_ASSIGN_BINDING_EVIDENCE_MISMATCH"
      ]
    },
    {
      path: "/runs/{runId}/arbitration/evidence",
      codes: [
        "X402_ARBITRATION_EVIDENCE_BINDING_EVIDENCE_REQUIRED",
        "X402_ARBITRATION_EVIDENCE_BINDING_EVIDENCE_MISMATCH"
      ]
    },
    {
      path: "/runs/{runId}/dispute/open",
      codes: [
        "X402_DISPUTE_OPEN_BINDING_EVIDENCE_REQUIRED",
        "X402_DISPUTE_OPEN_BINDING_EVIDENCE_MISMATCH"
      ]
    },
    {
      path: "/runs/{runId}/dispute/evidence",
      codes: [
        "X402_DISPUTE_EVIDENCE_BINDING_EVIDENCE_REQUIRED",
        "X402_DISPUTE_EVIDENCE_BINDING_EVIDENCE_MISMATCH"
      ]
    },
    {
      path: "/runs/{runId}/dispute/escalate",
      codes: [
        "X402_DISPUTE_ESCALATE_BINDING_EVIDENCE_REQUIRED",
        "X402_DISPUTE_ESCALATE_BINDING_EVIDENCE_MISMATCH"
      ]
    },
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
    const knownConflictCodes = operation?.responses?.["409"]?.["x-nooterra-known-error-codes"] ?? [];
    assert.ok(Array.isArray(knownConflictCodes), `${row.path} 409 must expose known error codes`);
    for (const code of row.codes) {
      assert.ok(knownConflictCodes.includes(code), `${row.path} missing ${code}`);
    }
  }
});

test("R1 API contract freeze: settlement resolve + tool-call arbitration routes publish known 409 conflict codes", () => {
  const spec = buildOpenApiSpec();
  const checks = [
    {
      path: "/runs/{runId}/settlement/resolve",
      codes: [
        "SETTLEMENT_KERNEL_BINDING_INVALID",
        "DISPUTE_OUTCOME_STATUS_MISMATCH",
        "DISPUTE_OUTCOME_AMOUNT_MISMATCH",
        "X402_SETTLEMENT_RESOLVE_BINDING_EVIDENCE_REQUIRED",
        "X402_AGENT_NOT_ACTIVE",
        "EMERGENCY_KILL_SWITCH_ACTIVE"
      ]
    },
    {
      path: "/tool-calls/arbitration/open",
      codes: [
        "TOOL_CALL_DISPUTE_BINDING_MISMATCH",
        "CASE_ID_NOT_DETERMINISTIC",
        "DISPUTE_INVALID_SIGNER",
        "X402_AGENT_NOT_ACTIVE",
        "EMERGENCY_KILL_SWITCH_ACTIVE"
      ]
    },
    {
      path: "/tool-calls/arbitration/verdict",
      codes: [
        "TRANSITION_ILLEGAL",
        "TOOL_CALL_VERDICT_NOT_BINARY",
        "ADJUSTMENT_INVALID",
        "INSUFFICIENT_ESCROW_BALANCE",
        "X402_AGENT_NOT_ACTIVE",
        "EMERGENCY_KILL_SWITCH_ACTIVE"
      ]
    }
  ];
  for (const row of checks) {
    const operation = spec?.paths?.[row.path]?.post ?? null;
    assert.ok(operation, `missing POST ${row.path}`);
    const knownConflictCodes = operation?.responses?.["409"]?.["x-nooterra-known-error-codes"] ?? [];
    assert.ok(Array.isArray(knownConflictCodes), `${row.path} 409 must expose known error codes`);
    for (const code of row.codes) {
      assert.ok(knownConflictCodes.includes(code), `${row.path} missing ${code}`);
    }
  }
});
