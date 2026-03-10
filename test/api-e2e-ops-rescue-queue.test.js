import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApi } from "../src/api/app.js";
import { buildAuthorityEnvelopeV1 } from "../src/core/authority-envelope.js";
import { APPROVAL_CONTINUATION_KIND, APPROVAL_CONTINUATION_STATUS, buildApprovalContinuationV1 } from "../src/core/approval-continuation.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem, sha256Hex } from "../src/core/crypto.js";
import { computeNooterraPayRequestBindingSha256V1 } from "../src/core/nooterra-pay-token.js";
import { signToolProviderSignatureV1 } from "../src/core/tool-provider-signature.js";
import { buildTaskWalletV1 } from "../src/core/task-wallet.js";
import { getPhase1SupportedTaskFamily } from "../src/core/phase1-task-policy.js";
import { makeScopedKey } from "../src/core/tenancy.js";
import { buildDelegatedAccountSessionBindingHeaderValue, buildDelegatedBrowserProfileHeaderValue } from "../packages/provider-kit/src/index.js";
import { request } from "./api-test-harness.js";

async function listenServer(server, host = "127.0.0.1") {
  await new Promise((resolve) => server.listen(0, host, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("unexpected address");
  return { host, port: addr.port, url: `http://${host}:${addr.port}` };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function registerAgent(api, { tenantId, agentId, capabilities = [], ownerId = "svc_ops_rescue_queue_test" }) {
  const { publicKeyPem } = createEd25519Keypair();
  const created = await request(api, {
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
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(created.statusCode, 201, created.body);
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
  assert.equal(response.statusCode, 201, response.body);
}

async function upsertAgentCard(api, { tenantId, agentId, capabilities, visibility = "public" }) {
  const response = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `agent_card_${tenantId}_${agentId}`
    },
    body: {
      agentId,
      displayName: `Card ${agentId}`,
      capabilities,
      visibility,
      host: { runtime: "nooterra" },
      priceHint: { amountCents: 500, currency: "USD", unit: "task" }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function submitBid(api, { tenantId, rfqId, bidId, bidderAgentId, amountCents, etaSeconds }) {
  const response = await request(api, {
    method: "POST",
    path: `/marketplace/rfqs/${encodeURIComponent(rfqId)}/bids`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `bid_${tenantId}_${bidId}`
    },
    body: {
      bidId,
      bidderAgentId,
      amountCents,
      currency: "USD",
      etaSeconds
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function createPhase1RunNeedingRescue(api, { tenantId, payerAgentId, payeeAgentId, runId, categoryId, taskWallet = null }) {
  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `create_${runId}`
    },
    body: {
      runId,
      taskType: "consumer",
      settlement: {
        payerAgentId,
        amountCents: 1200,
        currency: "USD",
        disputeWindowDays: 5
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const prevChainHash = created.json?.run?.lastChainHash;
  assert.ok(prevChainHash);

  const completed = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `complete_${runId}`,
      "x-proxy-expected-prev-chain-hash": prevChainHash
    },
    body: {
      type: "RUN_COMPLETED",
      payload: {
        outputRef: `evidence://${runId}/output.json`,
        metrics: {
          phase1CompletionState: "booking_confirmed"
        }
      }
    }
  });
  assert.equal(completed.statusCode, 201, completed.body);
  const settlementKey = makeScopedKey({ tenantId, id: runId });
  const storedSettlement = api.store.agentRunSettlements.get(settlementKey);
  assert.ok(storedSettlement, `settlement for ${runId} must exist`);
  api.store.agentRunSettlements.set(
    settlementKey,
    {
      ...storedSettlement,
      decisionTrace: {
        ...(storedSettlement?.decisionTrace && typeof storedSettlement.decisionTrace === "object" ? storedSettlement.decisionTrace : {}),
        bindings: {
          ...(
            storedSettlement?.decisionTrace?.bindings && typeof storedSettlement.decisionTrace.bindings === "object"
              ? storedSettlement.decisionTrace.bindings
              : {}
          ),
          request: {
            sha256: "a".repeat(64)
          }
        }
      }
    }
  );

  const family = getPhase1SupportedTaskFamily(categoryId);
  assert.ok(family, `phase1 family ${categoryId} must exist`);
  api.store.marketplaceRfqs.set(
    makeScopedKey({ tenantId, id: `rfq_${runId}` }),
    {
      schemaVersion: "MarketplaceRfq.v1",
      rfqId: `rfq_${runId}`,
      tenantId,
      runId,
      capability: "capability://consumer.scheduling.booking",
      posterAgentId: payerAgentId,
      status: "closed",
      agreement: {},
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

async function attachRunActionRequiredAccountSessionArtifact(api, {
  tenantId,
  payeeAgentId,
  runId,
  sessionRef,
  providerKey = "amazon",
  siteKey = "amazon.com",
  mode = "approval_at_boundary",
  accountHandleMasked = "user@example.com",
  maxSpendCents = 8000,
  currency = "USD",
  browserProfile = null
} = {}) {
  const runKey = makeScopedKey({ tenantId, id: runId });
  const run = api.store.agentRuns.get(runKey);
  assert.ok(run, `run ${runId} must exist`);
  const evidenceRef = `artifact://runs/${encodeURIComponent(runId)}/responses/${encodeURIComponent("run_action_response_" + runId + "_acct_session_demo")}.json`;
  const artifactId = `run_action_response_${runId}_acct_session_demo`;
  const artifact = {
    schemaVersion: "RunActionRequiredResponseArtifact.v1",
    artifactType: "RunActionRequiredResponseArtifact.v1",
    artifactId,
    artifactHash: "a".repeat(64),
    tenantId,
    runId,
    agentId: payeeAgentId,
    actionRequiredCode: "needs_account_access",
    requestedAt: "2026-03-06T20:31:00.000Z",
    respondedAt: "2026-03-06T20:32:00.000Z",
    requestedFields: ["account_session_ref", "provider_key", "site_key", "execution_mode"],
    requestedEvidenceKinds: [],
    providedFields: {
      account_session_ref: sessionRef,
      provider_key: providerKey,
      site_key: siteKey,
      execution_mode: mode
    },
    providedEvidenceKinds: [],
    evidenceRefs: [],
    note: "Use the delegated consumer account session on file.",
    respondedByPrincipalId: tenantId,
    accountSessionBinding: {
      sessionId: "cas_demo_1",
      sessionRef,
      providerKey,
      siteKey,
      mode,
      accountHandleMasked,
      maxSpendCents,
      currency,
      browserProfile:
        browserProfile ??
        {
          storageStateRef: `state://wallet/${tenantId}/bs_demo_1`,
          loginOrigin: "https://www.amazon.com/",
          startUrl: "https://www.amazon.com/gp/cart/view.html",
          allowedDomains: ["amazon.com", "www.amazon.com"],
          reviewMode: "approval_at_boundary"
        }
    }
  };
  await api.store.putArtifact({ tenantId, artifact });
  api.store.agentRuns.set(runKey, {
    ...run,
    evidenceRefs: Array.from(new Set([...(Array.isArray(run.evidenceRefs) ? run.evidenceRefs : []), evidenceRef])),
    updatedAt: "2026-03-06T20:32:00.000Z"
  });
  return artifact;
}

async function attachRunActionRequiredConsumerConnectorArtifact(api, {
  tenantId,
  payeeAgentId,
  runId,
  connectorId = "cc_calendar_demo",
  provider = "google_calendar",
  kind = "calendar",
  accountAddress = "calendar@example.com",
  timezone = "America/Los_Angeles"
} = {}) {
  const runKey = makeScopedKey({ tenantId, id: runId });
  const run = api.store.agentRuns.get(runKey);
  assert.ok(run, `run ${runId} must exist`);
  const artifactId = `run_action_response_${runId}_connector_demo`;
  const evidenceRef = `artifact://runs/${encodeURIComponent(runId)}/responses/${encodeURIComponent(artifactId)}.json`;
  const artifact = {
    schemaVersion: "RunActionRequiredResponseArtifact.v1",
    artifactType: "RunActionRequiredResponseArtifact.v1",
    artifactId,
    artifactHash: "b".repeat(64),
    tenantId,
    runId,
    agentId: payeeAgentId,
    actionRequiredCode: "needs_calendar_access",
    requestedAt: "2026-03-06T21:31:00.000Z",
    respondedAt: "2026-03-06T21:32:00.000Z",
    requestedFields: ["calendar_connector_ref", "calendar_provider", "calendar_email", "timezone"],
    requestedEvidenceKinds: [],
    providedFields: {
      calendar_connector_ref: `connector://tenants/${encodeURIComponent(tenantId)}/${encodeURIComponent(connectorId)}`,
      calendar_provider: provider,
      calendar_email: accountAddress,
      timezone
    },
    providedEvidenceKinds: [],
    evidenceRefs: [],
    note: "Use my linked calendar connector for the booking follow-up.",
    respondedByPrincipalId: tenantId,
    consumerConnectorBinding: {
      connectorId,
      connectorRef: `connector://tenants/${encodeURIComponent(tenantId)}/${encodeURIComponent(connectorId)}`,
      kind,
      provider,
      accountAddress,
      accountLabel: "Primary calendar",
      timezone
    }
  };
  await api.store.putArtifact({ tenantId, artifact });
  api.store.agentRuns.set(runKey, {
    ...run,
    evidenceRefs: Array.from(new Set([...(Array.isArray(run.evidenceRefs) ? run.evidenceRefs : []), evidenceRef])),
    updatedAt: "2026-03-06T21:32:00.000Z"
  });
  return artifact;
}

async function createPendingApprovalContinuation(api, { tenantId, agentId }) {
  const authorityEnvelope = buildAuthorityEnvelopeV1({
    envelopeId: "aenv_ops_rescue_1",
    actor: { agentId },
    principalRef: { principalType: "human", principalId: "usr_ops_rescue" },
    purpose: "Approve the delegated booking workflow",
    capabilitiesRequested: ["capability://consumer.scheduling.booking"],
    dataClassesRequested: ["calendar"],
    sideEffectsRequested: ["booking_confirmation"],
    spendEnvelope: {
      currency: "USD",
      maxPerCallCents: 0,
      maxTotalCents: 0
    },
    delegationRights: {
      mayDelegate: false,
      maxDepth: 0,
      allowedDelegateeAgentIds: []
    },
    duration: {
      maxDurationSeconds: 1800,
      deadlineAt: "2030-01-01T00:00:00.000Z"
    },
    downstreamRecipients: [agentId],
    reversibilityClass: "partially_reversible",
    riskClass: "medium",
    evidenceRequirements: ["approval_log"],
    createdAt: "2026-03-06T17:00:00.000Z"
  });
  const createdEnvelope = await request(api, {
    method: "POST",
    path: "/authority-envelopes",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "ops_rescue_envelope_1"
    },
    body: authorityEnvelope
  });
  assert.equal(createdEnvelope.statusCode, 201, createdEnvelope.body);

  const createdRequest = await request(api, {
    method: "POST",
    path: "/approval-requests",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "ops_rescue_request_1"
    },
    body: {
      envelopeId: authorityEnvelope.envelopeId,
      requestedBy: agentId,
      requestedAt: "2026-03-06T17:01:00.000Z",
      actionId: "act_ops_rescue_1"
    }
  });
  assert.equal(createdRequest.statusCode, 201, createdRequest.body);
  const approvalRequest = createdRequest.json?.approvalRequest;
  assert.ok(approvalRequest?.requestId);

  const continuation = buildApprovalContinuationV1({
    requestId: approvalRequest.requestId,
    kind: APPROVAL_CONTINUATION_KIND.ROUTER_LAUNCH,
    route: { method: "POST", path: "/router/launch" },
    authorityEnvelope,
    approvalRequest,
    requestBody: {
      text: "Book a dentist appointment next Tuesday afternoon.",
      posterAgentId: agentId,
      scope: "public",
      approvalMode: "require",
      approvalContinuation: { dispatchNow: true }
    },
    requestedBy: approvalRequest.requestedBy,
    status: APPROVAL_CONTINUATION_STATUS.PENDING,
    resume: {
      taskId: "t_schedule",
      rfqId: "rfq_ops_rescue_1",
      workOrderId: null,
      dispatchNow: true,
      approvalPath: `/approvals?requestId=${approvalRequest.requestId}`
    },
    createdAt: "2026-03-06T17:02:00.000Z",
    updatedAt: "2026-03-06T17:02:00.000Z"
  });

  await api.store.putApprovalContinuation({ tenantId, approvalContinuation: continuation });
  return continuation;
}

test("API e2e: ops rescue queue aggregates approval, launch, and run rescue items deterministically", async () => {
  const api = createApi({
    now: () => "2026-03-06T18:00:00.000Z",
    opsTokens: "tok_opsr:ops_read"
  });

  const tenantId = "tenant_ops_rescue_queue";
  const orchestratorAgentId = "agt_ops_rescue_orchestrator";
  const workerAgentId = "agt_ops_rescue_worker";

  await registerAgent(api, {
    tenantId,
    agentId: orchestratorAgentId,
    capabilities: ["capability://workflow.orchestrator"]
  });
  await registerAgent(api, { tenantId, agentId: workerAgentId });
  await creditWallet(api, {
    tenantId,
    agentId: orchestratorAgentId,
    amountCents: 10_000,
    idempotencyKey: "credit_ops_rescue_1"
  });

  const continuation = await createPendingApprovalContinuation(api, {
    tenantId,
    agentId: orchestratorAgentId
  });

  const launched = await request(api, {
    method: "POST",
    path: "/router/launch",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "launch_ops_rescue_1"
    },
    body: {
      text: "Book a dentist appointment next Tuesday afternoon.",
      posterAgentId: orchestratorAgentId,
      metadata: {
        source: "dashboard.network",
        productSurface: "consumer_shell"
      }
    }
  });
  assert.equal(launched.statusCode, 201, launched.body);
  assert.equal(Array.isArray(launched.json?.rfqs), true);
  assert.equal(launched.json?.rfqs?.length, 1, launched.body);

  await createPhase1RunNeedingRescue(api, {
    tenantId,
    payerAgentId: orchestratorAgentId,
    payeeAgentId: workerAgentId,
    runId: "run_ops_rescue_attention",
    categoryId: "scheduling_booking"
  });

  const queue = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?limit=10&offset=0",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsr"
    }
  });
  assert.equal(queue.statusCode, 200, queue.body);
  assert.equal(queue.json?.ok, true);
  assert.equal(queue.json?.rescueQueue?.schemaVersion, "OpsRescueQueue.v1");
  assert.equal(queue.json?.rescueQueue?.total, 3);
  assert.equal(queue.json?.rescueQueue?.counts?.bySourceType?.approval_continuation, 1);
  assert.equal(queue.json?.rescueQueue?.counts?.bySourceType?.router_launch, 1);
  assert.equal(queue.json?.rescueQueue?.counts?.bySourceType?.run, 1);

  const items = Array.isArray(queue.json?.rescueQueue?.queue) ? queue.json.rescueQueue.queue : [];
  assert.equal(items[0]?.sourceType, "run");
  assert.equal(items[0]?.rescueState, "run_attention_required");
  assert.equal(items[0]?.phase1?.categoryId, "scheduling_booking");

  const approvalItem = items.find((row) => row?.sourceType === "approval_continuation");
  assert.ok(approvalItem);
  assert.equal(approvalItem?.refs?.requestId, continuation.requestId);
  assert.equal(approvalItem?.links?.approvals, `/approvals?requestId=${continuation.requestId}`);

  const launchItem = items.find((row) => row?.sourceType === "router_launch");
  assert.ok(launchItem);
  assert.equal(launchItem?.rescueState, "open_no_bids");
  assert.equal(launchItem?.refs?.launchId, launched.json?.launch?.launchId);
  assert.equal(launchItem?.phase1?.categoryId, "scheduling_booking");

  const runItem = items.find((row) => row?.sourceType === "run");
  assert.ok(runItem);
  assert.equal(runItem?.details?.verificationStatus, "red");
  assert.ok(Array.isArray(runItem?.details?.missingEvidence));
  assert.ok(runItem.details.missingEvidence.includes("booking_confirmation"));

  const runOnly = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=run&priority=critical",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsr"
    }
  });
  assert.equal(runOnly.statusCode, 200, runOnly.body);
  assert.equal(runOnly.json?.rescueQueue?.total, 1);
  assert.equal(runOnly.json?.rescueQueue?.queue?.[0]?.sourceType, "run");
  assert.equal(runOnly.json?.rescueQueue?.queue?.[0]?.rescueState, "run_attention_required");

  const invalidSource = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=ops",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsr"
    }
  });
  assert.equal(invalidSource.statusCode, 400);
});

