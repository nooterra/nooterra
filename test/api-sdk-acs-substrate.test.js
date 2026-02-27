import test from "node:test";
import assert from "node:assert/strict";

import { NooterraClient } from "../packages/api-sdk/src/index.js";

function makeJsonResponse(body, { status = 200, requestId = "req_test_sdk_acs_1" } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId
    }
  });
}

test("api-sdk: delegation grant methods call expected endpoints", async () => {
  const calls = [];
  const grantId = "dgrant_sdk_1";
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/delegation-grants") && String(init?.method) === "POST") {
      return makeJsonResponse({ delegationGrant: { grantId } }, { status: 201 });
    }
    if (String(url).includes("/delegation-grants?") && String(init?.method) === "GET") {
      return makeJsonResponse({ grants: [{ grantId }], limit: 20, offset: 0 });
    }
    if (String(url).endsWith(`/delegation-grants/${grantId}`) && String(init?.method) === "GET") {
      return makeJsonResponse({ delegationGrant: { grantId } });
    }
    if (String(url).endsWith(`/delegation-grants/${grantId}/revoke`) && String(init?.method) === "POST") {
      return makeJsonResponse({ delegationGrant: { grantId, revocation: { revocationReasonCode: "MANUAL_REVOKE" } } });
    }
    return makeJsonResponse({}, { status: 404 });
  };

  const client = new NooterraClient({
    baseUrl: "https://api.nooterra.local",
    tenantId: "tenant_sdk",
    fetch: fetchStub
  });

  await client.createDelegationGrant({
    grantId,
    delegatorAgentId: "agt_principal",
    delegateeAgentId: "agt_worker"
  });
  assert.equal(calls[0].url, "https://api.nooterra.local/delegation-grants");
  assert.equal(calls[0].init?.method, "POST");

  await client.issueDelegationGrant({
    grantId: "dgrant_sdk_2",
    delegatorAgentId: "agt_principal",
    delegateeAgentId: "agt_worker_2"
  });
  assert.equal(calls[1].url, "https://api.nooterra.local/delegation-grants");
  assert.equal(calls[1].init?.method, "POST");

  await client.listDelegationGrants({
    delegateeAgentId: "agt_worker",
    includeRevoked: false,
    limit: 20,
    offset: 0
  });
  assert.equal(
    calls[2].url,
    "https://api.nooterra.local/delegation-grants?delegateeAgentId=agt_worker&includeRevoked=false&limit=20&offset=0"
  );
  assert.equal(calls[2].init?.method, "GET");

  await client.getDelegationGrant(grantId);
  assert.equal(calls[3].url, `https://api.nooterra.local/delegation-grants/${grantId}`);
  assert.equal(calls[3].init?.method, "GET");

  await client.revokeDelegationGrant(grantId, { reasonCode: "MANUAL_REVOKE" });
  assert.equal(calls[4].url, `https://api.nooterra.local/delegation-grants/${grantId}/revoke`);
  assert.equal(calls[4].init?.method, "POST");
});

