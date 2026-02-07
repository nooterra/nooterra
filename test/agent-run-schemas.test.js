import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import Ajv from "ajv/dist/2020.js";

async function loadSchemas() {
  const base = path.resolve(process.cwd(), "docs/spec/schemas");
  const names = (await fs.readdir(base)).filter((name) => name.endsWith(".json")).sort();
  const out = [];
  for (const name of names) {
    out.push(JSON.parse(await fs.readFile(path.join(base, name), "utf8")));
  }
  return out;
}

test("Agent run + wallet schemas validate canonical examples", async () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") ajv.addSchema(schema, schema.$id);
  }

  const validateRun = ajv.getSchema("https://settld.local/schemas/AgentRun.v1.schema.json");
  const validateEvent = ajv.getSchema("https://settld.local/schemas/AgentEvent.v1.schema.json");
  const validateWallet = ajv.getSchema("https://settld.local/schemas/AgentWallet.v1.schema.json");
  const validateSettlement = ajv.getSchema("https://settld.local/schemas/AgentRunSettlement.v1.schema.json");
  const validateReputation = ajv.getSchema("https://settld.local/schemas/AgentReputation.v1.schema.json");
  const validateReputationV2 = ajv.getSchema("https://settld.local/schemas/AgentReputation.v2.schema.json");
  assert.ok(validateRun);
  assert.ok(validateEvent);
  assert.ok(validateWallet);
  assert.ok(validateSettlement);
  assert.ok(validateReputation);
  assert.ok(validateReputationV2);

  const run = {
    schemaVersion: "AgentRun.v1",
    runId: "run_schema_demo",
    agentId: "agt_schema_demo",
    tenantId: "tenant_default",
    status: "completed",
    evidenceRefs: ["evidence://run_schema_demo/output.json"],
    metrics: { latencyMs: 1000 },
    failure: null,
    startedAt: "2026-02-01T00:01:00.000Z",
    completedAt: "2026-02-01T00:02:00.000Z",
    failedAt: null,
    revision: 2,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:02:00.000Z"
  };
  assert.equal(validateRun(run), true);

  const event = {
    schemaVersion: "AgentEvent.v1",
    v: 1,
    id: "ev_schema_demo_2",
    streamId: "run_schema_demo",
    type: "RUN_COMPLETED",
    at: "2026-02-01T00:02:00.000Z",
    actor: { type: "agent", id: "agt_schema_demo" },
    payload: { runId: "run_schema_demo", outputRef: "evidence://run_schema_demo/output.json" },
    payloadHash: "ph_schema_demo",
    prevChainHash: "ch_schema_demo_1",
    chainHash: "ch_schema_demo_2",
    signature: "sig_schema_demo",
    signerKeyId: "kid_schema_demo"
  };
  assert.equal(validateEvent(event), true);

  const wallet = {
    schemaVersion: "AgentWallet.v1",
    walletId: "wallet_agt_schema_demo",
    agentId: "agt_schema_demo",
    tenantId: "tenant_default",
    currency: "USD",
    availableCents: 5000,
    escrowLockedCents: 1250,
    totalDebitedCents: 900,
    totalCreditedCents: 7150,
    revision: 7,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:02:00.000Z"
  };
  assert.equal(validateWallet(wallet), true);

  const settlement = {
    schemaVersion: "AgentRunSettlement.v1",
    settlementId: "setl_run_schema_demo",
    runId: "run_schema_demo",
    tenantId: "tenant_default",
    agentId: "agt_schema_demo",
    payerAgentId: "agt_schema_payer",
    amountCents: 1250,
    currency: "USD",
    status: "released",
    lockedAt: "2026-02-01T00:00:30.000Z",
    resolvedAt: "2026-02-01T00:02:00.000Z",
    resolutionEventId: "ev_schema_demo_2",
    runStatus: "completed",
    revision: 1,
    createdAt: "2026-02-01T00:00:30.000Z",
    updatedAt: "2026-02-01T00:02:00.000Z"
  };
  assert.equal(validateSettlement(settlement), true);

  const reputation = {
    schemaVersion: "AgentReputation.v1",
    agentId: "agt_schema_demo",
    tenantId: "tenant_default",
    trustScore: 84,
    riskTier: "guarded",
    totalRuns: 4,
    terminalRuns: 3,
    createdRuns: 0,
    runningRuns: 1,
    completedRuns: 2,
    failedRuns: 1,
    runsWithEvidence: 3,
    totalSettlements: 3,
    lockedSettlements: 1,
    releasedSettlements: 1,
    refundedSettlements: 1,
    runCompletionRatePct: 67,
    evidenceCoverageRatePct: 100,
    settlementReleaseRatePct: 50,
    avgRunDurationMs: 100000,
    scoreBreakdown: {
      runQuality: 67,
      settlementQuality: 50,
      evidenceQuality: 100,
      activityScore: 8
    },
    computedAt: "2026-02-01T00:03:00.000Z"
  };
  assert.equal(validateReputation(reputation), true);

  const reputationV2 = {
    schemaVersion: "AgentReputation.v2",
    agentId: "agt_schema_demo",
    tenantId: "tenant_default",
    primaryWindow: "30d",
    trustScore: 84,
    riskTier: "guarded",
    windows: {
      "7d": {
        trustScore: 88,
        riskTier: "guarded",
        totalRuns: 2,
        terminalRuns: 2,
        createdRuns: 0,
        runningRuns: 0,
        completedRuns: 2,
        failedRuns: 0,
        runsWithEvidence: 2,
        totalSettlements: 2,
        lockedSettlements: 0,
        releasedSettlements: 2,
        refundedSettlements: 0,
        runCompletionRatePct: 100,
        evidenceCoverageRatePct: 100,
        settlementReleaseRatePct: 100,
        avgRunDurationMs: 95000,
        scoreBreakdown: {
          runQuality: 100,
          settlementQuality: 100,
          evidenceQuality: 100,
          activityScore: 4
        },
        computedAt: "2026-02-01T00:03:00.000Z"
      },
      "30d": {
        trustScore: 84,
        riskTier: "guarded",
        totalRuns: 4,
        terminalRuns: 3,
        createdRuns: 0,
        runningRuns: 1,
        completedRuns: 2,
        failedRuns: 1,
        runsWithEvidence: 3,
        totalSettlements: 3,
        lockedSettlements: 1,
        releasedSettlements: 1,
        refundedSettlements: 1,
        runCompletionRatePct: 67,
        evidenceCoverageRatePct: 100,
        settlementReleaseRatePct: 50,
        avgRunDurationMs: 100000,
        scoreBreakdown: {
          runQuality: 67,
          settlementQuality: 50,
          evidenceQuality: 100,
          activityScore: 8
        },
        computedAt: "2026-02-01T00:03:00.000Z"
      },
      allTime: {
        trustScore: 84,
        riskTier: "guarded",
        totalRuns: 4,
        terminalRuns: 3,
        createdRuns: 0,
        runningRuns: 1,
        completedRuns: 2,
        failedRuns: 1,
        runsWithEvidence: 3,
        totalSettlements: 3,
        lockedSettlements: 1,
        releasedSettlements: 1,
        refundedSettlements: 1,
        runCompletionRatePct: 67,
        evidenceCoverageRatePct: 100,
        settlementReleaseRatePct: 50,
        avgRunDurationMs: 100000,
        scoreBreakdown: {
          runQuality: 67,
          settlementQuality: 50,
          evidenceQuality: 100,
          activityScore: 8
        },
        computedAt: "2026-02-01T00:03:00.000Z"
      }
    },
    computedAt: "2026-02-01T00:03:00.000Z"
  };
  assert.equal(validateReputationV2(reputationV2), true);

  const invalidRun = { ...run };
  delete invalidRun.status;
  assert.equal(validateRun(invalidRun), false);

  const invalidEvent = { ...event };
  delete invalidEvent.type;
  assert.equal(validateEvent(invalidEvent), false);

  const invalidWallet = { ...wallet };
  delete invalidWallet.currency;
  assert.equal(validateWallet(invalidWallet), false);

  const invalidSettlement = { ...settlement, status: "pending" };
  assert.equal(validateSettlement(invalidSettlement), false);

  const invalidReputation = { ...reputation, trustScore: 123 };
  assert.equal(validateReputation(invalidReputation), false);

  const invalidReputationV2 = { ...reputationV2, primaryWindow: "90d" };
  assert.equal(validateReputationV2(invalidReputationV2), false);
});
