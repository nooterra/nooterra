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
      owner: { ownerType: "service", ownerId: "svc_task_negotiation_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

test("API e2e: task negotiation quote->offer->acceptance lifecycle", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const buyerAgentId = "agt_task_neg_buyer_1";
  const sellerAgentId = "agt_task_neg_seller_1";
  await registerAgent(api, { agentId: buyerAgentId, capabilities: ["analysis.generic"] });
  await registerAgent(api, { agentId: sellerAgentId, capabilities: ["analysis.generic"] });

  const quote = await request(api, {
    method: "POST",
    path: "/task-quotes",
    headers: { "x-idempotency-key": "task_quote_issue_1" },
    body: {
      quoteId: "tquote_1",
      buyerAgentId,
      sellerAgentId,
      requiredCapability: "analysis.generic",
      pricing: { amountCents: 500, currency: "USD" }
    }
  });
  assert.equal(quote.statusCode, 201, quote.body);
  assert.equal(quote.json?.taskQuote?.schemaVersion, "TaskQuote.v1");
  assert.equal(quote.json?.taskQuote?.status, "open");

  const quoteGet = await request(api, { method: "GET", path: "/task-quotes/tquote_1" });
  assert.equal(quoteGet.statusCode, 200, quoteGet.body);
  assert.equal(quoteGet.json?.taskQuote?.quoteId, "tquote_1");

  const quoteList = await request(api, {
    method: "GET",
    path: `/task-quotes?buyerAgentId=${encodeURIComponent(buyerAgentId)}&status=open`
  });
  assert.equal(quoteList.statusCode, 200, quoteList.body);
  assert.equal(quoteList.json?.taskQuotes?.length, 1);

  const offer = await request(api, {
    method: "POST",
    path: "/task-offers",
    headers: { "x-idempotency-key": "task_offer_issue_1" },
    body: {
      offerId: "toffer_1",
      buyerAgentId,
      sellerAgentId,
      quoteRef: {
        quoteId: "tquote_1",
        quoteHash: quote.json.taskQuote.quoteHash
      },
      pricing: { amountCents: 500, currency: "USD" }
    }
  });
  assert.equal(offer.statusCode, 201, offer.body);
  assert.equal(offer.json?.taskOffer?.schemaVersion, "TaskOffer.v1");
  assert.equal(offer.json?.taskOffer?.status, "open");

  const offerGet = await request(api, { method: "GET", path: "/task-offers/toffer_1" });
  assert.equal(offerGet.statusCode, 200, offerGet.body);
  assert.equal(offerGet.json?.taskOffer?.offerId, "toffer_1");

  const acceptance = await request(api, {
    method: "POST",
    path: "/task-acceptances",
    headers: { "x-idempotency-key": "task_acceptance_issue_1" },
    body: {
      acceptanceId: "taccept_1",
      quoteId: "tquote_1",
      offerId: "toffer_1",
      acceptedByAgentId: buyerAgentId
    }
  });
  assert.equal(acceptance.statusCode, 201, acceptance.body);
  assert.equal(acceptance.json?.taskAcceptance?.schemaVersion, "TaskAcceptance.v1");
  assert.equal(acceptance.json?.taskAcceptance?.status, "accepted");
  assert.equal(acceptance.json?.taskAcceptance?.quoteRef?.quoteId, "tquote_1");
  assert.equal(acceptance.json?.taskAcceptance?.offerRef?.offerId, "toffer_1");

  const acceptanceGet = await request(api, { method: "GET", path: "/task-acceptances/taccept_1" });
  assert.equal(acceptanceGet.statusCode, 200, acceptanceGet.body);
  assert.equal(acceptanceGet.json?.taskAcceptance?.acceptanceId, "taccept_1");

  const acceptanceList = await request(api, {
    method: "GET",
    path: `/task-acceptances?quoteId=${encodeURIComponent("tquote_1")}&status=accepted`
  });
  assert.equal(acceptanceList.statusCode, 200, acceptanceList.body);
  assert.equal(acceptanceList.json?.taskAcceptances?.length, 1);
});

