import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId, capabilities = ["translate"] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `mk_lifecycle_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_marketplace_lifecycle_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return { agentId, keyId: keyIdFromPublicKeyPem(publicKeyPem) };
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

async function rotateSignerKey(api, { keyId }) {
  const response = await request(api, {
    method: "POST",
    path: `/ops/signer-keys/${encodeURIComponent(keyId)}/rotate`,
    body: {}
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json?.signerKey?.status, "rotated");
}

test("API e2e: marketplace RFQ and bid issue routes fail closed on non-active lifecycle", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const posterAgentId = "agt_mk_lifecycle_poster_1";
  const bidderAgentId = "agt_mk_lifecycle_bidder_1";
  await registerAgent(api, { agentId: posterAgentId });
  await registerAgent(api, { agentId: bidderAgentId });

  const suspendPoster = await setX402AgentLifecycle(api, {
    agentId: posterAgentId,
    status: "suspended",
    reasonCode: "X402_AGENT_SUSPENDED_MANUAL",
    idempotencyKey: "mk_lifecycle_suspend_poster_1"
  });
  assert.equal(suspendPoster.statusCode, 200, suspendPoster.body);
  assert.equal(suspendPoster.json?.lifecycle?.status, "suspended");

  const blockedRfq = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": "mk_lifecycle_rfq_block_1" },
    body: {
      rfqId: "rfq_mk_lifecycle_1",
      title: "Lifecycle blocked rfq",
      capability: "translate",
      posterAgentId,
      budgetCents: 1200,
      currency: "USD"
    }
  });
  assert.equal(blockedRfq.statusCode, 410, blockedRfq.body);
  assert.equal(blockedRfq.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedRfq.json?.details?.role, "poster");
  assert.equal(blockedRfq.json?.details?.operation, "marketplace_rfq.issue");

  const reactivatePoster = await setX402AgentLifecycle(api, {
    agentId: posterAgentId,
    status: "active",
    reasonCode: "X402_AGENT_ACTIVE_MANUAL",
    idempotencyKey: "mk_lifecycle_activate_poster_1"
  });
  assert.equal(reactivatePoster.statusCode, 200, reactivatePoster.body);
  assert.equal(reactivatePoster.json?.lifecycle?.status, "active");

  const createdRfq = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": "mk_lifecycle_rfq_ok_1" },
    body: {
      rfqId: "rfq_mk_lifecycle_2",
      title: "Lifecycle active rfq",
      capability: "translate",
      posterAgentId,
      budgetCents: 1300,
      currency: "USD"
    }
  });
  assert.equal(createdRfq.statusCode, 201, createdRfq.body);

  const throttleBidder = await setX402AgentLifecycle(api, {
    agentId: bidderAgentId,
    status: "throttled",
    reasonCode: "X402_AGENT_THROTTLED_MANUAL",
    idempotencyKey: "mk_lifecycle_throttle_bidder_1"
  });
  assert.equal(throttleBidder.statusCode, 200, throttleBidder.body);
  assert.equal(throttleBidder.json?.lifecycle?.status, "throttled");

  const blockedBid = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_mk_lifecycle_2/bids",
    headers: { "x-idempotency-key": "mk_lifecycle_bid_block_1" },
    body: {
      bidId: "bid_mk_lifecycle_block_1",
      bidderAgentId,
      amountCents: 1100,
      currency: "USD"
    }
  });
  assert.equal(blockedBid.statusCode, 429, blockedBid.body);
  assert.equal(blockedBid.json?.code, "X402_AGENT_THROTTLED");
  assert.equal(blockedBid.json?.details?.role, "bidder");
  assert.equal(blockedBid.json?.details?.operation, "marketplace_bid.issue");
});

test("API e2e: marketplace counter-offer and accept routes fail closed on non-active lifecycle", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const posterAgentId = "agt_mk_lifecycle_poster_2";
  const bidderAgentId = "agt_mk_lifecycle_bidder_2";
  const operatorAgentId = "agt_mk_lifecycle_operator_2";
  await registerAgent(api, { agentId: posterAgentId });
  await registerAgent(api, { agentId: bidderAgentId });
  await registerAgent(api, { agentId: operatorAgentId });

  const createdRfq = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": "mk_lifecycle_rfq_ok_2" },
    body: {
      rfqId: "rfq_mk_lifecycle_3",
      title: "Lifecycle negotiation rfq",
      capability: "translate",
      posterAgentId,
      budgetCents: 1500,
      currency: "USD"
    }
  });
  assert.equal(createdRfq.statusCode, 201, createdRfq.body);

  const createdBid = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_mk_lifecycle_3/bids",
    headers: { "x-idempotency-key": "mk_lifecycle_bid_ok_2" },
    body: {
      bidId: "bid_mk_lifecycle_2",
      bidderAgentId,
      amountCents: 1200,
      currency: "USD"
    }
  });
  assert.equal(createdBid.statusCode, 201, createdBid.body);

  const suspendPoster = await setX402AgentLifecycle(api, {
    agentId: posterAgentId,
    status: "suspended",
    reasonCode: "X402_AGENT_SUSPENDED_MANUAL",
    idempotencyKey: "mk_lifecycle_suspend_poster_2"
  });
  assert.equal(suspendPoster.statusCode, 200, suspendPoster.body);
  assert.equal(suspendPoster.json?.lifecycle?.status, "suspended");

  const blockedCounterOffer = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_mk_lifecycle_3/bids/bid_mk_lifecycle_2/counter-offer",
    headers: { "x-idempotency-key": "mk_lifecycle_counter_block_1" },
    body: {
      proposerAgentId: bidderAgentId,
      amountCents: 1250
    }
  });
  assert.equal(blockedCounterOffer.statusCode, 410, blockedCounterOffer.body);
  assert.equal(blockedCounterOffer.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedCounterOffer.json?.details?.role, "poster");
  assert.equal(blockedCounterOffer.json?.details?.operation, "marketplace_bid.counter_offer");

  const reactivatePoster = await setX402AgentLifecycle(api, {
    agentId: posterAgentId,
    status: "active",
    reasonCode: "X402_AGENT_ACTIVE_MANUAL",
    idempotencyKey: "mk_lifecycle_activate_poster_2"
  });
  assert.equal(reactivatePoster.statusCode, 200, reactivatePoster.body);
  assert.equal(reactivatePoster.json?.lifecycle?.status, "active");

  const throttleBidder = await setX402AgentLifecycle(api, {
    agentId: bidderAgentId,
    status: "throttled",
    reasonCode: "X402_AGENT_THROTTLED_MANUAL",
    idempotencyKey: "mk_lifecycle_throttle_bidder_2"
  });
  assert.equal(throttleBidder.statusCode, 200, throttleBidder.body);
  assert.equal(throttleBidder.json?.lifecycle?.status, "throttled");

  const blockedAccept = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_mk_lifecycle_3/accept",
    headers: { "x-idempotency-key": "mk_lifecycle_accept_block_1" },
    body: {
      bidId: "bid_mk_lifecycle_2",
      acceptedByAgentId: operatorAgentId
    }
  });
  assert.equal(blockedAccept.statusCode, 429, blockedAccept.body);
  assert.equal(blockedAccept.json?.code, "X402_AGENT_THROTTLED");
  assert.equal(blockedAccept.json?.details?.role, "payee");
  assert.equal(blockedAccept.json?.details?.operation, "marketplace_bid.accept");
});

test("API e2e: marketplace counter-offer and accept routes fail closed when participant signer lifecycle is non-active", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const posterAgentId = "agt_mk_signer_lifecycle_poster_1";
  const bidderAgentId = "agt_mk_signer_lifecycle_bidder_1";
  const operatorAgentId = "agt_mk_signer_lifecycle_operator_1";
  await registerAgent(api, { agentId: posterAgentId });
  const bidder = await registerAgent(api, { agentId: bidderAgentId });
  await registerAgent(api, { agentId: operatorAgentId });

  const createdRfq = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": "mk_signer_lifecycle_rfq_1" },
    body: {
      rfqId: "rfq_mk_signer_lifecycle_1",
      title: "Signer lifecycle negotiation rfq",
      capability: "translate",
      posterAgentId,
      budgetCents: 1500,
      currency: "USD"
    }
  });
  assert.equal(createdRfq.statusCode, 201, createdRfq.body);

  const createdBid = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_mk_signer_lifecycle_1/bids",
    headers: { "x-idempotency-key": "mk_signer_lifecycle_bid_1" },
    body: {
      bidId: "bid_mk_signer_lifecycle_1",
      bidderAgentId,
      amountCents: 1200,
      currency: "USD"
    }
  });
  assert.equal(createdBid.statusCode, 201, createdBid.body);

  await rotateSignerKey(api, { keyId: bidder.keyId });

  const blockedCounterOffer = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_mk_signer_lifecycle_1/bids/bid_mk_signer_lifecycle_1/counter-offer",
    headers: { "x-idempotency-key": "mk_signer_lifecycle_counter_offer_block_1" },
    body: {
      proposerAgentId: bidderAgentId,
      amountCents: 1250
    }
  });
  assert.equal(blockedCounterOffer.statusCode, 409, blockedCounterOffer.body);
  assert.equal(blockedCounterOffer.json?.code, "X402_AGENT_SIGNER_KEY_INVALID");
  assert.equal(blockedCounterOffer.json?.details?.role, "bidder");
  assert.equal(blockedCounterOffer.json?.details?.operation, "marketplace_bid.counter_offer");
  assert.equal(blockedCounterOffer.json?.details?.reasonCode, "SIGNER_KEY_NOT_ACTIVE");
  assert.equal(blockedCounterOffer.json?.details?.signerStatus, "rotated");

  const blockedAccept = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_mk_signer_lifecycle_1/accept",
    headers: { "x-idempotency-key": "mk_signer_lifecycle_accept_block_1" },
    body: {
      bidId: "bid_mk_signer_lifecycle_1",
      acceptedByAgentId: operatorAgentId
    }
  });
  assert.equal(blockedAccept.statusCode, 409, blockedAccept.body);
  assert.equal(blockedAccept.json?.code, "X402_AGENT_SIGNER_KEY_INVALID");
  assert.equal(blockedAccept.json?.details?.role, "payee");
  assert.equal(blockedAccept.json?.details?.operation, "marketplace_bid.accept");
  assert.equal(blockedAccept.json?.details?.reasonCode, "SIGNER_KEY_NOT_ACTIVE");
  assert.equal(blockedAccept.json?.details?.signerStatus, "rotated");
});
