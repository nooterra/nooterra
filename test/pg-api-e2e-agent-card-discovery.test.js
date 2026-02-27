import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createPgStore } from "../src/db/store-pg.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

function makeSchema() {
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function tenantRequest(api, { tenantId, method, path, headers = null, body = undefined, auth = "auto" }) {
  return request(api, {
    method,
    path,
    headers: {
      "x-proxy-tenant-id": tenantId,
      ...(headers ?? {})
    },
    body,
    auth
  });
}

async function registerAgent(api, { tenantId, agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `pg_card_discovery_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: `svc_${tenantId}` },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function upsertAgentCard(
  api,
  {
    tenantId,
    agentId,
    idempotencyKey,
    visibility = "public",
    displayName = `Card ${agentId}`,
    capabilities = ["travel.booking"],
    host = { runtime: "openclaw", endpoint: `https://example.test/${agentId}`, protocols: ["mcp"] }
  }
) {
  return tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": idempotencyKey },
    body: {
      agentId,
      displayName,
      capabilities,
      visibility,
      host
    }
  });
}

async function creditWallet(api, { tenantId, agentId, idempotencyKey, amountCents, currency = "USD" }) {
  return tenantRequest(api, {
    tenantId,
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-idempotency-key": idempotencyKey },
    body: { amountCents, currency }
  });
}

async function getWallet(api, { tenantId, agentId }) {
  return tenantRequest(api, {
    tenantId,
    method: "GET",
    path: `/agents/${encodeURIComponent(agentId)}/wallet`
  });
}

(databaseUrl ? test : test.skip)("pg api e2e: /agent-cards public list parity is deterministic", async () => {
  const schema = makeSchema();
  const tenantId = "tenant_pg_card_discovery_public_list_1";
  const publicAgentA = "agt_pg_card_public_a_1";
  const publicAgentB = "agt_pg_card_public_b_1";
  const privateAgent = "agt_pg_card_private_1";

  const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
  try {
    const api = createApi({ store });

    await registerAgent(api, { tenantId, agentId: publicAgentB, capabilities: ["travel.booking"] });
    await registerAgent(api, { tenantId, agentId: privateAgent, capabilities: ["travel.booking"] });
    await registerAgent(api, { tenantId, agentId: publicAgentA, capabilities: ["travel.booking"] });

    const upsertPublicB = await upsertAgentCard(api, {
      tenantId,
      agentId: publicAgentB,
      idempotencyKey: "pg_card_discovery_public_b_1",
      visibility: "public"
    });
    assert.equal(upsertPublicB.statusCode, 201, upsertPublicB.body);

    const upsertPrivate = await upsertAgentCard(api, {
      tenantId,
      agentId: privateAgent,
      idempotencyKey: "pg_card_discovery_private_1",
      visibility: "private"
    });
    assert.equal(upsertPrivate.statusCode, 201, upsertPrivate.body);

    const upsertPublicA = await upsertAgentCard(api, {
      tenantId,
      agentId: publicAgentA,
      idempotencyKey: "pg_card_discovery_public_a_1",
      visibility: "public"
    });
    assert.equal(upsertPublicA.statusCode, 201, upsertPublicA.body);

    const listed = await tenantRequest(api, {
      tenantId,
      method: "GET",
      path: "/agent-cards?visibility=public&limit=10&offset=0"
    });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(Array.isArray(listed.json?.agentCards), true);
    const listedIds = listed.json.agentCards.map((row) => row?.agentId);
    assert.deepEqual(listedIds, [publicAgentA, publicAgentB]);
    assert.equal(listed.json.agentCards.every((row) => row?.visibility === "public"), true);

    const listedAgain = await tenantRequest(api, {
      tenantId,
      method: "GET",
      path: "/agent-cards?visibility=public&limit=10&offset=0"
    });
    assert.equal(listedAgain.statusCode, 200, listedAgain.body);
    assert.deepEqual(
      listedAgain.json?.agentCards?.map((row) => row?.agentId),
      listedIds
    );
  } finally {
    await store.close();
  }
});

