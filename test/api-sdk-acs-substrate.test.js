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
