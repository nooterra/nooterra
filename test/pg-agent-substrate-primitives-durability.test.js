import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createPgStore } from "../src/db/store-pg.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

function makeSchema() {
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function tenantRequest(api, { tenantId, method, path, headers = null, body = undefined, auth = "auto" }) {
  return request(api, {
    method,
    path,
    headers: {
      "x-proxy-tenant-id": tenantId,
      ...(headers ?? {})
    },
    body,
    auth
  });
}

async function registerAgent(api, { tenantId, agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `register_${tenantId}_${agentId}` },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId: `svc_${tenantId}` },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function creditWallet(api, { tenantId, agentId, amountCents, idempotencyKey }) {
  const response = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-idempotency-key": idempotencyKey },
    body: { amountCents, currency: "USD" }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function setX402AgentLifecycle(
  api,
  { tenantId, agentId, status, idempotencyKey, reasonCode = null, reasonMessage = null }
) {
  const response = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: `/x402/gate/agents/${encodeURIComponent(agentId)}/lifecycle`,
    headers: {
      "x-idempotency-key": idempotencyKey,
      "x-settld-protocol": "1.0"
    },
    body: {
      status,
      ...(reasonCode ? { reasonCode } : {}),
      ...(reasonMessage ? { reasonMessage } : {})
    }
  });
  return response;
}

async function createTerminalRun({
  api,
  tenantId,
  agentId,
  runId,
  payerAgentId,
  amountCents,
  terminalType = "RUN_COMPLETED"
}) {
  const created = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs`,
    headers: { "x-idempotency-key": `pg_sub_run_create_${runId}` },
    body: {
      runId,
      settlement: { payerAgentId, amountCents, currency: "USD" }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  let prev = created.json?.run?.lastChainHash;
  assert.ok(prev);

  const evidence = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": `pg_sub_run_evidence_${runId}`
    },
    body: {
      type: "EVIDENCE_ADDED",
      payload: { evidenceRef: `evidence://${runId}/output.json` }
    }
  });
  assert.equal(evidence.statusCode, 201, evidence.body);
  prev = evidence.json?.run?.lastChainHash;
  assert.ok(prev);

  const terminal = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": `pg_sub_run_terminal_${runId}`
    },
    body:
      terminalType === "RUN_COMPLETED"
        ? {
            type: "RUN_COMPLETED",
            payload: { outputRef: `evidence://${runId}/output.json`, metrics: { latencyMs: 500 } }
          }
        : {
            type: "RUN_FAILED",
            payload: { code: "TEST_FAILURE", message: "deterministic failure for reputation signal" }
          }
  });
  assert.equal(terminal.statusCode, 201, terminal.body);
}

