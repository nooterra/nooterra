import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { buildApprovalDecisionV1 } from "../src/core/authority-envelope.js";
import { request } from "./api-test-harness.js";

function withEnv(key, value) {
  const prev = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
  if (value === undefined || value === null) delete process.env[key];
  else process.env[key] = String(value);
  return () => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  };
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `agent_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_market_approval_e2e" },
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

test("API e2e: marketplace RFQs persist approval lineage and settlement binds approval refs", async () => {
  const api = createApi();
  await registerAgent(api, { agentId: "agt_market_approval_poster" });
  await registerAgent(api, { agentId: "agt_market_approval_bidder", capabilities: ["translate"] });
  await registerAgent(api, { agentId: "agt_market_approval_operator" });
  await creditWallet(api, {
    agentId: "agt_market_approval_poster",
    amountCents: 250_000,
    idempotencyKey: "wallet_credit_market_approval_poster"
  });

  const blocked = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": "marketplace_approval_rfq_blocked" },
    body: {
      rfqId: "rfq_market_approval_1",
      title: "Translate investor memo",
      capability: "translate",
      posterAgentId: "agt_market_approval_poster",
      budgetCents: 125_000,
      currency: "USD",
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 100_000,
        strictEvidenceRefs: true
      }
    }
  });

  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "HUMAN_APPROVAL_REQUIRED");
  const authorityEnvelope = blocked.json?.details?.authorityEnvelope;
  const approvalRequest = blocked.json?.details?.approvalRequest;
  const approvalContinuation = blocked.json?.details?.approvalContinuation;
  assert.ok(authorityEnvelope);
  assert.ok(approvalRequest);
  assert.equal(approvalContinuation?.kind, "marketplace_rfq");
  assert.equal(approvalContinuation?.status, "pending");

  const approvalDecision = buildApprovalDecisionV1({
    decisionId: "adec_market_approval_1",
    requestId: approvalRequest.requestId,
    envelopeHash: authorityEnvelope.envelopeHash,
    actionId: approvalRequest.actionRef.actionId,
    actionSha256: approvalRequest.actionRef.sha256,
    decidedBy: "human.market.ops",
    decidedAt: "2026-03-06T12:30:00.000Z",
    approved: true,
    evidenceRefs: ["ticket:NOO-market-approval-1"]
  });

  const created = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": "marketplace_approval_rfq_allowed" },
    body: {
      rfqId: "rfq_market_approval_1",
      title: "Translate investor memo",
      capability: "translate",
      posterAgentId: "agt_market_approval_poster",
      budgetCents: 125_000,
      currency: "USD",
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 100_000,
        strictEvidenceRefs: true
      },
      authorityEnvelope,
      approvalRequest,
      approvalDecision
    }
  });

  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.rfq?.approval?.schemaVersion, "ApprovalChainRef.v1");
  assert.equal(created.json?.rfq?.approval?.requestId, approvalRequest.requestId);
  assert.equal(created.json?.rfq?.approval?.decisionId, approvalDecision.decisionId);

  const persistedRequest = await request(api, {
    method: "GET",
    path: `/approval-requests/${encodeURIComponent(approvalRequest.requestId)}`
  });
  assert.equal(persistedRequest.statusCode, 200, persistedRequest.body);
  assert.equal(persistedRequest.json?.approvalRequest?.requestId, approvalRequest.requestId);
  assert.equal(persistedRequest.json?.approvalRequest?.requestHash, approvalRequest.requestHash);

  const persistedDecision = await request(api, {
    method: "GET",
    path: `/approval-decisions/${encodeURIComponent(approvalDecision.decisionId)}`
  });
  assert.equal(persistedDecision.statusCode, 200, persistedDecision.body);
  assert.equal(persistedDecision.json?.approvalDecision?.decisionHash, approvalDecision.decisionHash);

  const decidedInbox = await request(api, {
    method: "GET",
    path: "/approval-inbox?status=decided"
  });
  assert.equal(decidedInbox.statusCode, 200, decidedInbox.body);
  assert.equal(decidedInbox.json?.items?.[0]?.approvalContinuation?.status, "resumed");
  assert.equal(decidedInbox.json?.items?.[0]?.approvalContinuation?.resultRef?.rfqId, "rfq_market_approval_1");

  const bid = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_market_approval_1/bids",
    headers: { "x-idempotency-key": "marketplace_approval_bid_1" },
    body: {
      bidId: "bid_market_approval_1",
      bidderAgentId: "agt_market_approval_bidder",
      amountCents: 110_000,
      currency: "USD",
      etaSeconds: 1800
    }
  });
  assert.equal(bid.statusCode, 201, bid.body);

  const accepted = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_market_approval_1/accept",
    headers: { "x-idempotency-key": "marketplace_approval_accept_1" },
    body: {
      bidId: "bid_market_approval_1",
      payerAgentId: "agt_market_approval_poster",
      acceptedByAgentId: "agt_market_approval_operator"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json?.settlement?.decisionTrace?.approval?.requestId, approvalRequest.requestId);
  assert.equal(accepted.json?.settlement?.decisionTrace?.approval?.decisionId, approvalDecision.decisionId);
  assert.equal(accepted.json?.rfq?.approval?.requestId, approvalRequest.requestId);
});

test("API e2e: marketplace RFQ approval-required emission sends a buyer notification event", async () => {
  const restore = withEnv("PROXY_ONBOARDING_BASE_URL", "https://onboarding.nooterra.test");
  const calls = [];
  try {
    const api = createApi({
      opsToken: "tok_ops",
      fetchFn: async (url, init = {}) => {
        calls.push({
          url: String(url),
          method: init.method ?? "GET",
          headers: { ...(init.headers ?? {}) },
          body: init.body ? JSON.parse(init.body) : null
        });
        return new Response(JSON.stringify({ ok: true, delivery: { ok: true } }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }
    });
    await registerAgent(api, { agentId: "agt_market_approval_notify_poster" });
    await creditWallet(api, {
      agentId: "agt_market_approval_notify_poster",
      amountCents: 250_000,
      idempotencyKey: "wallet_credit_market_approval_notify_poster"
    });

    const blocked = await request(api, {
      method: "POST",
      path: "/marketplace/rfqs",
      headers: { "x-idempotency-key": "marketplace_approval_notify_blocked" },
      body: {
        rfqId: "rfq_market_approval_notify_1",
        title: "Translate investor memo",
        capability: "translate",
        posterAgentId: "agt_market_approval_notify_poster",
        budgetCents: 125_000,
        currency: "USD",
        approvalMode: "require",
        approvalPolicy: {
          requireApprovalAboveCents: 100_000,
          strictEvidenceRefs: true
        }
      }
    });

    assert.equal(blocked.statusCode, 409, blocked.body);
    assert.equal(blocked.json?.code, "HUMAN_APPROVAL_REQUIRED");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://onboarding.nooterra.test/v1/tenants/tenant_default/settings/buyer-notifications/product-event/send"
    );
    assert.equal(calls[0].body?.payload?.eventType, "approval.required");
    assert.equal(calls[0].body?.payload?.itemRef?.requestId, blocked.json?.details?.approvalRequest?.requestId);
    assert.equal(
      calls[0].body?.token,
      `notif_approval_${sha256Hex(
        `${blocked.json?.details?.approvalRequest?.requestId}\n${blocked.json?.details?.approvalRequest?.requestHash}`
      ).slice(0, 24)}`
    );
  } finally {
    restore();
  }
});