test("API e2e: ops rescue triage persists owner, status, and notes onto rescue items", async () => {
  const api = createApi({
    now: () => "2026-03-06T18:30:00.000Z",
    opsTokens: "tok_opsrw:ops_read,ops_write"
  });

  const tenantId = "tenant_ops_rescue_triage";
  const orchestratorAgentId = "agt_ops_rescue_triage_orchestrator";
  await registerAgent(api, {
    tenantId,
    agentId: orchestratorAgentId,
    capabilities: ["capability://workflow.orchestrator"]
  });
  const continuation = await createPendingApprovalContinuation(api, {
    tenantId,
    agentId: orchestratorAgentId
  });
  const rescueId = `approval:${continuation.requestId}`;

  const triaged = await request(api, {
    method: "POST",
    path: `/ops/network/rescue-queue/${encodeURIComponent(rescueId)}/triage`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    },
    body: {
      status: "acknowledged",
      ownerPrincipalId: "ops.alex",
      notes: "Waiting on the approvals team."
    }
  });
  assert.equal(triaged.statusCode, 200, triaged.body);
  assert.equal(triaged.json?.changed, true);
  assert.equal(triaged.json?.triage?.status, "acknowledged");
  assert.equal(triaged.json?.triage?.ownerPrincipalId, "ops.alex");

  const queue = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=approval_continuation",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queue.statusCode, 200, queue.body);
  assert.equal(queue.json?.rescueQueue?.queue?.[0]?.triage?.status, "acknowledged");
  assert.equal(queue.json?.rescueQueue?.queue?.[0]?.triage?.ownerPrincipalId, "ops.alex");
});

test("API e2e: ops rescue action resumes approved router launch continuations", async () => {
  const api = createApi({
    now: () => "2026-03-06T19:00:00.000Z",
    opsTokens: "tok_opsrw:ops_read,ops_write"
  });

  const tenantId = "tenant_ops_rescue_resume";
  const orchestratorAgentId = "agt_ops_rescue_resume_orchestrator";
  await registerAgent(api, {
    tenantId,
    agentId: orchestratorAgentId,
    capabilities: ["capability://workflow.orchestrator"]
  });
  await creditWallet(api, {
    tenantId,
    agentId: orchestratorAgentId,
    amountCents: 10_000,
    idempotencyKey: "credit_ops_rescue_resume_1"
  });

  const blocked = await request(api, {
    method: "POST",
    path: "/router/launch",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "ops_rescue_resume_blocked_1"
    },
    body: {
      text: "Book a dentist appointment next Tuesday afternoon.",
      posterAgentId: orchestratorAgentId,
      scope: "public",
      approvalMode: "require",
      approvalContinuation: {
        dispatchNow: true
      },
      taskOverrides: {
        t_schedule: {
          rfqId: "rfq_ops_rescue_resume_1"
        }
      }
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  const requestId = blocked.json?.details?.approvalRequest?.requestId;
  assert.ok(requestId);

  const decided = await request(api, {
    method: "POST",
    path: `/approval-inbox/${encodeURIComponent(requestId)}/decide`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "ops_rescue_resume_decide_1"
    },
    body: {
      approved: true,
      decidedBy: "human.ops",
      decidedAt: "2026-03-06T19:01:00.000Z",
      note: "Approved for operator resume",
      evidenceRefs: ["ticket:NOO-ops-rescue-resume-1"]
    }
  });
  assert.equal(decided.statusCode, 201, decided.body);

  const rescueId = `approval:${requestId}`;
  const resumed = await request(api, {
    method: "POST",
    path: `/ops/network/rescue-queue/${encodeURIComponent(rescueId)}/actions`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    },
    body: {
      action: "resume",
      note: "Operator resumed the approved launch."
    }
  });
  assert.equal(resumed.statusCode, 200, resumed.body);
  assert.equal(resumed.json?.triage?.status, "resolved");
  assert.ok(typeof resumed.json?.actionResult?.launch?.launchId === "string" && resumed.json.actionResult.launch.launchId.length > 0);
  assert.equal(resumed.json?.actionResult?.dispatch?.schemaVersion, "RouterMarketplaceDispatch.v1");

  const queue = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=approval_continuation",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queue.statusCode, 200, queue.body);
  assert.equal(queue.json?.rescueQueue?.total, 0);
});