(databaseUrl ? test : test.skip)("pg api e2e: public AgentCard listing fee fails closed for insufficient funds", async () => {
  const schema = makeSchema();
  const tenantId = "tenant_pg_card_discovery_listing_fee_insufficient_1";
  const collectorAgentId = "agt_pg_card_fee_collector_1";
  const feePayerAgentId = "agt_pg_card_fee_payer_1";

  const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
  try {
    const api = createApi({
      store,
      opsToken: "tok_ops",
      agentCardPublicListingFeeCents: 500,
      agentCardPublicListingFeeCurrency: "USD",
      agentCardPublicListingFeeCollectorAgentId: collectorAgentId
    });

    await registerAgent(api, { tenantId, agentId: collectorAgentId });
    await registerAgent(api, { tenantId, agentId: feePayerAgentId, capabilities: ["travel.booking"] });

    const denied = await upsertAgentCard(api, {
      tenantId,
      agentId: feePayerAgentId,
      idempotencyKey: "pg_card_fee_insufficient_upsert_1",
      visibility: "public",
      displayName: "PG Listing Fee Insufficient",
      capabilities: ["travel.booking"]
    });
    assert.equal(denied.statusCode, 402, denied.body);
    assert.equal(denied.json?.code, "INSUFFICIENT_FUNDS");

    const cardLookup = await tenantRequest(api, {
      tenantId,
      method: "GET",
      path: `/agent-cards/${encodeURIComponent(feePayerAgentId)}`
    });
    assert.equal(cardLookup.statusCode, 404, cardLookup.body);

    const payerWallet = await getWallet(api, { tenantId, agentId: feePayerAgentId });
    assert.equal(payerWallet.statusCode, 200, payerWallet.body);
    assert.equal(payerWallet.json?.wallet?.availableCents, 0);

    const collectorWallet = await getWallet(api, { tenantId, agentId: collectorAgentId });
    assert.equal(collectorWallet.statusCode, 200, collectorWallet.body);
    assert.equal(collectorWallet.json?.wallet?.availableCents, 0);
  } finally {
    await store.close();
  }
});

(databaseUrl ? test : test.skip)(
  "pg api e2e: public AgentCard listing fee fails closed when collector identity is missing",
  async () => {
    const schema = makeSchema();
    const tenantId = "tenant_pg_card_discovery_listing_fee_missing_collector_1";
    const missingCollectorAgentId = "agt_pg_card_fee_missing_collector_1";
    const feePayerAgentId = "agt_pg_card_fee_payer_missing_collector_1";

    const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    try {
      const api = createApi({
        store,
        opsToken: "tok_ops",
        agentCardPublicListingFeeCents: 250,
        agentCardPublicListingFeeCurrency: "USD",
        agentCardPublicListingFeeCollectorAgentId: missingCollectorAgentId
      });

      await registerAgent(api, { tenantId, agentId: feePayerAgentId, capabilities: ["travel.booking"] });

      const funded = await creditWallet(api, {
        tenantId,
        agentId: feePayerAgentId,
        idempotencyKey: "pg_card_fee_missing_collector_credit_1",
        amountCents: 1000,
        currency: "USD"
      });
      assert.equal(funded.statusCode, 201, funded.body);

      const denied = await upsertAgentCard(api, {
        tenantId,
        agentId: feePayerAgentId,
        idempotencyKey: "pg_card_fee_missing_collector_upsert_1",
        visibility: "public",
        displayName: "PG Listing Fee Missing Collector",
        capabilities: ["travel.booking"]
      });
      assert.equal(denied.statusCode, 409, denied.body);
      assert.equal(denied.json?.code, "AGENT_CARD_PUBLIC_LISTING_FEE_MISCONFIGURED");

      const cardLookup = await tenantRequest(api, {
        tenantId,
        method: "GET",
        path: `/agent-cards/${encodeURIComponent(feePayerAgentId)}`
      });
      assert.equal(cardLookup.statusCode, 404, cardLookup.body);

      const payerWallet = await getWallet(api, { tenantId, agentId: feePayerAgentId });
      assert.equal(payerWallet.statusCode, 200, payerWallet.body);
      assert.equal(payerWallet.json?.wallet?.availableCents, 1000);
    } finally {
      await store.close();
    }
  }
);

