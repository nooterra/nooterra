import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { computeArtifactHash } from "../src/core/artifacts.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { getPhase1SupportedTaskFamily } from "../src/core/phase1-task-policy.js";
import { buildTaskWalletV1 } from "../src/core/task-wallet.js";
import { makeScopedKey } from "../src/core/tenancy.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { tenantId, agentId, ownerId = "svc_run_detail_test" }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `register_${tenantId}_${agentId}`
    },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId },
      publicKeyPem
    }
  });
  assert.equal(response.statusCode, 201);
}

async function creditWallet(api, { tenantId, agentId, amountCents, idempotencyKey }) {
  const response = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": idempotencyKey
    },
    body: {
      amountCents,
      currency: "USD"
    }
  });
  assert.equal(response.statusCode, 201);
}

async function createCompletedRun(api, { tenantId, payerAgentId, payeeAgentId, runId, amountCents, idempotencyPrefix, evidenceRefs = [], metrics = null }) {
  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_create`
    },
    body: {
      runId,
      taskType: "analysis",
      settlement: {
        payerAgentId,
        amountCents,
        currency: "USD",
        disputeWindowDays: 5
      }
    }
  });
  assert.equal(created.statusCode, 201);
  let prev = created.json?.run?.lastChainHash;
  for (let index = 0; index < evidenceRefs.length; index += 1) {
    const evidenceResponse = await request(api, {
      method: "POST",
      path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`,
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-idempotency-key": `${idempotencyPrefix}_evidence_${index + 1}`,
        ...(prev ? { "x-proxy-expected-prev-chain-hash": prev } : {})
      },
      body: {
        type: "EVIDENCE_ADDED",
        payload: {
          evidenceRef: evidenceRefs[index]
        }
      }
    });
    assert.equal(evidenceResponse.statusCode, 201);
    prev = evidenceResponse.json?.run?.lastChainHash ?? prev;
  }

  const completed = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_complete`,
      ...(prev ? { "x-proxy-expected-prev-chain-hash": prev } : {})
    },
    body: {
      type: "RUN_COMPLETED",
      payload: {
        outputRef: `evidence://${runId}/output.json`,
        ...(metrics && typeof metrics === "object" && !Array.isArray(metrics) ? { metrics } : {})
      }
    }
  });
  assert.equal(completed.statusCode, 201);
}

async function createRunningRun(api, { tenantId, payerAgentId, payeeAgentId, runId, amountCents, idempotencyPrefix }) {
  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_create`
    },
    body: {
      runId,
      taskType: "analysis",
      settlement: {
        payerAgentId,
        amountCents,
        currency: "USD",
        disputeWindowDays: 5
      }
    }
  });
  assert.equal(created.statusCode, 201);

  const started = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_start`,
      "x-proxy-expected-prev-chain-hash": created.json?.run?.lastChainHash
    },
    body: {
      type: "RUN_STARTED",
      payload: {
        startedBy: payeeAgentId
      }
    }
  });
  assert.equal(started.statusCode, 201);
  return started.json?.run ?? null;
}

function attachPhase1LaunchContractToRun(api, { tenantId, runId, rfqId, categoryId, capability, posterAgentId = "agt_phase1_requester" }) {
  const family = getPhase1SupportedTaskFamily(categoryId);
  assert.ok(family, `phase1 family ${categoryId} must exist`);
  const taskWallet = buildTaskWalletV1({
    walletId: `twal_${runId}_${rfqId}`,
    tenantId,
    launchId: `rlaunch_${runId}`,
    taskId: `task_${runId}`,
    rfqId,
    ownerAgentId: posterAgentId,
    categoryId: family.categoryId,
    currency: "USD",
    maxSpendCents: 3200,
    evidenceRequirements: Array.isArray(family.completionContract?.evidenceRequirements)
      ? family.completionContract.evidenceRequirements
      : [],
    createdAt: "2026-03-06T18:30:00.000Z"
  });
  api.store.marketplaceRfqs.set(
    makeScopedKey({ tenantId, id: rfqId }),
    {
      schemaVersion: "MarketplaceRfq.v1",
      rfqId,
      tenantId,
      runId,
      capability,
      posterAgentId,
      status: "closed",
      metadata: {
        phase1Launch: {
          schemaVersion: "Phase1LaunchContract.v1",
          productSurface: "consumer_shell",
          categoryId: family.categoryId,
          categoryLabel: family.label,
          categorySummary: family.summary,
          completionContract: family.completionContract
        },
        routerLaunch: {
          schemaVersion: "RouterLaunchMetadata.v1",
          launchId: `rlaunch_${runId}`,
          taskId: `task_${runId}`,
          taskWallet
        }
      }
    }
  );
}

