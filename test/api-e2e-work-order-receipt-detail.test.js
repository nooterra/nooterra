import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `agent_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_receipt_detail_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function issueDelegationGrant(api, { grantId, delegatorAgentId, delegateeAgentId }) {
  const response = await request(api, {
    method: "POST",
    path: "/delegation-grants",
    headers: { "x-idempotency-key": `delegation_grant_${grantId}` },
    body: {
      grantId,
      delegatorAgentId,
      delegateeAgentId,
      scope: {
        allowedProviderIds: [delegateeAgentId],
        allowedToolIds: ["code_generation"],
        allowedRiskClasses: ["financial"],
        sideEffectingAllowed: true
      },
      spendLimit: {
        currency: "USD",
        maxPerCallCents: 10_000,
        maxTotalCents: 50_000
      },
      chainBinding: {
        depth: 0,
        maxDelegationDepth: 1
      },
      validity: {
        issuedAt: "2026-03-06T00:00:00.000Z",
        notBefore: "2026-03-06T00:00:00.000Z",
        expiresAt: "2027-03-06T00:00:00.000Z"
      }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function createCompletedWorkOrder(api, { workOrderId, receiptId, principalAgentId, subAgentId, grantId }) {
  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": `work_order_create_${workOrderId}` },
    body: {
      workOrderId,
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      specification: {
        taskType: "codegen",
        language: "javascript",
        prompt: "Implement receipt detail handling"
      },
      pricing: {
        amountCents: 450,
        currency: "USD",
        quoteId: `quote_${workOrderId}`
      },
      constraints: {
        maxDurationSeconds: 300,
        maxCostCents: 450,
        retryLimit: 1
      },
      delegationGrantRef: grantId,
      traceId: `trace_${workOrderId}`,
      metadata: {
        priority: "normal"
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const accepted = await request(api, {
    method: "POST",
    path: `/work-orders/${encodeURIComponent(workOrderId)}/accept`,
    headers: { "x-idempotency-key": `work_order_accept_${workOrderId}` },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-03-06T00:10:00.000Z"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);

  const completed = await request(api, {
    method: "POST",
    path: `/work-orders/${encodeURIComponent(workOrderId)}/complete`,
    headers: { "x-idempotency-key": `work_order_complete_${workOrderId}` },
    body: {
      receiptId,
      status: "success",
      outputs: {
        artifactRef: `artifact://code/${workOrderId}`
      },
      metrics: {
        tokensIn: 1000,
        tokensOut: 650
      },
      evidenceRefs: [`artifact://code/${workOrderId}`, `report://verification/${workOrderId}`],
      amountCents: 450,
      currency: "USD",
      deliveredAt: "2026-03-06T00:30:00.000Z",
      completedAt: "2026-03-06T00:31:00.000Z"
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);
  return completed.json?.completionReceipt;
}

async function settleWorkOrder(api, { workOrderId, completionReceiptId, completionReceiptHash }) {
  const settled = await request(api, {
    method: "POST",
    path: `/work-orders/${encodeURIComponent(workOrderId)}/settle`,
    headers: { "x-idempotency-key": `work_order_settle_${workOrderId}` },
    body: {
      completionReceiptId,
      completionReceiptHash,
      status: "released",
      x402GateId: `x402gate_${workOrderId}`,
      x402RunId: `run_${workOrderId}`,
      x402SettlementStatus: "released",
      x402ReceiptId: `x402rcpt_${workOrderId}`,
      settledAt: "2026-03-06T00:40:00.000Z"
    }
  });
  assert.equal(settled.statusCode, 200, settled.body);
}

function deleteStoredWorkOrder(api, workOrderId) {
  const store = api?.store;
  if (!(store?.subAgentWorkOrders instanceof Map)) throw new TypeError("subAgentWorkOrders map is required for this test");
  for (const [key, value] of store.subAgentWorkOrders.entries()) {
    if (String(value?.workOrderId ?? "") !== String(workOrderId)) continue;
    store.subAgentWorkOrders.delete(key);
    return;
  }
  throw new Error(`work order ${workOrderId} not found in store`);
}

test("API e2e: work-order receipt detail returns linked work-order and settlement context", async () => {
  const api = createApi({ now: () => "2026-03-06T00:00:00.000Z", opsToken: "tok_ops" });
  const principalAgentId = "agt_receipt_detail_principal";
  const subAgentId = "agt_receipt_detail_worker";
  const grantId = "dgrant_receipt_detail_1";
  const workOrderId = "workord_receipt_detail_1";
  const receiptId = "worec_receipt_detail_1";

  await registerAgent(api, { agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });
  await issueDelegationGrant(api, { grantId, delegatorAgentId: principalAgentId, delegateeAgentId: subAgentId });
  const completionReceipt = await createCompletedWorkOrder(api, {
    workOrderId,
    receiptId,
    principalAgentId,
    subAgentId,
    grantId
  });
  await settleWorkOrder(api, {
    workOrderId,
    completionReceiptId: receiptId,
    completionReceiptHash: completionReceipt?.receiptHash
  });

  const response = await request(api, {
    method: "GET",
    path: `/work-orders/receipts/${encodeURIComponent(receiptId)}`
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json?.completionReceipt?.receiptId, receiptId);
  assert.equal(response.json?.detail?.schemaVersion, "WorkOrderReceiptDetail.v1");
  assert.equal(response.json?.detail?.integrityStatus, "verified");
  assert.deepEqual(response.json?.detail?.issues, []);
  assert.equal(response.json?.detail?.workOrder?.workOrderId, workOrderId);
  assert.equal(response.json?.detail?.workOrder?.status, "settled");
  assert.equal(response.json?.detail?.settlement?.x402RunId, `run_${workOrderId}`);
  assert.equal(response.json?.detail?.settlement?.status, "released");
  assert.equal(response.json?.detail?.traceId, `trace_${workOrderId}`);
  assert.equal(response.json?.detail?.evidenceRefs?.length, 2);
});

test("API e2e: work-order receipt detail surfaces integrity issues when the linked work order is missing", async () => {
  const api = createApi({ now: () => "2026-03-06T00:00:00.000Z", opsToken: "tok_ops" });
  const principalAgentId = "agt_receipt_issue_principal";
  const subAgentId = "agt_receipt_issue_worker";
  const grantId = "dgrant_receipt_issue_1";
  const workOrderId = "workord_receipt_issue_1";
  const receiptId = "worec_receipt_issue_1";

  await registerAgent(api, { agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });
  await issueDelegationGrant(api, { grantId, delegatorAgentId: principalAgentId, delegateeAgentId: subAgentId });
  await createCompletedWorkOrder(api, {
    workOrderId,
    receiptId,
    principalAgentId,
    subAgentId,
    grantId
  });
  deleteStoredWorkOrder(api, workOrderId);

  const response = await request(api, {
    method: "GET",
    path: `/work-orders/receipts/${encodeURIComponent(receiptId)}`
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json?.completionReceipt?.receiptId, receiptId);
  assert.equal(response.json?.detail?.integrityStatus, "attention_required");
  assert.equal(response.json?.detail?.workOrder, null);
  assert.equal(response.json?.detail?.settlement, null);
  assert.ok(
    Array.isArray(response.json?.detail?.issues) &&
      response.json.detail.issues.some((issue) => issue?.code === "WORK_ORDER_MISSING")
  );
});
