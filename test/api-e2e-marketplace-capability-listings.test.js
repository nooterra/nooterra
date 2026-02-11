import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, agentId) {
  const created = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `register_${agentId}` },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId: "svc_marketplace_test" },
      publicKeyPem: createEd25519Keypair().publicKeyPem,
      capabilities: ["translate", "summarize"]
    }
  });
  assert.equal(created.statusCode, 201, created.body);
}

test("API e2e: marketplace capability listings CRUD + idempotency", async () => {
  const api = createApi();
  await registerAgent(api, "agt_listing_seller_1");

  const createBody = {
    listingId: "cap_translate_1",
    capability: "translate",
    title: "Translation Fast Lane",
    sellerAgentId: "agt_listing_seller_1",
    status: "active",
    description: "Human-in-the-loop translation support.",
    category: "language",
    tags: ["translation", "language", "translation"],
    priceModel: {
      mode: "fixed",
      amountCents: 2500,
      currency: "usd"
    }
  };

  const created = await request(api, {
    method: "POST",
    path: "/marketplace/capability-listings",
    headers: { "x-idempotency-key": "cap_listing_create_1" },
    body: createBody
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.listing?.schemaVersion, "MarketplaceCapabilityListing.v1");
  assert.equal(created.json?.listing?.listingId, "cap_translate_1");
  assert.equal(created.json?.listing?.status, "active");
  assert.deepEqual(created.json?.listing?.tags, ["translation", "language"]);
  assert.equal(created.json?.listing?.priceModel?.schemaVersion, "MarketplaceCapabilityPriceModel.v1");
  assert.equal(created.json?.listing?.priceModel?.currency, "USD");

  const createReplay = await request(api, {
    method: "POST",
    path: "/marketplace/capability-listings",
    headers: { "x-idempotency-key": "cap_listing_create_1" },
    body: createBody
  });
  assert.equal(createReplay.statusCode, 201, createReplay.body);
  assert.deepEqual(createReplay.json, created.json);

  const createConflict = await request(api, {
    method: "POST",
    path: "/marketplace/capability-listings",
    headers: { "x-idempotency-key": "cap_listing_create_1" },
    body: {
      ...createBody,
      title: "Changed title should conflict for same idempotency key"
    }
  });
  assert.equal(createConflict.statusCode, 409, createConflict.body);

  const listActive = await request(api, {
    method: "GET",
    path: "/marketplace/capability-listings?status=active&capability=translate&sellerAgentId=agt_listing_seller_1&q=fast&limit=10&offset=0"
  });
  assert.equal(listActive.statusCode, 200, listActive.body);
  assert.equal(listActive.json?.total, 1);
  assert.equal(listActive.json?.listings?.[0]?.listingId, "cap_translate_1");

  const getById = await request(api, {
    method: "GET",
    path: "/marketplace/capability-listings/cap_translate_1"
  });
  assert.equal(getById.statusCode, 200, getById.body);
  assert.equal(getById.json?.listing?.listingId, "cap_translate_1");

  const updated = await request(api, {
    method: "POST",
    path: "/marketplace/capability-listings/cap_translate_1",
    headers: { "x-idempotency-key": "cap_listing_update_1" },
    body: {
      listingId: "cap_translate_1",
      title: "Translation Fast Lane (paused)",
      status: "paused",
      tags: ["translation", "paused"],
      priceModel: {
        mode: "hourly",
        amountCents: 4500,
        currency: "USD",
        unit: "hour"
      }
    }
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json?.listing?.status, "paused");
  assert.deepEqual(updated.json?.listing?.tags, ["translation", "paused"]);
  assert.equal(updated.json?.listing?.priceModel?.mode, "hourly");
  assert.equal(updated.json?.listing?.priceModel?.unit, "hour");

  const listPaused = await request(api, {
    method: "GET",
    path: "/marketplace/capability-listings?status=paused&limit=10&offset=0"
  });
  assert.equal(listPaused.statusCode, 200, listPaused.body);
  assert.equal(listPaused.json?.total, 1);
  assert.equal(listPaused.json?.listings?.[0]?.listingId, "cap_translate_1");

  const deleted = await request(api, {
    method: "DELETE",
    path: "/marketplace/capability-listings/cap_translate_1",
    headers: { "x-idempotency-key": "cap_listing_delete_1" }
  });
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(deleted.json?.ok, true);
  assert.equal(deleted.json?.deleted, true);
  assert.equal(deleted.json?.listingId, "cap_translate_1");

  const deleteReplay = await request(api, {
    method: "DELETE",
    path: "/marketplace/capability-listings/cap_translate_1",
    headers: { "x-idempotency-key": "cap_listing_delete_1" }
  });
  assert.equal(deleteReplay.statusCode, 200, deleteReplay.body);
  assert.deepEqual(deleteReplay.json, deleted.json);

  const getAfterDelete = await request(api, {
    method: "GET",
    path: "/marketplace/capability-listings/cap_translate_1"
  });
  assert.equal(getAfterDelete.statusCode, 404, getAfterDelete.body);
});

test("API e2e: capability listing rejects unknown seller agent identity", async () => {
  const api = createApi();

  const create = await request(api, {
    method: "POST",
    path: "/marketplace/capability-listings",
    headers: { "x-idempotency-key": "cap_listing_missing_seller_1" },
    body: {
      listingId: "cap_missing_seller_1",
      capability: "summarize",
      sellerAgentId: "agt_unknown_missing",
      status: "active"
    }
  });
  assert.equal(create.statusCode, 404, create.body);
  assert.match(create.body, /seller agent identity not found/i);
});
