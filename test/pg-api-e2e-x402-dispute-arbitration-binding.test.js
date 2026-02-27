import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { normalizeForCanonicalJson } from "../src/core/canonical-json.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { createPgStore } from "../src/db/store-pg.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

function makeSchema() {
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function registerAgent(api, { agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `pg_x402_bind_reg_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_pg_x402_bindings" },
      publicKeyPem
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return { agentId };
}

async function creditWallet(api, { agentId, amountCents, idempotencyKey }) {
  const response = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-idempotency-key": idempotencyKey },
    body: { amountCents, currency: "USD" }
  });
  assert.equal(response.statusCode, 201, response.body);
}

function autoPolicy100() {
  return {
    mode: "automatic",
    rules: {
      autoReleaseOnGreen: true,
      greenReleaseRatePct: 100,
      autoReleaseOnAmber: false,
      amberReleaseRatePct: 0,
      autoReleaseOnRed: true,
      redReleaseRatePct: 0
    }
  };
}

function assertBindingEvidenceConflict(
  response,
  { code, operation, expectedRequestSha256, requestSha256 = null, requestSha256Values } = {}
) {
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json?.code, code);
  assert.equal(response.json?.details?.operation, operation);
  assert.equal(response.json?.details?.expectedRequestSha256, expectedRequestSha256);
  if (requestSha256 === null) {
    assert.equal(response.json?.details?.requestSha256 ?? null, null);
  } else {
    assert.equal(response.json?.details?.requestSha256, requestSha256);
  }
  if (requestSha256Values !== undefined) {
    assert.deepEqual(response.json?.details?.requestSha256Values, requestSha256Values);
  }
}

async function setupBoundRun(api, { seed, payerAgentId, payeeAgentId, requestSha256 }) {
  const gateId = `x402gate_pg_binding_${seed}`;
  const created = await request(api, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": `pg_x402_gate_create_${seed}` },
    body: {
      gateId,
      payerAgentId,
      payeeAgentId,
      amountCents: 650,
      currency: "USD",
      toolId: "mock_search",
      disputeWindowDays: 2
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const authorized = await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": `pg_x402_gate_authorize_${seed}` },
    body: { gateId }
  });
  assert.equal(authorized.statusCode, 200, authorized.body);

  const verify = await request(api, {
    method: "POST",
    path: "/x402/gate/verify",
    headers: { "x-idempotency-key": `pg_x402_gate_verify_${seed}` },
    body: {
      gateId,
      verificationStatus: "green",
      runStatus: "completed",
      policy: autoPolicy100(),
      verificationMethod: { mode: "deterministic", source: "http_status_v1" },
      evidenceRefs: [`http:request_sha256:${requestSha256}`, `http:response_sha256:${"d".repeat(64)}`]
    }
  });
  assert.equal(verify.statusCode, 200, verify.body);

  const gateRead = await request(api, {
    method: "GET",
    path: `/x402/gate/${encodeURIComponent(gateId)}`
  });
  assert.equal(gateRead.statusCode, 200, gateRead.body);

  const runId = gateRead.json?.settlement?.runId ?? null;
  assert.ok(typeof runId === "string" && runId.length > 0);
  const expectedRequestSha256Raw = gateRead.json?.settlement?.decisionTrace?.bindings?.request?.sha256 ?? null;
  assert.ok(typeof expectedRequestSha256Raw === "string" && /^[0-9a-f]{64}$/i.test(expectedRequestSha256Raw));

  return {
    runId,
    requestSha256: expectedRequestSha256Raw.toLowerCase()
  };
}

async function overwriteSettlementDisputeEvidenceRefs(store, { runId, evidenceRefs }) {
  const settlement = await store.getAgentRunSettlement({ runId });
  assert.ok(settlement, `missing settlement for runId=${runId}`);
  const tenantId =
    typeof settlement?.tenantId === "string" && settlement.tenantId.trim() !== "" ? settlement.tenantId.trim() : "tenant_default";
  const disputeContext =
    settlement?.disputeContext && typeof settlement.disputeContext === "object" && !Array.isArray(settlement.disputeContext)
      ? settlement.disputeContext
      : {};
  const nextSettlement = normalizeForCanonicalJson(
    {
      ...settlement,
      disputeContext: {
        ...disputeContext,
        evidenceRefs: Array.isArray(evidenceRefs) ? evidenceRefs.slice() : []
      }
    },
    { path: "$" }
  );
  const at = typeof store.nowIso === "function" ? store.nowIso() : new Date().toISOString();
  await store.commitTx({
    at,
    ops: [{ kind: "AGENT_RUN_SETTLEMENT_UPSERT", tenantId, runId, settlement: nextSettlement }]
  });
}

(databaseUrl ? test : test.skip)(
  "pg api e2e: run_dispute.close binding evidence fails closed for missing mismatched and conflicting request hash refs",
  async () => {
    const schema = makeSchema();
    const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    try {
      const api = createApi({ store, opsToken: "tok_ops" });
      const payer = await registerAgent(api, { agentId: "agt_pg_dispute_close_binding_payer_1" });
      const payee = await registerAgent(api, { agentId: "agt_pg_dispute_close_binding_payee_1" });
      const operator = await registerAgent(api, { agentId: "agt_pg_dispute_close_binding_operator_1" });
      await creditWallet(api, {
        agentId: payer.agentId,
        amountCents: 10000,
        idempotencyKey: "pg_x402_dispute_close_binding_credit_1"
      });

      const { runId, requestSha256 } = await setupBoundRun(api, {
        seed: "dispute_close_1",
        payerAgentId: payer.agentId,
        payeeAgentId: payee.agentId,
        requestSha256: "b".repeat(64)
      });
      const disputeId = "dsp_pg_dispute_close_binding_1";
      const contextRef = "evidence://x402/pg-dispute-close/context.json";
      const opened = await request(api, {
        method: "POST",
        path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
        headers: { "x-idempotency-key": "pg_x402_dispute_close_binding_open_1" },
        body: {
          disputeId,
          disputeType: "quality",
          disputePriority: "high",
          disputeChannel: "counterparty",
          escalationLevel: "l1_counterparty",
          openedByAgentId: operator.agentId,
          reason: "prepare dispute close binding checks",
          evidenceRefs: [`http:request_sha256:${requestSha256}`, contextRef]
        }
      });
      assert.equal(opened.statusCode, 200, opened.body);

      const closeMissing = await request(api, {
        method: "POST",
        path: `/runs/${encodeURIComponent(runId)}/dispute/close`,
        headers: { "x-idempotency-key": "pg_x402_dispute_close_binding_missing_1" },
        body: {
          disputeId,
          resolutionOutcome: "accepted",
          resolutionSummary: "missing request hash should fail closed",
          closedByAgentId: operator.agentId,
          resolutionEvidenceRefs: [contextRef]
        }
      });
      assertBindingEvidenceConflict(closeMissing, {
        code: "X402_DISPUTE_CLOSE_BINDING_EVIDENCE_REQUIRED",
        operation: "run_dispute.close",
        expectedRequestSha256: requestSha256
      });

      const mismatchSha = "a".repeat(64);
      const closeMismatch = await request(api, {
        method: "POST",
        path: `/runs/${encodeURIComponent(runId)}/dispute/close`,
        headers: { "x-idempotency-key": "pg_x402_dispute_close_binding_mismatch_1" },
        body: {
          disputeId,
          resolutionOutcome: "accepted",
          resolutionSummary: "mismatched request hash should fail closed",
          closedByAgentId: operator.agentId,
          resolutionEvidenceRefs: [`http:request_sha256:${mismatchSha}`]
        }
      });
      assertBindingEvidenceConflict(closeMismatch, {
        code: "X402_DISPUTE_CLOSE_BINDING_EVIDENCE_MISMATCH",
        operation: "run_dispute.close",
        expectedRequestSha256: requestSha256,
        requestSha256: mismatchSha
      });

      const closeConflict = await request(api, {
        method: "POST",
        path: `/runs/${encodeURIComponent(runId)}/dispute/close`,
        headers: { "x-idempotency-key": "pg_x402_dispute_close_binding_conflict_1" },
        body: {
          disputeId,
          resolutionOutcome: "accepted",
          resolutionSummary: "conflicting request hashes should fail closed",
          closedByAgentId: operator.agentId,
          resolutionEvidenceRefs: [`http:request_sha256:${requestSha256}`, `http:request_sha256:${mismatchSha}`]
        }
      });
      assertBindingEvidenceConflict(closeConflict, {
        code: "X402_DISPUTE_CLOSE_BINDING_EVIDENCE_MISMATCH",
        operation: "run_dispute.close",
        expectedRequestSha256: requestSha256,
        requestSha256,
        requestSha256Values: [mismatchSha, requestSha256].sort((left, right) => left.localeCompare(right))
      });
    } finally {
      await store.close();
    }
  }
);

(databaseUrl ? test : test.skip)(
  "pg api e2e: run_arbitration.open binding evidence fails closed for missing mismatched and conflicting request hash refs",
  async () => {
    const schema = makeSchema();
    const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    try {
      const api = createApi({ store, opsToken: "tok_ops" });
      const payer = await registerAgent(api, { agentId: "agt_pg_arb_open_binding_payer_1" });
      const payee = await registerAgent(api, { agentId: "agt_pg_arb_open_binding_payee_1" });
      const operator = await registerAgent(api, { agentId: "agt_pg_arb_open_binding_operator_1" });
      const arbiter = await registerAgent(api, { agentId: "agt_pg_arb_open_binding_arbiter_1" });
      await creditWallet(api, {
        agentId: payer.agentId,
        amountCents: 30000,
        idempotencyKey: "pg_x402_arb_open_binding_credit_1"
      });

      async function openBoundDispute({ seed, requestSha256 }) {
        const run = await setupBoundRun(api, {
          seed,
          payerAgentId: payer.agentId,
          payeeAgentId: payee.agentId,
          requestSha256
        });
        const disputeId = `dsp_pg_arb_open_binding_${seed}`;
        const contextRef = `evidence://x402/pg-arb-open/${seed}/context.json`;
        const openDispute = await request(api, {
          method: "POST",
          path: `/runs/${encodeURIComponent(run.runId)}/dispute/open`,
          headers: { "x-idempotency-key": `pg_x402_arb_open_binding_dispute_open_${seed}` },
          body: {
            disputeId,
            disputeType: "quality",
            disputePriority: "high",
            disputeChannel: "arbiter",
            escalationLevel: "l2_arbiter",
            openedByAgentId: operator.agentId,
            reason: "prepare arbitration open binding checks",
            evidenceRefs: [`http:request_sha256:${run.requestSha256}`, contextRef]
          }
        });
        assert.equal(openDispute.statusCode, 200, openDispute.body);
        return { ...run, disputeId, contextRef };
      }

      const requiredScenario = await openBoundDispute({
        seed: "required_1",
        requestSha256: "d".repeat(64)
      });
      const arbOpenMissing = await request(api, {
        method: "POST",
        path: `/runs/${encodeURIComponent(requiredScenario.runId)}/arbitration/open`,
        headers: { "x-idempotency-key": "pg_x402_arb_open_binding_missing_1" },
        body: {
          caseId: "arb_case_pg_arb_open_binding_required_1",
          disputeId: requiredScenario.disputeId,
          arbiterAgentId: arbiter.agentId,
          evidenceRefs: [requiredScenario.contextRef]
        }
      });
      assertBindingEvidenceConflict(arbOpenMissing, {
        code: "X402_ARBITRATION_OPEN_BINDING_EVIDENCE_REQUIRED",
        operation: "run_arbitration.open",
        expectedRequestSha256: requiredScenario.requestSha256
      });

      const mismatchScenario = await openBoundDispute({
        seed: "mismatch_1",
        requestSha256: "f".repeat(64)
      });
      const mismatchSha = "e".repeat(64);
      await overwriteSettlementDisputeEvidenceRefs(store, {
        runId: mismatchScenario.runId,
        evidenceRefs: [
          `http:request_sha256:${mismatchScenario.requestSha256}`,
          `http:request_sha256:${mismatchSha}`,
          mismatchScenario.contextRef
        ]
      });
      const arbOpenMismatch = await request(api, {
        method: "POST",
        path: `/runs/${encodeURIComponent(mismatchScenario.runId)}/arbitration/open`,
        headers: { "x-idempotency-key": "pg_x402_arb_open_binding_mismatch_1" },
        body: {
          caseId: "arb_case_pg_arb_open_binding_mismatch_1",
          disputeId: mismatchScenario.disputeId,
          arbiterAgentId: arbiter.agentId,
          evidenceRefs: [`http:request_sha256:${mismatchSha}`]
        }
      });
      assertBindingEvidenceConflict(arbOpenMismatch, {
        code: "X402_ARBITRATION_OPEN_BINDING_EVIDENCE_MISMATCH",
        operation: "run_arbitration.open",
        expectedRequestSha256: mismatchScenario.requestSha256,
        requestSha256: mismatchSha
      });

      const conflictScenario = await openBoundDispute({
        seed: "conflict_1",
        requestSha256: "9".repeat(64)
      });
      const conflictSha = "8".repeat(64);
      await overwriteSettlementDisputeEvidenceRefs(store, {
        runId: conflictScenario.runId,
        evidenceRefs: [
          `http:request_sha256:${conflictScenario.requestSha256}`,
          `http:request_sha256:${conflictSha}`,
          conflictScenario.contextRef
        ]
      });
      const arbOpenConflict = await request(api, {
        method: "POST",
        path: `/runs/${encodeURIComponent(conflictScenario.runId)}/arbitration/open`,
        headers: { "x-idempotency-key": "pg_x402_arb_open_binding_conflict_1" },
        body: {
          caseId: "arb_case_pg_arb_open_binding_conflict_1",
          disputeId: conflictScenario.disputeId,
          arbiterAgentId: arbiter.agentId,
          evidenceRefs: [`http:request_sha256:${conflictScenario.requestSha256}`, `http:request_sha256:${conflictSha}`]
        }
      });
      assertBindingEvidenceConflict(arbOpenConflict, {
        code: "X402_ARBITRATION_OPEN_BINDING_EVIDENCE_MISMATCH",
        operation: "run_arbitration.open",
        expectedRequestSha256: conflictScenario.requestSha256,
        requestSha256: conflictScenario.requestSha256,
        requestSha256Values: [conflictSha, conflictScenario.requestSha256].sort((left, right) => left.localeCompare(right))
      });
    } finally {
      await store.close();
    }
  }
);
