import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { tenantId, agentId, ownerId = "svc_arb_queue_test" }) {
  const { publicKeyPem } = createEd25519Keypair();
  const created = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `register_${tenantId}_${agentId}`
    },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId },
      publicKeyPem
    }
  });
  assert.equal(created.statusCode, 201);
}

async function createAndCompleteRun(api, { tenantId, payerAgentId, payeeAgentId, runId, amountCents, idempotencyPrefix }) {
  const createdRun = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_create`
    },
    body: {
      runId,
      taskType: "analysis",
      settlement: {
        payerAgentId,
        amountCents,
        currency: "USD",
        disputeWindowDays: 3
      }
    }
  });
  assert.equal(createdRun.statusCode, 201);
  const prevChainHash = createdRun.json?.run?.lastChainHash;
  assert.ok(prevChainHash);

  const completed = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_complete`,
      "x-proxy-expected-prev-chain-hash": prevChainHash
    },
    body: {
      type: "RUN_COMPLETED",
      payload: { outputRef: `evidence://${runId}/output.json` }
    }
  });
  assert.equal(completed.statusCode, 201);
}

async function openDisputeAndArbitrationCase(
  api,
  { tenantId, runId, disputeId, caseId, payerAgentId, arbiterAgentId, idempotencyPrefix }
) {
  const openedDispute = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_dispute_open`
    },
    body: {
      disputeId,
      reason: "arbitration queue coverage",
      openedByAgentId: payerAgentId
    }
  });
  assert.equal(openedDispute.statusCode, 200);
  assert.equal(openedDispute.json?.settlement?.disputeStatus, "open");

  const openedArbitration = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/arbitration/open`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_arbitration_open`
    },
    body: {
      disputeId,
      caseId,
      arbiterAgentId
    }
  });
  assert.equal(openedArbitration.statusCode, 201);
}

test("API e2e: ops arbitration queue supports filtering and deterministic SLA ordering", async () => {
  let nowAt = "2026-02-07T00:00:00.000Z";
  const api = createApi({
    now: () => nowAt,
    opsTokens: ["tok_finr:finance_read", "tok_finw:finance_write", "tok_opsr:ops_read"].join(";")
  });

  const tenantId = "tenant_arbitration_queue_ops";
  const payerAgentId = "agt_arb_queue_payer";
  const payeeAgentId = "agt_arb_queue_payee";
  const arbiterAgentId = "agt_arb_queue_arbiter";

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  await registerAgent(api, { tenantId, agentId: payeeAgentId });
  await registerAgent(api, { tenantId, agentId: arbiterAgentId });

  const credit = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payerAgentId)}/wallet/credit`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "arb_queue_credit_1"
    },
    body: {
      amountCents: 10000,
      currency: "USD"
    }
  });
  assert.equal(credit.statusCode, 201);

  await createAndCompleteRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId: "run_arb_queue_1",
    amountCents: 1200,
    idempotencyPrefix: "arb_queue_run_1"
  });
  await openDisputeAndArbitrationCase(api, {
    tenantId,
    runId: "run_arb_queue_1",
    disputeId: "dispute_arb_queue_1",
    caseId: "arb_case_queue_1",
    payerAgentId,
    arbiterAgentId,
    idempotencyPrefix: "arb_queue_case_1"
  });

  nowAt = "2026-02-08T12:00:00.000Z";
  await createAndCompleteRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId: "run_arb_queue_2",
    amountCents: 1300,
    idempotencyPrefix: "arb_queue_run_2"
  });
  await openDisputeAndArbitrationCase(api, {
    tenantId,
    runId: "run_arb_queue_2",
    disputeId: "dispute_arb_queue_2",
    caseId: "arb_case_queue_2",
    payerAgentId,
    arbiterAgentId,
    idempotencyPrefix: "arb_queue_case_2"
  });

  const queue = await request(api, {
    method: "GET",
    path: "/ops/arbitration/queue?slaHours=24",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finr"
    }
  });
  assert.equal(queue.statusCode, 200);
  assert.equal(queue.json?.count, 2);
  assert.equal(queue.json?.overSlaCount, 1);
  assert.equal(queue.json?.queue?.[0]?.caseId, "arb_case_queue_1");
  assert.equal(queue.json?.queue?.[0]?.overSla, true);
  assert.equal(queue.json?.queue?.[1]?.caseId, "arb_case_queue_2");
  assert.equal(queue.json?.queue?.[1]?.overSla, false);

  const byRun = await request(api, {
    method: "GET",
    path: "/ops/arbitration/queue?status=under_review&runId=run_arb_queue_2&assignedArbiter=true",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finr"
    }
  });
  assert.equal(byRun.statusCode, 200);
  assert.equal(byRun.json?.count, 1);
  assert.equal(byRun.json?.queue?.[0]?.runId, "run_arb_queue_2");
  assert.equal(byRun.json?.queue?.[0]?.arbiterAgentId, arbiterAgentId);

  const byCaseId = await request(api, {
    method: "GET",
    path: "/ops/arbitration/queue?caseId=arb_case_queue_1&openedSince=2026-02-07T00:00:00.000Z",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finr"
    }
  });
  assert.equal(byCaseId.statusCode, 200);
  assert.equal(byCaseId.json?.count, 1);
  assert.equal(byCaseId.json?.queue?.[0]?.caseId, "arb_case_queue_1");
});