test("API e2e: work-order settlement enforces acceptance hash binding", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const buyerAgentId = "agt_task_bind_buyer_1";
  const sellerAgentId = "agt_task_bind_seller_1";
  await registerAgent(api, { agentId: buyerAgentId, capabilities: ["analysis.generic"] });
  await registerAgent(api, { agentId: sellerAgentId, capabilities: ["analysis.generic"] });

  const quote = await request(api, {
    method: "POST",
    path: "/task-quotes",
    headers: { "x-idempotency-key": "task_quote_issue_bind_1" },
    body: {
      quoteId: "tquote_bind_1",
      buyerAgentId,
      sellerAgentId,
      requiredCapability: "analysis.generic",
      pricing: { amountCents: 400, currency: "USD" }
    }
  });
  assert.equal(quote.statusCode, 201, quote.body);

  const offer = await request(api, {
    method: "POST",
    path: "/task-offers",
    headers: { "x-idempotency-key": "task_offer_issue_bind_1" },
    body: {
      offerId: "toffer_bind_1",
      buyerAgentId,
      sellerAgentId,
      quoteRef: {
        quoteId: "tquote_bind_1",
        quoteHash: quote.json.taskQuote.quoteHash
      },
      pricing: { amountCents: 400, currency: "USD" }
    }
  });
  assert.equal(offer.statusCode, 201, offer.body);

  const acceptance = await request(api, {
    method: "POST",
    path: "/task-acceptances",
    headers: { "x-idempotency-key": "task_acceptance_issue_bind_1" },
    body: {
      acceptanceId: "taccept_bind_1",
      quoteId: "tquote_bind_1",
      offerId: "toffer_bind_1",
      acceptedByAgentId: buyerAgentId
    }
  });
  assert.equal(acceptance.statusCode, 201, acceptance.body);

  const workOrder = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_bind_1" },
    body: {
      workOrderId: "workord_bind_1",
      principalAgentId: buyerAgentId,
      subAgentId: sellerAgentId,
      requiredCapability: "analysis.generic",
      specification: { taskType: "analysis" },
      pricing: {
        amountCents: 400,
        currency: "USD",
        quoteId: "tquote_bind_1"
      },
      acceptanceRef: {
        acceptanceId: "taccept_bind_1",
        acceptanceHash: acceptance.json.taskAcceptance.acceptanceHash
      }
    }
  });
  assert.equal(workOrder.statusCode, 201, workOrder.body);
  assert.equal(workOrder.json?.workOrder?.acceptanceBinding?.acceptanceId, "taccept_bind_1");

  const accepted = await request(api, {
    method: "POST",
    path: "/work-orders/workord_bind_1/accept",
    headers: { "x-idempotency-key": "work_order_accept_bind_1" },
    body: { acceptedByAgentId: sellerAgentId }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);

  const completed = await request(api, {
    method: "POST",
    path: "/work-orders/workord_bind_1/complete",
    headers: { "x-idempotency-key": "work_order_complete_bind_1" },
    body: {
      receiptId: "worec_bind_1",
      status: "success",
      outputs: { artifactRef: "artifact://analysis/1" },
      evidenceRefs: ["artifact://analysis/1"],
      amountCents: 400,
      currency: "USD",
      deliveredAt: "2026-02-24T00:30:00.000Z",
      completedAt: "2026-02-24T00:31:00.000Z"
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);

  const settleMismatch = await request(api, {
    method: "POST",
    path: "/work-orders/workord_bind_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_bind_mismatch_1" },
    body: {
      completionReceiptId: "worec_bind_1",
      x402GateId: "x402gate_bind_1",
      x402RunId: "run_bind_1",
      acceptanceHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  });
  assert.equal(settleMismatch.statusCode, 409, settleMismatch.body);
  assert.equal(settleMismatch.json?.code, "WORK_ORDER_SETTLEMENT_CONFLICT");
  assert.match(String(settleMismatch.json?.details?.message ?? ""), /acceptancehash/i);

  const settle = await request(api, {
    method: "POST",
    path: "/work-orders/workord_bind_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_bind_ok_1" },
    body: {
      completionReceiptId: "worec_bind_1",
      x402GateId: "x402gate_bind_1",
      x402RunId: "run_bind_1",
      acceptanceHash: acceptance.json.taskAcceptance.acceptanceHash
    }
  });
  assert.equal(settle.statusCode, 200, settle.body);
  assert.equal(settle.json?.workOrder?.status, "settled");
});
