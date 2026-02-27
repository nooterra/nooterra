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
      owner: { ownerType: "service", ownerId: "svc_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function issueCapabilityAttestation(api, { attestationId, subjectAgentId, capability, level = "attested", issuerAgentId }) {
  const response = await request(api, {
    method: "POST",
    path: "/capability-attestations",
    headers: { "x-idempotency-key": `capability_attest_issue_${attestationId}` },
    body: {
      attestationId,
      subjectAgentId,
      capability,
      level,
      issuerAgentId,
      validity: {
        issuedAt: "2026-02-23T00:00:00.000Z",
        notBefore: "2026-02-23T00:00:00.000Z",
        expiresAt: "2027-02-23T00:00:00.000Z"
      },
      signature: {
        keyId: `key_${issuerAgentId}`,
        signature: `sig_${attestationId}`
      },
      verificationMethod: {
        mode: level,
        source: "issuer_registry"
      },
      evidenceRefs: [`artifact://attestation/${attestationId}`]
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function setX402AgentLifecycle(
  api,
  { agentId, status, idempotencyKey, reasonCode = null, reasonMessage = null }
) {
  const response = await request(api, {
    method: "POST",
    path: `/x402/gate/agents/${encodeURIComponent(agentId)}/lifecycle`,
    headers: {
      "x-idempotency-key": idempotencyKey,
      "x-nooterra-protocol": "1.0"
    },
    body: {
      status,
      ...(reasonCode ? { reasonCode } : {}),
      ...(reasonMessage ? { reasonMessage } : {})
    }
  });
  return response;
}

test("API e2e: SubAgentWorkOrder.v1 lifecycle create->accept->progress->complete->settle", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const principalAgentId = "agt_workord_principal_1";
  const subAgentId = "agt_workord_worker_1";

  await registerAgent(api, {
    agentId: principalAgentId,
    capabilities: ["code.generation", "orchestration"]
  });
  await registerAgent(api, {
    agentId: subAgentId,
    capabilities: ["code.generation"]
  });

  const issuedGrant = await request(api, {
    method: "POST",
    path: "/delegation-grants",
    headers: { "x-idempotency-key": "dgrant_workord_issue_1" },
    body: {
      grantId: "dgrant_workord_1",
      delegatorAgentId: principalAgentId,
      delegateeAgentId: subAgentId,
      scope: {
        allowedProviderIds: [subAgentId],
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
        issuedAt: "2026-02-23T00:00:00.000Z",
        notBefore: "2026-02-23T00:00:00.000Z",
        expiresAt: "2027-02-23T00:00:00.000Z"
      }
    }
  });
  assert.equal(issuedGrant.statusCode, 201, issuedGrant.body);

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_1" },
    body: {
      workOrderId: "workord_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      specification: {
        taskType: "codegen",
        language: "javascript",
        prompt: "Implement deterministic parser"
      },
      pricing: {
        amountCents: 450,
        currency: "USD",
        quoteId: "quote_workord_1"
      },
      constraints: {
        maxDurationSeconds: 300,
        maxCostCents: 450,
        retryLimit: 1
      },
      delegationGrantRef: "dgrant_workord_1",
      metadata: {
        priority: "normal"
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.workOrder?.schemaVersion, "SubAgentWorkOrder.v1");
  assert.equal(created.json?.workOrder?.status, "created");

  const listed = await request(api, {
    method: "GET",
    path: `/work-orders?principalAgentId=${encodeURIComponent(principalAgentId)}&subAgentId=${encodeURIComponent(subAgentId)}&status=created`
  });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json?.workOrders?.length, 1);

  const fetched = await request(api, {
    method: "GET",
    path: "/work-orders/workord_1"
  });
  assert.equal(fetched.statusCode, 200, fetched.body);
  assert.equal(fetched.json?.workOrder?.workOrderId, "workord_1");

  const accepted = await request(api, {
    method: "POST",
    path: "/work-orders/workord_1/accept",
    headers: { "x-idempotency-key": "work_order_accept_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-23T00:10:00.000Z"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json?.workOrder?.status, "accepted");

  const progressed = await request(api, {
    method: "POST",
    path: "/work-orders/workord_1/progress",
    headers: { "x-idempotency-key": "work_order_progress_1" },
    body: {
      progressId: "prog_1",
      eventType: "progress",
      message: "Core implementation done",
      percentComplete: 60,
      evidenceRefs: ["artifact://diff/1"],
      at: "2026-02-23T00:20:00.000Z"
    }
  });
  assert.equal(progressed.statusCode, 200, progressed.body);
  assert.equal(progressed.json?.workOrder?.status, "working");
  assert.equal(progressed.json?.workOrder?.progressEvents?.length, 1);

  const completed = await request(api, {
    method: "POST",
    path: "/work-orders/workord_1/complete",
    headers: { "x-idempotency-key": "work_order_complete_1" },
    body: {
      receiptId: "worec_1",
      status: "success",
      outputs: {
        artifactRef: "artifact://code/1"
      },
      metrics: {
        tokensIn: 1200,
        tokensOut: 800
      },
      evidenceRefs: ["artifact://code/1", "report://verification/1"],
      amountCents: 450,
      currency: "USD",
      deliveredAt: "2026-02-23T00:30:00.000Z",
      completedAt: "2026-02-23T00:31:00.000Z"
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json?.workOrder?.status, "completed");
  assert.equal(completed.json?.workOrder?.completionReceiptId, "worec_1");
  assert.equal(completed.json?.completionReceipt?.schemaVersion, "SubAgentCompletionReceipt.v1");
  assert.equal(typeof completed.json?.completionReceipt?.receiptHash, "string");
  assert.equal(completed.json.completionReceipt.receiptHash.length, 64);

  const receiptGet = await request(api, {
    method: "GET",
    path: "/work-orders/receipts/worec_1"
  });
  assert.equal(receiptGet.statusCode, 200, receiptGet.body);
  assert.equal(receiptGet.json?.completionReceipt?.receiptId, "worec_1");

  const receiptList = await request(api, {
    method: "GET",
    path: "/work-orders/receipts?workOrderId=workord_1&status=success"
  });
  assert.equal(receiptList.statusCode, 200, receiptList.body);
  assert.equal(receiptList.json?.receipts?.length, 1);

  const settled = await request(api, {
    method: "POST",
    path: "/work-orders/workord_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_1" },
    body: {
      completionReceiptId: "worec_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_workord_1",
      x402RunId: "run_workord_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_workord_1",
      settledAt: "2026-02-23T00:40:00.000Z"
    }
  });
  assert.equal(settled.statusCode, 200, settled.body);
  assert.equal(settled.json?.workOrder?.status, "settled");
  assert.equal(settled.json?.workOrder?.settlement?.status, "released");

  const cardUpsert = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_workord_worker_1" },
    body: {
      agentId: subAgentId,
      displayName: "WorkOrder Worker",
      capabilities: ["code.generation"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/workord/worker", protocols: ["mcp"] }
    }
  });
  assert.equal(cardUpsert.statusCode, 201, cardUpsert.body);

  const discovered = await request(api, {
    method: "GET",
    path:
      "/agent-cards/discover?capability=code.generation&visibility=public&runtime=openclaw&status=active" +
      "&includeReputation=false&includeRoutingFactors=true&scoreStrategy=trust_weighted" +
      `&requesterAgentId=${encodeURIComponent(principalAgentId)}&limit=10&offset=0`
  });
  assert.equal(discovered.statusCode, 200, discovered.body);
  assert.equal(discovered.json?.results?.[0]?.agentCard?.agentId, subAgentId);
  assert.equal(discovered.json?.results?.[0]?.routingFactors?.strategy, "trust_weighted");
  assert.equal(discovered.json?.results?.[0]?.routingFactors?.signals?.relationshipHistory?.counterpartyAgentId, principalAgentId);
  assert.equal(discovered.json?.results?.[0]?.routingFactors?.signals?.relationshipHistory?.workedWithCount, 1);
  assert.equal(discovered.json?.results?.[0]?.routingFactors?.signals?.relationshipHistory?.successRate, 1);
  assert.equal(discovered.json?.results?.[0]?.routingFactors?.signals?.relationshipHistory?.disputeRate, 0);

  const blockedAfterSettle = await request(api, {
    method: "POST",
    path: "/work-orders/workord_1/progress",
    headers: { "x-idempotency-key": "work_order_progress_after_settle_1" },
    body: {
      progressId: "prog_after_settle_1",
      eventType: "progress",
      percentComplete: 90,
      at: "2026-02-23T00:45:00.000Z"
    }
  });
  assert.equal(blockedAfterSettle.statusCode, 409, blockedAfterSettle.body);
  assert.equal(blockedAfterSettle.json?.code, "WORK_ORDER_PROGRESS_BLOCKED");
});

test("API e2e: work-order routes fail closed when principal or sub-agent lifecycle is non-active", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const principalAgentId = "agt_workord_lifecycle_principal_1";
  const subAgentId = "agt_workord_lifecycle_worker_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });

  const principalSuspended = await setX402AgentLifecycle(api, {
    agentId: principalAgentId,
    status: "suspended",
    idempotencyKey: "workord_lifecycle_principal_suspend_1",
    reasonCode: "X402_AGENT_SUSPENDED_POLICY",
    reasonMessage: "work order lifecycle create guard"
  });
  assert.equal(principalSuspended.statusCode, 200, principalSuspended.body);

  const createBlockedPrincipal = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "workord_lifecycle_create_blocked_principal_1" },
    body: {
      workOrderId: "workord_lifecycle_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 300, currency: "USD" }
    }
  });
  assert.equal(createBlockedPrincipal.statusCode, 410, createBlockedPrincipal.body);
  assert.equal(createBlockedPrincipal.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(createBlockedPrincipal.json?.details?.role, "principal");
  assert.equal(createBlockedPrincipal.json?.details?.operation, "work_order.create");

  const principalReactivated = await setX402AgentLifecycle(api, {
    agentId: principalAgentId,
    status: "active",
    idempotencyKey: "workord_lifecycle_principal_active_1",
    reasonCode: "X402_AGENT_REACTIVATED_MANUAL",
    reasonMessage: "work order lifecycle create unblock"
  });
  assert.equal(principalReactivated.statusCode, 200, principalReactivated.body);

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "workord_lifecycle_create_ok_1" },
    body: {
      workOrderId: "workord_lifecycle_2",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 320, currency: "USD" }
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const subSuspended = await setX402AgentLifecycle(api, {
    agentId: subAgentId,
    status: "suspended",
    idempotencyKey: "workord_lifecycle_sub_suspend_1",
    reasonCode: "X402_AGENT_SUSPENDED_POLICY",
    reasonMessage: "work order lifecycle accept guard"
  });
  assert.equal(subSuspended.statusCode, 200, subSuspended.body);

  const acceptBlockedSub = await request(api, {
    method: "POST",
    path: "/work-orders/workord_lifecycle_2/accept",
    headers: { "x-idempotency-key": "workord_lifecycle_accept_blocked_sub_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-24T02:00:00.000Z"
    }
  });
  assert.equal(acceptBlockedSub.statusCode, 410, acceptBlockedSub.body);
  assert.equal(acceptBlockedSub.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(acceptBlockedSub.json?.details?.role, "sub_agent");
  assert.equal(acceptBlockedSub.json?.details?.operation, "work_order.accept");

  const subReactivated = await setX402AgentLifecycle(api, {
    agentId: subAgentId,
    status: "active",
    idempotencyKey: "workord_lifecycle_sub_active_1",
    reasonCode: "X402_AGENT_REACTIVATED_MANUAL",
    reasonMessage: "work order lifecycle accept unblock"
  });
  assert.equal(subReactivated.statusCode, 200, subReactivated.body);

  const accepted = await request(api, {
    method: "POST",
    path: "/work-orders/workord_lifecycle_2/accept",
    headers: { "x-idempotency-key": "workord_lifecycle_accept_ok_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-24T02:05:00.000Z"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);

  const completed = await request(api, {
    method: "POST",
    path: "/work-orders/workord_lifecycle_2/complete",
    headers: { "x-idempotency-key": "workord_lifecycle_complete_ok_1" },
    body: {
      receiptId: "worec_lifecycle_2",
      status: "success",
      outputs: {
        artifactRef: "artifact://code/lifecycle/2"
      },
      evidenceRefs: ["artifact://code/lifecycle/2", "report://verification/lifecycle/2"],
      amountCents: 320,
      currency: "USD",
      deliveredAt: "2026-02-24T02:10:00.000Z",
      completedAt: "2026-02-24T02:11:00.000Z"
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);

  const principalThrottled = await setX402AgentLifecycle(api, {
    agentId: principalAgentId,
    status: "throttled",
    idempotencyKey: "workord_lifecycle_principal_throttle_1",
    reasonCode: "X402_AGENT_THROTTLED_MANUAL",
    reasonMessage: "work order lifecycle settle guard"
  });
  assert.equal(principalThrottled.statusCode, 200, principalThrottled.body);

  const settleBlockedPrincipal = await request(api, {
    method: "POST",
    path: "/work-orders/workord_lifecycle_2/settle",
    headers: { "x-idempotency-key": "workord_lifecycle_settle_blocked_principal_1" },
    body: {
      completionReceiptId: "worec_lifecycle_2",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_lifecycle_2",
      x402RunId: "run_lifecycle_2",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_lifecycle_2",
      settledAt: "2026-02-24T02:20:00.000Z"
    }
  });
  assert.equal(settleBlockedPrincipal.statusCode, 429, settleBlockedPrincipal.body);
  assert.equal(settleBlockedPrincipal.json?.code, "X402_AGENT_THROTTLED");
  assert.equal(settleBlockedPrincipal.json?.details?.role, "principal");
  assert.equal(settleBlockedPrincipal.json?.details?.operation, "work_order.settle");
});

test("API e2e: work-order metering snapshot returns Meter.v1 events with deterministic coverage", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const principalAgentId = "agt_workord_meter_principal_1";
  const subAgentId = "agt_workord_meter_worker_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_meter_create_1" },
    body: {
      workOrderId: "workord_meter_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: {
        amountCents: 300,
        currency: "USD"
      },
      constraints: {
        maxCostCents: 500
      },
      metering: {
        mode: "metered",
        requireFinalMeterEvidence: true,
        enforceFinalReconcile: true,
        maxTopUpCents: 300,
        unit: "usd_cents"
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const toppedUp = await request(api, {
    method: "POST",
    path: "/work-orders/workord_meter_1/topup",
    headers: {
      "x-idempotency-key": "work_order_meter_topup_1",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      topUpId: "topup_meter_1",
      amountCents: 120,
      quantity: 1,
      currency: "USD",
      eventKey: "work_order_topup:workord_meter_1:topup_meter_1",
      occurredAt: "2026-02-26T00:00:00.000Z"
    }
  });
  assert.equal(toppedUp.statusCode, 201, toppedUp.body);

  const metering = await request(api, {
    method: "GET",
    path: "/work-orders/workord_meter_1/metering?includeMeters=true&limit=10&offset=0"
  });
  assert.equal(metering.statusCode, 200, metering.body);
  assert.equal(metering.json?.ok, true);
  assert.equal(metering.json?.workOrderId, "workord_meter_1");
  assert.equal(metering.json?.metering?.schemaVersion, "WorkOrderMeteringSnapshot.v1");
  assert.equal(metering.json?.metering?.meterSchemaVersion, "Meter.v1");
  assert.equal(Array.isArray(metering.json?.metering?.meters), true);
  assert.equal(metering.json?.metering?.meters?.length, 1);
  assert.equal(metering.json?.metering?.meters?.[0]?.schemaVersion, "Meter.v1");
  assert.equal(metering.json?.metering?.meters?.[0]?.meterType, "topup");
  assert.equal(metering.json?.metering?.meters?.[0]?.workOrderId, "workord_meter_1");
  assert.match(String(metering.json?.metering?.meters?.[0]?.meterHash ?? ""), /^[0-9a-f]{64}$/);
  assert.equal(metering.json?.metering?.summary?.baseAmountCents, 300);
  assert.equal(metering.json?.metering?.summary?.topUpTotalCents, 120);
  assert.equal(metering.json?.metering?.summary?.coveredAmountCents, 420);
  assert.equal(metering.json?.metering?.summary?.remainingCents, 80);
  assert.equal(metering.json?.totalMeters, 1);
  assert.equal(metering.json?.count, 1);

  const meteringNoEvents = await request(api, {
    method: "GET",
    path: "/work-orders/workord_meter_1/metering?includeMeters=false"
  });
  assert.equal(meteringNoEvents.statusCode, 200, meteringNoEvents.body);
  assert.equal(meteringNoEvents.json?.metering?.meterCount, 0);
  assert.equal(meteringNoEvents.json?.count, 0);
  assert.equal(meteringNoEvents.json?.totalMeters, 1);

  const invalidQuery = await request(api, {
    method: "GET",
    path: "/work-orders/workord_meter_1/metering?includeMeters=maybe"
  });
  assert.equal(invalidQuery.statusCode, 400, invalidQuery.body);
  assert.equal(invalidQuery.json?.code, "SCHEMA_INVALID");
});

test("API e2e: work-order attestation requirement is enforced on create and accept", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const principalAgentId = "agt_workord_att_principal_1";
  const subAgentId = "agt_workord_att_worker_1";
  const issuerAgentId = "agt_workord_att_issuer_1";

  await registerAgent(api, {
    agentId: principalAgentId,
    capabilities: ["code.generation", "orchestration"]
  });
  await registerAgent(api, {
    agentId: subAgentId,
    capabilities: ["code.generation"]
  });
  await registerAgent(api, {
    agentId: issuerAgentId,
    capabilities: ["attestation.issue"]
  });

  const createBlocked = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_attestation_blocked_1" },
    body: {
      workOrderId: "workord_att_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: {
        amountCents: 450,
        currency: "USD"
      },
      attestationRequirement: {
        required: true,
        minLevel: "attested",
        issuerAgentId
      }
    }
  });
  assert.equal(createBlocked.statusCode, 409, createBlocked.body);
  assert.equal(createBlocked.json?.code, "WORK_ORDER_ATTESTATION_BLOCKED");
  assert.equal(createBlocked.json?.details?.reasonCode, "CAPABILITY_ATTESTATION_MISSING");

  await issueCapabilityAttestation(api, {
    attestationId: "catt_workord_att_1",
    subjectAgentId: subAgentId,
    capability: "code.generation",
    level: "attested",
    issuerAgentId
  });

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_attestation_ok_1" },
    body: {
      workOrderId: "workord_att_2",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: {
        amountCents: 450,
        currency: "USD"
      },
      attestationRequirement: {
        required: true,
        minLevel: "attested",
        issuerAgentId
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.workOrder?.attestationRequirement?.schemaVersion, "WorkOrderCapabilityAttestationRequirement.v1");
  assert.equal(created.json?.workOrder?.attestationRequirement?.required, true);
  assert.equal(created.json?.workOrder?.attestationRequirement?.minLevel, "attested");
  assert.equal(created.json?.workOrder?.attestationRequirement?.issuerAgentId, issuerAgentId);

  const createdForRecheck = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_attestation_ok_2" },
    body: {
      workOrderId: "workord_att_3",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: {
        amountCents: 550,
        currency: "USD"
      },
      attestationRequirement: {
        required: true,
        minLevel: "attested",
        issuerAgentId
      }
    }
  });
  assert.equal(createdForRecheck.statusCode, 201, createdForRecheck.body);

  const accepted = await request(api, {
    method: "POST",
    path: "/work-orders/workord_att_2/accept",
    headers: { "x-idempotency-key": "work_order_accept_attestation_ok_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-23T00:40:00.000Z"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json?.workOrder?.status, "accepted");

  const completed = await request(api, {
    method: "POST",
    path: "/work-orders/workord_att_2/complete",
    headers: { "x-idempotency-key": "work_order_complete_attestation_ok_1" },
    body: {
      receiptId: "worec_att_2",
      status: "success",
      outputs: {
        artifactRef: "artifact://code/attested/2"
      },
      evidenceRefs: ["artifact://code/attested/2", "report://verification/attested/2"],
      amountCents: 450,
      currency: "USD",
      deliveredAt: "2026-02-23T00:50:00.000Z",
      completedAt: "2026-02-23T00:51:00.000Z"
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json?.workOrder?.status, "completed");
  assert.equal(completed.json?.completionReceipt?.receiptId, "worec_att_2");

  const settled = await request(api, {
    method: "POST",
    path: "/work-orders/workord_att_2/settle",
    headers: { "x-idempotency-key": "work_order_settle_attestation_ok_1" },
    body: {
      completionReceiptId: "worec_att_2",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_att_2",
      x402RunId: "run_att_2",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_att_2",
      settledAt: "2026-02-23T00:55:00.000Z"
    }
  });
  assert.equal(settled.statusCode, 200, settled.body);
  assert.equal(settled.json?.workOrder?.status, "settled");
  assert.equal(settled.json?.workOrder?.settlement?.status, "released");

  const revoked = await request(api, {
    method: "POST",
    path: "/capability-attestations/catt_workord_att_1/revoke",
    headers: { "x-idempotency-key": "capability_attest_revoke_workord_att_1" },
    body: {
      revokedAt: "2026-02-23T01:00:00.000Z",
      reasonCode: "RETEST"
    }
  });
  assert.equal(revoked.statusCode, 200, revoked.body);

  const acceptBlocked = await request(api, {
    method: "POST",
    path: "/work-orders/workord_att_3/accept",
    headers: { "x-idempotency-key": "work_order_accept_attestation_blocked_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-23T01:10:00.000Z"
    }
  });
  assert.equal(acceptBlocked.statusCode, 409, acceptBlocked.body);
  assert.equal(acceptBlocked.json?.code, "WORK_ORDER_ATTESTATION_BLOCKED");
  assert.equal(acceptBlocked.json?.details?.reasonCode, "CAPABILITY_ATTESTATION_REVOKED");
});

test("API e2e: work-order settlement evidence binding blocks missing/mismatched evidence and allows valid release", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_workord_evidence_principal_1";
  const subAgentId = "agt_workord_evidence_worker_1";

  await registerAgent(api, { agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_evidence_1" },
    body: {
      workOrderId: "workord_evidence_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 900, currency: "USD" }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.workOrder?.evidencePolicy?.schemaVersion, "WorkOrderSettlementEvidencePolicy.v1");
  assert.equal(created.json?.workOrder?.evidencePolicy?.release?.requiredKinds?.includes("verification_report"), true);

  const accepted = await request(api, {
    method: "POST",
    path: "/work-orders/workord_evidence_1/accept",
    headers: { "x-idempotency-key": "work_order_accept_evidence_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-23T02:10:00.000Z"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);

  const completedMissingEvidence = await request(api, {
    method: "POST",
    path: "/work-orders/workord_evidence_1/complete",
    headers: { "x-idempotency-key": "work_order_complete_evidence_missing_1" },
    body: {
      receiptId: "worec_evidence_missing_1",
      status: "success",
      outputs: { artifactRef: "artifact://code/evidence/missing" },
      evidenceRefs: ["artifact://code/evidence/missing"],
      amountCents: 900,
      currency: "USD",
      deliveredAt: "2026-02-23T02:20:00.000Z",
      completedAt: "2026-02-23T02:21:00.000Z"
    }
  });
  assert.equal(completedMissingEvidence.statusCode, 200, completedMissingEvidence.body);

  const settleMissingEvidenceBlocked = await request(api, {
    method: "POST",
    path: "/work-orders/workord_evidence_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_evidence_missing_blocked_1" },
    body: {
      completionReceiptId: "worec_evidence_missing_1",
      completionReceiptHash: completedMissingEvidence.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_evidence_missing_1",
      x402RunId: "run_evidence_missing_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_evidence_missing_1",
      settledAt: "2026-02-23T02:30:00.000Z"
    }
  });
  assert.equal(settleMissingEvidenceBlocked.statusCode, 409, settleMissingEvidenceBlocked.body);
  assert.equal(settleMissingEvidenceBlocked.json?.code, "WORK_ORDER_EVIDENCE_BINDING_BLOCKED");
  assert.equal(settleMissingEvidenceBlocked.json?.details?.reasonCode, "WORK_ORDER_EVIDENCE_MISSING");

  const created2 = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_evidence_2" },
    body: {
      workOrderId: "workord_evidence_2",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 910, currency: "USD" }
    }
  });
  assert.equal(created2.statusCode, 201, created2.body);

  const accepted2 = await request(api, {
    method: "POST",
    path: "/work-orders/workord_evidence_2/accept",
    headers: { "x-idempotency-key": "work_order_accept_evidence_2" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-23T03:10:00.000Z"
    }
  });
  assert.equal(accepted2.statusCode, 200, accepted2.body);

  const completedValidEvidence = await request(api, {
    method: "POST",
    path: "/work-orders/workord_evidence_2/complete",
    headers: { "x-idempotency-key": "work_order_complete_evidence_valid_2" },
    body: {
      receiptId: "worec_evidence_valid_2",
      status: "success",
      outputs: { artifactRef: "artifact://code/evidence/valid" },
      evidenceRefs: ["artifact://code/evidence/valid", "report://verification/evidence/valid"],
      amountCents: 910,
      currency: "USD",
      deliveredAt: "2026-02-23T03:20:00.000Z",
      completedAt: "2026-02-23T03:21:00.000Z"
    }
  });
  assert.equal(completedValidEvidence.statusCode, 200, completedValidEvidence.body);

  const settleMismatchBlocked = await request(api, {
    method: "POST",
    path: "/work-orders/workord_evidence_2/settle",
    headers: { "x-idempotency-key": "work_order_settle_evidence_mismatch_blocked_2" },
    body: {
      completionReceiptId: "worec_evidence_valid_2",
      completionReceiptHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "released",
      x402GateId: "x402gate_evidence_mismatch_2",
      x402RunId: "run_evidence_mismatch_2",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_evidence_mismatch_2",
      settledAt: "2026-02-23T03:30:00.000Z"
    }
  });
  assert.equal(settleMismatchBlocked.statusCode, 409, settleMismatchBlocked.body);
  assert.equal(settleMismatchBlocked.json?.code, "WORK_ORDER_EVIDENCE_BINDING_BLOCKED");
  assert.equal(settleMismatchBlocked.json?.details?.reasonCode, "WORK_ORDER_RECEIPT_HASH_MISMATCH");

  const settleValid = await request(api, {
    method: "POST",
    path: "/work-orders/workord_evidence_2/settle",
    headers: { "x-idempotency-key": "work_order_settle_evidence_valid_2" },
    body: {
      completionReceiptId: "worec_evidence_valid_2",
      completionReceiptHash: completedValidEvidence.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_evidence_valid_2",
      x402RunId: "run_evidence_valid_2",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_evidence_valid_2",
      settledAt: "2026-02-23T03:31:00.000Z"
    }
  });
  assert.equal(settleValid.statusCode, 200, settleValid.body);
  assert.equal(settleValid.json?.workOrder?.status, "settled");
  assert.equal(settleValid.json?.workOrder?.settlement?.status, "released");
});