test("API e2e: ops rescue action dispatches ready router launch tasks", async () => {
  const api = createApi({
    now: () => "2026-03-06T19:30:00.000Z",
    opsTokens: "tok_opsrw:ops_read,ops_write"
  });

  const tenantId = "tenant_ops_rescue_dispatch";
  const posterAgentId = "agt_ops_rescue_dispatch_poster";
  const workerAgentId = "agt_ops_rescue_dispatch_worker";
  await registerAgent(api, {
    tenantId,
    agentId: posterAgentId,
    capabilities: ["capability://workflow.orchestrator"]
  });
  await registerAgent(api, {
    tenantId,
    agentId: workerAgentId,
    capabilities: ["capability://consumer.scheduling.booking"]
  });
  await upsertAgentCard(api, {
    tenantId,
    agentId: workerAgentId,
    capabilities: ["capability://consumer.scheduling.booking"]
  });
  await creditWallet(api, {
    tenantId,
    agentId: posterAgentId,
    amountCents: 10_000,
    idempotencyKey: "credit_ops_rescue_dispatch_1"
  });

  const launch = await request(api, {
    method: "POST",
    path: "/router/launch",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "launch_ops_rescue_dispatch_1"
    },
    body: {
      text: "Book a dentist appointment next Tuesday afternoon.",
      posterAgentId
    }
  });
  assert.equal(launch.statusCode, 201, launch.body);
  const launchId = launch.json?.launch?.launchId;
  const rfqId = launch.json?.rfqs?.[0]?.rfqId;
  assert.ok(launchId);
  assert.ok(rfqId);

  await submitBid(api, {
    tenantId,
    rfqId,
    bidId: "bid_ops_rescue_dispatch_1",
    bidderAgentId: workerAgentId,
    amountCents: 1200,
    etaSeconds: 900
  });

  const queueBefore = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=router_launch",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queueBefore.statusCode, 200, queueBefore.body);
  const rescueItem = queueBefore.json?.rescueQueue?.queue?.find((row) => row?.rescueState === "open_ready") ?? null;
  assert.ok(rescueItem);

  const dispatched = await request(api, {
    method: "POST",
    path: `/ops/network/rescue-queue/${encodeURIComponent(rescueItem.rescueId)}/actions`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    },
    body: {
      action: "dispatch",
      note: "Operator dispatched the ready task."
    }
  });
  assert.equal(dispatched.statusCode, 200, dispatched.body);
  assert.equal(dispatched.json?.triage?.status, "resolved");
  assert.equal(dispatched.json?.actionResult?.dispatch?.acceptedCount, 1);
  assert.equal(dispatched.json?.actionResult?.dispatch?.tasks?.[0]?.state, "accepted");

  const queueAfter = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=router_launch",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queueAfter.statusCode, 200, queueAfter.body);
  assert.equal(queueAfter.json?.rescueQueue?.total, 0);
});

test("API e2e: ops rescue action can request additional user input for run rescue items", async () => {
  let nowAt = "2026-03-06T19:00:00.000Z";
  const api = createApi({
    now: () => nowAt,
    opsTokens: "tok_opsrw:ops_read,ops_write"
  });

  const tenantId = "tenant_ops_rescue_request_info";
  const payeeAgentId = "agt_ops_rescue_request_info_payee";
  await registerAgent(api, {
    tenantId,
    agentId: payeeAgentId,
    capabilities: ["capability://consumer.scheduling.booking"]
  });
  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "run_ops_rescue_request_info_create_1"
    },
    body: {
      runId: "run_ops_rescue_request_info_1",
      taskType: "consumer"
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  nowAt = "2026-03-06T21:30:00.000Z";

  const queueBefore = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=run",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queueBefore.statusCode, 200, queueBefore.body);
  const rescueItem = queueBefore.json?.rescueQueue?.queue?.find((row) => row?.refs?.runId === "run_ops_rescue_request_info_1") ?? null;
  assert.ok(rescueItem);
  assert.equal(rescueItem?.rescueState, "run_stalled");

  const requested = await request(api, {
    method: "POST",
    path: `/ops/network/rescue-queue/${encodeURIComponent(rescueItem.rescueId)}/actions`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    },
    body: {
      action: "request_info",
      title: "Need one more thing before booking",
      note: "Please upload the insurance card and confirm the time window.",
      requestedFields: ["calendar_window", "insurance_provider"],
      requestedEvidenceKinds: ["insurance_card"]
    }
  });
  assert.equal(requested.statusCode, 200, requested.body);
  assert.equal(requested.json?.triage?.status, "in_progress");
  assert.equal(requested.json?.actionResult?.action, "request_info");
  assert.equal(requested.json?.actionResult?.event?.type, "RUN_ACTION_REQUIRED");
  assert.deepEqual(requested.json?.actionResult?.requestedFields, ["calendar_window", "insurance_provider"]);
  assert.deepEqual(requested.json?.actionResult?.requestedEvidenceKinds, ["insurance_card"]);
  assert.equal(requested.json?.actionResult?.run?.actionRequired?.title, "Need one more thing before booking");

  const queueAfter = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=run",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queueAfter.statusCode, 200, queueAfter.body);
  const updatedItem = queueAfter.json?.rescueQueue?.queue?.find((row) => row?.refs?.runId === "run_ops_rescue_request_info_1") ?? null;
  assert.ok(updatedItem);
  assert.equal(updatedItem?.rescueState, "run_action_required");
  assert.equal(updatedItem?.details?.actionRequiredCode, "needs_user_input");
});

test("API e2e: ops rescue queue surfaces latest user response bindings for run rescue items", async () => {
  const api = createApi({
    now: () => "2026-03-06T21:30:00.000Z",
    opsTokens: "tok_opsrw:ops_read,ops_write"
  });

  const tenantId = "tenant_ops_rescue_latest_response";
  const payeeAgentId = "agt_ops_rescue_latest_response_payee";
  await registerAgent(api, {
    tenantId,
    agentId: payeeAgentId,
    capabilities: ["capability://consumer.scheduling.booking"]
  });
  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "run_ops_rescue_latest_response_create_1"
    },
    body: {
      runId: "run_ops_rescue_latest_response_1",
      taskType: "consumer"
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const prev = created.json?.run?.lastChainHash;
  const actionRequired = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/run_ops_rescue_latest_response_1/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "run_ops_rescue_latest_response_event_1",
      "x-proxy-expected-prev-chain-hash": prev
    },
    body: {
      type: "RUN_ACTION_REQUIRED",
      payload: {
        code: "needs_calendar_access",
        requestedFields: ["calendar_connector_ref", "calendar_provider", "calendar_email", "timezone"],
        requestedEvidenceKinds: []
      }
    }
  });
  assert.equal(actionRequired.statusCode, 201, actionRequired.body);

  const responseArtifact = await attachRunActionRequiredConsumerConnectorArtifact(api, {
    tenantId,
    payeeAgentId,
    runId: "run_ops_rescue_latest_response_1"
  });

  const queue = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=run",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queue.statusCode, 200, queue.body);
  const rescueItem = queue.json?.rescueQueue?.queue?.find((row) => row?.refs?.runId === "run_ops_rescue_latest_response_1") ?? null;
  assert.ok(rescueItem);
  assert.equal(rescueItem?.details?.latestUserResponse?.artifactId, responseArtifact.artifactId);
  assert.equal(rescueItem?.details?.latestUserResponse?.consumerConnectorBinding?.kind, "calendar");
  assert.equal(rescueItem?.details?.latestUserResponse?.consumerConnectorBinding?.provider, "google_calendar");
});

test("API e2e: ops rescue action can escalate refund handling for run rescue items", async () => {
  const api = createApi({
    now: () => "2026-03-06T20:30:00.000Z",
    opsTokens: "tok_opsrw:ops_read,ops_write"
  });

  const tenantId = "tenant_ops_rescue_refund";
  const payerAgentId = "agt_ops_rescue_refund_payer";
  const payeeAgentId = "agt_ops_rescue_refund_payee";
  await registerAgent(api, {
    tenantId,
    agentId: payerAgentId,
    capabilities: ["capability://workflow.orchestrator"]
  });
  await registerAgent(api, {
    tenantId,
    agentId: payeeAgentId,
    capabilities: ["capability://consumer.scheduling.booking"]
  });
  await creditWallet(api, {
    tenantId,
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "credit_ops_rescue_refund_1"
  });

  await createPhase1RunNeedingRescue(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId: "run_ops_rescue_refund_1",
    categoryId: "scheduling_booking"
  });

  const queueBefore = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=run",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queueBefore.statusCode, 200, queueBefore.body);
  const rescueItem = queueBefore.json?.rescueQueue?.queue?.find((row) => row?.refs?.runId === "run_ops_rescue_refund_1") ?? null;
  assert.ok(rescueItem);
  assert.equal(rescueItem?.details?.settlementStatus, "released");
  assert.ok(typeof rescueItem?.details?.requestBindingSha256 === "string" && rescueItem.details.requestBindingSha256.length > 0);

  const escalated = await request(api, {
    method: "POST",
    path: `/ops/network/rescue-queue/${encodeURIComponent(rescueItem.rescueId)}/actions`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    },
    body: {
      action: "escalate_refund",
      note: "Booking proof is incomplete. Escalate for refund review."
    }
  });
  assert.equal(escalated.statusCode, 200, escalated.body);
  assert.equal(escalated.json?.triage?.status, "in_progress");
  assert.equal(escalated.json?.actionResult?.action, "escalate_refund");
  assert.equal(escalated.json?.actionResult?.dispute?.disputeStatus, "open");
  assert.ok(typeof escalated.json?.actionResult?.disputeId === "string" && escalated.json.actionResult.disputeId.length > 0);
  assert.ok(Array.isArray(escalated.json?.actionResult?.evidenceRefs));
  assert.ok(
    escalated.json.actionResult.evidenceRefs.some((value) => String(value).startsWith("http:request_sha256:")),
    escalated.json?.actionResult?.evidenceRefs
  );

  const settlement = await request(api, {
    method: "GET",
    path: "/runs/run_ops_rescue_refund_1/settlement",
    headers: {
      "x-proxy-tenant-id": tenantId
    }
  });
  assert.equal(settlement.statusCode, 200, settlement.body);
  assert.equal(settlement.json?.settlement?.disputeStatus, "open");
  assert.equal(settlement.json?.settlement?.disputeId, escalated.json?.actionResult?.disputeId);
});

test("API e2e: ops rescue action can recommend a managed reroute specialist for run rescue items", async () => {
  const api = createApi({
    now: () => "2026-03-06T20:30:00.000Z",
    opsTokens: "tok_opsrw:ops_read,ops_write"
  });

  const tenantId = "tenant_ops_rescue_reroute";
  const payerAgentId = "agt_ops_rescue_reroute_payer";
  const payeeAgentId = "agt_ops_rescue_reroute_payee";
  await registerAgent(api, {
    tenantId,
    agentId: payerAgentId,
    capabilities: ["capability://workflow.orchestrator"]
  });
  await registerAgent(api, {
    tenantId,
    agentId: payeeAgentId,
    capabilities: ["capability://consumer.scheduling.booking"]
  });
  await creditWallet(api, {
    tenantId,
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "credit_ops_rescue_reroute_1"
  });

  await createPhase1RunNeedingRescue(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId: "run_ops_rescue_reroute_1",
    categoryId: "scheduling_booking"
  });

  const queueBefore = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=run",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queueBefore.statusCode, 200, queueBefore.body);
  const rescueItem = queueBefore.json?.rescueQueue?.queue?.find((row) => row?.refs?.runId === "run_ops_rescue_reroute_1") ?? null;
  assert.ok(rescueItem);
  const bookingCandidate =
    Array.isArray(rescueItem?.details?.managedSpecialistCandidates)
      ? rescueItem.details.managedSpecialistCandidates.find((row) => row?.profileId === "booking_concierge")
      : null;
  assert.ok(bookingCandidate, rescueItem?.details?.managedSpecialistCandidates);

  const rerouted = await request(api, {
    method: "POST",
    path: `/ops/network/rescue-queue/${encodeURIComponent(rescueItem.rescueId)}/actions`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    },
    body: {
      action: "recommend_reroute",
      targetProfileId: "booking_concierge",
      note: "Prefer the managed booking specialist for this recovery path."
    }
  });
  assert.equal(rerouted.statusCode, 200, rerouted.body);
  assert.equal(rerouted.json?.triage?.status, "in_progress");
  assert.equal(rerouted.json?.actionResult?.action, "recommend_reroute");
  assert.equal(rerouted.json?.actionResult?.targetProfileId, "booking_concierge");
  assert.equal(rerouted.json?.actionResult?.recommendedSpecialist?.profileId, "booking_concierge");
  assert.equal(rerouted.json?.triage?.metadata?.targetProfileId, "booking_concierge");
});