async function openDisputeCase(api, { tenantId, runId, disputeId, caseId, payerAgentId, arbiterAgentId, idempotencyPrefix, reason }) {
  const dispute = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_dispute`
    },
    body: {
      disputeId,
      reason,
      openedByAgentId: payerAgentId
    }
  });
  assert.equal(dispute.statusCode, 200);

  const arbitration = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/arbitration/open`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_case`
    },
    body: {
      disputeId,
      caseId,
      arbiterAgentId
    }
  });
  assert.equal(arbitration.statusCode, 201);
}

async function attachManagedProviderHandoff(api, { tenantId, payeeAgentId, runId, idempotencyPrefix }) {
  const artifactBody = {
    schemaVersion: "ManagedProviderRunHandoff.v1",
    artifactType: "ManagedProviderRunHandoff.v1",
    artifactId: `run_handoff_${runId}_demo`,
    tenantId,
    runId,
    agentId: payeeAgentId,
    rescueId: `run:${runId}:run_attention_required`,
    targetProfileId: "booking_concierge",
    providerId: "provider_booking_exec",
    providerRef: "provider://booking_exec",
    publicationId: "pub_booking_exec",
    baseUrl: "https://provider.example.test",
    toolId: "book-checkout",
    paidPath: "/paid/booking/checkout",
    description: "Bounded booking checkout through a certified provider.",
    executionAdapter: {
      type: "browser_session_delegated",
      requiresDelegatedAccountSession: true,
      supportedSessionModes: ["browser_delegated", "approval_at_boundary"]
    },
    accountSessionBinding: {
      sessionId: "sess_booking_1",
      sessionRef: `account-session://${encodeURIComponent(tenantId)}/sess_booking_1`,
      providerKey: "amazon",
      siteKey: "amazon.com",
      mode: "browser_delegated",
      accountHandleMasked: "a***@example.com",
      maxSpendCents: 15000,
      currency: "USD"
    },
    requestHeaders: {
      "x-nooterra-account-session-binding": "opaque-binding"
    },
    handoffReady: true,
    handoffCode: "HANDOFF_READY",
    handoffMessage: "Certified managed provider is ready for delegated execution.",
    note: "Operator handed off this run to the certified booking provider.",
    handedOffAt: "2026-03-06T18:45:00.000Z",
    handedOffByPrincipalId: "legacy_ops:tok_opsrw"
  };
  const artifact = {
    ...artifactBody,
    artifactHash: computeArtifactHash(artifactBody)
  };
  await api.store.putArtifact({ tenantId, artifact });

  const run = await api.store.getAgentRun({ tenantId, runId });
  const evidenceResponse = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_handoff_evidence`,
      "x-proxy-expected-prev-chain-hash": run?.lastChainHash
    },
    body: {
      type: "EVIDENCE_ADDED",
      payload: {
        evidenceRef: `artifact://runs/${encodeURIComponent(runId)}/handoffs/${encodeURIComponent(artifact.artifactId)}.json`
      }
    }
  });
  assert.equal(evidenceResponse.statusCode, 201);
  return artifact;
}