test("api-sdk: work-order methods call expected endpoints", async () => {
  const calls = [];
  const workOrderId = "workord_sdk_1";
  const receiptId = "worec_sdk_1";
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/work-orders") && String(init?.method) === "POST") {
      return makeJsonResponse({ workOrder: { workOrderId } }, { status: 201 });
    }
    if (String(url).includes("/work-orders?") && String(init?.method) === "GET") {
      return makeJsonResponse({ workOrders: [{ workOrderId }], limit: 20, offset: 0 });
    }
    if (String(url).endsWith(`/work-orders/${workOrderId}`) && String(init?.method) === "GET") {
      return makeJsonResponse({ workOrder: { workOrderId } });
    }
    if (String(url).endsWith(`/work-orders/${workOrderId}/accept`) && String(init?.method) === "POST") {
      return makeJsonResponse({ workOrder: { workOrderId, status: "accepted" } });
    }
    if (String(url).endsWith(`/work-orders/${workOrderId}/progress`) && String(init?.method) === "POST") {
      return makeJsonResponse({ workOrder: { workOrderId, status: "in_progress" } });
    }
    if (String(url).endsWith(`/work-orders/${workOrderId}/topup`) && String(init?.method) === "POST") {
      return makeJsonResponse({ ok: true, metering: { coveredAmountCents: 200 } }, { status: 201 });
    }
    if (String(url).includes(`/work-orders/${workOrderId}/metering`) && String(init?.method) === "GET") {
      return makeJsonResponse({ ok: true, workOrderId, metering: { schemaVersion: "WorkOrderMeteringSnapshot.v1", meterCount: 1 } });
    }
    if (String(url).endsWith(`/work-orders/${workOrderId}/complete`) && String(init?.method) === "POST") {
      return makeJsonResponse({ workOrder: { workOrderId, status: "completed" }, completionReceipt: { receiptId } });
    }
    if (String(url).endsWith(`/work-orders/${workOrderId}/settle`) && String(init?.method) === "POST") {
      return makeJsonResponse({ workOrder: { workOrderId, status: "settled" }, completionReceipt: { receiptId } });
    }
    if (String(url).includes("/work-orders/receipts?") && String(init?.method) === "GET") {
      return makeJsonResponse({ receipts: [{ receiptId }], limit: 10, offset: 0 });
    }
    if (String(url).endsWith(`/work-orders/receipts/${receiptId}`) && String(init?.method) === "GET") {
      return makeJsonResponse({ completionReceipt: { receiptId } });
    }
    return makeJsonResponse({}, { status: 404 });
  };

  const client = new NooterraClient({
    baseUrl: "https://api.nooterra.local",
    tenantId: "tenant_sdk",
    fetch: fetchStub
  });

  await client.createWorkOrder({
    workOrderId,
    principalAgentId: "agt_principal",
    subAgentId: "agt_worker",
    requiredCapability: "capability://code.generation"
  });
  assert.equal(calls[0].url, "https://api.nooterra.local/work-orders");
  assert.equal(calls[0].init?.method, "POST");

  await client.listWorkOrders({ workOrderId, status: "created", limit: 20, offset: 0 });
  assert.equal(calls[1].url, "https://api.nooterra.local/work-orders?workOrderId=workord_sdk_1&status=created&limit=20&offset=0");
  assert.equal(calls[1].init?.method, "GET");

  await client.getWorkOrder(workOrderId);
  assert.equal(calls[2].url, `https://api.nooterra.local/work-orders/${workOrderId}`);
  assert.equal(calls[2].init?.method, "GET");

  await client.acceptWorkOrder(workOrderId, { acceptedByAgentId: "agt_worker" });
  assert.equal(calls[3].url, `https://api.nooterra.local/work-orders/${workOrderId}/accept`);
  assert.equal(calls[3].init?.method, "POST");

  await client.progressWorkOrder(workOrderId, { eventType: "progress", message: "working" });
  assert.equal(calls[4].url, `https://api.nooterra.local/work-orders/${workOrderId}/progress`);
  assert.equal(calls[4].init?.method, "POST");

  await client.topUpWorkOrder(workOrderId, { topUpId: "topup_1", amountCents: 100 });
  assert.equal(calls[5].url, `https://api.nooterra.local/work-orders/${workOrderId}/topup`);
  assert.equal(calls[5].init?.method, "POST");

  await client.getWorkOrderMetering(workOrderId, { includeMeters: true, limit: 5, offset: 0 });
  assert.equal(calls[6].url, `https://api.nooterra.local/work-orders/${workOrderId}/metering?includeMeters=true&limit=5&offset=0`);
  assert.equal(calls[6].init?.method, "GET");

  await client.completeWorkOrder(workOrderId, { receiptId, status: "success" });
  assert.equal(calls[7].url, `https://api.nooterra.local/work-orders/${workOrderId}/complete`);
  assert.equal(calls[7].init?.method, "POST");

  await client.settleWorkOrder(workOrderId, { completionReceiptId: receiptId, x402GateId: "x402gate_1", x402RunId: "run_1" });
  assert.equal(calls[8].url, `https://api.nooterra.local/work-orders/${workOrderId}/settle`);
  assert.equal(calls[8].init?.method, "POST");

  await client.listWorkOrderReceipts({ workOrderId, principalAgentId: "agt_principal", status: "success", limit: 10, offset: 0 });
  assert.equal(
    calls[9].url,
    "https://api.nooterra.local/work-orders/receipts?workOrderId=workord_sdk_1&principalAgentId=agt_principal&status=success&limit=10&offset=0"
  );
  assert.equal(calls[9].init?.method, "GET");

  await client.getWorkOrderReceipt(receiptId);
  assert.equal(calls[10].url, `https://api.nooterra.local/work-orders/receipts/${receiptId}`);
  assert.equal(calls[10].init?.method, "GET");
});

