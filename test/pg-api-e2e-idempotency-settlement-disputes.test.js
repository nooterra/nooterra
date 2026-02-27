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

async function registerAgent(api, { agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `pg_idmp_reg_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_pg_idempotency_test" },
      publicKeyPem
    }
  });
  assert.equal(response.statusCode, 201, response.body);
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

async function setupLockedSettlementRun(api, { prefix, amountCents = 2200, disputeWindowDays = 2 }) {
  const posterAgentId = `agt_${prefix}_poster`;
  const bidderAgentId = `agt_${prefix}_bidder`;
  const operatorAgentId = `agt_${prefix}_operator`;
  const rfqId = `rfq_${prefix}_1`;
  const bidId = `bid_${prefix}_1`;

  await registerAgent(api, { agentId: posterAgentId });
  await registerAgent(api, { agentId: bidderAgentId });
  await registerAgent(api, { agentId: operatorAgentId });

  await creditWallet(api, {
    agentId: posterAgentId,
    amountCents: 5000,
    idempotencyKey: `${prefix}_credit_1`
  });

  const createTask = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": `${prefix}_rfq_1` },
    body: {
      rfqId,
      title: `Task ${prefix}`,
      capability: "translate",
      posterAgentId,
      budgetCents: amountCents,
      currency: "USD"
    }
  });
  assert.equal(createTask.statusCode, 201, createTask.body);

  const createBid = await request(api, {
    method: "POST",
    path: `/marketplace/rfqs/${encodeURIComponent(rfqId)}/bids`,
    headers: { "x-idempotency-key": `${prefix}_bid_1` },
    body: {
      bidId,
      bidderAgentId,
      amountCents,
      currency: "USD",
      verificationMethod: {
        schemaVersion: "VerificationMethod.v1",
        mode: "attested",
        source: "vendor_attestor"
      },
      policy: {
        schemaVersion: "SettlementPolicy.v1",
        policyVersion: 1,
        mode: "automatic",
        rules: {
          requireDeterministicVerification: true,
          autoReleaseOnGreen: true,
          autoReleaseOnAmber: true,
          autoReleaseOnRed: false,
          greenReleaseRatePct: 100,
          amberReleaseRatePct: 100,
          redReleaseRatePct: 0,
          maxAutoReleaseAmountCents: null,
          manualReason: null
        }
      }
    }
  });
  assert.equal(createBid.statusCode, 201, createBid.body);

  const accept = await request(api, {
    method: "POST",
    path: `/marketplace/rfqs/${encodeURIComponent(rfqId)}/accept`,
    headers: { "x-idempotency-key": `${prefix}_accept_1` },
    body: {
      bidId,
      acceptedByAgentId: operatorAgentId,
      disputeWindowDays
    }
  });
  assert.equal(accept.statusCode, 200, accept.body);
  const runId = String(accept.json?.run?.runId ?? "");
  assert.ok(runId);

  const complete = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(bidderAgentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": accept.json?.run?.lastChainHash,
      "x-idempotency-key": `${prefix}_complete_1`
    },
    body: {
      type: "RUN_COMPLETED",
      payload: {
        outputRef: `evidence://${runId}/output.json`,
        metrics: { settlementReleaseRatePct: 100 }
      }
    }
  });
  assert.equal(complete.statusCode, 201, complete.body);
  assert.equal(complete.json?.settlement?.status, "locked");

  return { runId, operatorAgentId };
}

(databaseUrl ? test : test.skip)(
  "pg api e2e: settlement resolve/dispute open idempotency with locked fail-closed transition",
  async () => {
    const schema = makeSchema();
    const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });

    try {
      const api = createApi({ store });
      const { runId, operatorAgentId } = await setupLockedSettlementRun(api, { prefix: "pg_idmp_1" });

      const openWhileLocked = await request(api, {
        method: "POST",
        path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
        headers: { "x-idempotency-key": "pg_idmp_open_locked_1" },
        body: {
          disputeId: "dsp_pg_idmp_locked_1",
          disputeType: "quality",
          disputePriority: "normal",
          disputeChannel: "counterparty",
          escalationLevel: "l1_counterparty",
          openedByAgentId: operatorAgentId,
          reason: "attempt while locked"
        }
      });
      assert.equal(openWhileLocked.statusCode, 409, openWhileLocked.body);
      assert.equal(openWhileLocked.json?.code, "TRANSITION_ILLEGAL");

      const resolvePath = `/runs/${encodeURIComponent(runId)}/settlement/resolve`;
      const resolveBody = {
        status: "released",
        releaseRatePct: 100,
        resolvedByAgentId: operatorAgentId,
        reason: "manual approval"
      };

      const resolve = await request(api, {
        method: "POST",
        path: resolvePath,
        headers: { "x-idempotency-key": "pg_idmp_resolve_1" },
        body: resolveBody
      });
      assert.equal(resolve.statusCode, 200, resolve.body);
      assert.equal(resolve.json?.settlement?.status, "released");

      const resolveReplay = await request(api, {
        method: "POST",
        path: resolvePath,
        headers: { "x-idempotency-key": "pg_idmp_resolve_1" },
        body: resolveBody
      });
      assert.equal(resolveReplay.statusCode, 200, resolveReplay.body);
      assert.deepEqual(resolveReplay.json, resolve.json);

      const resolveConflict = await request(api, {
        method: "POST",
        path: resolvePath,
        headers: { "x-idempotency-key": "pg_idmp_resolve_1" },
        body: {
          status: "refunded",
          releaseRatePct: 0,
          resolvedByAgentId: operatorAgentId,
          reason: "different payload"
        }
      });
      assert.equal(resolveConflict.statusCode, 409, resolveConflict.body);

      const openPath = `/runs/${encodeURIComponent(runId)}/dispute/open`;
      const openBody = {
        disputeId: "dsp_pg_idmp_1",
        disputeType: "quality",
        disputePriority: "normal",
        disputeChannel: "counterparty",
        escalationLevel: "l1_counterparty",
        openedByAgentId: operatorAgentId,
        reason: "needs review"
      };

      const open = await request(api, {
        method: "POST",
        path: openPath,
        headers: { "x-idempotency-key": "pg_idmp_open_1" },
        body: openBody
      });
      assert.equal(open.statusCode, 200, open.body);
      assert.equal(open.json?.settlement?.disputeStatus, "open");

      const openReplay = await request(api, {
        method: "POST",
        path: openPath,
        headers: { "x-idempotency-key": "pg_idmp_open_1" },
        body: openBody
      });
      assert.equal(openReplay.statusCode, 200, openReplay.body);
      assert.deepEqual(openReplay.json, open.json);

      const openConflict = await request(api, {
        method: "POST",
        path: openPath,
        headers: { "x-idempotency-key": "pg_idmp_open_1" },
        body: {
          ...openBody,
          reason: "different reason"
        }
      });
      assert.equal(openConflict.statusCode, 409, openConflict.body);
    } finally {
      await store.close();
    }
  }
);
