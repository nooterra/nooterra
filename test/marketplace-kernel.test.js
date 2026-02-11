import test from "node:test";
import assert from "node:assert/strict";

import {
  MARKETPLACE_OFFER_SCHEMA_VERSION,
  MARKETPLACE_ACCEPTANCE_SCHEMA_VERSION,
  buildMarketplaceOffer,
  buildMarketplaceAcceptance
} from "../src/core/marketplace-kernel.js";

test("Marketplace kernel builds offer and acceptance artifacts with hash binding", () => {
  const offer = buildMarketplaceOffer({
    tenantId: "tenant_default",
    rfqId: "rfq_1",
    runId: "run_1",
    bidId: "bid_1",
    proposal: {
      schemaVersion: "MarketplaceBidProposal.v1",
      proposalId: "ofr_bid_1_2",
      bidId: "bid_1",
      revision: 2,
      proposerAgentId: "agt_bidder_1",
      amountCents: 1800,
      currency: "USD",
      etaSeconds: 900,
      note: "final offer",
      verificationMethod: { schemaVersion: "VerificationMethod.v1", mode: "deterministic" },
      policy: {
        schemaVersion: "SettlementPolicy.v1",
        policyVersion: 1,
        mode: "automatic",
        rules: {
          requireDeterministicVerification: true,
          autoReleaseOnGreen: true,
          autoReleaseOnAmber: false,
          autoReleaseOnRed: false
        },
        policyHash: "1".repeat(64)
      },
      policyRef: {
        schemaVersion: "MarketplaceSettlementPolicyRef.v1",
        source: "inline",
        policyId: null,
        policyVersion: 1,
        policyHash: "1".repeat(64),
        verificationMethodHash: "2".repeat(64)
      },
      policyRefHash: "3".repeat(64),
      prevProposalHash: "4".repeat(64),
      proposedAt: "2026-02-08T00:00:00.000Z",
      proposalHash: "5".repeat(64)
    },
    offerChainHash: "6".repeat(64),
    proposalCount: 2,
    createdAt: "2026-02-08T00:00:00.000Z"
  });

  assert.equal(offer.schemaVersion, MARKETPLACE_OFFER_SCHEMA_VERSION);
  assert.equal(offer.proposalHash, "5".repeat(64));
  assert.equal(offer.offerChainHash, "6".repeat(64));
  assert.match(offer.offerHash, /^[0-9a-f]{64}$/);

  const acceptance = buildMarketplaceAcceptance({
    tenantId: "tenant_default",
    rfqId: "rfq_1",
    runId: "run_1",
    bidId: "bid_1",
    agreementId: "agr_rfq_1_bid_1",
    acceptedAt: "2026-02-08T00:00:01.000Z",
    acceptedByAgentId: "agt_operator_1",
    acceptedProposalId: offer.proposalId,
    acceptedRevision: offer.revision,
    acceptedProposalHash: offer.proposalHash,
    offerChainHash: offer.offerChainHash,
    proposalCount: offer.proposalCount,
    offer,
    createdAt: "2026-02-08T00:00:01.000Z"
  });

  assert.equal(acceptance.schemaVersion, MARKETPLACE_ACCEPTANCE_SCHEMA_VERSION);
  assert.equal(acceptance.offerRef.offerId, offer.offerId);
  assert.equal(acceptance.offerRef.offerHash, offer.offerHash);
  assert.equal(acceptance.acceptedProposalHash, offer.proposalHash);
  assert.match(acceptance.acceptanceHash, /^[0-9a-f]{64}$/);
});