test("api-sdk: capability attestation methods call expected endpoints", async () => {
  const calls = [];
  const attestationId = "catt_sdk_1";
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/capability-attestations") && String(init?.method) === "POST") {
      return makeJsonResponse({ capabilityAttestation: { attestationId } }, { status: 201 });
    }
    if (String(url).includes("/capability-attestations?") && String(init?.method) === "GET") {
      return makeJsonResponse({ attestations: [{ capabilityAttestation: { attestationId }, runtime: { status: "active" } }], total: 1, limit: 25, offset: 0 });
    }
    if (String(url).endsWith(`/capability-attestations/${attestationId}`) && String(init?.method) === "GET") {
      return makeJsonResponse({ capabilityAttestation: { attestationId }, runtime: { status: "active" } });
    }
    if (String(url).endsWith(`/capability-attestations/${attestationId}/revoke`) && String(init?.method) === "POST") {
      return makeJsonResponse({ capabilityAttestation: { attestationId, revocation: { revokedAt: "2026-02-01T00:00:00.000Z" } }, runtime: { status: "revoked" } });
    }
    return makeJsonResponse({}, { status: 404 });
  };

  const client = new NooterraClient({
    baseUrl: "https://api.nooterra.local",
    tenantId: "tenant_sdk",
    fetch: fetchStub
  });

  await client.createCapabilityAttestation({
    attestationId,
    subjectAgentId: "agt_worker",
    capability: "capability://code.generation.frontend.react"
  });
  assert.equal(calls[0].url, "https://api.nooterra.local/capability-attestations");
  assert.equal(calls[0].init?.method, "POST");

  await client.listCapabilityAttestations({
    subjectAgentId: "agt_worker",
    status: "active",
    includeInvalid: false,
    limit: 25,
    offset: 0
  });
  assert.equal(
    calls[1].url,
    "https://api.nooterra.local/capability-attestations?subjectAgentId=agt_worker&status=active&includeInvalid=false&limit=25&offset=0"
  );
  assert.equal(calls[1].init?.method, "GET");

  await client.getCapabilityAttestation(attestationId);
  assert.equal(calls[2].url, `https://api.nooterra.local/capability-attestations/${attestationId}`);
  assert.equal(calls[2].init?.method, "GET");

  await client.revokeCapabilityAttestation(attestationId, { reasonCode: "MANUAL_REVOKE" });
  assert.equal(calls[3].url, `https://api.nooterra.local/capability-attestations/${attestationId}/revoke`);
  assert.equal(calls[3].init?.method, "POST");
});

test("api-sdk: parity adapters align HTTP + MCP payload/error/retry/idempotency semantics", async () => {
  const httpCalls = [];
  const mcpCalls = [];
  const attemptByIdempotency = new Map();
  const payload = {
    grantId: "dgrant_parity_1",
    delegatorAgentId: "agt_principal",
    delegateeAgentId: "agt_worker"
  };

  const fetchStub = async (url, init) => {
    const headers = init?.headers ?? {};
    const idempotencyKey = headers["x-idempotency-key"] ?? null;
    const attempt = (attemptByIdempotency.get(`http:${idempotencyKey}`) ?? 0) + 1;
    attemptByIdempotency.set(`http:${idempotencyKey}`, attempt);
    httpCalls.push({ url: String(url), method: String(init?.method ?? ""), idempotencyKey, attempt });
    if (attempt === 1) {
      return makeJsonResponse(
        { code: "TEMP_UNAVAILABLE", error: "temporary outage", details: { attempt } },
        { status: 503, requestId: `req_http_attempt_${attempt}` }
      );
    }
    return makeJsonResponse(
      { delegationGrant: { grantId: payload.grantId, status: "active" } },
      { status: 201, requestId: `req_http_attempt_${attempt}` }
    );
  };

  const client = new NooterraClient({
    baseUrl: "https://api.nooterra.local",
    tenantId: "tenant_sdk_parity",
    fetch: fetchStub
  });
  const httpAdapter = client.createHttpParityAdapter({
    maxAttempts: 2,
    retryStatusCodes: [503],
    retryDelayMs: 0
  });
  const mcpAdapter = client.createMcpParityAdapter({
    maxAttempts: 2,
    retryStatusCodes: [503],
    retryDelayMs: 0,
    callTool: async (toolName, requestPayload) => {
      const idempotencyKey = requestPayload?.idempotencyKey ?? null;
      const attempt = (attemptByIdempotency.get(`mcp:${idempotencyKey}`) ?? 0) + 1;
      attemptByIdempotency.set(`mcp:${idempotencyKey}`, attempt);
      mcpCalls.push({ toolName, idempotencyKey, attempt });
      if (attempt === 1) {
        return {
          ok: false,
          status: 503,
          requestId: `req_mcp_attempt_${attempt}`,
          error: { code: "TEMP_UNAVAILABLE", message: "temporary outage", details: { attempt } }
        };
      }
      return {
        ok: true,
        status: 201,
        requestId: `req_mcp_attempt_${attempt}`,
        body: { delegationGrant: { grantId: payload.grantId, status: "active" } },
        headers: { "x-request-id": `req_mcp_attempt_${attempt}` }
      };
    }
  });

  const operationId = "delegation_grant_issue";
  const httpOperation = {
    operationId,
    method: "POST",
    path: "/delegation-grants",
    requiredFields: ["grantId", "delegatorAgentId", "delegateeAgentId"],
    idempotencyRequired: true
  };
  const mcpOperation = {
    operationId,
    toolName: "nooterra.delegation_grant_issue",
    requiredFields: ["grantId", "delegatorAgentId", "delegateeAgentId"],
    idempotencyRequired: true
  };

  const httpResult = await httpAdapter.invoke(httpOperation, payload, {
    requestId: "req_parity_1",
    idempotencyKey: "idem_parity_1"
  });
  const mcpResult = await mcpAdapter.invoke(mcpOperation, payload, {
    requestId: "req_parity_1",
    idempotencyKey: "idem_parity_1"
  });

  assert.equal(httpResult.transport, "http");
  assert.equal(mcpResult.transport, "mcp");
  assert.equal(httpResult.status, 201);
  assert.equal(mcpResult.status, 201);
  assert.deepEqual(httpResult.body, mcpResult.body);
  assert.equal(httpResult.attempts, 2);
  assert.equal(mcpResult.attempts, 2);
  assert.equal(httpResult.idempotencyKey, "idem_parity_1");
  assert.equal(mcpResult.idempotencyKey, "idem_parity_1");

  assert.equal(httpCalls.length, 2);
  assert.equal(mcpCalls.length, 2);
  assert.equal(httpCalls[0].idempotencyKey, "idem_parity_1");
  assert.equal(httpCalls[1].idempotencyKey, "idem_parity_1");
  assert.equal(mcpCalls[0].idempotencyKey, "idem_parity_1");
  assert.equal(mcpCalls[1].idempotencyKey, "idem_parity_1");
});

