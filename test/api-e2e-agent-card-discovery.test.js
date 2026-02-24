import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair, signHashHexEd25519 } from "../src/core/crypto.js";
import { buildCapabilityAttestationV1, computeCapabilityAttestationSignaturePayloadHashV1 } from "../src/core/capability-attestation.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `agent_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  const keyId = typeof response.json?.keyId === "string" && response.json.keyId.trim() !== "" ? response.json.keyId.trim() : null;
  assert.ok(keyId, "registerAgent must return keyId");
  return { agentId, keyId, publicKeyPem, privateKeyPem };
}

function signCapabilityAttestationCreate({
  tenantId = "tenant_default",
  issuerKeyId,
  issuerPrivateKeyPem,
  attestationId,
  subjectAgentId,
  capability,
  level,
  issuerAgentId,
  validity
} = {}) {
  const preview = buildCapabilityAttestationV1({
    attestationId,
    tenantId,
    subjectAgentId,
    capability,
    level,
    issuerAgentId,
    validity,
    signature: { algorithm: "ed25519", keyId: issuerKeyId, signature: "sig_preview" },
    createdAt: "2026-02-23T00:00:00.000Z"
  });
  const payloadHashHex = computeCapabilityAttestationSignaturePayloadHashV1(preview);
  return signHashHexEd25519(payloadHashHex, issuerPrivateKeyPem);
}

async function createSettledRun({
  api,
  agentId,
  runId,
  payerAgentId,
  amountCents = 1000,
  idempotencyPrefix = runId
}) {
  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs`,
    headers: { "x-idempotency-key": `create_${idempotencyPrefix}` },
    body: {
      runId,
      settlement: { payerAgentId, amountCents, currency: "USD", disputeWindowDays: 7 }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  let prev = created.json?.run?.lastChainHash;
  assert.ok(prev);

  const evidence = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": `evidence_${idempotencyPrefix}`
    },
    body: {
      type: "EVIDENCE_ADDED",
      payload: { evidenceRef: `evidence://${runId}/output.json` }
    }
  });
  assert.equal(evidence.statusCode, 201, evidence.body);
  prev = evidence.json?.run?.lastChainHash;
  assert.ok(prev);

  const completed = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": `complete_${idempotencyPrefix}`
    },
    body: {
      type: "RUN_COMPLETED",
      payload: {
        outputRef: `evidence://${runId}/output.json`,
        metrics: { latencyMs: 500 }
      }
    }
  });
  assert.equal(completed.statusCode, 201, completed.body);
}

async function openRunDispute({
  api,
  runId,
  openedByAgentId,
  disputeId
}) {
  const opened = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
    headers: { "x-idempotency-key": `dispute_open_${disputeId}` },
    body: {
      disputeId,
      disputeType: "quality",
      disputePriority: "normal",
      disputeChannel: "counterparty",
      escalationLevel: "l1_counterparty",
      openedByAgentId,
      reason: "test routing dispute signal"
    }
  });
  assert.equal(opened.statusCode, 200, opened.body);
}

