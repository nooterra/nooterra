import test from "node:test";
import assert from "node:assert/strict";

import { SettldClient } from "../packages/api-sdk/src/index.js";

function makeJsonResponse(body, { status = 200, requestId = "req_test_task_neg_1" } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId
    }
  });
}

test("api-sdk: task negotiation methods call expected endpoints", async () => {
  const calls = [];

  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/task-quotes") && String(init?.method) === "POST") {
      return makeJsonResponse({ taskQuote: { quoteId: "tquote_sdk_1" } }, { status: 201 });
    }
    if (String(url).includes("/task-quotes?") && String(init?.method) === "GET") {
      return makeJsonResponse({ taskQuotes: [{ quoteId: "tquote_sdk_1" }], total: 1, limit: 20, offset: 0 });
    }
    if (String(url).endsWith("/task-quotes/tquote_sdk_1") && String(init?.method) === "GET") {
      return makeJsonResponse({ taskQuote: { quoteId: "tquote_sdk_1" } });
    }
    if (String(url).endsWith("/task-offers") && String(init?.method) === "POST") {
      return makeJsonResponse({ taskOffer: { offerId: "toffer_sdk_1" } }, { status: 201 });
    }
    if (String(url).includes("/task-offers?") && String(init?.method) === "GET") {
      return makeJsonResponse({ taskOffers: [{ offerId: "toffer_sdk_1" }], total: 1, limit: 20, offset: 0 });
    }
    if (String(url).endsWith("/task-offers/toffer_sdk_1") && String(init?.method) === "GET") {
      return makeJsonResponse({ taskOffer: { offerId: "toffer_sdk_1" } });
    }
    if (String(url).endsWith("/task-acceptances") && String(init?.method) === "POST") {
      return makeJsonResponse({ taskAcceptance: { acceptanceId: "taccept_sdk_1" } }, { status: 201 });
    }
    if (String(url).includes("/task-acceptances?") && String(init?.method) === "GET") {
      return makeJsonResponse({ taskAcceptances: [{ acceptanceId: "taccept_sdk_1" }], total: 1, limit: 20, offset: 0 });
    }
    if (String(url).endsWith("/task-acceptances/taccept_sdk_1") && String(init?.method) === "GET") {
      return makeJsonResponse({ taskAcceptance: { acceptanceId: "taccept_sdk_1" } });
    }
    return makeJsonResponse({}, { status: 404 });
  };

  const client = new SettldClient({
    baseUrl: "https://api.settld.local",
    tenantId: "tenant_sdk",
    fetch: fetchStub
  });

  await client.createTaskQuote({
    quoteId: "tquote_sdk_1",
    buyerAgentId: "agt_buyer_sdk",
    sellerAgentId: "agt_seller_sdk",
    requiredCapability: "analysis.generic",
    pricing: { amountCents: 500, currency: "USD" }
  });
  assert.equal(calls[0].url, "https://api.settld.local/task-quotes");
  assert.equal(calls[0].init?.method, "POST");

  await client.listTaskQuotes({
    buyerAgentId: "agt_buyer_sdk",
    status: "open",
    limit: 20,
    offset: 0
  });
  assert.equal(calls[1].url, "https://api.settld.local/task-quotes?buyerAgentId=agt_buyer_sdk&status=open&limit=20&offset=0");
  assert.equal(calls[1].init?.method, "GET");

  await client.getTaskQuote("tquote_sdk_1");
  assert.equal(calls[2].url, "https://api.settld.local/task-quotes/tquote_sdk_1");
  assert.equal(calls[2].init?.method, "GET");

  await client.createTaskOffer({
    offerId: "toffer_sdk_1",
    buyerAgentId: "agt_buyer_sdk",
    sellerAgentId: "agt_seller_sdk",
    quoteRef: {
      quoteId: "tquote_sdk_1",
      quoteHash: "f".repeat(64)
    },
    pricing: { amountCents: 500, currency: "USD" }
  });
  assert.equal(calls[3].url, "https://api.settld.local/task-offers");
  assert.equal(calls[3].init?.method, "POST");

  await client.listTaskOffers({
    quoteId: "tquote_sdk_1",
    status: "open",
    limit: 20,
    offset: 0
  });
  assert.equal(calls[4].url, "https://api.settld.local/task-offers?quoteId=tquote_sdk_1&status=open&limit=20&offset=0");
  assert.equal(calls[4].init?.method, "GET");

  await client.getTaskOffer("toffer_sdk_1");
  assert.equal(calls[5].url, "https://api.settld.local/task-offers/toffer_sdk_1");
  assert.equal(calls[5].init?.method, "GET");

  await client.createTaskAcceptance({
    acceptanceId: "taccept_sdk_1",
    quoteId: "tquote_sdk_1",
    offerId: "toffer_sdk_1",
    acceptedByAgentId: "agt_buyer_sdk"
  });
  assert.equal(calls[6].url, "https://api.settld.local/task-acceptances");
  assert.equal(calls[6].init?.method, "POST");

  await client.listTaskAcceptances({
    quoteId: "tquote_sdk_1",
    status: "accepted",
    limit: 20,
    offset: 0
  });
  assert.equal(calls[7].url, "https://api.settld.local/task-acceptances?quoteId=tquote_sdk_1&status=accepted&limit=20&offset=0");
  assert.equal(calls[7].init?.method, "GET");

  await client.getTaskAcceptance("taccept_sdk_1");
  assert.equal(calls[8].url, "https://api.settld.local/task-acceptances/taccept_sdk_1");
  assert.equal(calls[8].init?.method, "GET");
});