async function attachManagedProviderAssignment(api, {
  tenantId,
  payeeAgentId,
  runId,
  idempotencyPrefix,
  artifactId = `run_assignment_${runId}_demo`,
  providerId = "provider_booking_exec",
  providerRef = "provider://booking_exec",
  publicationId = "pub_booking_exec",
  toolId = "book-checkout",
  paidPath = "/paid/booking/checkout",
  description = "Certified booking specialist assigned to this run.",
  note = "Operator assigned this run to the certified booking provider.",
  assignedAt = "2026-03-06T18:44:00.000Z"
}) {
  const artifactBody = {
    schemaVersion: "ManagedProviderRunAssignment.v1",
    artifactType: "ManagedProviderRunAssignment.v1",
    artifactId,
    tenantId,
    runId,
    agentId: payeeAgentId,
    rescueId: `run:${runId}:run_attention_required`,
    assignmentMode: "rescue_auto_handoff",
    targetProfileId: "booking_concierge",
    providerId,
    providerRef,
    publicationId,
    baseUrl: "https://provider.example.test",
    toolId,
    paidPath,
    description,
    executionAdapter: {
      type: "browser_session_delegated",
      requiresDelegatedAccountSession: true,
      supportedSessionModes: ["browser_delegated", "approval_at_boundary"]
    },
    accountSessionBinding: {
      sessionId: "sess_booking_1",
      sessionRef: `account-session://${encodeURIComponent(tenantId)}/sess_booking_1`,
      providerKey: "amazon",
      siteKey: "amazon.com",
      mode: "browser_delegated",
      accountHandleMasked: "a***@example.com",
      maxSpendCents: 15000,
      currency: "USD"
    },
    handoffReady: true,
    handoffCode: "HANDOFF_READY",
    handoffMessage: "Certified managed provider is assigned and ready for delegated execution.",
    note,
    assignedAt,
    assignedByPrincipalId: "legacy_ops:tok_opsrw"
  };
  const artifact = {
    ...artifactBody,
    artifactHash: computeArtifactHash(artifactBody)
  };
  await api.store.putArtifact({ tenantId, artifact });

  const run = await api.store.getAgentRun({ tenantId, runId });
  const evidenceResponse = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_assignment_evidence`,
      "x-proxy-expected-prev-chain-hash": run?.lastChainHash
    },
    body: {
      type: "EVIDENCE_ADDED",
      payload: {
        evidenceRef: `artifact://runs/${encodeURIComponent(runId)}/assignments/${encodeURIComponent(artifact.artifactId)}.json`
      }
    }
  });
  assert.equal(evidenceResponse.statusCode, 201);
  return artifact;
}

async function attachManagedProviderInvocation(api, { tenantId, payeeAgentId, runId, idempotencyPrefix }) {
  const artifactBody = {
    schemaVersion: "ManagedProviderRunInvocation.v1",
    artifactType: "ManagedProviderRunInvocation.v1",
    artifactId: `run_handoff_invoke_${runId}_demo`,
    tenantId,
    runId,
    agentId: payeeAgentId,
    rescueId: `run:${runId}:run_attention_required`,
    providerId: "provider_booking_exec",
    providerRef: "provider://booking_exec",
    publicationId: "pub_booking_exec",
    baseUrl: "https://provider.example.test",
    toolId: "book-checkout",
    paidPath: "/paid/booking/checkout",
    requestBindingMode: "strict",
    requestBindingSha256: "a".repeat(64),
    challenge: {
      amountCents: 480,
      currency: "USD",
      providerId: "provider_booking_exec",
      toolId: "book-checkout"
    },
    requestHeaders: {
      "x-nooterra-account-session-binding": "opaque-binding"
    },
    accountSessionBinding: {
      sessionId: "sess_booking_1",
      sessionRef: `account-session://${encodeURIComponent(tenantId)}/sess_booking_1`,
      providerKey: "amazon",
      siteKey: "amazon.com",
      mode: "browser_delegated",
      accountHandleMasked: "a***@example.com",
      maxSpendCents: 15000,
      currency: "USD"
    },
    responseStatusCode: 200,
    responseSha256: "b".repeat(64),
    responseHeaders: {
      "x-nooterra-request-binding-mode": "strict",
      "x-nooterra-request-binding-sha256": "a".repeat(64),
      "x-nooterra-provider-key-id": "key_provider_demo"
    },
    providerSignature: {
      keyId: "key_provider_demo",
      signedAt: "2026-03-06T18:46:00.000Z",
      nonce: "abcdef0123456789abcdef0123456789",
      responseHash: "b".repeat(64),
      verified: true
    },
    note: "Certified provider executed the booking checkout.",
    invokedAt: "2026-03-06T18:46:00.000Z",
    invokedByPrincipalId: "legacy_ops:tok_opsrw"
  };
  const artifact = {
    ...artifactBody,
    artifactHash: computeArtifactHash(artifactBody)
  };
  await api.store.putArtifact({ tenantId, artifact });

  const run = await api.store.getAgentRun({ tenantId, runId });
  const evidenceResponse = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_handoff_invoke_evidence`,
      "x-proxy-expected-prev-chain-hash": run?.lastChainHash
    },
    body: {
      type: "EVIDENCE_ADDED",
      payload: {
        runId,
        evidenceRef: `artifact://runs/${encodeURIComponent(runId)}/handoff-invocations/${encodeURIComponent(artifact.artifactId)}.json`
      }
    }
  });
  assert.equal(evidenceResponse.statusCode, 201, evidenceResponse.body);
  return artifact;
}