test("API e2e: AgentCard.v1 upsert/list/get/discover", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  await registerAgent(api, {
    agentId: "agt_card_travel_1",
    capabilities: ["travel.booking", "travel.search"]
  });
  await registerAgent(api, {
    agentId: "agt_card_code_1",
    capabilities: ["code.generation"]
  });

  const upsertTravel = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_upsert_travel_1" },
    body: {
      agentId: "agt_card_travel_1",
      displayName: "Travel Booker",
      description: "Books flights with guardrails.",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: {
        runtime: "openclaw",
        endpoint: "https://example.test/agents/travel",
        protocols: ["mcp", "http"]
      },
      priceHint: {
        amountCents: 250,
        currency: "USD",
        unit: "task"
      },
      tags: ["travel", "booking"],
      attestations: [{ type: "self-claim", level: "self_claim" }]
    }
  });
  assert.equal(upsertTravel.statusCode, 201, upsertTravel.body);
  assert.equal(upsertTravel.json?.agentCard?.schemaVersion, "AgentCard.v1");
  assert.equal(upsertTravel.json?.agentCard?.status, "active");
  assert.equal(upsertTravel.json?.agentCard?.visibility, "public");

  const upsertCode = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_upsert_code_1" },
    body: {
      agentId: "agt_card_code_1",
      displayName: "Code Worker",
      capabilities: ["code.generation"],
      visibility: "private",
      host: {
        runtime: "codex"
      }
    }
  });
  assert.equal(upsertCode.statusCode, 201, upsertCode.body);
  assert.equal(upsertCode.json?.agentCard?.visibility, "private");

  const listedPublic = await request(api, {
    method: "GET",
    path: "/agent-cards?visibility=public"
  });
  assert.equal(listedPublic.statusCode, 200, listedPublic.body);
  assert.equal(Array.isArray(listedPublic.json?.agentCards), true);
  assert.equal(listedPublic.json.agentCards.length, 1);
  assert.equal(listedPublic.json.agentCards[0]?.agentId, "agt_card_travel_1");

  const getTravel = await request(api, {
    method: "GET",
    path: "/agent-cards/agt_card_travel_1"
  });
  assert.equal(getTravel.statusCode, 200, getTravel.body);
  assert.equal(getTravel.json?.agentCard?.displayName, "Travel Booker");

  const discovered = await request(api, {
    method: "GET",
    path: "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&minTrustScore=40&includeReputation=true&reputationVersion=v2&reputationWindow=30d&scoreStrategy=balanced&limit=10&offset=0"
  });
  assert.equal(discovered.statusCode, 200, discovered.body);
  assert.equal(discovered.json?.ok, true);
  assert.equal(discovered.json?.results?.length, 1);
  assert.equal(discovered.json?.results?.[0]?.agentCard?.agentId, "agt_card_travel_1");
  assert.equal(typeof discovered.json?.results?.[0]?.reputation?.trustScore, "number");

  const invalidCapability = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_upsert_invalid_cap_1" },
    body: {
      agentId: "agt_card_travel_1",
      capabilities: ["finance.trading"]
    }
  });
  assert.equal(invalidCapability.statusCode, 400, invalidCapability.body);
  assert.equal(invalidCapability.json?.code, "SCHEMA_INVALID");
});