(databaseUrl ? test : test.skip)("pg api e2e: public AgentCard listing fee charges once and not on update", async () => {
  const schema = makeSchema();
  const tenantId = "tenant_pg_card_discovery_listing_fee_once_1";
  const collectorAgentId = "agt_pg_card_fee_collector_once_1";
  const feePayerAgentId = "agt_pg_card_fee_payer_once_1";

  const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
  try {
    const api = createApi({
      store,
      opsToken: "tok_ops",
      agentCardPublicListingFeeCents: 500,
      agentCardPublicListingFeeCurrency: "USD",
      agentCardPublicListingFeeCollectorAgentId: collectorAgentId
    });

    await registerAgent(api, { tenantId, agentId: collectorAgentId });
    await registerAgent(api, { tenantId, agentId: feePayerAgentId, capabilities: ["travel.booking"] });

    const funded = await creditWallet(api, {
      tenantId,
      agentId: feePayerAgentId,
      idempotencyKey: "pg_card_fee_once_credit_1",
      amountCents: 1200,
      currency: "USD"
    });
    assert.equal(funded.statusCode, 201, funded.body);

    const listed = await upsertAgentCard(api, {
      tenantId,
      agentId: feePayerAgentId,
      idempotencyKey: "pg_card_fee_once_upsert_1",
      visibility: "public",
      displayName: "PG Listing Fee Once",
      capabilities: ["travel.booking"]
    });
    assert.equal(listed.statusCode, 201, listed.body);
    assert.equal(listed.json?.agentCard?.metadata?.publicListingFee?.schemaVersion, "AgentCardPublicListingFee.v1");
    assert.equal(listed.json?.agentCard?.metadata?.publicListingFee?.amountCents, 500);
    assert.equal(listed.json?.agentCard?.metadata?.publicListingFee?.currency, "USD");
    assert.equal(listed.json?.agentCard?.metadata?.publicListingFee?.collectorAgentId, collectorAgentId);
    const firstChargedAt = listed.json?.agentCard?.metadata?.publicListingFee?.chargedAt;
    assert.equal(typeof firstChargedAt, "string");

    const payerWalletAfterFirstListing = await getWallet(api, { tenantId, agentId: feePayerAgentId });
    assert.equal(payerWalletAfterFirstListing.statusCode, 200, payerWalletAfterFirstListing.body);
    assert.equal(payerWalletAfterFirstListing.json?.wallet?.availableCents, 700);

    const collectorWalletAfterFirstListing = await getWallet(api, { tenantId, agentId: collectorAgentId });
    assert.equal(collectorWalletAfterFirstListing.statusCode, 200, collectorWalletAfterFirstListing.body);
    assert.equal(collectorWalletAfterFirstListing.json?.wallet?.availableCents, 500);

    const updated = await upsertAgentCard(api, {
      tenantId,
      agentId: feePayerAgentId,
      idempotencyKey: "pg_card_fee_once_upsert_2",
      visibility: "public",
      displayName: "PG Listing Fee Once (Updated)",
      capabilities: ["travel.booking"]
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json?.agentCard?.metadata?.publicListingFee?.chargedAt, firstChargedAt);

    const payerWalletAfterUpdate = await getWallet(api, { tenantId, agentId: feePayerAgentId });
    assert.equal(payerWalletAfterUpdate.statusCode, 200, payerWalletAfterUpdate.body);
    assert.equal(payerWalletAfterUpdate.json?.wallet?.availableCents, 700);

    const collectorWalletAfterUpdate = await getWallet(api, { tenantId, agentId: collectorAgentId });
    assert.equal(collectorWalletAfterUpdate.statusCode, 200, collectorWalletAfterUpdate.body);
    assert.equal(collectorWalletAfterUpdate.json?.wallet?.availableCents, 500);
  } finally {
    await store.close();
  }
});