async function attachRunActionRequiredResponseArtifact(api, {
  tenantId,
  payeeAgentId,
  runId,
  idempotencyPrefix
} = {}) {
  const artifactBody = {
    schemaVersion: "RunActionRequiredResponseArtifact.v1",
    artifactType: "RunActionRequiredResponseArtifact.v1",
    artifactId: `run_action_response_${runId}_demo`,
    tenantId,
    runId,
    agentId: payeeAgentId,
    actionRequiredCode: "needs_calendar_access",
    requestedAt: "2026-03-06T18:43:00.000Z",
    respondedAt: "2026-03-06T18:43:30.000Z",
    requestedFields: ["calendar_connector_ref", "calendar_provider", "timezone"],
    requestedEvidenceKinds: [],
    providedFields: {
      calendar_connector_ref: `connector://tenants/${encodeURIComponent(tenantId)}/cc_calendar_demo`,
      calendar_provider: "google_calendar",
      timezone: "America/Los_Angeles"
    },
    providedEvidenceKinds: [],
    evidenceRefs: [],
    note: "Use my linked calendar for booking coordination.",
    respondedByPrincipalId: "buyer:run_detail_demo",
    consumerConnectorBinding: {
      connectorId: "cc_calendar_demo",
      connectorRef: `connector://tenants/${encodeURIComponent(tenantId)}/cc_calendar_demo`,
      kind: "calendar",
      provider: "google_calendar",
      accountAddress: "calendar@example.com",
      accountLabel: "Primary calendar",
      timezone: "America/Los_Angeles"
    }
  };
  const artifact = {
    ...artifactBody,
    artifactHash: computeArtifactHash(artifactBody)
  };
  await api.store.putArtifact({ tenantId, artifact });

  const run = await api.store.getAgentRun({ tenantId, runId });
  const evidenceResponse = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_action_response_evidence`,
      "x-proxy-expected-prev-chain-hash": run?.lastChainHash
    },
    body: {
      type: "EVIDENCE_ADDED",
      payload: {
        evidenceRef: `artifact://runs/${encodeURIComponent(runId)}/responses/${encodeURIComponent(artifact.artifactId)}.json`
      }
    }
  });
  assert.equal(evidenceResponse.statusCode, 201, evidenceResponse.body);
  return artifact;
}