test("API e2e: ops rescue queue exposes handoff-ready managed provider candidates for delegated-session runs", async () => {
  const api = createApi({
    now: () => "2026-03-06T20:35:00.000Z",
    opsTokens: "tok_opsrw:ops_read,ops_write"
  });

  const tenantId = "tenant_ops_rescue_handoff";
  const payerAgentId = "agt_ops_rescue_handoff_payer";
  const payeeAgentId = "agt_ops_rescue_handoff_payee";
  await registerAgent(api, {
    tenantId,
    agentId: payerAgentId,
    capabilities: ["capability://workflow.orchestrator"]
  });
  await registerAgent(api, {
    tenantId,
    agentId: payeeAgentId,
    capabilities: ["capability://consumer.scheduling.booking"]
  });
  await creditWallet(api, {
    tenantId,
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "credit_ops_rescue_handoff_1"
  });

  await createPhase1RunNeedingRescue(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId: "run_ops_rescue_handoff_1",
    categoryId: "scheduling_booking"
  });
  const boundArtifact = await attachRunActionRequiredAccountSessionArtifact(api, {
    tenantId,
    payeeAgentId,
    runId: "run_ops_rescue_handoff_1",
    sessionRef: `accountsession://tenants/${tenantId}/cas_booking_demo`,
    providerKey: "amazon",
    siteKey: "amazon.com",
    mode: "approval_at_boundary"
  });

  api.store.marketplaceProviderPublications.set(
    makeScopedKey({ tenantId, id: "jwk:provider_booking_demo" }),
    {
      schemaVersion: "MarketplaceProviderPublication.v1",
      publicationId: "pub_booking_demo_1",
      tenantId,
      providerId: "provider_booking_demo",
      providerRef: "jwk:provider_booking_demo",
      status: "certified",
      certified: true,
      baseUrl: "https://provider.booking.example",
      description: "Certified booking specialist runtime.",
      tags: ["phase1", "booking"],
      manifestSchemaVersion: "PaidToolManifest.v2",
      manifestHash: "b".repeat(64),
      manifest: {
        schemaVersion: "PaidToolManifest.v2",
        providerId: "provider_booking_demo",
        upstreamBaseUrl: "https://provider.booking.example",
        defaults: {
          amountCents: 480,
          currency: "USD",
          idempotency: "side_effecting",
          signatureMode: "required",
          toolClass: "action",
          riskLevel: "medium",
          requiredSignatures: ["output"],
          requestBinding: "strict"
        },
        tools: [
          {
            toolId: "tool_booking_concierge",
            mcpToolName: "booking.conceirge",
            description: "Delegated booking checkout surface",
            method: "POST",
            paidPath: "/paid/booking",
            upstreamPath: "/invoke",
            pricing: { amountCents: 480, currency: "USD" },
            auth: { mode: "none" },
            toolClass: "action",
            riskLevel: "medium",
            security: {
              requiredSignatures: ["output"],
              requestBinding: "strict"
            },
            metadata: {
              phase1ManagedNetwork: {
                profileId: "booking_concierge",
                executionAdapter: {
                  schemaVersion: "Phase1ExecutionAdapter.v1",
                  adapterId: "delegated_account_session_booking",
                  mode: "delegated_account_session",
                  requiresDelegatedAccountSession: true,
                  supportedSessionModes: ["browser_delegated", "approval_at_boundary", "operator_supervised"],
                  requiredRunFields: ["account_session_ref", "provider_key", "site_key", "execution_mode"],
                  merchantScope: "booking_travel",
                  reviewPolicy: "allow autonomous slot selection inside approved constraints, but keep final booking bounded by the stored review mode"
                }
              }
            }
          }
        ]
      },
      publishedAt: "2026-03-06T20:20:00.000Z",
      certifiedAt: "2026-03-06T20:21:00.000Z",
      updatedAt: "2026-03-06T20:22:00.000Z"
    }
  );

  const queueBefore = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=run",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queueBefore.statusCode, 200, queueBefore.body);
  const rescueItem = queueBefore.json?.rescueQueue?.queue?.find((row) => row?.refs?.runId === "run_ops_rescue_handoff_1") ?? null;
  assert.ok(rescueItem);
  const bookingCandidate =
    Array.isArray(rescueItem?.details?.managedSpecialistCandidates)
      ? rescueItem.details.managedSpecialistCandidates.find((row) => row?.profileId === "booking_concierge")
      : null;
  assert.ok(bookingCandidate);
  assert.equal(bookingCandidate?.handoffReady, true);
  assert.ok(Array.isArray(bookingCandidate?.providerCandidates));
  assert.equal(bookingCandidate.providerCandidates.length, 1);
  assert.equal(bookingCandidate.providerCandidates[0]?.handoffReady, true);
  assert.equal(
    bookingCandidate.providerCandidates[0]?.requestHeaders?.["x-nooterra-account-session-binding"],
    buildDelegatedAccountSessionBindingHeaderValue(boundArtifact.accountSessionBinding)
  );
  assert.ok(typeof bookingCandidate.providerCandidates[0]?.requestHeaders?.["x-nooterra-account-session-browser-profile"] === "string");

  const rerouted = await request(api, {
    method: "POST",
    path: `/ops/network/rescue-queue/${encodeURIComponent(rescueItem.rescueId)}/actions`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    },
    body: {
      action: "recommend_reroute",
      targetProfileId: "booking_concierge",
      note: "Prefer the certified managed booking specialist."
    }
  });
  assert.equal(rerouted.statusCode, 200, rerouted.body);
  assert.equal(rerouted.json?.actionResult?.managedExecution?.ready, true);
  assert.equal(rerouted.json?.actionResult?.managedExecution?.candidateCount, 1);
  assert.equal(rerouted.json?.actionResult?.managedExecution?.providerCandidate?.providerId, "provider_booking_demo");
  assert.equal(
    rerouted.json?.actionResult?.managedExecution?.providerCandidate?.requestHeaders?.["x-nooterra-account-session-binding"],
    buildDelegatedAccountSessionBindingHeaderValue(boundArtifact.accountSessionBinding)
  );
  assert.ok(typeof rerouted.json?.actionResult?.managedExecution?.providerCandidate?.requestHeaders?.["x-nooterra-account-session-browser-profile"] === "string");
});

