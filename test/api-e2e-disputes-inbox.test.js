import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { tenantId, agentId, ownerId = "svc_dispute_inbox_test" }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
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
  assert.equal(response.statusCode, 201);
}

async function creditWallet(api, { tenantId, agentId, amountCents, idempotencyKey }) {
  const response = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": idempotencyKey
    },
    body: {
      amountCents,
      currency: "USD"
    }
  });
  assert.equal(response.statusCode, 201);
}

async function createCompletedRun(api, { tenantId, payerAgentId, payeeAgentId, runId, amountCents, idempotencyPrefix }) {
  const created = await request(api, {
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
        disputeWindowDays: 5
      }
    }
  });
  assert.equal(created.statusCode, 201);

  const completed = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_complete`,
      "x-proxy-expected-prev-chain-hash": created.json?.run?.lastChainHash
    },
    body: {
      type: "RUN_COMPLETED",
      payload: { outputRef: `evidence://${runId}/output.json` }
    }
  });
  assert.equal(completed.statusCode, 201);
}

async function openDisputeCase(api, { tenantId, runId, disputeId, caseId, payerAgentId, arbiterAgentId, idempotencyPrefix, reason }) {
  const dispute = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_dispute`
    },
    body: {
      disputeId,
      reason,
      openedByAgentId: payerAgentId
    }
  });
  assert.equal(dispute.statusCode, 200);
  assert.equal(dispute.json?.settlement?.disputeStatus, "open");

  const arbitration = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/arbitration/open`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_case`
    },
    body: {
      disputeId,
      caseId,
      arbiterAgentId
    }
  });
  assert.equal(arbitration.statusCode, 201);
}

test("API e2e: dispute inbox lists tenant disputes with arbitration summaries", async () => {
  let nowAt = "2026-03-06T08:00:00.000Z";
  const api = createApi({ now: () => nowAt });

  const tenantId = "tenant_dispute_inbox";
  const payerAgentId = "agt_dispute_inbox_payer";
  const payeeAgentId = "agt_dispute_inbox_payee";
  const arbiterAgentId = "agt_dispute_inbox_arbiter";

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  await registerAgent(api, { tenantId, agentId: payeeAgentId });
  await registerAgent(api, { tenantId, agentId: arbiterAgentId });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 20_000, idempotencyKey: "credit_dispute_inbox" });

  await createCompletedRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId: "run_dispute_inbox_1",
    amountCents: 1500,
    idempotencyPrefix: "dispute_inbox_run_1"
  });
  await openDisputeCase(api, {
    tenantId,
    runId: "run_dispute_inbox_1",
    disputeId: "dispute_inbox_1",
    caseId: "arb_case_inbox_1",
    payerAgentId,
    arbiterAgentId,
    idempotencyPrefix: "dispute_inbox_case_1",
    reason: "First dispute reason"
  });

  nowAt = "2026-03-06T10:30:00.000Z";
  await createCompletedRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId: "run_dispute_inbox_2",
    amountCents: 2300,
    idempotencyPrefix: "dispute_inbox_run_2"
  });
  await openDisputeCase(api, {
    tenantId,
    runId: "run_dispute_inbox_2",
    disputeId: "dispute_inbox_2",
    caseId: "arb_case_inbox_2",
    payerAgentId,
    arbiterAgentId,
    idempotencyPrefix: "dispute_inbox_case_2",
    reason: "Second dispute reason"
  });

  const inbox = await request(api, {
    method: "GET",
    path: "/disputes?limit=50&offset=0",
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(inbox.statusCode, 200, inbox.body);
  assert.equal(inbox.json?.ok, true);
  assert.equal(inbox.json?.tenantId, tenantId);
  assert.equal(inbox.json?.count, 2);
  assert.equal(inbox.json?.items?.length, 2);
  assert.equal(inbox.json?.items?.[0]?.runId, "run_dispute_inbox_2");
  assert.equal(inbox.json?.items?.[0]?.disputeId, "dispute_inbox_2");
  assert.equal(inbox.json?.items?.[0]?.settlementStatus, "released");
  assert.equal(inbox.json?.items?.[0]?.disputeStatus, "open");
  assert.equal(inbox.json?.items?.[0]?.arbitration?.latestCaseId, "arb_case_inbox_2");
  assert.equal(inbox.json?.items?.[0]?.arbitration?.caseCount, 1);
  assert.equal(inbox.json?.items?.[0]?.arbitration?.openCaseCount, 1);
  assert.equal(inbox.json?.items?.[1]?.runId, "run_dispute_inbox_1");

  const filtered = await request(api, {
    method: "GET",
    path: "/disputes?runId=run_dispute_inbox_1&disputeStatus=open&settlementStatus=released",
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(filtered.statusCode, 200, filtered.body);
  assert.equal(filtered.json?.count, 1);
  assert.equal(filtered.json?.items?.[0]?.runId, "run_dispute_inbox_1");
  assert.equal(filtered.json?.items?.[0]?.arbitration?.latestCaseId, "arb_case_inbox_1");
});

test("API e2e: dispute inbox rejects invalid queries fail-closed", async () => {
  const api = createApi();

  const invalidLimit = await request(api, {
    method: "GET",
    path: "/disputes?limit=abc"
  });
  assert.equal(invalidLimit.statusCode, 400, invalidLimit.body);
  assert.equal(invalidLimit.json?.code, "SCHEMA_INVALID");

  const invalidStatus = await request(api, {
    method: "GET",
    path: "/disputes?disputeStatus=pending"
  });
  assert.equal(invalidStatus.statusCode, 400, invalidStatus.body);
  assert.equal(invalidStatus.json?.code, "SCHEMA_INVALID");
});

test("API e2e: dispute detail returns a consumer-safe dispute packet", async () => {
  const api = createApi({ now: () => "2026-03-06T12:00:00.000Z" });

  const tenantId = "tenant_dispute_detail";
  const payerAgentId = "agt_dispute_detail_payer";
  const payeeAgentId = "agt_dispute_detail_payee";
  const arbiterAgentId = "agt_dispute_detail_arbiter";

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  await registerAgent(api, { tenantId, agentId: payeeAgentId });
  await registerAgent(api, { tenantId, agentId: arbiterAgentId });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 8_000, idempotencyKey: "credit_dispute_detail" });
  await createCompletedRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId: "run_dispute_detail_1",
    amountCents: 1750,
    idempotencyPrefix: "dispute_detail_run_1"
  });
  await openDisputeCase(api, {
    tenantId,
    runId: "run_dispute_detail_1",
    disputeId: "dispute_detail_1",
    caseId: "arb_case_detail_1",
    payerAgentId,
    arbiterAgentId,
    idempotencyPrefix: "dispute_detail_case_1",
    reason: "Detail packet reason"
  });

  const detail = await request(api, {
    method: "GET",
    path: "/disputes/dispute_detail_1?caseId=arb_case_detail_1",
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json?.ok, true);
  assert.equal(detail.json?.detail?.schemaVersion, "DisputeDetail.v1");
  assert.equal(detail.json?.detail?.disputeId, "dispute_detail_1");
  assert.equal(detail.json?.detail?.runId, "run_dispute_detail_1");
  assert.equal(detail.json?.detail?.caseId, "arb_case_detail_1");
  assert.equal(detail.json?.detail?.item?.disputeId, "dispute_detail_1");
  assert.equal(detail.json?.detail?.arbitrationCase?.caseId, "arb_case_detail_1");
  assert.equal(detail.json?.detail?.settlement?.settlement?.status, "released");
  assert.ok(Array.isArray(detail.json?.detail?.relatedCases));
  assert.ok(Array.isArray(detail.json?.detail?.timeline));
  assert.ok(detail.json?.detail?.timeline?.some((row) => row?.eventType === "dispute.opened"));
  assert.ok(detail.json?.detail?.timeline?.some((row) => row?.eventType === "arbitration.opened"));

  const missingCase = await request(api, {
    method: "GET",
    path: "/disputes/dispute_detail_1?caseId=arb_case_missing",
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(missingCase.statusCode, 404, missingCase.body);
});

test("API e2e: /v1/disputes projects the Action Wallet dispute lifecycle", async () => {
  const api = createApi({ now: () => "2026-03-06T14:00:00.000Z" });

  const tenantId = "tenant_dispute_wallet_v1";
  const payerAgentId = "agt_dispute_wallet_payer";
  const payeeAgentId = "agt_dispute_wallet_payee";
  const arbiterAgentId = "agt_dispute_wallet_arbiter";
  const runId = "run_dispute_wallet_v1";
  const disputeId = "dispute_wallet_v1";
  const caseId = "arb_case_wallet_v1";

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  await registerAgent(api, { tenantId, agentId: payeeAgentId });
  await registerAgent(api, { tenantId, agentId: arbiterAgentId });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 8_000, idempotencyKey: "credit_dispute_wallet_v1" });
  await createCompletedRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId,
    amountCents: 1750,
    idempotencyPrefix: "dispute_wallet_v1"
  });

  const opened = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
    headers: { "x-proxy-tenant-id": tenantId, "x-idempotency-key": "dispute_wallet_v1_open" },
    body: {
      disputeId,
      reason: "Incorrect charge",
      openedByAgentId: payerAgentId
    }
  });
  assert.equal(opened.statusCode, 200, opened.body);

  const openedAlias = await request(api, {
    method: "POST",
    path: "/v1/disputes",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "dispute_wallet_v1_alias_opened",
      "x-nooterra-protocol": "1.0"
    },
    body: { disputeId }
  });
  assert.equal(openedAlias.statusCode, 200, openedAlias.body);
  assert.equal(openedAlias.json?.disputeCase?.status, "opened");
  assert.equal(openedAlias.json?.disputeCase?.settlementStatus, "released");

  const openedDetail = await request(api, {
    method: "GET",
    path: `/v1/disputes/${encodeURIComponent(disputeId)}`,
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(openedDetail.statusCode, 200, openedDetail.body);
  assert.equal(openedDetail.json?.disputeCase?.disputeId, disputeId);
  assert.equal(openedDetail.json?.disputeCase?.status, "opened");

  const replayedOpenedAlias = await request(api, {
    method: "POST",
    path: "/v1/disputes",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "dispute_wallet_v1_alias_opened",
      "x-nooterra-protocol": "1.0"
    },
    body: { disputeId }
  });
  assert.equal(replayedOpenedAlias.statusCode, 200, replayedOpenedAlias.body);
  assert.deepEqual(replayedOpenedAlias.json, openedAlias.json);

  const conflictingOpenedAlias = await request(api, {
    method: "POST",
    path: "/v1/disputes",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "dispute_wallet_v1_alias_opened",
      "x-nooterra-protocol": "1.0"
    },
    body: { disputeId, caseId: "arb_case_wallet_v1_conflict" }
  });
  assert.equal(conflictingOpenedAlias.statusCode, 409, conflictingOpenedAlias.body);
  assert.equal(conflictingOpenedAlias.json?.error, "idempotency key conflict");

  const arbitration = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/arbitration/open`,
    headers: { "x-proxy-tenant-id": tenantId, "x-idempotency-key": "dispute_wallet_v1_arbitration_open" },
    body: {
      disputeId,
      caseId,
      arbiterAgentId
    }
  });
  assert.equal(arbitration.statusCode, 201, arbitration.body);

  const awaitingEvidenceAlias = await request(api, {
    method: "POST",
    path: "/v1/disputes",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "dispute_wallet_v1_alias_awaiting",
      "x-nooterra-protocol": "1.0"
    },
    body: { disputeId, caseId }
  });
  assert.equal(awaitingEvidenceAlias.statusCode, 200, awaitingEvidenceAlias.body);
  assert.equal(awaitingEvidenceAlias.json?.disputeCase?.caseId, caseId);
  assert.equal(awaitingEvidenceAlias.json?.disputeCase?.status, "awaiting_evidence");

  const awaitingEvidenceDetail = await request(api, {
    method: "GET",
    path: `/v1/disputes/${encodeURIComponent(disputeId)}?caseId=${encodeURIComponent(caseId)}`,
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(awaitingEvidenceDetail.statusCode, 200, awaitingEvidenceDetail.body);
  assert.equal(awaitingEvidenceDetail.json?.disputeCase?.caseId, caseId);
  assert.equal(awaitingEvidenceDetail.json?.disputeCase?.status, "awaiting_evidence");

  const evidence = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/evidence`,
    headers: { "x-proxy-tenant-id": tenantId, "x-idempotency-key": "dispute_wallet_v1_evidence" },
    body: {
      disputeId,
      evidenceRef: `evidence://${runId}/receipt.png`,
      submittedByAgentId: payerAgentId,
      reason: "Attached receipt screenshot"
    }
  });
  assert.equal(evidence.statusCode, 200, evidence.body);

  const triagedAlias = await request(api, {
    method: "POST",
    path: "/v1/disputes",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "dispute_wallet_v1_alias_triaged",
      "x-nooterra-protocol": "1.0"
    },
    body: { disputeId, caseId }
  });
  assert.equal(triagedAlias.statusCode, 200, triagedAlias.body);
  assert.equal(triagedAlias.json?.disputeCase?.status, "triaged");

  const closed = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/close`,
    headers: { "x-proxy-tenant-id": tenantId, "x-idempotency-key": "dispute_wallet_v1_close" },
    body: {
      disputeId,
      resolutionOutcome: "rejected",
      resolutionEscalationLevel: "l2_arbiter",
      resolutionSummary: "Charge is valid",
      closedByAgentId: arbiterAgentId
    }
  });
  assert.equal(closed.statusCode, 200, closed.body);

  const deniedAlias = await request(api, {
    method: "POST",
    path: "/v1/disputes",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": "dispute_wallet_v1_alias_denied",
      "x-nooterra-protocol": "1.0"
    },
    body: { disputeId, caseId }
  });
  assert.equal(deniedAlias.statusCode, 200, deniedAlias.body);
  assert.equal(deniedAlias.json?.disputeCase?.status, "denied");
  assert.equal(deniedAlias.json?.disputeCase?.settlementStatus, "released");
  assert.ok(Array.isArray(deniedAlias.json?.detail?.timeline));
  assert.ok(deniedAlias.json?.detail?.timeline?.some((row) => row?.eventType === "dispute.opened"));
  assert.ok(deniedAlias.json?.detail?.timeline?.some((row) => row?.eventType === "dispute.resolved"));
  assert.ok(!deniedAlias.json?.detail?.timeline?.some((row) => row?.eventType === "dispute.closed"));

  const deniedDetail = await request(api, {
    method: "GET",
    path: `/v1/disputes/${encodeURIComponent(disputeId)}?caseId=${encodeURIComponent(caseId)}`,
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(deniedDetail.statusCode, 200, deniedDetail.body);
  assert.equal(deniedDetail.json?.disputeCase?.status, "denied");
  assert.equal(deniedDetail.json?.disputeCase?.settlementStatus, "released");
});