test("API e2e: public AgentCard listing fee is fail-closed and charged once", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    agentCardPublicListingFeeCents: 500,
    agentCardPublicListingFeeCurrency: "USD",
    agentCardPublicListingFeeCollectorAgentId: "agt_card_fee_collector_1"
  });

  const feePayerAgentId = "agt_card_fee_payer_1";
  const collectorAgentId = "agt_card_fee_collector_1";
  await registerAgent(api, { agentId: collectorAgentId });
  await registerAgent(api, {
    agentId: feePayerAgentId,
    capabilities: ["travel.booking"]
  });

  const denied = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_fee_upsert_denied_1" },
    body: {
      agentId: feePayerAgentId,
      displayName: "Travel Booking Fee Agent",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(denied.statusCode, 402, denied.body);
  assert.equal(denied.json?.code, "INSUFFICIENT_FUNDS");

  const funded = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(feePayerAgentId)}/wallet/credit`,
    headers: { "x-idempotency-key": "wallet_credit_agent_card_fee_1" },
    body: { amountCents: 1200, currency: "USD" }
  });
  assert.equal(funded.statusCode, 201, funded.body);

  const listed = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_fee_upsert_allowed_1" },
    body: {
      agentId: feePayerAgentId,
      displayName: "Travel Booking Fee Agent",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(listed.statusCode, 201, listed.body);
  assert.equal(listed.json?.agentCard?.metadata?.publicListingFee?.schemaVersion, "AgentCardPublicListingFee.v1");
  assert.equal(listed.json?.agentCard?.metadata?.publicListingFee?.amountCents, 500);
  assert.equal(listed.json?.agentCard?.metadata?.publicListingFee?.currency, "USD");
  assert.equal(listed.json?.agentCard?.metadata?.publicListingFee?.collectorAgentId, collectorAgentId);

  const payerWalletAfterFirstListing = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(feePayerAgentId)}/wallet`
  });
  assert.equal(payerWalletAfterFirstListing.statusCode, 200, payerWalletAfterFirstListing.body);
  assert.equal(payerWalletAfterFirstListing.json?.wallet?.availableCents, 700);

  const collectorWalletAfterFirstListing = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(collectorAgentId)}/wallet`
  });
  assert.equal(collectorWalletAfterFirstListing.statusCode, 200, collectorWalletAfterFirstListing.body);
  assert.equal(collectorWalletAfterFirstListing.json?.wallet?.availableCents, 500);

  const updatePublicCard = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_fee_upsert_update_1" },
    body: {
      agentId: feePayerAgentId,
      displayName: "Travel Booking Fee Agent (Updated)",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(updatePublicCard.statusCode, 200, updatePublicCard.body);

  const payerWalletAfterUpdate = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(feePayerAgentId)}/wallet`
  });
  assert.equal(payerWalletAfterUpdate.statusCode, 200, payerWalletAfterUpdate.body);
  assert.equal(payerWalletAfterUpdate.json?.wallet?.availableCents, 700);

  const collectorWalletAfterUpdate = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(collectorAgentId)}/wallet`
  });
  assert.equal(collectorWalletAfterUpdate.statusCode, 200, collectorWalletAfterUpdate.body);
  assert.equal(collectorWalletAfterUpdate.json?.wallet?.availableCents, 500);
});

test("API e2e: public AgentCard listing fee fails closed when collector identity is missing", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    agentCardPublicListingFeeCents: 250,
    agentCardPublicListingFeeCurrency: "USD",
    agentCardPublicListingFeeCollectorAgentId: "agt_card_fee_missing_collector_1"
  });
  const feePayerAgentId = "agt_card_fee_payer_missing_collector_1";
  await registerAgent(api, {
    agentId: feePayerAgentId,
    capabilities: ["travel.booking"]
  });
  const funded = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(feePayerAgentId)}/wallet/credit`,
    headers: { "x-idempotency-key": "wallet_credit_agent_card_fee_missing_collector_1" },
    body: { amountCents: 1000, currency: "USD" }
  });
  assert.equal(funded.statusCode, 201, funded.body);

  const denied = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_fee_missing_collector_1" },
    body: {
      agentId: feePayerAgentId,
      displayName: "Travel Booking Missing Collector",
      capabilities: ["travel.booking"],
      visibility: "public"
    }
  });
  assert.equal(denied.statusCode, 409, denied.body);
  assert.equal(denied.json?.code, "AGENT_CARD_PUBLIC_LISTING_FEE_MISCONFIGURED");

  const payerWallet = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(feePayerAgentId)}/wallet`
  });
  assert.equal(payerWallet.statusCode, 200, payerWallet.body);
  assert.equal(payerWallet.json?.wallet?.availableCents, 1000);
});

test("API e2e: public AgentCard listing bond is required for public publishing", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    agentCardPublicListingBondCents: 250,
    agentCardPublicListingBondCurrency: "USD"
  });
  const agentId = "agt_card_bond_required_1";
  await registerAgent(api, { agentId, capabilities: ["travel.booking"] });

  const denied = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_bond_required_denied_1" },
    body: {
      agentId,
      displayName: "Bond Required Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/bond-required", protocols: ["mcp"] }
    }
  });
  assert.equal(denied.statusCode, 402, denied.body);
  assert.equal(denied.json?.code, "AGENT_CARD_PUBLIC_LISTING_BOND_REQUIRED");
  assert.equal(denied.json?.details?.schemaVersion, "AgentCardPublicListingBondRequirement.v1");
});

test("API e2e: listing bond publish succeeds and is discoverable", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    agentCardPublicListingBondCents: 250,
    agentCardPublicListingBondCurrency: "USD"
  });
  const agentId = "agt_card_bond_allowed_1";
  await registerAgent(api, { agentId, capabilities: ["travel.booking"] });

  const funded = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-idempotency-key": "wallet_credit_agent_card_bond_allowed_1" },
    body: { amountCents: 2000, currency: "USD" }
  });
  assert.equal(funded.statusCode, 201, funded.body);

  const issued = await request(api, {
    method: "POST",
    path: "/agent-cards/listing-bonds",
    headers: { "x-idempotency-key": "listing_bond_issue_1" },
    body: { agentId }
  });
  assert.equal(issued.statusCode, 201, issued.body);
  assert.equal(issued.json?.bond?.schemaVersion, "ListingBond.v1");

  const published = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_bond_publish_1" },
    body: {
      agentId,
      displayName: "Bond Allowed Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/bond-allowed", protocols: ["mcp"] },
      listingBond: issued.json?.bond
    }
  });
  assert.equal(published.statusCode, 201, published.body);
  assert.equal(published.json?.agentCard?.metadata?.publicListingBond?.schemaVersion, "ListingBond.v1");

  const discovered = await request(api, {
    method: "GET",
    path: "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&limit=10&offset=0"
  });
  assert.equal(discovered.statusCode, 200, discovered.body);
  assert.equal(discovered.json?.results?.[0]?.agentCard?.agentId, agentId);
});

test("API adversarial: flood publish is rate limited and invalid bond attempt quarantines agent from discovery", async () => {
  let nowAt = "2026-02-24T00:00:00.000Z";
  const api = createApi({
    opsToken: "tok_ops",
    now: () => nowAt,
    agentCardPublicListingBondCents: 100,
    agentCardPublicListingBondCurrency: "USD",
    agentCardPublicListingBondRateLimitSeconds: 10,
    agentCardPublicListingBondEscalationWindowSeconds: 60,
    agentCardPublicListingBondEscalationMultiplier: 2
  });
  const agentId = "agt_card_bond_adv_1";
  await registerAgent(api, { agentId, capabilities: ["travel.booking"] });
  const funded = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-idempotency-key": "wallet_credit_agent_card_bond_adv_1" },
    body: { amountCents: 5000, currency: "USD" }
  });
  assert.equal(funded.statusCode, 201, funded.body);

  const issued = await request(api, {
    method: "POST",
    path: "/agent-cards/listing-bonds",
    headers: { "x-idempotency-key": "listing_bond_issue_adv_1" },
    body: { agentId }
  });
  assert.equal(issued.statusCode, 201, issued.body);

  const published = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_bond_adv_publish_1" },
    body: {
      agentId,
      displayName: "Bond Adv Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/bond-adv", protocols: ["mcp"] },
      listingBond: issued.json?.bond
    }
  });
  assert.equal(published.statusCode, 201, published.body);

  nowAt = "2026-02-24T00:00:05.000Z";
  const floodBond = await request(api, {
    method: "POST",
    path: "/agent-cards/listing-bonds",
    headers: { "x-idempotency-key": "listing_bond_issue_adv_flood_1" },
    body: { agentId }
  });
  assert.equal(floodBond.statusCode, 429, floodBond.body);
  assert.equal(floodBond.json?.code, "AGENT_CARD_PUBLIC_LISTING_RATE_LIMITED");

  nowAt = "2026-02-24T00:00:20.000Z";
  const issued2 = await request(api, {
    method: "POST",
    path: "/agent-cards/listing-bonds",
    headers: { "x-idempotency-key": "listing_bond_issue_adv_2" },
    body: { agentId }
  });
  assert.equal(issued2.statusCode, 201, issued2.body);

  const tampered = JSON.parse(JSON.stringify(issued2.json?.bond));
  tampered.signature.signatureBase64 = "AA" + String(tampered.signature.signatureBase64 ?? "").slice(2);

  const rejected = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_bond_adv_publish_tampered_1" },
    body: {
      agentId,
      displayName: "Bond Adv Agent (Bad)",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/bond-adv-bad", protocols: ["mcp"] },
      listingBond: tampered
    }
  });
  assert.equal(rejected.statusCode, 409, rejected.body);
  assert.equal(rejected.json?.code, "AGENT_CARD_PUBLIC_LISTING_BOND_INVALID");

  const discovered = await request(api, {
    method: "GET",
    path: "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&limit=10&offset=0"
  });
  assert.equal(discovered.statusCode, 200, discovered.body);
  assert.equal(discovered.json?.results?.length, 0);
});

test("API e2e: trust-weighted routing strategy is explainable and deterministic", async () => {
  let nowAt = "2026-02-23T00:00:00.000Z";
  const api = createApi({
    opsToken: "tok_ops",
    now: () => nowAt
  });

  const requesterAgentId = "agt_router_requester_1";
  const candidateGood = "agt_router_good_1";
  const candidateRisky = "agt_router_risky_1";
  const tieA = "agt_router_tie_a";
  const tieB = "agt_router_tie_b";
  const issuerAgentId = "agt_router_issuer_1";

  await registerAgent(api, { agentId: requesterAgentId });
  await registerAgent(api, { agentId: candidateGood, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: candidateRisky, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: tieA, capabilities: ["travel.search"] });
  await registerAgent(api, { agentId: tieB, capabilities: ["travel.search"] });
  const issuer = await registerAgent(api, { agentId: issuerAgentId, capabilities: ["attestation.issue"] });

  const funded = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(requesterAgentId)}/wallet/credit`,
    headers: { "x-idempotency-key": "wallet_credit_router_1" },
    body: { amountCents: 100000, currency: "USD" }
  });
  assert.equal(funded.statusCode, 201, funded.body);

  const upsertGood = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_router_good_1" },
    body: {
      agentId: candidateGood,
      displayName: "Router Good",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/router/good", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertGood.statusCode, 201, upsertGood.body);

  const upsertRisky = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_router_risky_1" },
    body: {
      agentId: candidateRisky,
      displayName: "Router Risky",
      capabilities: ["travel.booking"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/router/risky", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertRisky.statusCode, 201, upsertRisky.body);

  const upsertTieA = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_router_tie_a_1" },
    body: {
      agentId: tieA,
      displayName: "Router Tie A",
      capabilities: ["travel.search"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/router/tie-a", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertTieA.statusCode, 201, upsertTieA.body);

  const upsertTieB = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_router_tie_b_1" },
    body: {
      agentId: tieB,
      displayName: "Router Tie B",
      capabilities: ["travel.search"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/router/tie-b", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertTieB.statusCode, 201, upsertTieB.body);

  nowAt = "2026-02-23T01:00:00.000Z";
  await createSettledRun({
    api,
    agentId: candidateGood,
    runId: "run_router_good_1",
    payerAgentId: requesterAgentId,
    idempotencyPrefix: "run_router_good_1"
  });
  nowAt = "2026-02-23T02:00:00.000Z";
  await createSettledRun({
    api,
    agentId: candidateGood,
    runId: "run_router_good_2",
    payerAgentId: requesterAgentId,
    idempotencyPrefix: "run_router_good_2"
  });

  nowAt = "2026-02-23T03:00:00.000Z";
  await createSettledRun({
    api,
    agentId: candidateRisky,
    runId: "run_router_risky_1",
    payerAgentId: requesterAgentId,
    idempotencyPrefix: "run_router_risky_1"
  });
  nowAt = "2026-02-23T04:00:00.000Z";
  await createSettledRun({
    api,
    agentId: candidateRisky,
    runId: "run_router_risky_2",
    payerAgentId: requesterAgentId,
    idempotencyPrefix: "run_router_risky_2"
  });
  nowAt = "2026-02-23T05:00:00.000Z";
  await openRunDispute({
    api,
    runId: "run_router_risky_2",
    openedByAgentId: requesterAgentId,
    disputeId: "dsp_router_risky_1"
  });

  const issueAttestation = await request(api, {
    method: "POST",
    path: "/capability-attestations",
    headers: { "x-idempotency-key": "router_attestation_good_1" },
    body: {
      attestationId: "catt_router_good_1",
      subjectAgentId: candidateGood,
      capability: "travel.booking",
      level: "attested",
      issuerAgentId,
      validity: {
        issuedAt: "2026-02-23T00:00:00.000Z",
        notBefore: "2026-02-23T00:00:00.000Z",
        expiresAt: "2027-02-23T00:00:00.000Z"
      },
      signature: {
        algorithm: "ed25519",
        keyId: issuer.keyId,
        signature: signCapabilityAttestationCreate({
          issuerKeyId: issuer.keyId,
          issuerPrivateKeyPem: issuer.privateKeyPem,
          attestationId: "catt_router_good_1",
          subjectAgentId: candidateGood,
          capability: "travel.booking",
          level: "attested",
          issuerAgentId,
          validity: {
            issuedAt: "2026-02-23T00:00:00.000Z",
            notBefore: "2026-02-23T00:00:00.000Z",
            expiresAt: "2027-02-23T00:00:00.000Z"
          }
        })
      }
    }
  });
  assert.equal(issueAttestation.statusCode, 201, issueAttestation.body);

  nowAt = "2026-02-23T06:00:00.000Z";
  const routed = await request(api, {
    method: "GET",
    path:
      `/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active` +
      `&includeReputation=false&includeAttestationMetadata=true&includeRoutingFactors=true&scoreStrategy=trust_weighted` +
      `&requesterAgentId=${encodeURIComponent(requesterAgentId)}&limit=10&offset=0`
  });
  assert.equal(routed.statusCode, 200, routed.body);
  assert.equal(routed.json?.scoreStrategy, "trust_weighted");
  assert.equal(routed.json?.results?.[0]?.agentCard?.agentId, candidateGood);
  assert.equal(routed.json?.results?.[1]?.agentCard?.agentId, candidateRisky);
  assert.ok(Number(routed.json?.results?.[0]?.rankingScore ?? 0) > Number(routed.json?.results?.[1]?.rankingScore ?? 0));
  assert.equal(routed.json?.results?.[0]?.routingFactors?.schemaVersion, "TrustRoutingFactors.v1");
  assert.equal(routed.json?.results?.[0]?.routingFactors?.strategy, "trust_weighted");
  assert.equal(
    routed.json?.results?.[0]?.routingFactors?.signals?.relationshipHistory?.counterpartyAgentId,
    requesterAgentId
  );
  assert.equal(routed.json?.results?.[0]?.capabilityAttestation?.attestationId, "catt_router_good_1");

  const routedNoRequester = await request(api, {
    method: "GET",
    path:
      `/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active` +
      `&includeReputation=false&includeRoutingFactors=true&scoreStrategy=trust_weighted&limit=10&offset=0`
  });
  assert.equal(routedNoRequester.statusCode, 200, routedNoRequester.body);
  assert.equal(routedNoRequester.json?.results?.[0]?.agentCard?.agentId, candidateGood);
  assert.equal(routedNoRequester.json?.results?.[0]?.routingFactors?.strategy, "trust_weighted");
  assert.equal(routedNoRequester.json?.results?.[0]?.routingFactors?.signals?.relationshipHistory?.counterpartyAgentId, null);
  assert.equal(routedNoRequester.json?.results?.[0]?.routingFactors?.signals?.relationshipHistory?.eventCount, 0);
  assert.equal(routedNoRequester.json?.results?.[0]?.routingFactors?.signals?.relationshipHistory?.workedWithCount, 0);

  const tieOrder = await request(api, {
    method: "GET",
    path:
      "/agent-cards/discover?capability=travel.search&visibility=public&runtime=openclaw&status=active" +
      "&includeReputation=false&scoreStrategy=trust_weighted&limit=10&offset=0"
  });
  assert.equal(tieOrder.statusCode, 200, tieOrder.body);
  assert.equal(tieOrder.json?.results?.length, 2);
  assert.equal(tieOrder.json?.results?.[0]?.agentCard?.agentId, tieA);
  assert.equal(tieOrder.json?.results?.[1]?.agentCard?.agentId, tieB);
});