test("API e2e: managed reroute fails closed when the task wallet blocks the provider merchant scope", async () => {
  const api = createApi({
    now: () => "2026-03-06T20:36:00.000Z",
    opsTokens: "tok_opsrw:ops_read,ops_write"
  });

  const tenantId = "tenant_ops_rescue_wallet_guard";
  const payerAgentId = "agt_ops_rescue_wallet_guard_payer";
  const payeeAgentId = "agt_ops_rescue_wallet_guard_payee";
  await registerAgent(api, {
    tenantId,
    agentId: payerAgentId,
    capabilities: ["capability://workflow.orchestrator"]
  });
  await registerAgent(api, {
    tenantId,
    agentId: payeeAgentId,
    capabilities: ["capability://consumer.scheduling.booking"]
  });
  await creditWallet(api, {
    tenantId,
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "credit_ops_rescue_wallet_guard_1"
  });

  const blockedTaskWallet = buildTaskWalletV1({
    walletId: "twal_ops_rescue_wallet_guard_1",
    tenantId,
    launchId: "rlaunch_ops_rescue_wallet_guard_1",
    taskId: "task_ops_rescue_wallet_guard_1",
    rfqId: "rfq_run_ops_rescue_wallet_guard_1",
    ownerAgentId: payerAgentId,
    categoryId: "scheduling_booking",
    currency: "USD",
    maxSpendCents: 4_000,
    evidenceRequirements: ["booking_confirmation"],
    createdAt: "2026-03-06T20:36:00.000Z"
  });
  blockedTaskWallet.allowedMerchantScopes = ["consumer_commerce"];

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "create_run_ops_rescue_wallet_guard_1"
    },
    body: {
      runId: "run_ops_rescue_wallet_guard_1",
      taskType: "consumer",
      settlement: {
        payerAgentId,
        amountCents: 1200,
        currency: "USD",
        disputeWindowDays: 5
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const prevChainHash = created.json?.run?.lastChainHash;
  assert.ok(prevChainHash);

  const actionRequired = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent("run_ops_rescue_wallet_guard_1")}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "action_required_run_ops_rescue_wallet_guard_1",
      "x-proxy-expected-prev-chain-hash": prevChainHash
    },
    body: {
      type: "RUN_ACTION_REQUIRED",
      payload: {
        code: "needs_account_access",
        title: "Need booking account access",
        detail: "Provide the delegated booking account session.",
        requestedFields: ["account_session_ref", "provider_key", "site_key", "execution_mode"]
      }
    }
  });
  assert.equal(actionRequired.statusCode, 201, actionRequired.body);
  const family = getPhase1SupportedTaskFamily("scheduling_booking");
  api.store.marketplaceRfqs.set(
    makeScopedKey({ tenantId, id: "rfq_run_ops_rescue_wallet_guard_1" }),
    {
      schemaVersion: "MarketplaceRfq.v1",
      rfqId: "rfq_run_ops_rescue_wallet_guard_1",
      tenantId,
      runId: "run_ops_rescue_wallet_guard_1",
      capability: "capability://consumer.scheduling.booking",
      posterAgentId: payerAgentId,
      status: "assigned",
      agreement: {},
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
          launchId: "rlaunch_ops_rescue_wallet_guard_1",
          taskId: "task_ops_rescue_wallet_guard_1",
          taskWallet: blockedTaskWallet
        }
      }
    }
  );
  await attachRunActionRequiredAccountSessionArtifact(api, {
    tenantId,
    payeeAgentId,
    runId: "run_ops_rescue_wallet_guard_1",
    sessionRef: `accountsession://tenants/${tenantId}/cas_booking_wallet_guard`,
    providerKey: "booking",
    siteKey: "booking.example.com",
    mode: "approval_at_boundary"
  });

  api.store.marketplaceProviderPublications.set(
    makeScopedKey({ tenantId, id: "jwk:provider_booking_wallet_guard" }),
    {
      schemaVersion: "MarketplaceProviderPublication.v1",
      publicationId: "pub_booking_wallet_guard_1",
      tenantId,
      providerId: "provider_booking_wallet_guard",
      providerRef: "jwk:provider_booking_wallet_guard",
      status: "certified",
      certified: true,
      baseUrl: "https://provider.booking.example",
      description: "Certified booking specialist runtime.",
      tags: ["phase1", "booking"],
      manifestSchemaVersion: "PaidToolManifest.v2",
      manifestHash: "c".repeat(64),
      manifest: {
        schemaVersion: "PaidToolManifest.v2",
        providerId: "provider_booking_wallet_guard",
        upstreamBaseUrl: "https://provider.booking.example",
        defaults: {
          amountCents: 480,
          currency: "USD",
          idempotency: "side_effecting",
          signatureMode: "required",
          toolClass: "action",
          riskLevel: "medium",
          requiredSignatures: ["output"],
          requestBinding: "strict"
        },
        tools: [
          {
            toolId: "tool_booking_wallet_guard",
            mcpToolName: "booking.guard",
            description: "Delegated booking checkout surface",
            method: "POST",
            paidPath: "/paid/booking",
            upstreamPath: "/invoke",
            pricing: { amountCents: 480, currency: "USD" },
            auth: { mode: "none" },
            toolClass: "action",
            riskLevel: "medium",
            security: {
              requiredSignatures: ["output"],
              requestBinding: "strict"
            },
            metadata: {
              phase1ManagedNetwork: {
                profileId: "booking_concierge",
                executionAdapter: {
                  schemaVersion: "Phase1ExecutionAdapter.v1",
                  adapterId: "delegated_account_session_booking",
                  mode: "delegated_account_session",
                  requiresDelegatedAccountSession: true,
                  supportedSessionModes: ["browser_delegated", "approval_at_boundary", "operator_supervised"],
                  requiredRunFields: ["account_session_ref", "provider_key", "site_key", "execution_mode"],
                  merchantScope: "booking_travel",
                  reviewPolicy: "allow autonomous slot selection inside approved constraints, but keep final booking bounded by the stored review mode"
                }
              }
            }
          }
        ]
      },
      publishedAt: "2026-03-06T20:20:00.000Z",
      certifiedAt: "2026-03-06T20:21:00.000Z",
      updatedAt: "2026-03-06T20:22:00.000Z"
    }
  );

  const queue = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=run",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queue.statusCode, 200, queue.body);
  const rescueItem = queue.json?.rescueQueue?.queue?.find((row) => row?.refs?.runId === "run_ops_rescue_wallet_guard_1") ?? null;
  assert.ok(rescueItem);
  const bookingCandidate =
    Array.isArray(rescueItem?.details?.managedSpecialistCandidates)
      ? rescueItem.details.managedSpecialistCandidates.find((row) => row?.profileId === "booking_concierge")
      : null;
  assert.ok(bookingCandidate);
  assert.equal(bookingCandidate?.handoffReady, false);
  assert.equal(bookingCandidate?.providerCandidates?.[0]?.handoffReady, false);
  assert.equal(bookingCandidate?.providerCandidates?.[0]?.handoffCode, "TASK_WALLET_SCOPE_BLOCKED");

  const directHandoff = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent("run_ops_rescue_wallet_guard_1")}/managed-execution/handoff`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw",
      "x-nooterra-protocol": "1.0",
      "x-idempotency-key": "run_wallet_guard_handoff_1"
    },
    body: {
      targetProfileId: "booking_concierge",
      targetProviderId: "provider_booking_wallet_guard",
      targetToolId: "tool_booking_wallet_guard"
    }
  });
  assert.equal(directHandoff.statusCode, 409, directHandoff.body);
  assert.equal(directHandoff.json?.code, "RUN_MANAGED_HANDOFF_NOT_READY");
});

test("API e2e: recommend_reroute auto-handoffs when the selected managed provider is already handoff-ready", async (t) => {
  const api = createApi({
    now: () => "2026-03-06T20:37:00.000Z",
    opsTokens: "tok_opsrw:ops_read,ops_write"
  });

  const tenantId = "tenant_ops_rescue_auto_handoff";
  const payerAgentId = "agt_ops_rescue_auto_handoff_payer";
  const payeeAgentId = "agt_ops_rescue_auto_handoff_payee";
  await registerAgent(api, {
    tenantId,
    agentId: payerAgentId,
    capabilities: ["capability://workflow.orchestrator"]
  });
  await registerAgent(api, {
    tenantId,
    agentId: payeeAgentId,
    capabilities: ["capability://consumer.scheduling.booking"]
  });
  await creditWallet(api, {
    tenantId,
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "credit_ops_rescue_auto_handoff_1"
  });

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "create_run_ops_rescue_auto_handoff_1"
    },
    body: {
      runId: "run_ops_rescue_auto_handoff_1",
      taskType: "consumer",
      settlement: {
        payerAgentId,
        amountCents: 1200,
        currency: "USD",
        disputeWindowDays: 5
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const prevChainHash = created.json?.run?.lastChainHash;
  assert.ok(prevChainHash);
  const actionRequired = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent("run_ops_rescue_auto_handoff_1")}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "action_required_ops_rescue_auto_handoff_1",
      "x-proxy-expected-prev-chain-hash": prevChainHash
    },
    body: {
      type: "RUN_ACTION_REQUIRED",
      payload: {
        runId: "run_ops_rescue_auto_handoff_1",
        code: "needs_account_access",
        title: "Need booking account access",
        detail: "Provide the delegated booking account session.",
        requestedFields: ["account_session_ref", "provider_key", "site_key", "execution_mode"]
      }
    }
  });
  assert.equal(actionRequired.statusCode, 201, actionRequired.body);
  const family = getPhase1SupportedTaskFamily("scheduling_booking");
  api.store.marketplaceRfqs.set(
    makeScopedKey({ tenantId, id: "rfq_run_ops_rescue_auto_handoff_1" }),
    {
      schemaVersion: "MarketplaceRfq.v1",
      rfqId: "rfq_run_ops_rescue_auto_handoff_1",
      tenantId,
      runId: "run_ops_rescue_auto_handoff_1",
      capability: "capability://consumer.scheduling.booking",
      posterAgentId: payerAgentId,
      status: "assigned",
      agreement: {},
      metadata: {
        phase1Launch: {
          schemaVersion: "Phase1LaunchContract.v1",
          productSurface: "consumer_shell",
          categoryId: family.categoryId,
          categoryLabel: family.label,
          categorySummary: family.summary,
          completionContract: family.completionContract
        }
      }
    }
  );
  const boundArtifact = await attachRunActionRequiredAccountSessionArtifact(api, {
    tenantId,
    payeeAgentId,
    runId: "run_ops_rescue_auto_handoff_1",
    sessionRef: `accountsession://tenants/${tenantId}/cas_booking_auto`,
    providerKey: "amazon",
    siteKey: "amazon.com",
    mode: "approval_at_boundary"
  });

  const providerSigner = createEd25519Keypair();
  const providerSignerKeyId = keyIdFromPublicKeyPem(providerSigner.publicKeyPem);
  let expectedAccountSessionBinding = "";
  const providerServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/paid/booking") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      req.on("end", () => {
        const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
        if (!authorization) {
          const challenge = "amountCents=480; currency=USD; providerId=provider_booking_auto; toolId=tool_booking_auto; address=nooterra:provider; network=nooterra; requestBindingMode=strict";
          res.writeHead(402, {
            "content-type": "application/json; charset=utf-8",
            "x-payment-required": challenge,
            "payment-required": challenge
          });
          res.end(JSON.stringify({ ok: false, error: "payment_required" }));
          return;
        }
        if (!authorization.startsWith("NooterraPay ")) {
          res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "invalid_authorization" }));
          return;
        }
        const delegatedSessionHeader =
          typeof req.headers["x-nooterra-account-session-binding"] === "string"
            ? req.headers["x-nooterra-account-session-binding"].trim()
            : "";
        if (delegatedSessionHeader !== expectedAccountSessionBinding) {
          res.writeHead(409, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "delegated_session_binding_mismatch" }));
          return;
        }
        const bodyBuffer = Buffer.concat(chunks);
        const requestBindingSha256 = computeNooterraPayRequestBindingSha256V1({
          method: String(req.method ?? "POST").toUpperCase(),
          host: String(req.headers.host ?? "").trim().toLowerCase(),
          pathWithQuery: url.pathname + url.search,
          bodySha256: sha256Hex(bodyBuffer)
        });
        const responseBodyBuffer = Buffer.from(JSON.stringify({ ok: true, bookingId: "bk_auto_handoff_1" }), "utf8");
        const responseHash = sha256Hex(responseBodyBuffer);
        const signedAt = "2026-03-06T20:37:30.000Z";
        const nonce = "abcdef0123456789abcdef0123456789";
        const signature = signToolProviderSignatureV1({
          responseHash,
          nonce,
          signedAt,
          publicKeyPem: providerSigner.publicKeyPem,
          privateKeyPem: providerSigner.privateKeyPem
        });
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "x-nooterra-provider-key-id": signature.keyId,
          "x-nooterra-provider-signed-at": signature.signedAt,
          "x-nooterra-provider-nonce": signature.nonce,
          "x-nooterra-provider-response-sha256": signature.responseHash,
          "x-nooterra-provider-signature": signature.signatureBase64,
          "x-nooterra-request-binding-mode": "strict",
          "x-nooterra-request-binding-sha256": requestBindingSha256,
          "x-nooterra-account-session-mode": "approval_at_boundary",
          "x-nooterra-account-session-provider": "amazon",
          "x-nooterra-account-session-site": "amazon.com"
        });
        res.end(responseBodyBuffer);
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });
  const providerAddr = await listenServer(providerServer);
  t.after(async () => {
    await closeServer(providerServer);
  });

  api.store.marketplaceProviderPublications.set(
    makeScopedKey({ tenantId, id: "jwk:provider_booking_auto" }),
    {
      schemaVersion: "MarketplaceProviderPublication.v1",
      publicationId: "pub_booking_auto_1",
      tenantId,
      providerId: "provider_booking_auto",
      providerRef: "jwk:provider_booking_auto",
      status: "certified",
      certified: true,
      baseUrl: providerAddr.url,
      description: "Certified booking specialist runtime.",
      tags: ["phase1", "booking"],
      manifestSchemaVersion: "PaidToolManifest.v2",
      manifestHash: "c".repeat(64),
      providerSigning: {
        schemaVersion: "ProviderSigning.v1",
        keyId: providerSignerKeyId,
        publicKeyPem: providerSigner.publicKeyPem
      },
      manifest: {
        schemaVersion: "PaidToolManifest.v2",
        providerId: "provider_booking_auto",
        upstreamBaseUrl: providerAddr.url,
        defaults: {
          amountCents: 480,
          currency: "USD",
          idempotency: "side_effecting",
          signatureMode: "required",
          toolClass: "action",
          riskLevel: "medium",
          requiredSignatures: ["output"],
          requestBinding: "strict"
        },
        tools: [
          {
            toolId: "tool_booking_auto",
            description: "Delegated booking execution",
            method: "POST",
            paidPath: "/paid/booking",
            upstreamPath: "/invoke",
            pricing: { amountCents: 480, currency: "USD" },
            auth: { mode: "none" },
            toolClass: "action",
            riskLevel: "medium",
            security: { requiredSignatures: ["output"], requestBinding: "strict" },
            metadata: {
              phase1ManagedNetwork: {
                profileId: "booking_concierge",
                executionAdapter: {
                  schemaVersion: "Phase1ExecutionAdapter.v1",
                  adapterId: "delegated_account_session_booking",
                  mode: "delegated_account_session",
                  requiresDelegatedAccountSession: true,
                  supportedSessionModes: ["browser_delegated", "approval_at_boundary", "operator_supervised"],
                  requiredRunFields: ["account_session_ref", "provider_key", "site_key", "execution_mode"],
                  merchantScope: "booking_travel",
                  reviewPolicy: "allow autonomous slot selection inside approved constraints, but keep final booking bounded by the stored review mode"
                }
              }
            }
          }
        ]
      },
      publishedAt: "2026-03-06T20:20:00.000Z",
      certifiedAt: "2026-03-06T20:21:00.000Z",
      updatedAt: "2026-03-06T20:22:00.000Z"
    }
  );
  expectedAccountSessionBinding = buildDelegatedAccountSessionBindingHeaderValue(boundArtifact.accountSessionBinding);

  const queue = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=run",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queue.statusCode, 200, queue.body);
  const rescueItem = queue.json?.rescueQueue?.queue?.find((row) => row?.refs?.runId === "run_ops_rescue_auto_handoff_1") ?? null;
  assert.ok(rescueItem);

  const rerouted = await request(api, {
    method: "POST",
    path: `/ops/network/rescue-queue/${encodeURIComponent(rescueItem.rescueId)}/actions`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    },
    body: {
      action: "recommend_reroute",
      targetProfileId: "booking_concierge",
      targetProviderId: "provider_booking_auto",
      targetProviderRef: "jwk:provider_booking_auto",
      targetToolId: "tool_booking_auto",
      autoHandoff: true,
      note: "Reroute immediately because the certified booking provider is handoff-ready."
    }
  });
  assert.equal(rerouted.statusCode, 200, rerouted.body);
  assert.equal(rerouted.json?.actionResult?.action, "recommend_reroute");
  assert.equal(rerouted.json?.actionResult?.managedExecution?.ready, true);
  assert.equal(rerouted.json?.actionResult?.managedProviderInvocation?.providerId, "provider_booking_auto");
  assert.equal(rerouted.json?.actionResult?.invocationArtifact?.providerSignature?.verified, true);
  assert.equal(
    rerouted.json?.actionResult?.managedExecution?.providerCandidate?.requestHeaders?.["x-nooterra-account-session-binding"],
    buildDelegatedAccountSessionBindingHeaderValue(boundArtifact.accountSessionBinding)
  );
});