test("API e2e: canonical run detail returns execution, settlement, and dispute context", async () => {
  const api = createApi({ now: () => "2026-03-06T16:00:00.000Z" });
  const tenantId = "tenant_run_detail";
  const payerAgentId = "agt_run_detail_payer";
  const payeeAgentId = "agt_run_detail_payee";
  const arbiterAgentId = "agt_run_detail_arbiter";
  const runId = "run_detail_1";

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  await registerAgent(api, { tenantId, agentId: payeeAgentId });
  await registerAgent(api, { tenantId, agentId: arbiterAgentId });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 10_000, idempotencyKey: "credit_run_detail" });
  await createCompletedRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId,
    amountCents: 2100,
    idempotencyPrefix: "run_detail"
  });
  await openDisputeCase(api, {
    tenantId,
    runId,
    disputeId: "dispute_run_detail_1",
    caseId: "arb_case_run_detail_1",
    payerAgentId,
    arbiterAgentId,
    idempotencyPrefix: "run_detail_case",
    reason: "Need more evidence"
  });

  const detail = await request(api, {
    method: "GET",
    path: `/runs/${encodeURIComponent(runId)}`,
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json?.ok, true);
  assert.equal(detail.json?.detail?.schemaVersion, "RunDetail.v1");
  assert.equal(detail.json?.detail?.runId, runId);
  assert.equal(detail.json?.detail?.integrityStatus, "verified");
  assert.equal(detail.json?.detail?.run?.runId, runId);
  assert.equal(detail.json?.detail?.settlement?.settlement?.status, "released");
  assert.equal(detail.json?.detail?.settlement?.settlement?.disputeStatus, "open");
  assert.equal(detail.json?.detail?.arbitration?.caseCount, 1);
  assert.equal(detail.json?.detail?.arbitration?.latestCaseId, "arb_case_run_detail_1");
  assert.ok(Array.isArray(detail.json?.detail?.timeline));
  assert.ok(detail.json.detail.timeline.some((entry) => entry.eventType === "run.created"));
  assert.ok(detail.json.detail.timeline.some((entry) => entry.eventType === "RUN_COMPLETED"));
  assert.ok(detail.json.detail.timeline.some((entry) => entry.eventType === "dispute.opened"));
  assert.ok(detail.json.detail.timeline.some((entry) => entry.eventType === "arbitration.case_opened"));
});

test("API e2e: canonical run detail returns not found for unknown runs", async () => {
  const api = createApi();
  const response = await request(api, {
    method: "GET",
    path: "/runs/run_missing_detail"
  });
  assert.equal(response.statusCode, 404, response.body);
});

