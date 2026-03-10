import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { buildAuthorityEnvelopeV1 } from "../src/core/authority-envelope.js";
import { APPROVAL_CONTINUATION_KIND, APPROVAL_CONTINUATION_STATUS, buildApprovalContinuationV1 } from "../src/core/approval-continuation.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { getPhase1SupportedTaskFamily } from "../src/core/phase1-task-policy.js";
import { makeScopedKey } from "../src/core/tenancy.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { tenantId, agentId, ownerId = "svc_phase1_metrics_test" }) {
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
  assert.equal(response.statusCode, 201, response.body);
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
      taskType: "consumer",
      settlement: {
        payerAgentId,
        amountCents,
        currency: "USD",
        disputeWindowDays: 5
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);

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
    assert.equal(evidenceResponse.statusCode, 201, evidenceResponse.body);
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
  assert.equal(completed.statusCode, 201, completed.body);
}

function attachPhase1LaunchContractToRun(
  api,
  { tenantId, runId, rfqId, categoryId, capability, posterAgentId = "agt_phase1_requester", launchChannel = null, hostId = null, hostRuntime = null }
) {
  const family = getPhase1SupportedTaskFamily(categoryId);
  assert.ok(family, `phase1 family ${categoryId} must exist`);
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
        actionWalletHost:
          launchChannel || hostId || hostRuntime
            ? {
                channel: launchChannel,
                hostId,
                runtime: hostRuntime
              }
            : undefined
      }
    }
  );
}

function toScenarioToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "default";
}

async function createPhase1ApprovalContinuation(api, { tenantId, agentId, rfqId, categoryId, capability, purpose, launchChannel = null, hostId = null, hostRuntime = null }) {
  const family = getPhase1SupportedTaskFamily(categoryId);
  assert.ok(family, `phase1 family ${categoryId} must exist`);
  const scenarioToken = toScenarioToken(`${rfqId}_${categoryId}_${launchChannel ?? ""}`);
  const launchId = `launch_${scenarioToken}`;
  const taskId = `task_${scenarioToken}`;
  const actionId = `act_${scenarioToken}`;
  const envelopeId = `aenv_${scenarioToken}`;
  api.store.marketplaceRfqs.set(
    makeScopedKey({ tenantId, id: rfqId }),
    {
      schemaVersion: "MarketplaceRfq.v1",
      rfqId,
      tenantId,
      capability: "capability://consumer.purchases.checkout",
      posterAgentId: agentId,
      status: "open",
      metadata: {
        routerLaunch: {
          launchId,
          taskId
        },
        phase1Launch: {
          schemaVersion: "Phase1LaunchContract.v1",
          productSurface: "consumer_shell",
          categoryId: family.categoryId,
          categoryLabel: family.label,
          categorySummary: family.summary,
          completionContract: family.completionContract
        },
        actionWalletHost:
          launchChannel || hostId || hostRuntime
            ? {
                channel: launchChannel,
                hostId,
                runtime: hostRuntime
              }
            : undefined
      }
    }
  );

  const authorityEnvelope = buildAuthorityEnvelopeV1({
    envelopeId,
    principalRef: { principalType: "agent", principalId: agentId },
    actor: { agentId: agentId },
    purpose: purpose ?? "Complete the launch-scoped action under the approved cap.",
    capabilitiesRequested: [capability ?? "capability://consumer.purchases.checkout"],
    spendEnvelope: {
      currency: "USD",
      maxPerCallCents: 8000,
      maxTotalCents: 8000
    }
  });
  const createdEnvelope = await request(api, {
    method: "POST",
    path: "/authority-envelopes",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${scenarioToken}_envelope`
    },
    body: authorityEnvelope
  });
  assert.equal(createdEnvelope.statusCode, 201, createdEnvelope.body);

  const createdRequest = await request(api, {
    method: "POST",
    path: "/approval-requests",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${scenarioToken}_request`
    },
    body: {
      envelopeId: authorityEnvelope.envelopeId,
      requestedBy: agentId,
      requestedAt: "2026-03-07T08:00:00.000Z",
      actionId
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
      text: purpose ?? "Complete the launch-scoped action under the approved cap.",
      posterAgentId: agentId,
      scope: "public",
      approvalMode: "require",
      approvalContinuation: { dispatchNow: true },
      actionWalletHost:
        launchChannel || hostId || hostRuntime
          ? {
              channel: launchChannel,
              hostId,
              runtime: hostRuntime
            }
          : undefined
    },
    requestedBy: approvalRequest.requestedBy,
    status: APPROVAL_CONTINUATION_STATUS.PENDING,
    resume: {
      taskId,
      rfqId,
      workOrderId: null,
      dispatchNow: true,
      approvalPath: `/approvals?requestId=${approvalRequest.requestId}`
    },
    resultRef: {
      launchId,
      rfqId
    },
    createdAt: "2026-03-07T08:01:00.000Z",
    updatedAt: "2026-03-07T08:01:00.000Z"
  });
  await api.store.putApprovalContinuation({ tenantId, approvalContinuation: continuation });
}