test("API e2e: ops rescue action can hand off a non-terminal run to a handoff-ready managed provider", async (t) => {
  const api = createApi({
    now: () => "2026-03-06T20:40:00.000Z",
    opsTokens: "tok_opsrw:ops_read,ops_write"
  });

  const tenantId = "tenant_ops_rescue_handoff_execute";
  const payerAgentId = "agt_ops_rescue_handoff_execute_payer";
  const payeeAgentId = "agt_ops_rescue_handoff_execute_payee";
  await registerAgent(api, {
    tenantId,
    agentId: payerAgentId,
    capabilities: ["capability://workflow.orchestrator"]
  });
  await registerAgent(api, {
    tenantId,
    agentId: payeeAgentId,
    capabilities: ["capability://consumer.scheduling.booking"]
  });
  await creditWallet(api, {
    tenantId,
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "credit_ops_rescue_handoff_execute_1"
  });
  const providerSigner = createEd25519Keypair();
  const providerSignerKeyId = keyIdFromPublicKeyPem(providerSigner.publicKeyPem);
  let expectedAccountSessionBinding = "";
  const providerServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/paid/booking") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      req.on("end", () => {
        const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
        if (!authorization) {
          const challenge = "amountCents=480; currency=USD; providerId=provider_booking_exec; toolId=tool_booking_exec; address=nooterra:provider; network=nooterra; requestBindingMode=strict";
          res.writeHead(402, {
            "content-type": "application/json; charset=utf-8",
            "x-payment-required": challenge,
            "payment-required": challenge
          });
          res.end(JSON.stringify({ ok: false, error: "payment_required" }));
          return;
        }
        if (!authorization.startsWith("NooterraPay ")) {
          res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "invalid_authorization" }));
          return;
        }
        const delegatedSessionHeader =
          typeof req.headers["x-nooterra-account-session-binding"] === "string"
            ? req.headers["x-nooterra-account-session-binding"].trim()
            : "";
        if (delegatedSessionHeader !== expectedAccountSessionBinding) {
          res.writeHead(409, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "delegated_session_binding_mismatch" }));
          return;
        }
        const bodyBuffer = Buffer.concat(chunks);
        const requestBindingSha256 = computeNooterraPayRequestBindingSha256V1({
          method: String(req.method ?? "POST").toUpperCase(),
          host: String(req.headers.host ?? "").trim().toLowerCase(),
          pathWithQuery: url.pathname + url.search,
          bodySha256: sha256Hex(bodyBuffer)
        });
        const responseBodyBuffer = Buffer.from(JSON.stringify({ ok: true, bookingId: "bk_managed_provider_1" }), "utf8");
        const responseHash = sha256Hex(responseBodyBuffer);
        const signedAt = "2026-03-06T20:40:30.000Z";
        const nonce = "abcdef0123456789abcdef0123456789";
        const signature = signToolProviderSignatureV1({
          responseHash,
          nonce,
          signedAt,
          publicKeyPem: providerSigner.publicKeyPem,
          privateKeyPem: providerSigner.privateKeyPem
        });
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "x-nooterra-provider-key-id": signature.keyId,
          "x-nooterra-provider-signed-at": signature.signedAt,
          "x-nooterra-provider-nonce": signature.nonce,
          "x-nooterra-provider-response-sha256": signature.responseHash,
          "x-nooterra-provider-signature": signature.signatureBase64,
          "x-nooterra-request-binding-mode": "strict",
          "x-nooterra-request-binding-sha256": requestBindingSha256,
          "x-nooterra-account-session-mode": "approval_at_boundary",
          "x-nooterra-account-session-provider": "amazon",
          "x-nooterra-account-session-site": "amazon.com"
        });
        res.end(responseBodyBuffer);
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });
  const providerAddr = await listenServer(providerServer);
  t.after(async () => {
    await closeServer(providerServer);
  });

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "create_run_ops_rescue_handoff_execute_1"
    },
    body: {
      runId: "run_ops_rescue_handoff_execute_1",
      taskType: "consumer",
      settlement: {
        payerAgentId,
        amountCents: 1200,
        currency: "USD",
        disputeWindowDays: 5
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const prevChainHash = created.json?.run?.lastChainHash;
  assert.ok(prevChainHash);
  const actionRequired = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent("run_ops_rescue_handoff_execute_1")}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "action_required_ops_rescue_handoff_execute_1",
      "x-proxy-expected-prev-chain-hash": prevChainHash
    },
    body: {
      type: "RUN_ACTION_REQUIRED",
      payload: {
        runId: "run_ops_rescue_handoff_execute_1",
        code: "needs_account_access",
        title: "Need booking account access",
        detail: "Provide the delegated booking account session.",
        requestedFields: ["account_session_ref", "provider_key", "site_key", "execution_mode"]
      }
    }
  });
  assert.equal(actionRequired.statusCode, 201, actionRequired.body);

  const family = getPhase1SupportedTaskFamily("scheduling_booking");
  api.store.marketplaceRfqs.set(
    makeScopedKey({ tenantId, id: "rfq_run_ops_rescue_handoff_execute_1" }),
    {
      schemaVersion: "MarketplaceRfq.v1",
      rfqId: "rfq_run_ops_rescue_handoff_execute_1",
      tenantId,
      runId: "run_ops_rescue_handoff_execute_1",
      capability: "capability://consumer.scheduling.booking",
      posterAgentId: payerAgentId,
      status: "assigned",
      agreement: {},
      metadata: {
        phase1Launch: {
          schemaVersion: "Phase1LaunchContract.v1",
          productSurface: "consumer_shell",
          categoryId: family.categoryId,
          categoryLabel: family.label,
          categorySummary: family.summary,
          completionContract: family.completionContract
        }
      }
    }
  );
  const boundArtifact = await attachRunActionRequiredAccountSessionArtifact(api, {
    tenantId,
    payeeAgentId,
    runId: "run_ops_rescue_handoff_execute_1",
    sessionRef: `accountsession://tenants/${tenantId}/cas_booking_exec`,
    providerKey: "amazon",
    siteKey: "amazon.com",
    mode: "approval_at_boundary"
  });
  expectedAccountSessionBinding = buildDelegatedAccountSessionBindingHeaderValue(boundArtifact.accountSessionBinding);
  api.store.marketplaceProviderPublications.set(
    makeScopedKey({ tenantId, id: "jwk:provider_booking_exec" }),
    {
      schemaVersion: "MarketplaceProviderPublication.v1",
      publicationId: "pub_booking_exec_1",
      tenantId,
      providerId: "provider_booking_exec",
      providerRef: "jwk:provider_booking_exec",
      status: "certified",
      certified: true,
      baseUrl: providerAddr.url,
      description: "Certified booking execution provider.",
      tags: ["phase1", "booking"],
      manifestSchemaVersion: "PaidToolManifest.v2",
      manifestHash: "c".repeat(64),
      providerSigning: {
        algorithm: "ed25519",
        keyId: providerSignerKeyId,
        publicKeyPem: providerSigner.publicKeyPem
      },
      manifest: {
        schemaVersion: "PaidToolManifest.v2",
        providerId: "provider_booking_exec",
        upstreamBaseUrl: providerAddr.url,
        defaults: {
          amountCents: 480,
          currency: "USD",
          idempotency: "side_effecting",
          signatureMode: "required",
          toolClass: "action",
          riskLevel: "medium",
          requiredSignatures: ["output"],
          requestBinding: "strict"
        },
        tools: [
          {
            toolId: "tool_booking_exec",
            description: "Delegated booking execution",
            method: "POST",
            paidPath: "/paid/booking",
            upstreamPath: "/invoke",
            pricing: { amountCents: 480, currency: "USD" },
            auth: { mode: "none" },
            toolClass: "action",
            riskLevel: "medium",
            security: { requiredSignatures: ["output"], requestBinding: "strict" },
            metadata: {
              phase1ManagedNetwork: {
                profileId: "booking_concierge",
                executionAdapter: {
                  schemaVersion: "Phase1ExecutionAdapter.v1",
                  adapterId: "delegated_account_session_booking",
                  mode: "delegated_account_session",
                  requiresDelegatedAccountSession: true,
                  supportedSessionModes: ["browser_delegated", "approval_at_boundary", "operator_supervised"],
                  requiredRunFields: ["account_session_ref", "provider_key", "site_key", "execution_mode"],
                  merchantScope: "booking_travel",
                  reviewPolicy: "allow autonomous slot selection inside approved constraints, but keep final booking bounded by the stored review mode"
                }
              }
            }
          }
        ]
      },
      publishedAt: "2026-03-06T20:20:00.000Z",
      certifiedAt: "2026-03-06T20:21:00.000Z",
      updatedAt: "2026-03-06T20:22:00.000Z"
    }
  );

  const queue = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=run",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queue.statusCode, 200, queue.body);
  const rescueItem = queue.json?.rescueQueue?.queue?.find((row) => row?.refs?.runId === "run_ops_rescue_handoff_execute_1") ?? null;
  assert.ok(rescueItem);
  const rescueSpecialist =
    rescueItem?.details?.managedSpecialistCandidates?.find((row) => row?.profileId === "booking_concierge") ?? null;
  assert.ok(rescueSpecialist);
  const rescueProviderCandidate =
    rescueSpecialist?.providerCandidates?.find((row) => row?.providerId === "provider_booking_exec" && row?.toolId === "tool_booking_exec") ?? null;
  assert.ok(rescueProviderCandidate);
  assert.equal(rescueProviderCandidate?.providerSigning?.keyId, providerSignerKeyId);
  assert.equal(rescueProviderCandidate?.providerSigning?.publicKeyPem, providerSigner.publicKeyPem);

  const handedOff = await request(api, {
    method: "POST",
    path: `/ops/network/rescue-queue/${encodeURIComponent(rescueItem.rescueId)}/actions`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    },
    body: {
      action: "handoff_reroute",
      targetProfileId: "booking_concierge",
      targetProviderId: "provider_booking_exec",
      targetProviderRef: "jwk:provider_booking_exec",
      targetToolId: "tool_booking_exec",
      note: "Hand off this booking run to the certified managed provider."
    }
  });
  assert.equal(handedOff.statusCode, 200, handedOff.body);
  assert.equal(handedOff.json?.actionResult?.action, "handoff_reroute");
  assert.equal(handedOff.json?.actionResult?.managedExecution?.ready, true);
  assert.equal(handedOff.json?.actionResult?.managedExecution?.providerCandidate?.providerId, "provider_booking_exec");
  assert.match(String(handedOff.json?.actionResult?.assignmentEvidenceRef ?? ""), /^artifact:\/\/runs\/run_ops_rescue_handoff_execute_1\/assignments\//);
  assert.match(String(handedOff.json?.actionResult?.handoffEvidenceRef ?? ""), /^artifact:\/\/runs\/run_ops_rescue_handoff_execute_1\/handoffs\//);
  assert.match(
    String(handedOff.json?.actionResult?.invocationEvidenceRef ?? ""),
    /^artifact:\/\/runs\/run_ops_rescue_handoff_execute_1\/handoff-invocations\//
  );
  assert.equal(handedOff.json?.actionResult?.managedProviderAssignment?.providerId, "provider_booking_exec");
  assert.equal(handedOff.json?.actionResult?.managedProviderAssignment?.assignmentMode, "rescue_forced_handoff");
  assert.equal(handedOff.json?.actionResult?.managedProviderInvocation?.providerId, "provider_booking_exec");
  assert.equal(handedOff.json?.actionResult?.managedProviderInvocation?.toolId, "tool_booking_exec");
  assert.equal(handedOff.json?.actionResult?.managedProviderInvocation?.statusCode, 200);
  assert.equal(handedOff.json?.actionResult?.invocationArtifact?.providerSignature?.verified, true);
  assert.equal(handedOff.json?.actionResult?.run?.status, "running");
  assert.equal(handedOff.json?.actionResult?.events?.[0]?.type, "EVIDENCE_ADDED");
  assert.equal(handedOff.json?.actionResult?.events?.[1]?.type, "EVIDENCE_ADDED");
  assert.equal(handedOff.json?.actionResult?.events?.[2]?.type, "EVIDENCE_ADDED");
  assert.equal(handedOff.json?.actionResult?.events?.[3]?.type, "RUN_HEARTBEAT");
  assert.equal(
    handedOff.json?.actionResult?.managedExecution?.providerCandidate?.requestHeaders?.["x-nooterra-account-session-binding"],
    expectedAccountSessionBinding
  );

  const queueAfterHandoff = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queueAfterHandoff.statusCode, 200, queueAfterHandoff.body);
  const handoffQueueItem =
    queueAfterHandoff.json?.rescueQueue?.queue?.find((item) => item?.refs?.runId === "run_ops_rescue_handoff_execute_1") ?? null;
  assert.equal(handoffQueueItem?.details?.managedExecution?.assignment?.providerId, "provider_booking_exec");
  assert.equal(handoffQueueItem?.details?.managedExecution?.assignmentMode, "rescue_forced_handoff");
  assert.equal(handoffQueueItem?.details?.managedExecution?.assignmentHistory?.[0]?.providerId, "provider_booking_exec");
  assert.ok(Array.isArray(handoffQueueItem?.details?.managedExecution?.invocationHistory));
});

