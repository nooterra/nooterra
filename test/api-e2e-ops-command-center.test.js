import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, agentId) {
  const keypair = createEd25519Keypair();
  const res = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `register_${agentId}` },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId: "svc_command_center" },
      publicKeyPem: keypair.publicKeyPem,
      capabilities: ["translate"]
    }
  });
  assert.equal(res.statusCode, 201);
}

test("API e2e: /ops/network/command-center summarizes reliability, settlement, dispute, and revenue signals", async () => {
  const api = createApi({
    opsTokens: ["tok_opsr:ops_read", "tok_opsw:ops_write"].join(";")
  });

  await registerAgent(api, "agt_cc_poster");
  await registerAgent(api, "agt_cc_bidder");
  await registerAgent(api, "agt_cc_operator");

  const credit = await request(api, {
    method: "POST",
    path: "/agents/agt_cc_poster/wallet/credit",
    headers: { "x-idempotency-key": "cc_credit_1" },
    body: { amountCents: 5000, currency: "USD" }
  });
  assert.equal(credit.statusCode, 201);

  const task = await request(api, {
    method: "POST",
    path: "/marketplace/tasks",
    headers: { "x-idempotency-key": "cc_task_1" },
    body: {
      taskId: "task_cc_1",
      title: "Command center test task",
      capability: "translate",
      posterAgentId: "agt_cc_poster",
      budgetCents: 2500,
      currency: "USD"
    }
  });
  assert.equal(task.statusCode, 201);

  const bid = await request(api, {
    method: "POST",
    path: "/marketplace/tasks/task_cc_1/bids",
    headers: { "x-idempotency-key": "cc_bid_1" },
    body: {
      bidId: "bid_cc_1",
      bidderAgentId: "agt_cc_bidder",
      amountCents: 2000,
      currency: "USD",
      etaSeconds: 1200
    }
  });
  assert.equal(bid.statusCode, 201);

  const accept = await request(api, {
    method: "POST",
    path: "/marketplace/tasks/task_cc_1/accept",
    headers: { "x-idempotency-key": "cc_accept_1" },
    body: {
      bidId: "bid_cc_1",
      acceptedByAgentId: "agt_cc_operator"
    }
  });
  assert.equal(accept.statusCode, 200);
  const runId = String(accept.json?.run?.runId ?? "");
  assert.ok(runId.length > 0);

  const complete = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent("agt_cc_bidder")}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": accept.json?.run?.lastChainHash,
      "x-idempotency-key": "cc_run_complete_1"
    },
    body: {
      eventId: "ev_cc_run_complete_1",
      type: "RUN_COMPLETED",
      at: "2026-02-07T00:00:00.000Z",
      payload: {
        outputRef: `evidence://${runId}/output.json`,
        metrics: { settlementReleaseRatePct: 100 }
      }
    }
  });
  assert.equal(complete.statusCode, 201);

  const completionSettlementStatus = String(complete.json?.settlement?.status ?? "");
  if (completionSettlementStatus === "locked") {
    const resolve = await request(api, {
      method: "POST",
      path: `/runs/${encodeURIComponent(runId)}/settlement/resolve`,
      headers: { "x-idempotency-key": "cc_resolve_1" },
      body: {
        status: "released",
        releaseRatePct: 100,
        resolvedByAgentId: "agt_cc_operator",
        reason: "manual approval"
      }
    });
    assert.equal(resolve.statusCode, 200);
    assert.equal(resolve.json?.settlement?.status, "released");
  } else {
    assert.equal(completionSettlementStatus, "released");
  }

  const openDispute = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
    headers: { "x-idempotency-key": "cc_dispute_open_1" },
    body: {
      disputeId: "dsp_cc_1",
      disputeType: "quality",
      disputePriority: "normal",
      disputeChannel: "counterparty",
      escalationLevel: "l1_counterparty",
      openedByAgentId: "agt_cc_operator",
      reason: "needs review"
    }
  });
  assert.equal(openDispute.statusCode, 200);
  assert.equal(openDispute.json?.settlement?.disputeStatus, "open");

  const commandCenter = await request(api, {
    method: "GET",
    path: "/ops/network/command-center?windowHours=24&disputeSlaHours=1&transactionFeeBps=100",
    headers: { "x-proxy-ops-token": "tok_opsr" }
  });
  assert.equal(commandCenter.statusCode, 200);
  assert.equal(commandCenter.json?.ok, true);
  assert.equal(commandCenter.json?.tenantId, "tenant_default");
  assert.ok(typeof commandCenter.json?.commandCenter?.generatedAt === "string");
  assert.ok(commandCenter.json?.commandCenter?.reliability?.backlog);
  assert.ok(commandCenter.json?.commandCenter?.settlement?.resolvedCount >= 1);
  assert.ok(commandCenter.json?.commandCenter?.settlement?.releasedAmountCents >= 2000);
  assert.ok(commandCenter.json?.commandCenter?.disputes?.openCount >= 1);
  assert.ok(commandCenter.json?.commandCenter?.revenue?.estimatedTransactionFeesCentsInWindow >= 20);
  assert.ok(commandCenter.json?.commandCenter?.trust?.totalAgents >= 3);
});