test("API e2e: phase1 linked runs enforce completion contract proof on detail and verification routes", async () => {
  const api = createApi({ now: () => "2026-03-06T18:30:00.000Z" });
  const tenantId = "tenant_run_detail_phase1";
  const payerAgentId = "agt_run_detail_phase1_payer";
  const payeeAgentId = "agt_run_detail_phase1_payee";

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  await registerAgent(api, { tenantId, agentId: payeeAgentId });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 20_000, idempotencyKey: "credit_run_detail_phase1" });

  await createCompletedRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId: "run_detail_phase1_green",
    amountCents: 3200,
    idempotencyPrefix: "run_detail_phase1_green",
    evidenceRefs: [
      "artifact://phase1/receipt/1",
      "artifact://phase1/merchant_confirmation/1",
      "artifact://phase1/price_breakdown/1"
    ],
    metrics: {
      phase1CompletionState: "purchase_confirmed"
    }
  });
  attachPhase1LaunchContractToRun(api, {
    tenantId,
    runId: "run_detail_phase1_green",
    rfqId: "rfq_run_detail_phase1_green",
    categoryId: "purchases_under_cap",
    capability: "capability://consumer.purchase.execute"
  });

  const greenVerification = await request(api, {
    method: "GET",
    path: "/runs/run_detail_phase1_green/verification",
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(greenVerification.statusCode, 200, greenVerification.body);
  assert.equal(greenVerification.json?.verification?.verificationStatus, "green");
  assert.equal(greenVerification.json?.verification?.reasonCodes?.includes("PHASE1_REQUIRED_EVIDENCE_MISSING"), false);

  const greenDetail = await request(api, {
    method: "GET",
    path: "/runs/run_detail_phase1_green",
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(greenDetail.statusCode, 200, greenDetail.body);
  assert.equal(greenDetail.json?.detail?.verification?.verificationStatus, "green");
  assert.equal(greenDetail.json?.detail?.taskWallet?.schemaVersion, "TaskWallet.v1");
  assert.equal(greenDetail.json?.detail?.taskWallet?.categoryId, "purchases_under_cap");
  assert.equal(greenDetail.json?.detail?.taskWallet?.maxSpendCents, 3200);
  assert.equal(greenDetail.json?.detail?.taskWalletSpendPlan?.schemaVersion, "TaskWalletSpendPlan.v1");
  assert.equal(greenDetail.json?.detail?.taskWalletSpendPlan?.consumerSpendRail, "stripe_issuing_task_wallet");
  assert.equal(greenDetail.json?.detail?.taskWalletSpendPlan?.platformSettlementRail, "stripe_connect_marketplace_split");
  assert.equal(greenDetail.json?.detail?.taskWalletSpendPlan?.machineSpendRail, "x402_optional_later");
  assert.equal(greenDetail.json?.detail?.taskWalletSpendPlan?.authorizationPattern, "operator_supervised_checkout");
  assert.equal(
    greenDetail.json?.detail?.issues?.some((issue) => String(issue?.code ?? "").startsWith("PHASE1_")),
    false
  );

  await createCompletedRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId: "run_detail_phase1_red",
    amountCents: 3200,
    idempotencyPrefix: "run_detail_phase1_red",
    evidenceRefs: ["artifact://phase1/receipt/2"],
    metrics: {
      phase1CompletionState: "purchase_confirmed"
    }
  });
  attachPhase1LaunchContractToRun(api, {
    tenantId,
    runId: "run_detail_phase1_red",
    rfqId: "rfq_run_detail_phase1_red",
    categoryId: "purchases_under_cap",
    capability: "capability://consumer.purchase.execute"
  });

  const redVerification = await request(api, {
    method: "GET",
    path: "/runs/run_detail_phase1_red/verification",
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(redVerification.statusCode, 200, redVerification.body);
  assert.equal(redVerification.json?.verification?.verificationStatus, "red");
  assert.ok(Array.isArray(redVerification.json?.verification?.reasonCodes));
  assert.ok(redVerification.json.verification.reasonCodes.includes("PHASE1_REQUIRED_EVIDENCE_MISSING"));

  const redDetail = await request(api, {
    method: "GET",
    path: "/runs/run_detail_phase1_red",
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(redDetail.statusCode, 200, redDetail.body);
  assert.equal(redDetail.json?.detail?.integrityStatus, "attention_required");
  assert.ok(
    redDetail.json?.detail?.issues?.some(
      (issue) =>
        issue?.code === "PHASE1_REQUIRED_EVIDENCE_MISSING" &&
        String(issue?.message ?? "").includes("merchant_confirmation")
    )
  );
});

test("API e2e: canonical run detail surfaces managed provider handoff state", async () => {
  const api = createApi({ now: () => "2026-03-06T18:45:00.000Z" });
  const tenantId = "tenant_run_detail_handoff";
  const payerAgentId = "agt_run_detail_handoff_payer";
  const payeeAgentId = "agt_run_detail_handoff_payee";
  const runId = "run_detail_handoff_1";

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  await registerAgent(api, { tenantId, agentId: payeeAgentId });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 20_000, idempotencyKey: "credit_run_detail_handoff" });
  await createRunningRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId,
    amountCents: 3200,
    idempotencyPrefix: "run_detail_handoff"
  });
  const previousAssignmentArtifact = await attachManagedProviderAssignment(api, {
    tenantId,
    payeeAgentId,
    runId,
    idempotencyPrefix: "run_detail_handoff_previous",
    artifactId: `run_assignment_${runId}_previous`,
    providerId: "provider_booking_previous",
    providerRef: "provider://booking_previous",
    publicationId: "pub_booking_previous",
    toolId: "book-research",
    paidPath: "/paid/booking/research",
    description: "Previous managed booking provider assignment.",
    note: "Original specialist assignment before reroute.",
    assignedAt: "2026-03-06T18:40:00.000Z"
  });
  const assignmentArtifact = await attachManagedProviderAssignment(api, {
    tenantId,
    payeeAgentId,
    runId,
    idempotencyPrefix: "run_detail_handoff"
  });
  const handoffArtifact = await attachManagedProviderHandoff(api, {
    tenantId,
    payeeAgentId,
    runId,
    idempotencyPrefix: "run_detail_handoff"
  });
  const invocationArtifact = await attachManagedProviderInvocation(api, {
    tenantId,
    payeeAgentId,
    runId,
    idempotencyPrefix: "run_detail_handoff"
  });

  const detail = await request(api, {
    method: "GET",
    path: `/runs/${encodeURIComponent(runId)}`,
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json?.detail?.managedExecution?.assignment?.artifactId, assignmentArtifact.artifactId);
  assert.equal(detail.json?.detail?.managedExecution?.assignmentMode, "rescue_auto_handoff");
  assert.equal(detail.json?.detail?.managedExecution?.assignedAt, "2026-03-06T18:44:00.000Z");
  assert.equal(detail.json?.detail?.managedExecution?.assignmentHistory?.[0]?.artifactId, assignmentArtifact.artifactId);
  assert.equal(detail.json?.detail?.managedExecution?.assignmentHistory?.[1]?.artifactId, previousAssignmentArtifact.artifactId);
  assert.equal(detail.json?.detail?.managedExecution?.artifactId, handoffArtifact.artifactId);
  assert.equal(detail.json?.detail?.managedExecution?.providerId, "provider_booking_exec");
  assert.equal(detail.json?.detail?.managedExecution?.toolId, "book-checkout");
  assert.equal(detail.json?.detail?.managedExecution?.handoffReady, true);
  assert.equal(detail.json?.detail?.managedExecution?.invocation?.artifactId, invocationArtifact.artifactId);
  assert.equal(detail.json?.detail?.managedExecution?.invocation?.responseStatusCode, 200);
  assert.equal(detail.json?.detail?.managedExecution?.invocation?.providerSignature?.verified, true);
  assert.ok(detail.json?.detail?.timeline?.some((entry) => entry.eventType === "managed_provider.assigned"));
  assert.ok(detail.json?.detail?.timeline?.some((entry) => entry.eventType === "managed_provider.handoff"));
  assert.ok(detail.json?.detail?.timeline?.some((entry) => entry.eventType === "managed_provider.invoked"));
});

test("API e2e: canonical run detail surfaces latest user response bindings", async () => {
  const api = createApi({ now: () => "2026-03-06T18:45:00.000Z" });
  const tenantId = "tenant_run_detail_action_response";
  const payerAgentId = "agt_run_detail_action_response_payer";
  const payeeAgentId = "agt_run_detail_action_response_payee";
  const runId = "run_detail_action_response_1";

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  await registerAgent(api, { tenantId, agentId: payeeAgentId });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 20_000, idempotencyKey: "credit_run_detail_action_response" });
  await createRunningRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId,
    amountCents: 3200,
    idempotencyPrefix: "run_detail_action_response"
  });
  const responseArtifact = await attachRunActionRequiredResponseArtifact(api, {
    tenantId,
    payeeAgentId,
    runId,
    idempotencyPrefix: "run_detail_action_response"
  });

  const detail = await request(api, {
    method: "GET",
    path: `/runs/${encodeURIComponent(runId)}`,
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json?.detail?.latestUserResponse?.artifactId, responseArtifact.artifactId);
  assert.equal(detail.json?.detail?.latestUserResponse?.actionRequiredCode, "needs_calendar_access");
  assert.equal(detail.json?.detail?.latestUserResponse?.consumerConnectorBinding?.kind, "calendar");
  assert.equal(detail.json?.detail?.latestUserResponse?.consumerConnectorBinding?.provider, "google_calendar");
  assert.ok(detail.json?.detail?.timeline?.some((entry) => entry.eventType === "run.action_required.responded"));
});