test("API e2e: ops rescue handoff fails closed when the managed provider does not return a payment challenge", async (t) => {
  const api = createApi({
    now: () => "2026-03-06T20:50:00.000Z",
    opsTokens: "tok_opsrw:ops_read,ops_write"
  });

  const tenantId = "tenant_ops_rescue_handoff_fail_closed";
  const payerAgentId = "agt_ops_rescue_handoff_fail_payer";
  const payeeAgentId = "agt_ops_rescue_handoff_fail_payee";
  await registerAgent(api, {
    tenantId,
    agentId: payerAgentId,
    capabilities: ["capability://workflow.orchestrator"]
  });
  await registerAgent(api, {
    tenantId,
    agentId: payeeAgentId,
    capabilities: ["capability://consumer.scheduling.booking"]
  });
  await creditWallet(api, {
    tenantId,
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "credit_ops_rescue_handoff_fail_closed_1"
  });

  const badProviderServer = http.createServer((req, res) => {
    if (req.url === "/paid/booking") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, bad: true }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });
  const badProviderAddr = await listenServer(badProviderServer);
  t.after(async () => {
    await closeServer(badProviderServer);
  });

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "create_run_ops_rescue_handoff_fail_closed_1"
    },
    body: {
      runId: "run_ops_rescue_handoff_fail_closed_1",
      taskType: "consumer",
      settlement: {
        payerAgentId,
        amountCents: 1200,
        currency: "USD",
        disputeWindowDays: 5
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const prevChainHash = created.json?.run?.lastChainHash;
  assert.ok(prevChainHash);

  const actionRequired = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent("run_ops_rescue_handoff_fail_closed_1")}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "action_required_ops_rescue_handoff_fail_closed_1",
      "x-proxy-expected-prev-chain-hash": prevChainHash
    },
    body: {
      type: "RUN_ACTION_REQUIRED",
      payload: {
        runId: "run_ops_rescue_handoff_fail_closed_1",
        code: "needs_account_access",
        title: "Need booking account access",
        detail: "Provide the delegated booking account session.",
        requestedFields: ["account_session_ref", "provider_key", "site_key", "execution_mode"]
      }
    }
  });
  assert.equal(actionRequired.statusCode, 201, actionRequired.body);

  const family = getPhase1SupportedTaskFamily("scheduling_booking");
  api.store.marketplaceRfqs.set(
    makeScopedKey({ tenantId, id: "rfq_run_ops_rescue_handoff_fail_closed_1" }),
    {
      schemaVersion: "MarketplaceRfq.v1",
      rfqId: "rfq_run_ops_rescue_handoff_fail_closed_1",
      tenantId,
      runId: "run_ops_rescue_handoff_fail_closed_1",
      capability: "capability://consumer.scheduling.booking",
      posterAgentId: payerAgentId,
      status: "assigned",
      agreement: {},
      metadata: {
        phase1Launch: {
          schemaVersion: "Phase1LaunchContract.v1",
          productSurface: "consumer_shell",
          categoryId: family.categoryId,
          categoryLabel: family.label,
          categorySummary: family.summary,
          completionContract: family.completionContract
        }
      }
    }
  );
  await attachRunActionRequiredAccountSessionArtifact(api, {
    tenantId,
    payeeAgentId,
    runId: "run_ops_rescue_handoff_fail_closed_1",
    sessionRef: `accountsession://tenants/${tenantId}/cas_booking_fail_closed`,
    providerKey: "amazon",
    siteKey: "amazon.com",
    mode: "approval_at_boundary"
  });
  const providerSigner = createEd25519Keypair();
  api.store.marketplaceProviderPublications.set(
    makeScopedKey({ tenantId, id: "jwk:provider_booking_fail_closed" }),
    {
      schemaVersion: "MarketplaceProviderPublication.v1",
      publicationId: "pub_booking_fail_closed_1",
      tenantId,
      providerId: "provider_booking_fail_closed",
      providerRef: "jwk:provider_booking_fail_closed",
      status: "certified",
      certified: true,
      baseUrl: badProviderAddr.url,
      description: "Bad booking execution provider.",
      tags: ["phase1", "booking"],
      manifestSchemaVersion: "PaidToolManifest.v2",
      manifestHash: "d".repeat(64),
      providerSigning: {
        algorithm: "ed25519",
        keyId: keyIdFromPublicKeyPem(providerSigner.publicKeyPem),
        publicKeyPem: providerSigner.publicKeyPem
      },
      manifest: {
        schemaVersion: "PaidToolManifest.v2",
        providerId: "provider_booking_fail_closed",
        upstreamBaseUrl: badProviderAddr.url,
        defaults: {
          amountCents: 480,
          currency: "USD",
          idempotency: "side_effecting",
          signatureMode: "required",
          toolClass: "action",
          riskLevel: "medium",
          requiredSignatures: ["output"],
          requestBinding: "strict"
        },
        tools: [
          {
            toolId: "tool_booking_fail_closed",
            description: "Delegated booking execution",
            method: "POST",
            paidPath: "/paid/booking",
            upstreamPath: "/invoke",
            pricing: { amountCents: 480, currency: "USD" },
            auth: { mode: "none" },
            toolClass: "action",
            riskLevel: "medium",
            security: { requiredSignatures: ["output"], requestBinding: "strict" },
            metadata: {
              phase1ManagedNetwork: {
                profileId: "booking_concierge",
                executionAdapter: {
                  schemaVersion: "Phase1ExecutionAdapter.v1",
                  adapterId: "delegated_account_session_booking",
                  mode: "delegated_account_session",
                  requiresDelegatedAccountSession: true,
                  supportedSessionModes: ["browser_delegated", "approval_at_boundary", "operator_supervised"],
                  requiredRunFields: ["account_session_ref", "provider_key", "site_key", "execution_mode"],
                  merchantScope: "booking_travel",
                  reviewPolicy: "allow autonomous slot selection inside approved constraints, but keep final booking bounded by the stored review mode"
                }
              }
            }
          }
        ]
      },
      publishedAt: "2026-03-06T20:20:00.000Z",
      certifiedAt: "2026-03-06T20:21:00.000Z",
      updatedAt: "2026-03-06T20:22:00.000Z"
    }
  );

  const queue = await request(api, {
    method: "GET",
    path: "/ops/network/rescue-queue?sourceType=run",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    }
  });
  assert.equal(queue.statusCode, 200, queue.body);
  const rescueItem = queue.json?.rescueQueue?.queue?.find((row) => row?.refs?.runId === "run_ops_rescue_handoff_fail_closed_1") ?? null;
  assert.ok(rescueItem);

  const handedOff = await request(api, {
    method: "POST",
    path: `/ops/network/rescue-queue/${encodeURIComponent(rescueItem.rescueId)}/actions`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw"
    },
    body: {
      action: "handoff_reroute",
      targetProfileId: "booking_concierge",
      targetProviderId: "provider_booking_fail_closed",
      targetToolId: "tool_booking_fail_closed",
      note: "This should fail closed because the provider skipped the payment challenge."
    }
  });
  assert.equal(handedOff.statusCode, 409, handedOff.body);
  assert.equal(handedOff.json?.code ?? handedOff.json?.details?.code, "OPS_RESCUE_HANDOFF_PROVIDER_CHALLENGE_MISSING");
});

