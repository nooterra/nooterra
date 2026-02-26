import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId, capabilities = ["translate"] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `mk_agr_lifecycle_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_marketplace_agreement_lifecycle_test" },
      publicKeyPem,
      capabilities
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

async function setX402AgentLifecycle(
  api,
  { agentId, status, idempotencyKey, reasonCode = null, reasonMessage = null }
) {
  return await request(api, {
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
}

async function createAcceptedMarketplaceRun(api, { prefix }) {
  const posterAgentId = `agt_${prefix}_poster`;
  const bidderAgentId = `agt_${prefix}_bidder`;
  const operatorAgentId = `agt_${prefix}_operator`;
  const rfqId = `rfq_${prefix}_1`;
  const bidId = `bid_${prefix}_1`;
  await registerAgent(api, { agentId: posterAgentId });
  await registerAgent(api, { agentId: bidderAgentId });
  await registerAgent(api, { agentId: operatorAgentId });
  await creditWallet(api, {
    agentId: posterAgentId,
    amountCents: 5000,
    idempotencyKey: `${prefix}_wallet_credit_1`
  });

  const rfq = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": `${prefix}_rfq_1` },
    body: {
      rfqId,
      title: "Lifecycle agreement rfq",
      capability: "translate",
      posterAgentId,
      budgetCents: 1500,
      currency: "USD"
    }
  });
  assert.equal(rfq.statusCode, 201, rfq.body);

  const bid = await request(api, {
    method: "POST",
    path: `/marketplace/rfqs/${encodeURIComponent(rfqId)}/bids`,
    headers: { "x-idempotency-key": `${prefix}_bid_1` },
    body: {
      bidId,
      bidderAgentId,
      amountCents: 1400,
      currency: "USD"
    }
  });
  assert.equal(bid.statusCode, 201, bid.body);

  const accept = await request(api, {
    method: "POST",
    path: `/marketplace/rfqs/${encodeURIComponent(rfqId)}/accept`,
    headers: { "x-idempotency-key": `${prefix}_accept_1` },
    body: {
      bidId,
      acceptedByAgentId: operatorAgentId,
      agreementTerms: {
        milestones: [{ milestoneId: "m1", label: "Initial", releaseRatePct: 100, statusGate: "green" }],
        changeOrderPolicy: { enabled: true, maxChangeOrders: 2, requireCounterpartyAcceptance: false },
        cancellation: {
          allowCancellationBeforeStart: true,
          killFeeRatePct: 10,
          requireEvidenceOnCancellation: false,
          requireCounterpartyAcceptance: false
        }
      }
    }
  });
  assert.equal(accept.statusCode, 200, accept.body);
  const runId = String(accept.json?.run?.runId ?? "");
  assert.ok(runId.length > 0, accept.body);
  return { runId, posterAgentId };
}

test("API e2e: marketplace agreement change-order and cancel fail closed on non-active lifecycle", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const { runId, posterAgentId } = await createAcceptedMarketplaceRun(api, { prefix: "mk_agr_lifecycle" });

  const suspendPoster = await setX402AgentLifecycle(api, {
    agentId: posterAgentId,
    status: "suspended",
    reasonCode: "X402_AGENT_SUSPENDED_MANUAL",
    idempotencyKey: "mk_agr_lifecycle_suspend_poster_1"
  });
  assert.equal(suspendPoster.statusCode, 200, suspendPoster.body);
  assert.equal(suspendPoster.json?.lifecycle?.status, "suspended");

  const blockedChangeOrder = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/agreement/change-order`,
    headers: { "x-idempotency-key": "mk_agr_lifecycle_change_order_block_1" },
    body: {
      changeOrderId: "chg_mk_agr_lifecycle_1",
      requestedByAgentId: posterAgentId,
      reason: "scope update",
      milestones: [{ milestoneId: "m1", label: "Initial", releaseRatePct: 100, statusGate: "green" }]
    }
  });
  assert.equal(blockedChangeOrder.statusCode, 410, blockedChangeOrder.body);
  assert.equal(blockedChangeOrder.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedChangeOrder.json?.details?.role, "payer");
  assert.equal(blockedChangeOrder.json?.details?.operation, "marketplace_agreement.change_order");

  const blockedCancel = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/agreement/cancel`,
    headers: { "x-idempotency-key": "mk_agr_lifecycle_cancel_block_1" },
    body: {
      cancellationId: "cancel_mk_agr_lifecycle_1",
      cancelledByAgentId: posterAgentId,
      reason: "cancel requested"
    }
  });
  assert.equal(blockedCancel.statusCode, 410, blockedCancel.body);
  assert.equal(blockedCancel.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedCancel.json?.details?.role, "payer");
  assert.equal(blockedCancel.json?.details?.operation, "marketplace_agreement.cancel");
});
