import test from "node:test";
import assert from "node:assert/strict";

import {
  computeActionWalletEvidenceBundleHashV1,
  computeActionWalletExecutionGrantHashV1,
  resolveActionWalletIntentHashV1,
  resolveActionWalletReceiptHashV1
} from "../src/core/action-wallet-semantic-hash.js";

test("action wallet semantic hash: intent hash resolves from the canonical authority envelope hash", () => {
  const hash = resolveActionWalletIntentHashV1({
    authorityEnvelope: { envelopeHash: "A".repeat(64) }
  });
  assert.equal(hash, "a".repeat(64));
});

test("action wallet semantic hash: execution grant hash is deterministic across operational projection drift", () => {
  const baseGrant = {
    executionGrantId: "apr_action_wallet_hash_1",
    principal: { principalType: "human", principalId: "usr_action_wallet_hash" },
    actionType: "buy",
    hostId: "agt_action_wallet_host_hash",
    vendorOrDomainAllowlist: ["merchant.example", "shop.example"],
    spendCap: { currency: "USD", maxPerCallCents: 4000, maxTotalCents: 4000 },
    expiresAt: "2026-03-08T16:15:00.000Z",
    grantNonce: "b".repeat(64),
    delegationLineageRef: {
      authorityEnvelopeRef: { envelopeId: "aint_action_wallet_hash_1", envelopeHash: "c".repeat(64) },
      authorityGrantRef: "agrant_action_wallet_hash_1",
      delegationGrantRef: "dgrant_action_wallet_hash_1",
      mayDelegate: false,
      maxDepth: 0
    },
    evidenceRequirements: ["merchant_receipt", "order_confirmation"],
    authorityEnvelopeRef: { envelopeId: "aint_action_wallet_hash_1", envelopeHash: "c".repeat(64) },
    approvalRequestRef: { requestId: "apr_action_wallet_hash_1", requestHash: "d".repeat(64) },
    approvalDecisionRef: {
      decisionId: "adec_action_wallet_hash_1",
      decisionHash: "e".repeat(64),
      approved: true,
      decidedAt: "2026-03-08T16:05:00.000Z"
    }
  };
  const driftedGrant = {
    ...baseGrant,
    status: "materialized",
    createdAt: "2026-03-08T16:06:00.000Z",
    workOrderId: "workord_action_wallet_hash_1",
    requiredCapability: "capability://workflow.intake",
    spendEnvelope: { currency: "USD", maxPerCallCents: 4000, maxTotalCents: 4000 },
    continuation: { requestId: "apr_action_wallet_hash_1", status: "pending" },
    vendorOrDomainAllowlist: ["shop.example", "merchant.example"],
    evidenceRequirements: ["order_confirmation", "merchant_receipt"]
  };

  assert.equal(computeActionWalletExecutionGrantHashV1(baseGrant), computeActionWalletExecutionGrantHashV1(driftedGrant));
});

test("action wallet semantic hash: evidence bundle hash ignores progress-only fields and evidence ordering", () => {
  const baseBundle = {
    executionGrantId: "apr_action_wallet_hash_1",
    workOrderId: "workord_action_wallet_hash_1",
    evidenceRefs: ["artifact://checkout/cart-1", "report://verification/action-wallet-1"],
    executionAttestationRef: null
  };
  const driftedBundle = {
    ...baseBundle,
    progressId: "wprog_action_wallet_hash_1",
    eventType: "evidence_submitted",
    message: "Attached checkout evidence.",
    percentComplete: 75,
    at: "2026-03-08T16:10:00.000Z",
    submittedAt: "2026-03-08T16:10:00.000Z",
    evidenceRefs: ["report://verification/action-wallet-1", "artifact://checkout/cart-1", "artifact://checkout/cart-1"]
  };

  assert.equal(computeActionWalletEvidenceBundleHashV1(baseBundle), computeActionWalletEvidenceBundleHashV1(driftedBundle));
});

test("action wallet semantic hash: receipt hash resolves from the canonical completion receipt hash", () => {
  const hash = resolveActionWalletReceiptHashV1({
    completionReceipt: { receiptHash: "F".repeat(64) }
  });
  assert.equal(hash, "f".repeat(64));
});
