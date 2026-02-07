import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { tenantId, agentId, ownerId = "svc_billing_test" }) {
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

  return request(api, {
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
}

test("API e2e: billing catalog + summary reflects billable event usage and estimated charges", async () => {
  const api = createApi({
    now: () => "2026-02-07T00:00:00.000Z",
    opsTokens: ["tok_finr:finance_read", "tok_finw:finance_write"].join(";")
  });

  const tenantId = "tenant_billing_summary";
  const payerAgentId = "agt_billing_payer";
  const payeeAgentId = "agt_billing_payee";
  const arbiterAgentId = "agt_billing_arbiter";
  const runId = "run_billing_summary_1";

  const catalog = await request(api, {
    method: "GET",
    path: "/ops/finance/billing/catalog",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finr"
    }
  });
  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.json?.schemaVersion, "BillingPlanCatalog.v1");
  assert.ok(catalog.json?.plans?.builder);

  const setPlan = await request(api, {
    method: "PUT",
    path: "/ops/finance/billing/plan",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finw"
    },
    body: {
      plan: "builder",
      hardLimitEnforced: true
    }
  });
  assert.equal(setPlan.statusCode, 200);
  assert.equal(setPlan.json?.billing?.plan, "builder");

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  await registerAgent(api, { tenantId, agentId: payeeAgentId });
  await registerAgent(api, { tenantId, agentId: arbiterAgentId });

  const credit = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payerAgentId)}/wallet/credit`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "billing_summary_credit_1"
    },
    body: {
      amountCents: 5000,
      currency: "USD"
    }
  });
  assert.equal(credit.statusCode, 201);

  const completed = await createAndCompleteRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId,
    amountCents: 1500,
    idempotencyPrefix: "billing_summary_run_1"
  });
  assert.equal(completed.statusCode, 201);
  assert.equal(completed.json?.settlement?.status, "released");

  const openedDispute = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "billing_summary_dispute_open_1"
    },
    body: {
      disputeId: "dispute_billing_summary_1",
      reason: "need arbitration",
      openedByAgentId: payerAgentId
    }
  });
  assert.equal(openedDispute.statusCode, 200);

  const openArbitration = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/arbitration/open`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "billing_summary_arb_open_1"
    },
    body: {
      caseId: "arb_case_billing_summary_1",
      disputeId: "dispute_billing_summary_1",
      arbiterAgentId
    }
  });
  assert.equal(openArbitration.statusCode, 201);

  const summary = await request(api, {
    method: "GET",
    path: "/ops/finance/billing/summary?period=2026-02",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finr"
    }
  });
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.json?.plan?.planId, "builder");
  assert.equal(summary.json?.usage?.verifiedRuns, 1);
  assert.equal(summary.json?.usage?.settledVolumeCents, 1500);
  assert.equal(summary.json?.usage?.arbitrationCases, 1);
  assert.equal(summary.json?.estimate?.subscriptionCents, 9900);
  assert.equal(summary.json?.estimate?.settledVolumeFeeCents, 11);
  assert.equal(summary.json?.estimate?.arbitrationFeeCents, 200);
  assert.equal(summary.json?.estimate?.totalEstimatedCents, 10111);
});

test("API e2e: billing hard limit blocks additional verified runs", async () => {
  const api = createApi({
    now: () => "2026-02-07T00:00:00.000Z",
    opsTokens: ["tok_finw:finance_write"].join(";")
  });

  const tenantId = "tenant_billing_hard_limit";
  const payerAgentId = "agt_billing_limit_payer";
  const payeeAgentId = "agt_billing_limit_payee";

  const setPlan = await request(api, {
    method: "PUT",
    path: "/ops/finance/billing/plan",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finw"
    },
    body: {
      plan: "free",
      hardLimitEnforced: true,
      planOverrides: {
        hardLimitVerifiedRunsPerMonth: 1,
        includedVerifiedRunsPerMonth: 1
      }
    }
  });
  assert.equal(setPlan.statusCode, 200);

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  await registerAgent(api, { tenantId, agentId: payeeAgentId });

  const credit = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payerAgentId)}/wallet/credit`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "billing_limit_credit_1"
    },
    body: {
      amountCents: 4000,
      currency: "USD"
    }
  });
  assert.equal(credit.statusCode, 201);

  const firstCompletion = await createAndCompleteRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId: "run_billing_limit_1",
    amountCents: 500,
    idempotencyPrefix: "billing_limit_run_1"
  });
  assert.equal(firstCompletion.statusCode, 201);
  assert.equal(firstCompletion.json?.run?.status, "completed");

  const secondCompletion = await createAndCompleteRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId: "run_billing_limit_2",
    amountCents: 500,
    idempotencyPrefix: "billing_limit_run_2"
  });
  assert.equal(secondCompletion.statusCode, 402);
  assert.equal(secondCompletion.json?.code, "BILLING_PLAN_LIMIT_EXCEEDED");
  assert.equal(secondCompletion.json?.details?.hardLimitVerifiedRunsPerMonth, 1);
});
