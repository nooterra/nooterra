import test from "node:test";
import assert from "node:assert/strict";

import { createEd25519Keypair } from "../src/core/crypto.js";
import {
  buildVerifiedInteractionGraphPackV1,
  signVerifiedInteractionGraphPackV1,
  verifyVerifiedInteractionGraphPackV1
} from "../src/core/interaction-graph-pack.js";

test("interaction graph pack: deterministic hash-bound output", () => {
  const input = {
    tenantId: "tenant_demo",
    agentId: "agt_demo",
    reputationVersion: "v2",
    reputationWindow: "30d",
    asOf: "2026-02-25T00:00:00.000Z",
    generatedAt: "2026-02-25T00:05:00.000Z",
    summary: {
      schemaVersion: "InteractionGraphSummary.v1",
      agentId: "agt_demo",
      reputationVersion: "v2",
      reputationWindow: "30d",
      asOf: "2026-02-25T00:00:00.000Z",
      trustScore: 97,
      riskTier: "low",
      eventCount: 12,
      decisionsTotal: 8,
      decisionsApproved: 8,
      successRate: 1,
      disputesOpened: 0,
      disputeRate: 0,
      settledCents: 4500,
      refundedCents: 0,
      penalizedCents: 0,
      autoReleasedCents: 0,
      adjustmentAppliedCents: 0,
      relationshipCount: 1,
      economicallyQualifiedRelationshipCount: 1,
      dampenedRelationshipCount: 0,
      collusionSuspectedRelationshipCount: 0,
      lastInteractionAt: "2026-02-25T00:00:00.000Z"
    },
    relationships: [
      {
        schemaVersion: "RelationshipEdge.v1",
        tenantId: "tenant_demo",
        agentId: "agt_demo",
        counterpartyAgentId: "agt_peer",
        visibility: "private",
        reputationWindow: "30d",
        asOf: "2026-02-25T00:00:00.000Z",
        eventCount: 8,
        decisionsTotal: 8,
        decisionsApproved: 8,
        workedWithCount: 8,
        successRate: 1,
        disputesOpened: 0,
        disputeRate: 0,
        releaseRateAvg: 100,
        settledCents: 4500,
        refundedCents: 0,
        penalizedCents: 0,
        autoReleasedCents: 0,
        adjustmentAppliedCents: 0,
        lastInteractionAt: "2026-02-25T00:00:00.000Z"
      }
    ]
  };
  const first = buildVerifiedInteractionGraphPackV1(input);
  const second = buildVerifiedInteractionGraphPackV1(input);
  assert.equal(first.schemaVersion, "VerifiedInteractionGraphPack.v1");
  assert.equal(first.packHash, second.packHash);
  assert.equal(first.summaryHash, second.summaryHash);
  assert.equal(first.relationshipsHash, second.relationshipsHash);
});

test("interaction graph pack: fails closed on invalid summary schema version", () => {
  assert.throws(
    () =>
      buildVerifiedInteractionGraphPackV1({
        tenantId: "tenant_demo",
        agentId: "agt_demo",
        reputationVersion: "v2",
        reputationWindow: "30d",
        asOf: "2026-02-25T00:00:00.000Z",
        summary: {
          schemaVersion: "WrongSummary.v1"
        },
        relationships: []
      }),
    /summary\.schemaVersion/
  );
});

test("interaction graph pack: optional signature verifies and fails closed when tampered", () => {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const unsignedPack = buildVerifiedInteractionGraphPackV1({
    tenantId: "tenant_demo",
    agentId: "agt_demo",
    reputationVersion: "v2",
    reputationWindow: "30d",
    asOf: "2026-02-25T00:00:00.000Z",
    generatedAt: "2026-02-25T00:00:00.000Z",
    summary: {
      schemaVersion: "InteractionGraphSummary.v1",
      agentId: "agt_demo",
      reputationVersion: "v2",
      reputationWindow: "30d",
      asOf: "2026-02-25T00:00:00.000Z",
      trustScore: 97,
      riskTier: "low",
      eventCount: 12,
      decisionsTotal: 8,
      decisionsApproved: 8,
      successRate: 1,
      disputesOpened: 0,
      disputeRate: 0,
      settledCents: 4500,
      refundedCents: 0,
      penalizedCents: 0,
      autoReleasedCents: 0,
      adjustmentAppliedCents: 0,
      relationshipCount: 0,
      economicallyQualifiedRelationshipCount: 0,
      dampenedRelationshipCount: 0,
      collusionSuspectedRelationshipCount: 0,
      lastInteractionAt: "2026-02-25T00:00:00.000Z"
    },
    relationships: []
  });
  const signedPack = signVerifiedInteractionGraphPackV1({
    graphPack: unsignedPack,
    signedAt: "2026-02-25T00:00:01.000Z",
    publicKeyPem,
    privateKeyPem
  });
  assert.equal(signedPack.signature?.schemaVersion, "VerifiedInteractionGraphPackSignature.v1");
  const verified = verifyVerifiedInteractionGraphPackV1({ graphPack: signedPack, publicKeyPem });
  assert.equal(verified.ok, true);
  assert.equal(verified.code, null);

  const tampered = {
    ...signedPack,
    summary: {
      ...signedPack.summary,
      trustScore: 1
    }
  };
  const tamperedVerify = verifyVerifiedInteractionGraphPackV1({ graphPack: tampered, publicKeyPem });
  assert.equal(tamperedVerify.ok, false);
  assert.equal(tamperedVerify.code, "INTERACTION_GRAPH_PACK_SIGNATURE_PAYLOAD_HASH_MISMATCH");
});