(databaseUrl ? test : test.skip)("pg: agent substrate primitives persist across restart + public discovery spans tenants", async () => {
  const schema = makeSchema();
  const tenantA = "tenant_pg_substrate_a";
  const tenantB = "tenant_pg_substrate_b";
  const principalA = "agt_pg_sub_principal_a";
  const workerA = "agt_pg_sub_worker_a";
  const issuerA = "agt_pg_sub_issuer_a";
  const workerB = "agt_pg_sub_worker_b";
  const issuerB = "agt_pg_sub_issuer_b";
  const quoteId = "pg_sub_quote_1";
  const offerId = "pg_sub_offer_1";
  const acceptanceId = "pg_sub_acceptance_1";
  let replayPackHashBeforeRestart = null;
  let transcriptHashBeforeRestart = null;
  let interactionGraphPackHashBeforeRestart = null;

  let storeA = null;
  let storeB = null;
  try {
    storeA = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: false });
    const apiA = createApi({
      store: storeA,
      agentCardPublicAbuseSuppressionThreshold: 1
    });

    await registerAgent(apiA, { tenantId: tenantA, agentId: principalA, capabilities: ["orchestration"] });
    await registerAgent(apiA, { tenantId: tenantA, agentId: workerA, capabilities: ["travel.booking"] });
    await registerAgent(apiA, { tenantId: tenantA, agentId: issuerA, capabilities: ["attestation.issue"] });
    await registerAgent(apiA, { tenantId: tenantB, agentId: workerB, capabilities: ["travel.booking"] });
    await registerAgent(apiA, { tenantId: tenantB, agentId: issuerB, capabilities: ["attestation.issue"] });

    const suspendPrincipal = await setX402AgentLifecycle(apiA, {
      tenantId: tenantA,
      agentId: principalA,
      status: "suspended",
      reasonCode: "X402_AGENT_SUSPENDED_MANUAL",
      idempotencyKey: "pg_sub_lifecycle_suspend_principal_1"
    });
    assert.equal(suspendPrincipal.statusCode, 200, suspendPrincipal.body);
    assert.equal(suspendPrincipal.json?.lifecycle?.status, "suspended");

    const blockedDelegationGrantIssue = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/delegation-grants",
      headers: { "x-idempotency-key": "pg_sub_grant_issue_lifecycle_blocked_1" },
      body: {
        grantId: "pg_sub_grant_blocked_1",
        delegatorAgentId: principalA,
        delegateeAgentId: workerA,
        scope: {
          allowedProviderIds: [workerA],
          allowedToolIds: ["travel_booking"],
          allowedRiskClasses: ["financial"],
          sideEffectingAllowed: true
        },
        spendLimit: {
          currency: "USD",
          maxPerCallCents: 50_000,
          maxTotalCents: 200_000
        },
        chainBinding: {
          depth: 0,
          maxDelegationDepth: 1
        },
        validity: {
          issuedAt: "2026-02-25T00:00:00.000Z",
          notBefore: "2026-02-25T00:00:00.000Z",
          expiresAt: "2027-02-25T00:00:00.000Z"
        }
      }
    });
    assert.equal(blockedDelegationGrantIssue.statusCode, 410, blockedDelegationGrantIssue.body);
    assert.equal(blockedDelegationGrantIssue.json?.code, "X402_AGENT_SUSPENDED");
    assert.equal(blockedDelegationGrantIssue.json?.details?.operation, "delegation_grant.issue");

    const reactivatePrincipal = await setX402AgentLifecycle(apiA, {
      tenantId: tenantA,
      agentId: principalA,
      status: "active",
      reasonCode: "X402_AGENT_ACTIVE_MANUAL",
      idempotencyKey: "pg_sub_lifecycle_reactivate_principal_1"
    });
    assert.equal(reactivatePrincipal.statusCode, 200, reactivatePrincipal.body);
    assert.equal(reactivatePrincipal.json?.lifecycle?.status, "active");

    const upsertCardA = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/agent-cards",
      headers: { "x-idempotency-key": "pg_sub_card_a_1" },
      body: {
        agentId: workerA,
        displayName: "PG Worker A",
        capabilities: ["travel.booking"],
        visibility: "public",
        host: { runtime: "openclaw", endpoint: "https://example.test/worker-a", protocols: ["mcp"] },
        tools: [
          {
            schemaVersion: "ToolDescriptor.v1",
            toolId: "travel.book_flight",
            mcpToolName: "travel_book_flight",
            riskClass: "action",
            sideEffecting: true,
            pricing: { amountCents: 500, currency: "USD", unit: "booking" },
            requiresEvidenceKinds: ["artifact", "hash"]
          }
        ]
      }
    });
    assert.equal(upsertCardA.statusCode, 201, upsertCardA.body);

    const upsertCardB = await tenantRequest(apiA, {
      tenantId: tenantB,
      method: "POST",
      path: "/agent-cards",
      headers: { "x-idempotency-key": "pg_sub_card_b_1" },
      body: {
        agentId: workerB,
        displayName: "PG Worker B",
        capabilities: ["travel.booking"],
        visibility: "public",
        host: { runtime: "openclaw", endpoint: "https://example.test/worker-b", protocols: ["mcp"] },
        tools: [
          {
            schemaVersion: "ToolDescriptor.v1",
            toolId: "travel.search_flights",
            mcpToolName: "travel_search_flights",
            riskClass: "read",
            sideEffecting: false,
            pricing: { amountCents: 90, currency: "USD", unit: "call" },
            requiresEvidenceKinds: ["artifact"]
          }
        ]
      }
    });
    assert.equal(upsertCardB.statusCode, 201, upsertCardB.body);

    const issueGrant = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/delegation-grants",
      headers: { "x-idempotency-key": "pg_sub_grant_issue_1" },
      body: {
        grantId: "pg_sub_grant_1",
        delegatorAgentId: principalA,
        delegateeAgentId: workerA,
        scope: {
          allowedProviderIds: [workerA],
          allowedToolIds: ["travel_booking"],
          allowedRiskClasses: ["financial"],
          sideEffectingAllowed: true
        },
        spendLimit: {
          currency: "USD",
          maxPerCallCents: 50_000,
          maxTotalCents: 200_000
        },
        chainBinding: {
          depth: 0,
          maxDelegationDepth: 1
        },
        validity: {
          issuedAt: "2026-02-25T00:00:00.000Z",
          notBefore: "2026-02-25T00:00:00.000Z",
          expiresAt: "2027-02-25T00:00:00.000Z"
        }
      }
    });
    assert.equal(issueGrant.statusCode, 201, issueGrant.body);

    const issueAuthorityGrant = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/authority-grants",
      headers: { "x-idempotency-key": "pg_sub_authority_grant_issue_1" },
      body: {
        grantId: "pg_sub_authority_grant_1",
        principalRef: {
          principalType: "org",
          principalId: "org_pg_substrate_a"
        },
        granteeAgentId: principalA,
        scope: {
          sideEffectingAllowed: true
        },
        spendEnvelope: {
          currency: "USD",
          maxPerCallCents: 50_000,
          maxTotalCents: 200_000
        },
        chainBinding: {
          depth: 0,
          maxDelegationDepth: 1
        },
        validity: {
          issuedAt: "2026-02-25T00:00:00.000Z",
          notBefore: "2026-02-25T00:00:00.000Z",
          expiresAt: "2027-02-25T00:00:00.000Z"
        }
      }
    });
    assert.equal(issueAuthorityGrant.statusCode, 201, issueAuthorityGrant.body);

    const throttleWorker = await setX402AgentLifecycle(apiA, {
      tenantId: tenantA,
      agentId: workerA,
      status: "throttled",
      reasonCode: "X402_AGENT_THROTTLED_MANUAL",
      idempotencyKey: "pg_sub_lifecycle_throttle_worker_1"
    });
    assert.equal(throttleWorker.statusCode, 200, throttleWorker.body);
    assert.equal(throttleWorker.json?.lifecycle?.status, "throttled");

    const blockedAgreementDelegationIssue = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: `/agreements/${"c".repeat(64)}/delegations`,
      headers: { "x-idempotency-key": "pg_sub_agreement_delegation_lifecycle_blocked_1" },
      body: {
        delegationId: "pg_sub_agreement_delegation_blocked_1",
        childAgreementHash: "d".repeat(64),
        delegatorAgentId: principalA,
        delegateeAgentId: workerA,
        budgetCapCents: 1_000,
        currency: "USD",
        delegationDepth: 0,
        maxDelegationDepth: 1
      }
    });
    assert.equal(blockedAgreementDelegationIssue.statusCode, 429, blockedAgreementDelegationIssue.body);
    assert.equal(blockedAgreementDelegationIssue.json?.code, "X402_AGENT_THROTTLED");
    assert.equal(blockedAgreementDelegationIssue.json?.details?.operation, "agreement_delegation.issue");

    const blockedTaskQuoteIssue = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/task-quotes",
      headers: { "x-idempotency-key": "pg_sub_task_quote_lifecycle_blocked_1" },
      body: {
        quoteId: "pg_sub_quote_blocked_1",
        buyerAgentId: principalA,
        sellerAgentId: workerA,
        requiredCapability: "travel.booking",
        pricing: { amountCents: 1200, currency: "USD" },
        quoteAt: "2026-02-25T00:04:00.000Z"
      }
    });
    assert.equal(blockedTaskQuoteIssue.statusCode, 429, blockedTaskQuoteIssue.body);
    assert.equal(blockedTaskQuoteIssue.json?.code, "X402_AGENT_THROTTLED");
    assert.equal(blockedTaskQuoteIssue.json?.details?.operation, "task_quote.issue");

    const reactivateWorker = await setX402AgentLifecycle(apiA, {
      tenantId: tenantA,
      agentId: workerA,
      status: "active",
      reasonCode: "X402_AGENT_ACTIVE_MANUAL",
      idempotencyKey: "pg_sub_lifecycle_reactivate_worker_1"
    });
    assert.equal(reactivateWorker.statusCode, 200, reactivateWorker.body);
    assert.equal(reactivateWorker.json?.lifecycle?.status, "active");

    const issueAttestationA = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/capability-attestations",
      headers: { "x-idempotency-key": "pg_sub_attest_a_1" },
      body: {
        attestationId: "pg_sub_attest_a_1",
        subjectAgentId: workerA,
        capability: "travel.booking",
        level: "attested",
        issuerAgentId: issuerA,
        validity: {
          issuedAt: "2026-02-25T00:00:00.000Z",
          notBefore: "2026-02-25T00:00:00.000Z",
          expiresAt: "2027-02-25T00:00:00.000Z"
        },
        signature: { keyId: `key_${issuerA}`, signature: "sig_pg_sub_attest_a_1" }
      }
    });
    assert.equal(issueAttestationA.statusCode, 201, issueAttestationA.body);

    const issueAttestationB = await tenantRequest(apiA, {
      tenantId: tenantB,
      method: "POST",
      path: "/capability-attestations",
      headers: { "x-idempotency-key": "pg_sub_attest_b_1" },
      body: {
        attestationId: "pg_sub_attest_b_1",
        subjectAgentId: workerB,
        capability: "travel.booking",
        level: "attested",
        issuerAgentId: issuerB,
        validity: {
          issuedAt: "2026-02-25T00:00:00.000Z",
          notBefore: "2026-02-25T00:00:00.000Z",
          expiresAt: "2027-02-25T00:00:00.000Z"
        },
        signature: { keyId: `key_${issuerB}`, signature: "sig_pg_sub_attest_b_1" }
      }
    });
    assert.equal(issueAttestationB.statusCode, 201, issueAttestationB.body);

    const createQuote = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/task-quotes",
      headers: { "x-idempotency-key": "pg_sub_task_quote_issue_1" },
      body: {
        quoteId,
        buyerAgentId: principalA,
        sellerAgentId: workerA,
        requiredCapability: "travel.booking",
        pricing: { amountCents: 1200, currency: "USD" },
        quoteAt: "2026-02-25T00:05:00.000Z"
      }
    });
    assert.equal(createQuote.statusCode, 201, createQuote.body);

    const createOffer = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/task-offers",
      headers: { "x-idempotency-key": "pg_sub_task_offer_issue_1" },
      body: {
        offerId,
        buyerAgentId: principalA,
        sellerAgentId: workerA,
        quoteRef: {
          quoteId,
          quoteHash: createQuote.json?.taskQuote?.quoteHash
        },
        pricing: { amountCents: 1200, currency: "USD" },
        offeredAt: "2026-02-25T00:06:00.000Z"
      }
    });
    assert.equal(createOffer.statusCode, 201, createOffer.body);

    const createAcceptance = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/task-acceptances",
      headers: { "x-idempotency-key": "pg_sub_task_acceptance_issue_1" },
      body: {
        acceptanceId,
        quoteId,
        offerId,
        acceptedByAgentId: principalA,
        acceptedAt: "2026-02-25T00:07:00.000Z"
      }
    });
    assert.equal(createAcceptance.statusCode, 201, createAcceptance.body);

    const createWorkOrder = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/work-orders",
      headers: { "x-idempotency-key": "pg_sub_work_order_create_1" },
      body: {
        workOrderId: "pg_sub_work_order_1",
        principalAgentId: principalA,
        subAgentId: workerA,
        requiredCapability: "travel.booking",
        pricing: { amountCents: 1200, currency: "USD" },
        delegationGrantRef: "pg_sub_grant_1",
        authorityGrantRef: "pg_sub_authority_grant_1",
        acceptanceRef: {
          acceptanceId,
          acceptanceHash: createAcceptance.json?.taskAcceptance?.acceptanceHash
        }
      }
    });
    assert.equal(createWorkOrder.statusCode, 201, createWorkOrder.body);

    const acceptWorkOrder = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/work-orders/pg_sub_work_order_1/accept",
      headers: { "x-idempotency-key": "pg_sub_work_order_accept_1" },
      body: { acceptedByAgentId: workerA, acceptedAt: "2026-02-25T00:10:00.000Z" }
    });
    assert.equal(acceptWorkOrder.statusCode, 200, acceptWorkOrder.body);

    const completeWorkOrder = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/work-orders/pg_sub_work_order_1/complete",
      headers: { "x-idempotency-key": "pg_sub_work_order_complete_1" },
      body: {
        receiptId: "pg_sub_receipt_1",
        status: "success",
        outputs: { confirmationRef: "artifact://travel/booking/1" },
        evidenceRefs: ["artifact://travel/booking/1", "sha256:pg_sub_travel_booking_1", "verification://travel/booking/1"],
        amountCents: 1200,
        currency: "USD",
        deliveredAt: "2026-02-25T00:20:00.000Z",
        completedAt: "2026-02-25T00:21:00.000Z"
      }
    });
    assert.equal(completeWorkOrder.statusCode, 200, completeWorkOrder.body);

    const settleWorkOrder = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/work-orders/pg_sub_work_order_1/settle",
      headers: { "x-idempotency-key": "pg_sub_work_order_settle_1" },
      body: {
        completionReceiptId: "pg_sub_receipt_1",
        completionReceiptHash: completeWorkOrder.json?.completionReceipt?.receiptHash,
        authorityGrantRef: "pg_sub_authority_grant_1",
        acceptanceHash: createAcceptance.json?.taskAcceptance?.acceptanceHash,
        status: "released",
        x402GateId: "x402gate_pg_sub_work_order_1",
        x402RunId: "run_pg_sub_work_order_1",
        x402SettlementStatus: "released",
        x402ReceiptId: "x402rcpt_pg_sub_work_order_1",
        settledAt: "2026-02-25T00:22:00.000Z"
      }
    });
    assert.equal(settleWorkOrder.statusCode, 200, settleWorkOrder.body);

    const createSession = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/sessions",
      headers: { "x-idempotency-key": "pg_sub_session_create_1" },
      body: {
        sessionId: "pg_sub_session_1",
        visibility: "tenant",
        participants: [principalA, workerA],
        policyRef: "policy://pg/session/default"
      }
    });
    assert.equal(createSession.statusCode, 201, createSession.body);
    assert.equal(createSession.json?.session?.sessionId, "pg_sub_session_1");
    assert.equal(createSession.json?.session?.revision, 0);

    const appendSessionEvent = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/sessions/pg_sub_session_1/events",
      headers: {
        "x-idempotency-key": "pg_sub_session_event_append_1",
        "x-proxy-expected-prev-chain-hash": "null"
      },
      body: {
        eventType: "TASK_REQUESTED",
        traceId: "trace_pg_sub_session_1",
        payload: {
          taskId: "task_pg_sub_session_1",
          capability: "travel.booking",
          budgetCents: 1200
        }
      }
    });
    assert.equal(appendSessionEvent.statusCode, 201, appendSessionEvent.body);
    assert.equal(appendSessionEvent.json?.session?.revision, 1);
    assert.equal(appendSessionEvent.json?.event?.type, "TASK_REQUESTED");

    const replayPackBeforeRestart = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "GET",
      path: "/sessions/pg_sub_session_1/replay-pack"
    });
    assert.equal(replayPackBeforeRestart.statusCode, 200, replayPackBeforeRestart.body);
    assert.equal(replayPackBeforeRestart.json?.replayPack?.schemaVersion, "SessionReplayPack.v1");
    assert.equal(replayPackBeforeRestart.json?.replayPack?.eventCount, 1);
    assert.equal(replayPackBeforeRestart.json?.replayPack?.verification?.chainOk, true);
    replayPackHashBeforeRestart = replayPackBeforeRestart.json?.replayPack?.packHash ?? null;
    assert.equal(typeof replayPackHashBeforeRestart, "string");

    const transcriptBeforeRestart = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "GET",
      path: "/sessions/pg_sub_session_1/transcript"
    });
    assert.equal(transcriptBeforeRestart.statusCode, 200, transcriptBeforeRestart.body);
    assert.equal(transcriptBeforeRestart.json?.transcript?.schemaVersion, "SessionTranscript.v1");
    assert.equal(transcriptBeforeRestart.json?.transcript?.eventCount, 1);
    assert.equal(transcriptBeforeRestart.json?.transcript?.verification?.chainOk, true);
    transcriptHashBeforeRestart = transcriptBeforeRestart.json?.transcript?.transcriptHash ?? null;
    assert.equal(typeof transcriptHashBeforeRestart, "string");

    await creditWallet(apiA, {
      tenantId: tenantA,
      agentId: principalA,
      amountCents: 10000,
      idempotencyKey: "pg_sub_wallet_credit_principal_a_1"
    });
    await createTerminalRun({
      api: apiA,
      tenantId: tenantA,
      agentId: workerA,
      runId: "pg_sub_graph_run_1",
      payerAgentId: principalA,
      amountCents: 1250,
      terminalType: "RUN_COMPLETED"
    });

    const interactionGraphBeforeRestart = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "GET",
      path:
        `/agents/${encodeURIComponent(workerA)}/interaction-graph-pack` +
        "?reputationVersion=v2&reputationWindow=allTime&asOf=2030-01-01T00:00:00.000Z&visibility=all&limit=10&offset=0"
    });
    assert.equal(interactionGraphBeforeRestart.statusCode, 200, interactionGraphBeforeRestart.body);
    assert.equal(interactionGraphBeforeRestart.json?.graphPack?.schemaVersion, "VerifiedInteractionGraphPack.v1");
    assert.ok(Number(interactionGraphBeforeRestart.json?.graphPack?.relationshipCount ?? 0) >= 1);
    interactionGraphPackHashBeforeRestart = interactionGraphBeforeRestart.json?.graphPack?.packHash ?? null;
    assert.equal(typeof interactionGraphPackHashBeforeRestart, "string");

    const abuseReportBeforeRestart = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: `/agent-cards/${encodeURIComponent(workerA)}/abuse-reports`,
      headers: { "x-idempotency-key": "pg_sub_abuse_report_1" },
      body: {
        reportId: "pg_sub_abuse_report_1",
        reporterAgentId: principalA,
        reasonCode: "MALICIOUS_OUTPUT",
        severity: 2,
        notes: "pg durability abuse report test",
        evidenceRefs: ["evidence://pg_sub/abuse/1"]
      }
    });
    assert.equal(abuseReportBeforeRestart.statusCode, 201, abuseReportBeforeRestart.body);
    assert.equal(abuseReportBeforeRestart.json?.report?.reportId, "pg_sub_abuse_report_1");
    assert.equal(abuseReportBeforeRestart.json?.subjectStatus?.publicDiscoverySuppressed, true);

    const resolvedBeforeRestart = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: `/agent-cards/${encodeURIComponent(workerA)}/abuse-reports/pg_sub_abuse_report_1/status`,
      headers: {
        "x-idempotency-key": "pg_sub_abuse_report_resolve_1",
        "x-settld-protocol": "1.0"
      },
      body: {
        status: "resolved",
        resolvedByAgentId: principalA,
        resolutionNotes: "pg durability status transition"
      }
    });
    assert.equal(resolvedBeforeRestart.statusCode, 200, resolvedBeforeRestart.body);
    assert.equal(resolvedBeforeRestart.json?.report?.status, "resolved");
    assert.equal(resolvedBeforeRestart.json?.report?.resolvedByAgentId, principalA);
    assert.equal(resolvedBeforeRestart.json?.subjectStatus?.openReportCount, 0);
    assert.equal(resolvedBeforeRestart.json?.subjectStatus?.publicDiscoverySuppressed, false);

    await storeA.close();
    storeA = null;

    storeB = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    const apiB = createApi({
      store: storeB,
      agentCardPublicAbuseSuppressionThreshold: 1
    });

    const getCard = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: `/agent-cards/${encodeURIComponent(workerA)}`
    });
    assert.equal(getCard.statusCode, 200, getCard.body);
    assert.equal(getCard.json?.agentCard?.agentId, workerA);

    const listGrants = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: `/delegation-grants?delegatorAgentId=${encodeURIComponent(principalA)}`
    });
    assert.equal(listGrants.statusCode, 200, listGrants.body);
    assert.equal(listGrants.json?.grants?.some((row) => row.grantId === "pg_sub_grant_1"), true);

    const listAuthorityGrants = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: `/authority-grants?granteeAgentId=${encodeURIComponent(principalA)}`
    });
    assert.equal(listAuthorityGrants.statusCode, 200, listAuthorityGrants.body);
    assert.equal(listAuthorityGrants.json?.grants?.some((row) => row.grantId === "pg_sub_authority_grant_1"), true);

    const listTaskQuotes = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: `/task-quotes?buyerAgentId=${encodeURIComponent(principalA)}&status=open`
    });
    assert.equal(listTaskQuotes.statusCode, 200, listTaskQuotes.body);
    assert.equal(listTaskQuotes.json?.taskQuotes?.some((row) => row.quoteId === quoteId), true);

    const listTaskOffers = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: `/task-offers?quoteId=${encodeURIComponent(quoteId)}&status=open`
    });
    assert.equal(listTaskOffers.statusCode, 200, listTaskOffers.body);
    assert.equal(listTaskOffers.json?.taskOffers?.some((row) => row.offerId === offerId), true);

    const listTaskAcceptances = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: `/task-acceptances?quoteId=${encodeURIComponent(quoteId)}&status=accepted`
    });
    assert.equal(listTaskAcceptances.statusCode, 200, listTaskAcceptances.body);
    assert.equal(listTaskAcceptances.json?.taskAcceptances?.some((row) => row.acceptanceId === acceptanceId), true);

    const listAttestations = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: `/capability-attestations?subjectAgentId=${encodeURIComponent(workerA)}&capability=travel.booking`
    });
    assert.equal(listAttestations.statusCode, 200, listAttestations.body);
    assert.equal(listAttestations.json?.attestations?.some((row) => row?.capabilityAttestation?.attestationId === "pg_sub_attest_a_1"), true);

    const getWorkOrder = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: "/work-orders/pg_sub_work_order_1"
    });
    assert.equal(getWorkOrder.statusCode, 200, getWorkOrder.body);
    assert.equal(getWorkOrder.json?.workOrder?.status, "settled");
    assert.equal(getWorkOrder.json?.workOrder?.authorityGrantRef, "pg_sub_authority_grant_1");
    assert.equal(getWorkOrder.json?.workOrder?.settlement?.authorityGrantRef, "pg_sub_authority_grant_1");
    assert.equal(getWorkOrder.json?.workOrder?.acceptanceBinding?.acceptanceId, acceptanceId);

    const listReceipts = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: "/work-orders/receipts?workOrderId=pg_sub_work_order_1&status=success"
    });
    assert.equal(listReceipts.statusCode, 200, listReceipts.body);
    assert.equal(listReceipts.json?.receipts?.some((row) => row.receiptId === "pg_sub_receipt_1"), true);

    const getSession = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: "/sessions/pg_sub_session_1"
    });
    assert.equal(getSession.statusCode, 200, getSession.body);
    assert.equal(getSession.json?.session?.sessionId, "pg_sub_session_1");
    assert.equal(getSession.json?.session?.revision, 1);

    const listSessionEvents = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: "/sessions/pg_sub_session_1/events?eventType=task_requested"
    });
    assert.equal(listSessionEvents.statusCode, 200, listSessionEvents.body);
    assert.equal(listSessionEvents.json?.events?.length, 1);
    assert.equal(listSessionEvents.json?.events?.[0]?.type, "TASK_REQUESTED");

    const replayPackAfterRestart = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: "/sessions/pg_sub_session_1/replay-pack"
    });
    assert.equal(replayPackAfterRestart.statusCode, 200, replayPackAfterRestart.body);
    assert.equal(replayPackAfterRestart.json?.replayPack?.schemaVersion, "SessionReplayPack.v1");
    assert.equal(replayPackAfterRestart.json?.replayPack?.packHash, replayPackHashBeforeRestart);

    const transcriptAfterRestart = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: "/sessions/pg_sub_session_1/transcript"
    });
    assert.equal(transcriptAfterRestart.statusCode, 200, transcriptAfterRestart.body);
    assert.equal(transcriptAfterRestart.json?.transcript?.schemaVersion, "SessionTranscript.v1");
    assert.equal(transcriptAfterRestart.json?.transcript?.transcriptHash, transcriptHashBeforeRestart);

    const interactionGraphAfterRestart = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path:
        `/agents/${encodeURIComponent(workerA)}/interaction-graph-pack` +
        "?reputationVersion=v2&reputationWindow=allTime&asOf=2030-01-01T00:00:00.000Z&visibility=all&limit=10&offset=0"
    });
    assert.equal(interactionGraphAfterRestart.statusCode, 200, interactionGraphAfterRestart.body);
    assert.equal(interactionGraphAfterRestart.json?.graphPack?.schemaVersion, "VerifiedInteractionGraphPack.v1");
    assert.equal(interactionGraphAfterRestart.json?.graphPack?.packHash, interactionGraphPackHashBeforeRestart);

    const openAbuseReportsAfterRestart = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: `/agent-cards/${encodeURIComponent(workerA)}/abuse-reports?status=open&limit=10&offset=0`
    });
    assert.equal(openAbuseReportsAfterRestart.statusCode, 200, openAbuseReportsAfterRestart.body);
    assert.equal(openAbuseReportsAfterRestart.json?.total, 0);
    assert.equal(openAbuseReportsAfterRestart.json?.subjectStatus?.openReportCount, 0);
    assert.equal(openAbuseReportsAfterRestart.json?.subjectStatus?.publicDiscoverySuppressed, false);

    const resolvedAbuseReportsAfterRestart = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: `/agent-cards/${encodeURIComponent(workerA)}/abuse-reports?status=resolved&limit=10&offset=0`
    });
    assert.equal(resolvedAbuseReportsAfterRestart.statusCode, 200, resolvedAbuseReportsAfterRestart.body);
    assert.equal(
      resolvedAbuseReportsAfterRestart.json?.reports?.some((row) => String(row?.reportId ?? "") === "pg_sub_abuse_report_1"),
      true
    );
    assert.equal(resolvedAbuseReportsAfterRestart.json?.subjectStatus?.openReportCount, 0);

    const publicDiscover = await request(apiB, {
      method: "GET",
      path:
        "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active" +
        "&includeReputation=false&limit=10&offset=0",
      auth: "none"
    });
    assert.equal(publicDiscover.statusCode, 200, publicDiscover.body);
    assert.equal(publicDiscover.json?.scope, "public");
    const publicIds = new Set((publicDiscover.json?.results ?? []).map((row) => String(row?.agentCard?.agentId ?? "")));
    assert.equal(publicIds.has(workerA), true);
    assert.equal(publicIds.has(workerB), true);

    const publicDiscoverToolFiltered = await request(apiB, {
      method: "GET",
      path:
        "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active" +
        "&includeReputation=false&toolMcpName=TRAVEL_SEARCH_FLIGHTS&toolRiskClass=read&toolSideEffecting=false&toolMaxPriceCents=100&toolRequiresEvidenceKind=artifact&limit=10&offset=0",
      auth: "none"
    });
    assert.equal(publicDiscoverToolFiltered.statusCode, 200, publicDiscoverToolFiltered.body);
    assert.equal(publicDiscoverToolFiltered.json?.scope, "public");
    assert.equal(publicDiscoverToolFiltered.json?.results?.length, 1);
    assert.equal(publicDiscoverToolFiltered.json?.results?.[0]?.agentCard?.agentId, workerB);

    const tenantDiscover = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path:
        "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active" +
        "&includeReputation=false&limit=10&offset=0"
    });
    assert.equal(tenantDiscover.statusCode, 200, tenantDiscover.body);
    const tenantIds = new Set((tenantDiscover.json?.results ?? []).map((row) => String(row?.agentCard?.agentId ?? "")));
    assert.equal(tenantIds.has(workerA), true);
    assert.equal(tenantIds.has(workerB), false);

    const tenantDiscoverToolFiltered = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path:
        "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active" +
        "&includeReputation=false&toolId=travel.book_flight&toolRiskClass=action&toolSideEffecting=true&toolMaxPriceCents=600&toolRequiresEvidenceKind=hash&limit=10&offset=0"
    });
    assert.equal(tenantDiscoverToolFiltered.statusCode, 200, tenantDiscoverToolFiltered.body);
    assert.equal(tenantDiscoverToolFiltered.json?.results?.length, 1);
    assert.equal(tenantDiscoverToolFiltered.json?.results?.[0]?.agentCard?.agentId, workerA);

    const tenantDiscoverToolNotVisibleCrossTenant = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path:
        "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active" +
        "&includeReputation=false&toolId=travel.search_flights&limit=10&offset=0"
    });
    assert.equal(tenantDiscoverToolNotVisibleCrossTenant.statusCode, 200, tenantDiscoverToolNotVisibleCrossTenant.body);
    assert.equal(tenantDiscoverToolNotVisibleCrossTenant.json?.results?.length, 0);
  } finally {
    try {
      await storeB?.close?.();
    } catch {}
    try {
      await storeA?.close?.();
    } catch {}
  }
});