test("api-sdk: parity adapters fail closed on missing safety-critical fields", async () => {
  const client = new NooterraClient({
    baseUrl: "https://api.nooterra.local",
    tenantId: "tenant_sdk_parity",
    fetch: async () => makeJsonResponse({ ok: true })
  });
  const httpAdapter = client.createHttpParityAdapter();
  const mcpAdapter = client.createMcpParityAdapter({
    callTool: async () => ({ ok: true, status: 200, body: { ok: true } })
  });
  const httpOperation = {
    operationId: "run_event_append_http",
    method: "POST",
    path: "/runs/run_1/dispute/evidence",
    requiredFields: ["evidenceRef"],
    idempotencyRequired: true,
    expectedPrevChainHashRequired: true
  };
  const mcpOperation = {
    operationId: "run_event_append_mcp",
    toolName: "nooterra.run_dispute_evidence_submit",
    requiredFields: ["evidenceRef"],
    idempotencyRequired: true,
    expectedPrevChainHashRequired: true
  };

  await assert.rejects(
    httpAdapter.invoke(httpOperation, {}, { requestId: "req_fail_closed_1", idempotencyKey: "idem_fail_1", expectedPrevChainHash: "a".repeat(64) }),
    (err) => {
      assert.equal(err?.nooterra?.code, "PARITY_REQUIRED_FIELD_MISSING");
      return true;
    }
  );
  await assert.rejects(
    mcpAdapter.invoke(mcpOperation, {}, { requestId: "req_fail_closed_2", idempotencyKey: "idem_fail_2", expectedPrevChainHash: "a".repeat(64) }),
    (err) => {
      assert.equal(err?.nooterra?.code, "PARITY_REQUIRED_FIELD_MISSING");
      return true;
    }
  );
  await assert.rejects(
    httpAdapter.invoke(
      httpOperation,
      { evidenceRef: "evidence://run_1/output.json" },
      { requestId: "req_fail_closed_3", expectedPrevChainHash: "a".repeat(64) }
    ),
    (err) => {
      assert.equal(err?.nooterra?.code, "PARITY_IDEMPOTENCY_KEY_REQUIRED");
      return true;
    }
  );
  await assert.rejects(
    mcpAdapter.invoke(
      mcpOperation,
      { evidenceRef: "evidence://run_1/output.json" },
      { requestId: "req_fail_closed_4", expectedPrevChainHash: "a".repeat(64) }
    ),
    (err) => {
      assert.equal(err?.nooterra?.code, "PARITY_IDEMPOTENCY_KEY_REQUIRED");
      return true;
    }
  );
});
