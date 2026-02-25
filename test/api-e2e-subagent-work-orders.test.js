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

async function issueAuthorityGrant(
  api,
  {
    grantId,
    granteeAgentId,
    maxPerCallCents = 5_000,
    maxTotalCents = 50_000,
    allowedProviderIds = [],
    allowedToolIds = [],
    validity = null
  }
) {
  const normalizedValidity =
    validity && typeof validity === "object" && !Array.isArray(validity)
      ? {
          issuedAt: validity.issuedAt ?? "2026-02-23T00:00:00.000Z",
          notBefore: validity.notBefore ?? "2026-02-23T00:00:00.000Z",
          expiresAt: validity.expiresAt ?? "2027-02-23T00:00:00.000Z"
        }
      : {
          issuedAt: "2026-02-23T00:00:00.000Z",
          notBefore: "2026-02-23T00:00:00.000Z",
          expiresAt: "2027-02-23T00:00:00.000Z"
        };
  const response = await request(api, {
    method: "POST",
    path: "/authority-grants",
    headers: { "x-idempotency-key": `authority_grant_issue_${grantId}` },
    body: {
      grantId,
      principalRef: {
        principalType: "org",
        principalId: "org_subagent_workorders_test"
      },
      granteeAgentId,
      scope: {
        allowedProviderIds,
        allowedToolIds,
        allowedRiskClasses: ["financial"],
        sideEffectingAllowed: true
      },
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents,
        maxTotalCents
      },
      chainBinding: {
        depth: 0,
        maxDelegationDepth: 1
      },
      validity: normalizedValidity
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function creditWallet(api, { agentId, amountCents, idempotencyKey }) {
  const response = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-idempotency-key": idempotencyKey },
    body: { amountCents, currency: "USD" }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function createX402Gate(api, { gateId, payerAgentId, payeeAgentId, amountCents, toolId = "code_generation" }) {
  const response = await request(api, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": `x402_gate_create_${gateId}` },
    body: {
      gateId,
      payerAgentId,
      payeeAgentId,
      amountCents,
      currency: "USD",
      toolId
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json?.gate ?? null;
}

async function authorizeX402Gate(api, { gateId, idempotencyKey, extraBody = null }) {
  return await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": idempotencyKey },
    body: {
      gateId,
      ...(extraBody && typeof extraBody === "object" ? extraBody : {})
    }
  });
}

async function createTaintedSession(api, { sessionId, participantAgentId }) {
  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": `session_create_${sessionId}` },
    body: {
      sessionId,
      visibility: "tenant",
      participants: [participantAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const tainted = await request(api, {
    method: "POST",
    path: `/sessions/${encodeURIComponent(sessionId)}/events`,
    headers: {
      "x-idempotency-key": `session_taint_event_${sessionId}`,
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "MESSAGE",
      payload: { text: "untrusted prompt payload" },
      provenance: { label: "external" }
    }
  });
  assert.equal(tainted.statusCode, 201, tainted.body);
  assert.equal(tainted.json?.event?.payload?.provenance?.isTainted, true);
  const eventId = typeof tainted.json?.event?.id === "string" ? tainted.json.event.id : null;
  const chainHash = typeof tainted.json?.event?.chainHash === "string" ? tainted.json.event.chainHash : null;
  const evidenceRefs = [];
  if (eventId) evidenceRefs.push(`session:event:${eventId}`);
  if (chainHash) evidenceRefs.push(`session:chain:${chainHash}`);
  return { sessionRef: sessionId, evidenceRefs };
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
  await issueAuthorityGrant(api, {
    grantId: "agrant_workord_1",
    granteeAgentId: principalAgentId,
    maxPerCallCents: 2_000,
    maxTotalCents: 20_000
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
      authorityGrantRef: "agrant_workord_1",
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
  assert.equal(settled.json?.workOrder?.settlement?.authorityGrantRef, "agrant_workord_1");

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

test("API e2e: work-order settle enforces authority grant binding and revocation fail-closed", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const principalAgentId = "agt_workord_auth_principal_1";
  const subAgentId = "agt_workord_auth_worker_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });

  await issueAuthorityGrant(api, {
    grantId: "agrant_workord_settle_1",
    granteeAgentId: principalAgentId,
    maxPerCallCents: 2_000,
    maxTotalCents: 10_000
  });
  await issueAuthorityGrant(api, {
    grantId: "agrant_workord_settle_2",
    granteeAgentId: principalAgentId,
    maxPerCallCents: 2_000,
    maxTotalCents: 10_000
  });

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_authority_settle_1" },
    body: {
      workOrderId: "workord_auth_settle_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 700, currency: "USD" },
      authorityGrantRef: "agrant_workord_settle_1"
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.workOrder?.authorityGrantRef, "agrant_workord_settle_1");

  const accepted = await request(api, {
    method: "POST",
    path: "/work-orders/workord_auth_settle_1/accept",
    headers: { "x-idempotency-key": "work_order_accept_authority_settle_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-23T04:10:00.000Z"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);

  const completed = await request(api, {
    method: "POST",
    path: "/work-orders/workord_auth_settle_1/complete",
    headers: { "x-idempotency-key": "work_order_complete_authority_settle_1" },
    body: {
      receiptId: "worec_auth_settle_1",
      status: "success",
      outputs: { artifactRef: "artifact://code/authority/settle/1" },
      evidenceRefs: ["artifact://code/authority/settle/1", "report://verification/authority/settle/1"],
      amountCents: 700,
      currency: "USD",
      deliveredAt: "2026-02-23T04:20:00.000Z",
      completedAt: "2026-02-23T04:21:00.000Z"
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json?.workOrder?.status, "completed");

  const settleMismatchBlocked = await request(api, {
    method: "POST",
    path: "/work-orders/workord_auth_settle_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_authority_mismatch_blocked_1" },
    body: {
      completionReceiptId: "worec_auth_settle_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      authorityGrantRef: "agrant_workord_settle_2",
      status: "released",
      x402GateId: "x402gate_auth_settle_1",
      x402RunId: "run_auth_settle_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_auth_settle_1",
      settledAt: "2026-02-23T04:30:00.000Z"
    }
  });
  assert.equal(settleMismatchBlocked.statusCode, 409, settleMismatchBlocked.body);
  assert.equal(settleMismatchBlocked.json?.code, "WORK_ORDER_SETTLEMENT_CONFLICT");
  assert.match(String(settleMismatchBlocked.json?.details?.message ?? ""), /authorityGrantRef does not match work order binding/i);

  const revoked = await request(api, {
    method: "POST",
    path: "/authority-grants/agrant_workord_settle_1/revoke",
    headers: { "x-idempotency-key": "authority_grant_revoke_workord_settle_1" },
    body: {
      revocationReasonCode: "MANUAL_REVOKE"
    }
  });
  assert.equal(revoked.statusCode, 200, revoked.body);

  const settleRevokedBlocked = await request(api, {
    method: "POST",
    path: "/work-orders/workord_auth_settle_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_authority_revoked_blocked_1" },
    body: {
      completionReceiptId: "worec_auth_settle_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_auth_settle_1",
      x402RunId: "run_auth_settle_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_auth_settle_1",
      settledAt: "2026-02-23T04:31:00.000Z"
    }
  });
  assert.equal(settleRevokedBlocked.statusCode, 409, settleRevokedBlocked.body);
  assert.equal(settleRevokedBlocked.json?.code, "X402_AUTHORITY_GRANT_REVOKED");

  const settleRevokedReplay = await request(api, {
    method: "POST",
    path: "/work-orders/workord_auth_settle_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_authority_revoked_blocked_1" },
    body: {
      completionReceiptId: "worec_auth_settle_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_auth_settle_1",
      x402RunId: "run_auth_settle_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_auth_settle_1",
      settledAt: "2026-02-23T04:31:00.000Z"
    }
  });
  assert.equal(settleRevokedReplay.statusCode, 409, settleRevokedReplay.body);
  assert.equal(settleRevokedReplay.json?.code, "X402_AUTHORITY_GRANT_REVOKED");
  assert.equal(
    settleRevokedReplay.json?.details?.authorityGrantRef,
    settleRevokedBlocked.json?.details?.authorityGrantRef
  );
});

test("API e2e: work-order settle fails closed when authority grant expires between completion and settle", async () => {
  let nowAt = "2026-02-23T04:00:00.000Z";
  const api = createApi({
    opsToken: "tok_ops",
    now: () => nowAt
  });

  const principalAgentId = "agt_workord_auth_expiry_principal_1";
  const subAgentId = "agt_workord_auth_expiry_worker_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });

  await issueAuthorityGrant(api, {
    grantId: "agrant_workord_settle_expiry_1",
    granteeAgentId: principalAgentId,
    maxPerCallCents: 2_000,
    maxTotalCents: 10_000,
    validity: {
      issuedAt: "2026-02-23T00:00:00.000Z",
      notBefore: "2026-02-23T00:00:00.000Z",
      expiresAt: "2026-02-23T04:30:00.000Z"
    }
  });

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_authority_expiry_1" },
    body: {
      workOrderId: "workord_auth_expiry_settle_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 700, currency: "USD" },
      authorityGrantRef: "agrant_workord_settle_expiry_1"
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const accepted = await request(api, {
    method: "POST",
    path: "/work-orders/workord_auth_expiry_settle_1/accept",
    headers: { "x-idempotency-key": "work_order_accept_authority_expiry_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-23T04:10:00.000Z"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);

  const completed = await request(api, {
    method: "POST",
    path: "/work-orders/workord_auth_expiry_settle_1/complete",
    headers: { "x-idempotency-key": "work_order_complete_authority_expiry_1" },
    body: {
      receiptId: "worec_auth_expiry_settle_1",
      status: "success",
      outputs: { artifactRef: "artifact://code/authority/expiry/1" },
      evidenceRefs: ["artifact://code/authority/expiry/1", "report://verification/authority/expiry/1"],
      amountCents: 700,
      currency: "USD",
      deliveredAt: "2026-02-23T04:20:00.000Z",
      completedAt: "2026-02-23T04:21:00.000Z"
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);

  nowAt = "2026-02-23T04:31:00.000Z";

  const settleExpiredBlocked = await request(api, {
    method: "POST",
    path: "/work-orders/workord_auth_expiry_settle_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_authority_expiry_blocked_1" },
    body: {
      completionReceiptId: "worec_auth_expiry_settle_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_auth_expiry_settle_1",
      x402RunId: "run_auth_expiry_settle_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_auth_expiry_settle_1",
      settledAt: "2026-02-23T04:31:00.000Z"
    }
  });
  assert.equal(settleExpiredBlocked.statusCode, 409, settleExpiredBlocked.body);
  assert.equal(settleExpiredBlocked.json?.code, "X402_AUTHORITY_GRANT_EXPIRED");
});

test("API e2e: work-order settle fails closed when completion quote exceeds constraints.maxCostCents", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const principalAgentId = "agt_workord_maxcost_principal_1";
  const subAgentId = "agt_workord_maxcost_worker_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_maxcost_1" },
    body: {
      workOrderId: "workord_maxcost_settle_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 300, currency: "USD" },
      constraints: { maxCostCents: 300 }
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const accepted = await request(api, {
    method: "POST",
    path: "/work-orders/workord_maxcost_settle_1/accept",
    headers: { "x-idempotency-key": "work_order_accept_maxcost_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-23T08:10:00.000Z"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);

  const completed = await request(api, {
    method: "POST",
    path: "/work-orders/workord_maxcost_settle_1/complete",
    headers: { "x-idempotency-key": "work_order_complete_maxcost_1" },
    body: {
      receiptId: "worec_maxcost_settle_1",
      status: "success",
      outputs: { artifactRef: "artifact://code/maxcost/1" },
      evidenceRefs: ["artifact://code/maxcost/1", "report://verification/maxcost/1", "sha256:maxcostevidence1"],
      amountCents: 450,
      currency: "USD",
      deliveredAt: "2026-02-23T08:20:00.000Z",
      completedAt: "2026-02-23T08:21:00.000Z"
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json?.completionReceipt?.settlementQuote?.amountCents, 450);

  const settleBlocked = await request(api, {
    method: "POST",
    path: "/work-orders/workord_maxcost_settle_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_maxcost_blocked_1" },
    body: {
      completionReceiptId: "worec_maxcost_settle_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_workord_maxcost_settle_1",
      x402RunId: "run_workord_maxcost_settle_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_workord_maxcost_settle_1",
      settledAt: "2026-02-23T08:30:00.000Z"
    }
  });
  assert.equal(settleBlocked.statusCode, 409, settleBlocked.body);
  assert.equal(settleBlocked.json?.code, "WORK_ORDER_SETTLEMENT_BLOCKED");
  assert.equal(settleBlocked.json?.details?.reasonCode, "WORK_ORDER_SETTLEMENT_MAX_COST_EXCEEDED");
  assert.equal(settleBlocked.json?.details?.settlementAmountCents, 450);
  assert.equal(settleBlocked.json?.details?.maxCostCents, 300);
});

test("API e2e: metered work-order settle fails closed without meter evidence and succeeds after top-up coverage", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const principalAgentId = "agt_workord_metered_principal_1";
  const subAgentId = "agt_workord_metered_worker_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_metered_1" },
    body: {
      workOrderId: "workord_metered_settle_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 200, currency: "USD" },
      constraints: { maxCostCents: 600 },
      metering: {
        mode: "metered",
        requireFinalMeterEvidence: true,
        enforceFinalReconcile: false
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.workOrder?.metadata?.metering?.mode, "metered");

  const accepted = await request(api, {
    method: "POST",
    path: "/work-orders/workord_metered_settle_1/accept",
    headers: { "x-idempotency-key": "work_order_accept_metered_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-25T10:10:00.000Z"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);

  const completed = await request(api, {
    method: "POST",
    path: "/work-orders/workord_metered_settle_1/complete",
    headers: { "x-idempotency-key": "work_order_complete_metered_1" },
    body: {
      receiptId: "worec_metered_settle_1",
      status: "success",
      outputs: { artifactRef: "artifact://code/metered/1" },
      evidenceRefs: ["artifact://code/metered/1", "report://verification/metered/1", "sha256:meteredevidence1"],
      amountCents: 350,
      currency: "USD",
      deliveredAt: "2026-02-25T10:20:00.000Z",
      completedAt: "2026-02-25T10:21:00.000Z"
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json?.completionReceipt?.settlementQuote?.amountCents, 350);

  const settleMissingMeterEvidence = await request(api, {
    method: "POST",
    path: "/work-orders/workord_metered_settle_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_metered_missing_evidence_1" },
    body: {
      completionReceiptId: "worec_metered_settle_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_workord_metered_settle_1",
      x402RunId: "run_workord_metered_settle_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_workord_metered_settle_1",
      settledAt: "2026-02-25T10:30:00.000Z"
    }
  });
  assert.equal(settleMissingMeterEvidence.statusCode, 409, settleMissingMeterEvidence.body);
  assert.equal(settleMissingMeterEvidence.json?.code, "WORK_ORDER_SETTLEMENT_BLOCKED");
  assert.equal(settleMissingMeterEvidence.json?.details?.reasonCode, "WORK_ORDER_SETTLEMENT_METER_EVIDENCE_REQUIRED");

  const topup = await request(api, {
    method: "POST",
    path: "/work-orders/workord_metered_settle_1/topup",
    headers: { "x-idempotency-key": "work_order_topup_metered_1" },
    body: {
      topUpId: "topup_metered_1",
      amountCents: 150,
      currency: "USD",
      occurredAt: "2026-02-25T10:25:00.000Z"
    }
  });
  assert.equal(topup.statusCode, 201, topup.body);
  assert.equal(topup.json?.appended, true);
  assert.equal(topup.json?.metering?.topUpTotalCents, 150);
  assert.equal(topup.json?.metering?.coveredAmountCents, 350);

  const topupReplay = await request(api, {
    method: "POST",
    path: "/work-orders/workord_metered_settle_1/topup",
    headers: { "x-idempotency-key": "work_order_topup_metered_1" },
    body: {
      topUpId: "topup_metered_1",
      amountCents: 150,
      currency: "USD",
      occurredAt: "2026-02-25T10:25:00.000Z"
    }
  });
  assert.equal(topupReplay.statusCode, 201, topupReplay.body);
  assert.equal(topupReplay.json?.event?.eventKey, topup.json?.event?.eventKey);

  const settle = await request(api, {
    method: "POST",
    path: "/work-orders/workord_metered_settle_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_metered_ok_1" },
    body: {
      completionReceiptId: "worec_metered_settle_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      meteringEventKeys: [topup.json?.event?.eventKey],
      x402GateId: "x402gate_workord_metered_settle_1",
      x402RunId: "run_workord_metered_settle_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_workord_metered_settle_1",
      settledAt: "2026-02-25T10:31:00.000Z"
    }
  });
  assert.equal(settle.statusCode, 200, settle.body);
  assert.equal(settle.json?.workOrder?.status, "settled");
  assert.equal(settle.json?.workOrder?.metadata?.metering?.lastSettlementReconcile?.topUpTotalCents, 150);
  assert.equal(settle.json?.workOrder?.metadata?.metering?.lastSettlementReconcile?.settlementAmountCents, 350);
  assert.match(String(settle.json?.workOrder?.metadata?.metering?.lastSettlementReconcile?.meterEvidenceHash ?? ""), /^[0-9a-f]{64}$/);
});

test("API e2e: work-order metering top-up fails closed when projected coverage exceeds max envelope", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const principalAgentId = "agt_workord_topup_cap_principal_1";
  const subAgentId = "agt_workord_topup_cap_worker_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_topup_cap_1" },
    body: {
      workOrderId: "workord_topup_cap_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 200, currency: "USD" },
      constraints: { maxCostCents: 250 },
      metering: {
        mode: "metered",
        requireFinalMeterEvidence: true,
        enforceFinalReconcile: true
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const topupBlocked = await request(api, {
    method: "POST",
    path: "/work-orders/workord_topup_cap_1/topup",
    headers: { "x-idempotency-key": "work_order_topup_cap_blocked_1" },
    body: {
      topUpId: "topup_cap_1",
      amountCents: 100,
      currency: "USD",
      occurredAt: "2026-02-25T11:00:00.000Z"
    }
  });
  assert.equal(topupBlocked.statusCode, 409, topupBlocked.body);
  assert.equal(topupBlocked.json?.code, "WORK_ORDER_TOPUP_BLOCKED");
  assert.equal(topupBlocked.json?.details?.reasonCode, "WORK_ORDER_TOPUP_ENVELOPE_EXCEEDED");
  assert.equal(topupBlocked.json?.details?.maxCostCents, 250);
});

test("API e2e: work-order settle enforces deterministic split contract fail-closed and binds split hash", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const principalAgentId = "agt_workord_split_principal_1";
  const subAgentId = "agt_workord_split_worker_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_split_1" },
    body: {
      workOrderId: "workord_split_settle_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 500, currency: "USD" },
      settlementSplitPolicy: {
        mode: "deterministic",
        requireAtSettle: true,
        requiredRoles: ["provider_payout", "router_fee", "delegator_share"]
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.workOrder?.metadata?.settlementSplitPolicy?.mode, "deterministic");

  const accepted = await request(api, {
    method: "POST",
    path: "/work-orders/workord_split_settle_1/accept",
    headers: { "x-idempotency-key": "work_order_accept_split_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-25T11:10:00.000Z"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);

  const completed = await request(api, {
    method: "POST",
    path: "/work-orders/workord_split_settle_1/complete",
    headers: { "x-idempotency-key": "work_order_complete_split_1" },
    body: {
      receiptId: "worec_split_settle_1",
      status: "success",
      outputs: { artifactRef: "artifact://code/split/1" },
      evidenceRefs: ["artifact://code/split/1", "report://verification/split/1"],
      amountCents: 500,
      currency: "USD",
      deliveredAt: "2026-02-25T11:20:00.000Z",
      completedAt: "2026-02-25T11:21:00.000Z"
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);

  const settleMissingSplit = await request(api, {
    method: "POST",
    path: "/work-orders/workord_split_settle_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_split_missing_1" },
    body: {
      completionReceiptId: "worec_split_settle_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_workord_split_settle_1",
      x402RunId: "run_workord_split_settle_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_workord_split_settle_1",
      settledAt: "2026-02-25T11:30:00.000Z"
    }
  });
  assert.equal(settleMissingSplit.statusCode, 409, settleMissingSplit.body);
  assert.equal(settleMissingSplit.json?.code, "WORK_ORDER_SETTLEMENT_BLOCKED");
  assert.equal(settleMissingSplit.json?.details?.reasonCode, "WORK_ORDER_SETTLEMENT_SPLIT_REQUIRED");

  const settleInvalidSplit = await request(api, {
    method: "POST",
    path: "/work-orders/workord_split_settle_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_split_invalid_1" },
    body: {
      completionReceiptId: "worec_split_settle_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      settlementSplit: {
        schemaVersion: "WorkOrderSettlementSplit.v1",
        settlementAmountCents: 500,
        currency: "USD",
        allocations: [
          { role: "provider_payout", amountCents: 350, recipientRef: subAgentId },
          { role: "router_fee", amountCents: 100, recipientRef: "settld_router" },
          { role: "delegator_share", amountCents: 25, recipientRef: principalAgentId }
        ]
      },
      x402GateId: "x402gate_workord_split_settle_1",
      x402RunId: "run_workord_split_settle_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_workord_split_settle_1",
      settledAt: "2026-02-25T11:31:00.000Z"
    }
  });
  assert.equal(settleInvalidSplit.statusCode, 409, settleInvalidSplit.body);
  assert.equal(settleInvalidSplit.json?.code, "WORK_ORDER_SETTLEMENT_BLOCKED");
  assert.equal(settleInvalidSplit.json?.details?.reasonCode, "WORK_ORDER_SETTLEMENT_SPLIT_INVALID");

  const settle = await request(api, {
    method: "POST",
    path: "/work-orders/workord_split_settle_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_split_ok_1" },
    body: {
      completionReceiptId: "worec_split_settle_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      settlementSplit: {
        schemaVersion: "WorkOrderSettlementSplit.v1",
        settlementAmountCents: 500,
        currency: "USD",
        allocations: [
          { role: "provider_payout", amountCents: 400, recipientRef: subAgentId },
          { role: "router_fee", amountCents: 75, recipientRef: "settld_router" },
          { role: "delegator_share", amountCents: 25, recipientRef: principalAgentId }
        ]
      },
      x402GateId: "x402gate_workord_split_settle_1",
      x402RunId: "run_workord_split_settle_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_workord_split_settle_1",
      settledAt: "2026-02-25T11:32:00.000Z"
    }
  });
  assert.equal(settle.statusCode, 200, settle.body);
  assert.equal(settle.json?.workOrder?.status, "settled");
  assert.equal(settle.json?.workOrder?.metadata?.settlementSplit?.lastSettlementBinding?.schemaVersion, "WorkOrderSettlementSplitBinding.v1");
  assert.equal(settle.json?.workOrder?.metadata?.settlementSplit?.lastSettlementBinding?.settlementAmountCents, 500);
  assert.equal(settle.json?.workOrder?.metadata?.settlementSplit?.lastSettlementBinding?.currency, "USD");
  assert.match(
    String(settle.json?.workOrder?.metadata?.settlementSplit?.lastSettlementBinding?.splitContractHash ?? ""),
    /^[0-9a-f]{64}$/
  );
});

test("API e2e: work-order create enforces authority grant spend and revocation fail-closed", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const principalAgentId = "agt_workord_auth_create_principal_1";
  const subAgentId = "agt_workord_auth_create_worker_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });

  await issueAuthorityGrant(api, {
    grantId: "agrant_workord_create_percall_1",
    granteeAgentId: principalAgentId,
    maxPerCallCents: 500,
    maxTotalCents: 10_000
  });
  await issueAuthorityGrant(api, {
    grantId: "agrant_workord_create_revoked_1",
    granteeAgentId: principalAgentId,
    maxPerCallCents: 5_000,
    maxTotalCents: 10_000
  });

  const revokeGrant = await request(api, {
    method: "POST",
    path: "/authority-grants/agrant_workord_create_revoked_1/revoke",
    headers: { "x-idempotency-key": "authority_grant_revoke_workord_create_1" },
    body: {
      revocationReasonCode: "MANUAL_REVOKE"
    }
  });
  assert.equal(revokeGrant.statusCode, 200, revokeGrant.body);

  const perCallBlocked = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_authority_percall_blocked_1" },
    body: {
      workOrderId: "workord_auth_create_percall_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 700, currency: "USD" },
      authorityGrantRef: "agrant_workord_create_percall_1"
    }
  });
  assert.equal(perCallBlocked.statusCode, 409, perCallBlocked.body);
  assert.equal(perCallBlocked.json?.code, "X402_AUTHORITY_GRANT_PER_CALL_EXCEEDED");

  const revokedBlocked = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_authority_revoked_blocked_1" },
    body: {
      workOrderId: "workord_auth_create_revoked_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 700, currency: "USD" },
      authorityGrantRef: "agrant_workord_create_revoked_1"
    }
  });
  assert.equal(revokedBlocked.statusCode, 409, revokedBlocked.body);
  assert.equal(revokedBlocked.json?.code, "X402_AUTHORITY_GRANT_REVOKED");
});

test("API e2e: work-order create enforces authority grant tool/provider allowlists fail-closed", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const principalAgentId = "agt_workord_auth_scope_principal_1";
  const subAgentId = "agt_workord_auth_scope_worker_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });

  await issueAuthorityGrant(api, {
    grantId: "agrant_workord_scope_1",
    granteeAgentId: principalAgentId,
    maxPerCallCents: 2_000,
    maxTotalCents: 10_000,
    allowedProviderIds: ["provider_allowed_1"],
    allowedToolIds: ["tool_allowed_1"]
  });

  const toolDenied = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_authority_scope_tool_denied_1" },
    body: {
      workOrderId: "workord_auth_scope_tool_denied_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 700, currency: "USD" },
      authorityGrantRef: "agrant_workord_scope_1",
      x402ToolId: "tool_denied_1",
      x402ProviderId: "provider_allowed_1"
    }
  });
  assert.equal(toolDenied.statusCode, 409, toolDenied.body);
  assert.equal(toolDenied.json?.code, "X402_AUTHORITY_GRANT_TOOL_DENIED");

  const providerDenied = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_authority_scope_provider_denied_1" },
    body: {
      workOrderId: "workord_auth_scope_provider_denied_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 700, currency: "USD" },
      authorityGrantRef: "agrant_workord_scope_1",
      x402ToolId: "tool_allowed_1",
      x402ProviderId: "provider_denied_1"
    }
  });
  assert.equal(providerDenied.statusCode, 409, providerDenied.body);
  assert.equal(providerDenied.json?.code, "X402_AUTHORITY_GRANT_PROVIDER_DENIED");

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_authority_scope_ok_1" },
    body: {
      workOrderId: "workord_auth_scope_ok_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 700, currency: "USD" },
      authorityGrantRef: "agrant_workord_scope_1",
      x402ToolId: "tool_allowed_1",
      x402ProviderId: "provider_allowed_1"
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.workOrder?.x402ToolId, "tool_allowed_1");
  assert.equal(created.json?.workOrder?.x402ProviderId, "provider_allowed_1");
});

test("API e2e: work-order settle enforces x402 tool/provider bindings against linked gate", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const principalAgentId = "agt_workord_bind_principal_1";
  const subAgentId = "agt_workord_bind_worker_1";
  const alternateProviderAgentId = "agt_workord_bind_provider_alt_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });
  await registerAgent(api, { agentId: alternateProviderAgentId, capabilities: ["code.generation"] });
  await creditWallet(api, {
    agentId: principalAgentId,
    amountCents: 5_000,
    idempotencyKey: "wallet_credit_workord_bind_1"
  });

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_bind_1" },
    body: {
      workOrderId: "workord_bind_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 300, currency: "USD" },
      x402ToolId: "tool_bind_expected_1",
      x402ProviderId: subAgentId
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.workOrder?.x402ToolId, "tool_bind_expected_1");
  assert.equal(created.json?.workOrder?.x402ProviderId, subAgentId);

  const accepted = await request(api, {
    method: "POST",
    path: "/work-orders/workord_bind_1/accept",
    headers: { "x-idempotency-key": "work_order_accept_bind_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-23T06:10:00.000Z"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);

  const completed = await request(api, {
    method: "POST",
    path: "/work-orders/workord_bind_1/complete",
    headers: { "x-idempotency-key": "work_order_complete_bind_1" },
    body: {
      receiptId: "worec_bind_1",
      status: "success",
      outputs: { artifactRef: "artifact://code/bind/1" },
      evidenceRefs: ["artifact://code/bind/1", "report://verification/bind/1"],
      amountCents: 300,
      currency: "USD",
      deliveredAt: "2026-02-23T06:20:00.000Z",
      completedAt: "2026-02-23T06:21:00.000Z"
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);

  const gateToolMismatch = await createX402Gate(api, {
    gateId: "x402gate_workord_bind_tool_mismatch_1",
    payerAgentId: principalAgentId,
    payeeAgentId: subAgentId,
    amountCents: 300,
    toolId: "tool_bind_mismatch_1"
  });
  const settleToolMismatch = await request(api, {
    method: "POST",
    path: "/work-orders/workord_bind_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_bind_tool_mismatch_1" },
    body: {
      completionReceiptId: "worec_bind_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_workord_bind_tool_mismatch_1",
      x402RunId: gateToolMismatch?.runId ?? "run_workord_bind_tool_mismatch_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_workord_bind_tool_mismatch_1",
      settledAt: "2026-02-23T06:30:00.000Z"
    }
  });
  assert.equal(settleToolMismatch.statusCode, 409, settleToolMismatch.body);
  assert.equal(settleToolMismatch.json?.code, "WORK_ORDER_SETTLEMENT_CONFLICT");
  assert.match(String(settleToolMismatch.json?.details?.message ?? ""), /x402ToolId does not match/i);

  const gateProviderMismatch = await createX402Gate(api, {
    gateId: "x402gate_workord_bind_provider_mismatch_1",
    payerAgentId: principalAgentId,
    payeeAgentId: alternateProviderAgentId,
    amountCents: 300,
    toolId: "tool_bind_expected_1"
  });
  const settleProviderMismatch = await request(api, {
    method: "POST",
    path: "/work-orders/workord_bind_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_bind_provider_mismatch_1" },
    body: {
      completionReceiptId: "worec_bind_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_workord_bind_provider_mismatch_1",
      x402RunId: gateProviderMismatch?.runId ?? "run_workord_bind_provider_mismatch_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_workord_bind_provider_mismatch_1",
      settledAt: "2026-02-23T06:31:00.000Z"
    }
  });
  assert.equal(settleProviderMismatch.statusCode, 409, settleProviderMismatch.body);
  assert.equal(settleProviderMismatch.json?.code, "WORK_ORDER_SETTLEMENT_CONFLICT");
  assert.match(String(settleProviderMismatch.json?.details?.message ?? ""), /x402ProviderId does not match/i);

  const gateMatching = await createX402Gate(api, {
    gateId: "x402gate_workord_bind_match_1",
    payerAgentId: principalAgentId,
    payeeAgentId: subAgentId,
    amountCents: 300,
    toolId: "tool_bind_expected_1"
  });
  const settleMatching = await request(api, {
    method: "POST",
    path: "/work-orders/workord_bind_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_bind_match_1" },
    body: {
      completionReceiptId: "worec_bind_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_workord_bind_match_1",
      x402RunId: gateMatching?.runId ?? "run_workord_bind_match_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_workord_bind_match_1",
      settledAt: "2026-02-23T06:32:00.000Z"
    }
  });
  assert.equal(settleMatching.statusCode, 200, settleMatching.body);
  assert.equal(settleMatching.json?.workOrder?.status, "settled");
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

test("API e2e: work-order settle fails closed until tainted-session provenance evidence refs are included", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    x402SessionTaintEscalateAmountCents: 1_000
  });
  const principalAgentId = "agt_workord_taint_principal_1";
  const subAgentId = "agt_workord_taint_worker_1";
  await registerAgent(api, { agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
  await registerAgent(api, { agentId: subAgentId, capabilities: ["code.generation"] });
  await creditWallet(api, {
    agentId: principalAgentId,
    amountCents: 5_000,
    idempotencyKey: "wallet_credit_workord_taint_1"
  });
  const taintedSession = await createTaintedSession(api, {
    sessionId: "sess_workord_taint_1",
    participantAgentId: principalAgentId
  });
  const gate = await createX402Gate(api, {
    gateId: "x402gate_workord_taint_1",
    payerAgentId: principalAgentId,
    payeeAgentId: subAgentId,
    amountCents: 300
  });
  const authorized = await authorizeX402Gate(api, {
    gateId: "x402gate_workord_taint_1",
    idempotencyKey: "x402_gate_authorize_workord_taint_1",
    extraBody: {
      sessionRef: taintedSession.sessionRef,
      promptRiskOverride: {
        enabled: true,
        reason: "manual review for tainted workflow",
        ticketRef: "INC-WORKORD-TAINT-1"
      }
    }
  });
  assert.equal(authorized.statusCode, 200, authorized.body);

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_taint_1" },
    body: {
      workOrderId: "workord_taint_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      pricing: { amountCents: 300, currency: "USD" }
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const accepted = await request(api, {
    method: "POST",
    path: "/work-orders/workord_taint_1/accept",
    headers: { "x-idempotency-key": "work_order_accept_taint_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-23T05:10:00.000Z"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);

  const completed = await request(api, {
    method: "POST",
    path: "/work-orders/workord_taint_1/complete",
    headers: { "x-idempotency-key": "work_order_complete_taint_1" },
    body: {
      receiptId: "worec_taint_1",
      status: "success",
      outputs: { artifactRef: "artifact://code/taint/1" },
      evidenceRefs: ["artifact://code/taint/1", "report://verification/taint/1"],
      amountCents: 300,
      currency: "USD",
      deliveredAt: "2026-02-23T05:20:00.000Z",
      completedAt: "2026-02-23T05:21:00.000Z"
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);

  const settleMissingProvenance = await request(api, {
    method: "POST",
    path: "/work-orders/workord_taint_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_taint_missing_1" },
    body: {
      completionReceiptId: "worec_taint_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_workord_taint_1",
      x402RunId: gate?.runId ?? "run_workord_taint_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_workord_taint_1",
      promptRiskOverride: {
        enabled: true,
        reason: "manual review for tainted workflow",
        ticketRef: "INC-WORKORD-TAINT-2"
      },
      settledAt: "2026-02-23T05:30:00.000Z"
    }
  });
  assert.equal(settleMissingProvenance.statusCode, 409, settleMissingProvenance.body);
  assert.equal(settleMissingProvenance.json?.code, "WORK_ORDER_SETTLEMENT_BLOCKED");
  assert.equal(
    settleMissingProvenance.json?.details?.reasonCode,
    "WORK_ORDER_PROMPT_RISK_EVIDENCE_REQUIRED"
  );
  assert.deepEqual(
    [...(settleMissingProvenance.json?.details?.missingEvidenceRefs ?? [])].sort((a, b) => a.localeCompare(b)),
    [...taintedSession.evidenceRefs].sort((a, b) => a.localeCompare(b))
  );

  const settlePartialProvenance = await request(api, {
    method: "POST",
    path: "/work-orders/workord_taint_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_taint_partial_1" },
    body: {
      completionReceiptId: "worec_taint_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_workord_taint_1",
      x402RunId: gate?.runId ?? "run_workord_taint_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_workord_taint_1",
      promptRiskOverride: {
        enabled: true,
        reason: "manual review complete",
        ticketRef: "INC-WORKORD-TAINT-2B"
      },
      evidenceRefs: [taintedSession.evidenceRefs[0]],
      settledAt: "2026-02-23T05:30:30.000Z"
    }
  });
  assert.equal(settlePartialProvenance.statusCode, 409, settlePartialProvenance.body);
  assert.equal(settlePartialProvenance.json?.code, "WORK_ORDER_SETTLEMENT_BLOCKED");
  assert.equal(
    settlePartialProvenance.json?.details?.reasonCode,
    "WORK_ORDER_PROMPT_RISK_EVIDENCE_REQUIRED"
  );
  const expectedMissingPartialEvidence = taintedSession.evidenceRefs
    .filter((value) => value !== taintedSession.evidenceRefs[0])
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(
    [...(settlePartialProvenance.json?.details?.missingEvidenceRefs ?? [])].sort((a, b) => a.localeCompare(b)),
    expectedMissingPartialEvidence
  );

  const settleWithProvenance = await request(api, {
    method: "POST",
    path: "/work-orders/workord_taint_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_taint_with_evidence_1" },
    body: {
      completionReceiptId: "worec_taint_1",
      completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
      status: "released",
      x402GateId: "x402gate_workord_taint_1",
      x402RunId: gate?.runId ?? "run_workord_taint_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_workord_taint_1",
      promptRiskOverride: {
        enabled: true,
        reason: "manual review complete with provenance evidence",
        ticketRef: "INC-WORKORD-TAINT-3"
      },
      evidenceRefs: taintedSession.evidenceRefs,
      settledAt: "2026-02-23T05:31:00.000Z"
    }
  });
  assert.equal(settleWithProvenance.statusCode, 200, settleWithProvenance.body);
  assert.equal(settleWithProvenance.json?.workOrder?.status, "settled");
  assert.equal(settleWithProvenance.json?.workOrder?.settlement?.status, "released");
});