test("API e2e: direct run managed-execution handoff invokes the certified provider", async (t) => {
  const api = createApi({
    now: () => "2026-03-06T21:10:00.000Z",
    opsTokens: "tok_opsrw:ops_read,ops_write"
  });

  const tenantId = "tenant_run_managed_handoff_direct";
  const payerAgentId = "agt_run_managed_handoff_direct_payer";
  const payeeAgentId = "agt_run_managed_handoff_direct_payee";
  await registerAgent(api, {
    tenantId,
    agentId: payerAgentId,
    capabilities: ["capability://workflow.orchestrator"]
  });
  await registerAgent(api, {
    tenantId,
    agentId: payeeAgentId,
    capabilities: ["capability://consumer.scheduling.booking"]
  });
  await creditWallet(api, {
    tenantId,
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "credit_run_managed_handoff_direct_1"
  });

  const providerSigner = createEd25519Keypair();
  let expectedAccountSessionBinding = "";
  let expectedBrowserProfileBinding = "";
  const providerServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/paid/booking") {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
      if (!authorization) {
        const challenge = "amountCents=480; currency=USD; providerId=provider_booking_direct; toolId=tool_booking_direct; address=nooterra:provider; network=nooterra; requestBindingMode=strict";
        res.writeHead(402, {
          "content-type": "application/json; charset=utf-8",
          "x-payment-required": challenge,
          "payment-required": challenge
        });
        res.end(JSON.stringify({ ok: false, error: "payment_required" }));
        return;
      }
      const delegatedSessionHeader =
        typeof req.headers["x-nooterra-account-session-binding"] === "string"
          ? req.headers["x-nooterra-account-session-binding"].trim()
          : "";
      if (delegatedSessionHeader !== expectedAccountSessionBinding) {
        res.writeHead(409, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "delegated_session_binding_mismatch" }));
        return;
      }
      const delegatedBrowserProfileHeader =
        typeof req.headers["x-nooterra-account-session-browser-profile"] === "string"
          ? req.headers["x-nooterra-account-session-browser-profile"].trim()
          : "";
      if (delegatedBrowserProfileHeader !== expectedBrowserProfileBinding) {
        res.writeHead(409, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "delegated_browser_profile_binding_mismatch" }));
        return;
      }
      const bodyBuffer = Buffer.concat(chunks);
      const requestBindingSha256 = computeNooterraPayRequestBindingSha256V1({
        method: String(req.method ?? "POST").toUpperCase(),
        host: String(req.headers.host ?? "").trim().toLowerCase(),
        pathWithQuery: url.pathname + url.search,
        bodySha256: sha256Hex(bodyBuffer)
      });
      const responseBodyBuffer = Buffer.from(JSON.stringify({ ok: true, bookingId: "bk_direct_provider_1" }), "utf8");
      const responseHash = sha256Hex(responseBodyBuffer);
      const signature = signToolProviderSignatureV1({
        responseHash,
        nonce: "abcdef0123456789abcdef0123456789",
        signedAt: "2026-03-06T21:10:30.000Z",
        publicKeyPem: providerSigner.publicKeyPem,
        privateKeyPem: providerSigner.privateKeyPem
      });
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "x-nooterra-provider-key-id": signature.keyId,
        "x-nooterra-provider-signed-at": signature.signedAt,
        "x-nooterra-provider-nonce": signature.nonce,
        "x-nooterra-provider-response-sha256": signature.responseHash,
        "x-nooterra-provider-signature": signature.signatureBase64,
        "x-nooterra-request-binding-mode": "strict",
        "x-nooterra-request-binding-sha256": requestBindingSha256,
        "x-nooterra-account-session-mode": "approval_at_boundary",
        "x-nooterra-account-session-provider": "amazon",
        "x-nooterra-account-session-site": "amazon.com"
      });
      res.end(responseBodyBuffer);
    });
  });
  const providerAddr = await listenServer(providerServer);
  t.after(async () => {
    await closeServer(providerServer);
  });

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "create_run_managed_handoff_direct_1"
    },
    body: {
      runId: "run_managed_handoff_direct_1",
      taskType: "consumer",
      settlement: {
        payerAgentId,
        amountCents: 1200,
        currency: "USD",
        disputeWindowDays: 5
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const prevChainHash = created.json?.run?.lastChainHash;
  assert.ok(prevChainHash);
  const actionRequired = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent("run_managed_handoff_direct_1")}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "action_required_run_managed_handoff_direct_1",
      "x-proxy-expected-prev-chain-hash": prevChainHash
    },
    body: {
      type: "RUN_ACTION_REQUIRED",
      payload: {
        runId: "run_managed_handoff_direct_1",
        code: "needs_account_access",
        title: "Need booking account access",
        detail: "Provide the delegated booking account session.",
        requestedFields: ["account_session_ref", "provider_key", "site_key", "execution_mode"]
      }
    }
  });
  assert.equal(actionRequired.statusCode, 201, actionRequired.body);

  const family = getPhase1SupportedTaskFamily("scheduling_booking");
  api.store.marketplaceRfqs.set(
    makeScopedKey({ tenantId, id: "rfq_run_managed_handoff_direct_1" }),
    {
      schemaVersion: "MarketplaceRfq.v1",
      rfqId: "rfq_run_managed_handoff_direct_1",
      tenantId,
      runId: "run_managed_handoff_direct_1",
      capability: "capability://consumer.scheduling.booking",
      posterAgentId: payerAgentId,
      status: "assigned",
      agreement: {},
      metadata: {
        phase1Launch: {
          schemaVersion: "Phase1LaunchContract.v1",
          productSurface: "consumer_shell",
          categoryId: family.categoryId,
          categoryLabel: family.label,
          categorySummary: family.summary,
          completionContract: family.completionContract
        }
      }
    }
  );
  const boundArtifact = await attachRunActionRequiredAccountSessionArtifact(api, {
    tenantId,
    payeeAgentId,
    runId: "run_managed_handoff_direct_1",
    sessionRef: `accountsession://tenants/${tenantId}/cas_booking_direct`,
    providerKey: "amazon",
    siteKey: "amazon.com",
    mode: "approval_at_boundary"
  });
  expectedAccountSessionBinding = buildDelegatedAccountSessionBindingHeaderValue(boundArtifact.accountSessionBinding);
  expectedBrowserProfileBinding = buildDelegatedBrowserProfileHeaderValue(boundArtifact.accountSessionBinding.browserProfile);

  api.store.marketplaceProviderPublications.set(
    makeScopedKey({ tenantId, id: "jwk:provider_booking_direct" }),
    {
      schemaVersion: "MarketplaceProviderPublication.v1",
      publicationId: "pub_booking_direct_1",
      tenantId,
      providerId: "provider_booking_direct",
      providerRef: "jwk:provider_booking_direct",
      status: "certified",
      certified: true,
      baseUrl: providerAddr.url,
      description: "Certified booking execution provider.",
      tags: ["phase1", "booking"],
      manifestSchemaVersion: "PaidToolManifest.v2",
      manifestHash: "d".repeat(64),
      providerSigning: {
        algorithm: "ed25519",
        keyId: keyIdFromPublicKeyPem(providerSigner.publicKeyPem),
        publicKeyPem: providerSigner.publicKeyPem
      },
      manifest: {
        schemaVersion: "PaidToolManifest.v2",
        providerId: "provider_booking_direct",
        upstreamBaseUrl: providerAddr.url,
        defaults: {
          amountCents: 480,
          currency: "USD",
          idempotency: "side_effecting",
          signatureMode: "required",
          toolClass: "action",
          riskLevel: "medium",
          requiredSignatures: ["output"],
          requestBinding: "strict"
        },
        tools: [
          {
            toolId: "tool_booking_direct",
            description: "Delegated booking execution",
            method: "POST",
            paidPath: "/paid/booking",
            upstreamPath: "/invoke",
            pricing: { amountCents: 480, currency: "USD" },
            auth: { mode: "none" },
            toolClass: "action",
            riskLevel: "medium",
            security: { requiredSignatures: ["output"], requestBinding: "strict" },
            metadata: {
              phase1ManagedNetwork: {
                profileId: "booking_concierge",
                executionAdapter: {
                  schemaVersion: "Phase1ExecutionAdapter.v1",
                  adapterId: "delegated_account_session_booking",
                  mode: "delegated_account_session",
                  requiresDelegatedAccountSession: true,
                  supportedSessionModes: ["browser_delegated", "approval_at_boundary", "operator_supervised"],
                  requiredRunFields: ["account_session_ref", "provider_key", "site_key", "execution_mode"],
                  merchantScope: "booking_travel",
                  reviewPolicy: "allow autonomous slot selection inside approved constraints, but keep final booking bounded by the stored review mode"
                }
              }
            }
          }
        ]
      },
      publishedAt: "2026-03-06T21:00:00.000Z",
      certifiedAt: "2026-03-06T21:01:00.000Z",
      updatedAt: "2026-03-06T21:02:00.000Z"
    }
  );

  const handedOff = await request(api, {
    method: "POST",
    path: "/runs/run_managed_handoff_direct_1/managed-execution/handoff",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_opsrw",
      "x-nooterra-protocol": "1.0",
      "x-idempotency-key": "run_managed_handoff_direct_execute_1"
    },
    body: {
      targetProfileId: "booking_concierge",
      targetProviderId: "provider_booking_direct",
      targetProviderRef: "jwk:provider_booking_direct",
      targetToolId: "tool_booking_direct",
      note: "Directly hand off this run to the certified managed provider."
    }
  });
  assert.equal(handedOff.statusCode, 200, handedOff.body);
  assert.equal(handedOff.json?.result?.action, "managed_execution_handoff");
  assert.equal(handedOff.json?.result?.managedExecution?.providerCandidate?.providerId, "provider_booking_direct");
  assert.equal(handedOff.json?.result?.managedProviderAssignment?.providerId, "provider_booking_direct");
  assert.equal(handedOff.json?.result?.managedProviderAssignment?.assignmentMode, "direct_run_handoff");
  assert.equal(handedOff.json?.result?.managedProviderInvocation?.providerId, "provider_booking_direct");
  assert.equal(handedOff.json?.result?.managedProviderInvocation?.statusCode, 200);
  assert.equal(handedOff.json?.result?.run?.status, "running");

  const detail = await request(api, {
    method: "GET",
    path: "/runs/run_managed_handoff_direct_1",
    headers: {
      "x-proxy-tenant-id": tenantId
    }
  });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json?.detail?.managedExecution?.assignment?.providerId, "provider_booking_direct");
  assert.equal(detail.json?.detail?.managedExecution?.assignmentMode, "direct_run_handoff");
  assert.equal(detail.json?.detail?.managedExecution?.providerId, "provider_booking_direct");
  assert.equal(detail.json?.detail?.managedExecution?.invocation?.providerId, "provider_booking_direct");
  assert.ok(detail.json?.detail?.timeline?.some((entry) => entry.eventType === "managed_provider.assigned"));
  assert.ok(detail.json?.detail?.timeline?.some((entry) => entry.eventType === "managed_provider.invoked"));
});
