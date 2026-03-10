import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createStore } from "../src/api/store.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { buildApprovalDecisionV1 } from "../src/core/authority-envelope.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId, capabilities }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `router_approval_agent_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_router_approval_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function upsertAgentCard(api, { agentId, capabilities, visibility = "public" }) {
  const response = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": `router_approval_card_${agentId}` },
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

test("API e2e: router launch fails closed on missing approval and persists approval refs once granted", async () => {
  const api = createApi({ store: createStore() });

  await registerAgent(api, {
    agentId: "agt_router_approval_poster",
    capabilities: ["capability://workflow.orchestrator"]
  });
  await registerAgent(api, {
    agentId: "agt_router_approval_worker",
    capabilities: ["capability://code.generation"]
  });

  await upsertAgentCard(api, {
    agentId: "agt_router_approval_worker",
    capabilities: ["capability://code.generation"],
    visibility: "public"
  });

  const blocked = await request(api, {
    method: "POST",
    path: "/router/launch",
    headers: { "x-idempotency-key": "router_launch_approval_blocked" },
    body: {
      text: "Implement the feature.",
      posterAgentId: "agt_router_approval_poster",
      scope: "public",
      budgetCents: 125_000,
      currency: "USD",
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 100_000,
        strictEvidenceRefs: true
      },
      approvalContinuation: {
        dispatchNow: true
      },
      taskOverrides: {
        t_implement: {
          rfqId: "rfq_router_launch_approval_1"
        }
      }
    }
  });

  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "HUMAN_APPROVAL_REQUIRED");
  assert.equal(blocked.json?.details?.taskId, "t_implement");
  assert.ok(blocked.json?.details?.rfqId);
  const authorityEnvelope = blocked.json?.details?.authorityEnvelope;
  const approvalRequest = blocked.json?.details?.approvalRequest;
  const approvalContinuation = blocked.json?.details?.approvalContinuation;
  assert.ok(authorityEnvelope);
  assert.ok(approvalRequest);
  assert.equal(approvalContinuation?.kind, "router_launch");
  assert.equal(approvalContinuation?.status, "pending");
  assert.equal(approvalContinuation?.resume?.dispatchNow, true);

  const approvalDecision = buildApprovalDecisionV1({
    decisionId: "adec_router_launch_approval_1",
    requestId: approvalRequest.requestId,
    envelopeHash: authorityEnvelope.envelopeHash,
    actionId: approvalRequest.actionRef.actionId,
    actionSha256: approvalRequest.actionRef.sha256,
    decidedBy: "human.router.ops",
    decidedAt: "2026-03-06T12:45:00.000Z",
    approved: true,
    evidenceRefs: ["ticket:NOO-router-approval-1"]
  });

  const launched = await request(api, {
    method: "POST",
    path: "/router/launch",
    headers: { "x-idempotency-key": "router_launch_approval_allowed" },
    body: {
      text: "Implement the feature.",
      posterAgentId: "agt_router_approval_poster",
      scope: "public",
      budgetCents: 125_000,
      currency: "USD",
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 100_000,
        strictEvidenceRefs: true
      },
      approvalContinuation: {
        dispatchNow: true
      },
      taskOverrides: {
        t_implement: {
          rfqId: "rfq_router_launch_approval_1",
          authorityEnvelope,
          approvalRequest,
          approvalDecision
        }
      }
    }
  });

  assert.equal(launched.statusCode, 201, launched.body);
  assert.equal(launched.json?.rfqs?.length, 1);
  assert.equal(launched.json?.rfqs?.[0]?.rfqId, "rfq_router_launch_approval_1");
  assert.equal(launched.json?.rfqs?.[0]?.approval?.requestId, approvalRequest.requestId);
  assert.equal(launched.json?.rfqs?.[0]?.approval?.decisionId, approvalDecision.decisionId);

  const persistedRequest = await request(api, {
    method: "GET",
    path: `/approval-requests/${encodeURIComponent(approvalRequest.requestId)}`
  });
  assert.equal(persistedRequest.statusCode, 200, persistedRequest.body);
  assert.equal(persistedRequest.json?.approvalRequest?.requestHash, approvalRequest.requestHash);

  const decidedInbox = await request(api, {
    method: "GET",
    path: "/approval-inbox?status=decided"
  });
  assert.equal(decidedInbox.statusCode, 200, decidedInbox.body);
  assert.equal(decidedInbox.json?.items?.[0]?.approvalContinuation?.status, "resumed");
  assert.equal(decidedInbox.json?.items?.[0]?.approvalContinuation?.resultRef?.launchId, launched.json?.launch?.launchId);
});