test("API e2e: ops phase1 metrics summarize launch-scoped buy and cancel/recover families, approvals, and rescue load", async () => {
  const api = createApi({ opsTokens: "tok_phase1_metrics:ops_read" });
  const tenantId = "tenant_ops_phase1_metrics";
  const orchestratorAgentId = "agt_phase1_metrics_requester";
  const workerAgentId = "agt_phase1_metrics_worker";

  await registerAgent(api, { tenantId, agentId: orchestratorAgentId });
  await registerAgent(api, { tenantId, agentId: workerAgentId });
  await creditWallet(api, { tenantId, agentId: orchestratorAgentId, amountCents: 20_000, idempotencyKey: "credit_phase1_metrics_requester" });

  await createCompletedRun(api, {
    tenantId,
    payerAgentId: orchestratorAgentId,
    payeeAgentId: workerAgentId,
    runId: "run_phase1_buy_success",
    amountCents: 2400,
    idempotencyPrefix: "run_phase1_buy_success",
    evidenceRefs: [
      "artifact://receipt/demo.json",
      "artifact://merchant_confirmation/demo.json",
      "artifact://price_breakdown/demo.json"
    ],
    metrics: {
      phase1CompletionState: "purchase_confirmed"
    }
  });
  attachPhase1LaunchContractToRun(api, {
    tenantId,
    runId: "run_phase1_buy_success",
    rfqId: "rfq_phase1_buy_success",
    categoryId: "purchases_under_cap",
    capability: "capability://consumer.purchases.checkout",
    posterAgentId: orchestratorAgentId,
    launchChannel: "Claude MCP",
    hostId: "host_partner_claude",
    hostRuntime: "claude-desktop"
  });

  await createCompletedRun(api, {
    tenantId,
    payerAgentId: orchestratorAgentId,
    payeeAgentId: workerAgentId,
    runId: "run_phase1_cancel_unresolved",
    amountCents: 3200,
    idempotencyPrefix: "run_phase1_cancel_unresolved",
    evidenceRefs: ["artifact://provider_confirmation/demo.json"],
    metrics: {
      phase1CompletionState: "awaiting_provider_confirmation"
    }
  });
  attachPhase1LaunchContractToRun(api, {
    tenantId,
    runId: "run_phase1_cancel_unresolved",
    rfqId: "rfq_phase1_cancel_unresolved",
    categoryId: "subscriptions_cancellations",
    capability: "capability://consumer.subscription.manage",
    posterAgentId: orchestratorAgentId,
    launchChannel: "OpenClaw",
    hostId: "host_openclaw",
    hostRuntime: "openclaw"
  });

  await createPhase1ApprovalContinuation(api, {
    tenantId,
    agentId: orchestratorAgentId,
    rfqId: "rfq_phase1_purchase_pending_claude",
    categoryId: "purchases_under_cap",
    capability: "capability://consumer.purchases.checkout",
    purpose: "Buy the best replacement charger under $80.",
    launchChannel: "Claude MCP",
    hostId: "host_partner_claude",
    hostRuntime: "claude-desktop"
  });

  await createPhase1ApprovalContinuation(api, {
    tenantId,
    agentId: orchestratorAgentId,
    rfqId: "rfq_phase1_cancel_pending_openclaw",
    categoryId: "subscriptions_cancellations",
    capability: "capability://consumer.subscription.manage",
    purpose: "Cancel the duplicate subscription and recover any available refund.",
    launchChannel: "OpenClaw",
    hostId: "host_openclaw",
    hostRuntime: "openclaw"
  });

  const response = await request(api, {
    method: "GET",
    path: "/ops/network/phase1-metrics?staleRunMinutes=60",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_phase1_metrics"
    }
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json?.ok, true);
  assert.equal(response.json?.metrics?.schemaVersion, "OpsPhase1Metrics.v1");
  assert.equal(response.json?.metrics?.totals?.runs, 2);
  assert.equal(response.json?.metrics?.totals?.successRuns, 1);
  assert.equal(response.json?.metrics?.totals?.unresolvedRuns, 1);
  assert.equal(response.json?.metrics?.totals?.evidenceCoveredRuns, 1);
  assert.equal(response.json?.metrics?.rescue?.total, 2);
  assert.equal(response.json?.metrics?.approvals?.pending, 2);
  assert.equal(response.json?.metrics?.receiptCoverageSupported, true);

  const byCategory = Array.isArray(response.json?.metrics?.byCategory) ? response.json.metrics.byCategory : [];
  const byChannel = Array.isArray(response.json?.metrics?.byChannel) ? response.json.metrics.byChannel : [];
  const categoryIds = byCategory.map((row) => row?.categoryId).filter(Boolean).sort();
  const buyRow = byCategory.find((row) => row?.categoryId === "purchases_under_cap");
  const cancelRow = byCategory.find((row) => row?.categoryId === "subscriptions_cancellations");
  const claudeRow = byChannel.find((row) => row?.channel === "Claude MCP");
  const openClawRow = byChannel.find((row) => row?.channel === "OpenClaw");
  assert.deepEqual(categoryIds, ["purchases_under_cap", "subscriptions_cancellations"]);
  assert.ok(!categoryIds.includes("scheduling_booking"));
  assert.ok(!categoryIds.includes("support_follow_up"));
  assert.ok(buyRow);
  assert.equal(buyRow.successRuns, 1);
  assert.equal(buyRow.evidenceCoveredRuns, 1);
  assert.equal(buyRow.approvalsTriggered, 1);
  assert.equal(buyRow.approvalsPending, 1);
  assert.ok(cancelRow);
  assert.equal(cancelRow.unresolvedRuns, 1);
  assert.equal(cancelRow.rescueOpenRuns, 1);
  assert.equal(cancelRow.approvalsTriggered, 1);
  assert.equal(cancelRow.approvalsPending, 1);
  assert.deepEqual(
    byChannel.map((row) => row?.channel).filter(Boolean).sort(),
    ["Claude MCP", "OpenClaw"]
  );
  assert.ok(claudeRow);
  assert.equal(claudeRow.runs, 1);
  assert.equal(claudeRow.successRuns, 1);
  assert.equal(claudeRow.receiptCoveredRuns, 0);
  assert.equal(claudeRow.approvalsTriggered, 1);
  assert.equal(claudeRow.approvalsPending, 1);
  assert.ok(openClawRow);
  assert.equal(openClawRow.runs, 1);
  assert.equal(openClawRow.unresolvedRuns, 1);
  assert.equal(openClawRow.rescueOpenRuns, 1);
  assert.equal(openClawRow.approvalsTriggered, 1);
  assert.equal(openClawRow.approvalsPending, 1);

  const topIssueCodes = Array.isArray(response.json?.metrics?.topIssueCodes) ? response.json.metrics.topIssueCodes : [];
  assert.ok(topIssueCodes.some((row) => row?.code === "PHASE1_COMPLETION_STATE_UNRESOLVED"));
  assert.ok(topIssueCodes.some((row) => row?.code === "PHASE1_REQUIRED_EVIDENCE_MISSING"));
});
