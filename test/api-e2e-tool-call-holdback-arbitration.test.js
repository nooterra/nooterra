import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair, sha256Hex, signHashHexEd25519 } from "../src/core/crypto.js";
import { canonicalJsonStringify, normalizeForCanonicalJson } from "../src/core/canonical-json.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId, publicKeyPem = null, tenantId = "tenant_default" } = {}) {
  const kp = publicKeyPem ? null : createEd25519Keypair();
  const res = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-proxy-tenant-id": tenantId, "x-idempotency-key": `idmp_reg_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_tool_call_holdback_test" },
      publicKeyPem: publicKeyPem ?? kp.publicKeyPem
    }
  });
  assert.equal(res.statusCode, 201, res.body);
  return { keypair: kp, keyId: res.json?.keyId ?? null };
}

async function creditWallet(api, { agentId, amountCents, tenantId = "tenant_default", key } = {}) {
  const res = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-proxy-tenant-id": tenantId, "x-idempotency-key": key },
    body: { amountCents, currency: "USD" }
  });
  assert.equal(res.statusCode, 201, res.body);
}

async function getWallet(api, { agentId, tenantId = "tenant_default" } = {}) {
  const res = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(agentId)}/wallet`,
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json?.wallet ?? null;
}

function buildSignedToolCallVerdict({
  tenantId,
  caseId,
  runId,
  settlementId,
  disputeId,
  arbiterAgentId,
  signerKeyId,
  signerPrivateKeyPem,
  releaseRatePct,
  outcome,
  evidenceRefs,
  issuedAt
} = {}) {
  const verdictCore = normalizeForCanonicalJson(
    {
      schemaVersion: "ArbitrationVerdict.v1",
      verdictId: `arb_vrd_${caseId}`,
      caseId,
      tenantId,
      runId,
      settlementId,
      disputeId,
      arbiterAgentId,
      outcome,
      releaseRatePct,
      rationale: `tool-call verdict ${releaseRatePct}`,
      evidenceRefs,
      issuedAt,
      appealRef: null
    },
    { path: "$" }
  );
  const verdictHash = sha256Hex(canonicalJsonStringify(verdictCore));
  const signature = signHashHexEd25519(verdictHash, signerPrivateKeyPem);
  return {
    ...verdictCore,
    signerKeyId,
    signature,
    verdictHash
  };
}

test("API e2e: tool-call dispute freezes holdback auto-release; payee-win verdict releases held escrow with deterministic adjustment", async () => {
  let nowMs = Date.parse("2026-02-10T00:00:00.000Z");
  const api = createApi({ now: () => new Date(nowMs).toISOString() });
  const tenantId = "tenant_default";

  const payerAgentId = "agt_tc_payer_1";
  const payeeAgentId = "agt_tc_payee_1";
  const arbiterAgentId = "agt_tc_arbiter_1";
  const arbiterKeypair = createEd25519Keypair();

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  await registerAgent(api, { tenantId, agentId: payeeAgentId });
  const arbiterRegistration = await registerAgent(api, { tenantId, agentId: arbiterAgentId, publicKeyPem: arbiterKeypair.publicKeyPem });
  assert.ok(typeof arbiterRegistration.keyId === "string" && arbiterRegistration.keyId.length > 0);

  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 10_000, key: "idmp_tc_credit_1" });

  const agreementHash = "1".repeat(64);
  const receiptHash = "2".repeat(64);

  const lock = await request(api, {
    method: "POST",
    path: "/ops/tool-calls/holds/lock",
    headers: { "x-proxy-tenant-id": tenantId, "x-settld-protocol": "1.0", "x-idempotency-key": "idmp_tc_hold_1" },
    body: {
      agreementHash,
      receiptHash,
      payerAgentId,
      payeeAgentId,
      amountCents: 10_000,
      currency: "USD",
      holdbackBps: 2000,
      challengeWindowMs: 1000
    }
  });
  assert.equal(lock.statusCode, 201, lock.body);
  const hold = lock.json?.hold ?? null;
  assert.ok(hold);
  const holdHash = String(hold.holdHash ?? "");
  assert.match(holdHash, /^[0-9a-f]{64}$/);
  assert.equal(hold.status, "held");
  assert.equal(hold.heldAmountCents, 2000);

  const open = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/open",
    headers: { "x-proxy-tenant-id": tenantId, "x-settld-protocol": "1.0", "x-idempotency-key": "idmp_tc_open_1" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payeeAgentId,
      arbiterAgentId,
      summary: "tool-call dispute: payee claims non-payment",
      evidenceRefs: []
    }
  });
  assert.equal(open.statusCode, 201, open.body);
  const arbitrationCase = open.json?.arbitrationCase ?? null;
  assert.ok(arbitrationCase);
  assert.equal(arbitrationCase.caseId, `arb_case_tc_${agreementHash}`);
  assert.equal(arbitrationCase.status, "under_review");
  assert.equal(arbitrationCase.metadata?.caseType, "tool_call");
  assert.equal(arbitrationCase.metadata?.agreementHash, agreementHash);
  assert.equal(arbitrationCase.metadata?.receiptHash, receiptHash);
  assert.equal(arbitrationCase.metadata?.holdHash, holdHash);

  const listCases = await request(api, {
    method: "GET",
    path: `/tool-calls/arbitration/cases?agreementHash=${agreementHash}&status=under_review`,
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(listCases.statusCode, 200, listCases.body);
  assert.ok(Array.isArray(listCases.json?.cases));
  assert.ok(listCases.json.cases.some((row) => row?.caseId === arbitrationCase.caseId));

  const getCase = await request(api, {
    method: "GET",
    path: `/tool-calls/arbitration/cases/${encodeURIComponent(arbitrationCase.caseId)}`,
    headers: { "x-proxy-tenant-id": tenantId }
  });
  assert.equal(getCase.statusCode, 200, getCase.body);
  assert.equal(getCase.json?.arbitrationCase?.caseId, arbitrationCase.caseId);

  nowMs += 2000;
  const maintenance = await request(api, {
    method: "POST",
    path: "/ops/maintenance/tool-call-holdback/run",
    headers: { "x-proxy-tenant-id": tenantId, "x-settld-protocol": "1.0" },
    body: { dryRun: false, limit: 1000 }
  });
  assert.equal(maintenance.statusCode, 200, maintenance.body);
  assert.equal(maintenance.json?.attempted, 1);
  assert.equal(maintenance.json?.released, 0);
  assert.equal(maintenance.json?.blocked, 1);
  assert.ok((maintenance.json?.blockedCases ?? []).some((row) => row?.holdHash === holdHash));

  const runId = arbitrationCase.runId;
  const disputeId = arbitrationCase.disputeId;
  const settlementId = arbitrationCase.settlementId;
  const verdictIssuedAt = new Date(nowMs).toISOString();
  const signedVerdict = buildSignedToolCallVerdict({
    tenantId,
    caseId: arbitrationCase.caseId,
    runId,
    settlementId,
    disputeId,
    arbiterAgentId,
    signerKeyId: arbiterRegistration.keyId,
    signerPrivateKeyPem: arbiterKeypair.privateKeyPem,
    releaseRatePct: 100,
    outcome: "accepted",
    evidenceRefs: [],
    issuedAt: verdictIssuedAt
  });

  const verdict = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/verdict",
    headers: { "x-proxy-tenant-id": tenantId, "x-settld-protocol": "1.0", "x-idempotency-key": "idmp_tc_verdict_1" },
    body: { caseId: arbitrationCase.caseId, arbitrationVerdict: signedVerdict }
  });
  assert.equal(verdict.statusCode, 200, verdict.body);
  assert.equal(verdict.json?.arbitrationCase?.status, "closed");
  assert.equal(verdict.json?.settlementAdjustment?.adjustmentId, `sadj_agmt_${agreementHash}_holdback`);
  assert.equal(verdict.json?.settlementAdjustment?.kind, "holdback_release");
  assert.equal(verdict.json?.settlementAdjustment?.amountCents, 2000);

  const payerWalletAfter = await getWallet(api, { tenantId, agentId: payerAgentId });
  const payeeWalletAfter = await getWallet(api, { tenantId, agentId: payeeAgentId });
  assert.equal(payerWalletAfter.escrowLockedCents, 0);
  assert.equal(payeeWalletAfter.availableCents, 2000);

  const storedHold = api.store.toolCallHolds.get(`${tenantId}\n${holdHash}`);
  assert.equal(storedHold?.status, "released");

  const verdictReplay = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/verdict",
    headers: { "x-proxy-tenant-id": tenantId, "x-settld-protocol": "1.0", "x-idempotency-key": "idmp_tc_verdict_replay_1" },
    body: { caseId: arbitrationCase.caseId, arbitrationVerdict: signedVerdict }
  });
  assert.equal(verdictReplay.statusCode, 200, verdictReplay.body);
  assert.equal(verdictReplay.json?.alreadyExisted, true);
  assert.equal(verdictReplay.json?.settlementAdjustment?.adjustmentId, `sadj_agmt_${agreementHash}_holdback`);
});

test("API e2e: tool-call dispute payer-win verdict refunds held escrow; admin override can open after challenge window", async () => {
  let nowMs = Date.parse("2026-02-10T00:10:00.000Z");
  const api = createApi({ now: () => new Date(nowMs).toISOString() });
  const tenantId = "tenant_default";

  const payerAgentId = "agt_tc_payer_2";
  const payeeAgentId = "agt_tc_payee_2";
  const arbiterAgentId = "agt_tc_arbiter_2";
  const arbiterKeypair = createEd25519Keypair();

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  await registerAgent(api, { tenantId, agentId: payeeAgentId });
  const arbiterRegistration = await registerAgent(api, { tenantId, agentId: arbiterAgentId, publicKeyPem: arbiterKeypair.publicKeyPem });

  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 5000, key: "idmp_tc_credit_2" });

  const agreementHash = "3".repeat(64);
  const receiptHash = "4".repeat(64);

  const lock = await request(api, {
    method: "POST",
    path: "/ops/tool-calls/holds/lock",
    headers: { "x-proxy-tenant-id": tenantId, "x-settld-protocol": "1.0", "x-idempotency-key": "idmp_tc_hold_2" },
    body: {
      agreementHash,
      receiptHash,
      payerAgentId,
      payeeAgentId,
      amountCents: 5000,
      currency: "USD",
      holdbackBps: 2000,
      challengeWindowMs: 1000
    }
  });
  assert.equal(lock.statusCode, 201, lock.body);
  const hold = lock.json?.hold ?? null;
  const holdHash = String(hold?.holdHash ?? "");
  assert.match(holdHash, /^[0-9a-f]{64}$/);

  nowMs += 2000;
  const openTooLate = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/open",
    headers: { "x-proxy-tenant-id": tenantId, "x-settld-protocol": "1.0", "x-idempotency-key": "idmp_tc_open_2_late" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payerAgentId,
      arbiterAgentId,
      summary: "late open should fail",
      evidenceRefs: []
    }
  });
  assert.equal(openTooLate.statusCode, 409);
  assert.equal(openTooLate.json?.code, "CHALLENGE_WINDOW_CLOSED");

  const open = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/open",
    headers: { "x-proxy-tenant-id": tenantId, "x-settld-protocol": "1.0", "x-idempotency-key": "idmp_tc_open_2_override" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payerAgentId,
      arbiterAgentId,
      summary: "admin override open after window",
      evidenceRefs: [],
      adminOverride: { enabled: true, reason: "ops override for late-filing test" }
    }
  });
  assert.equal(open.statusCode, 201, open.body);
  const arbitrationCase = open.json?.arbitrationCase ?? null;
  assert.ok(arbitrationCase);

  const payerWalletBefore = await getWallet(api, { tenantId, agentId: payerAgentId });
  assert.ok(payerWalletBefore.escrowLockedCents > 0);

  const signedVerdict = buildSignedToolCallVerdict({
    tenantId,
    caseId: arbitrationCase.caseId,
    runId: arbitrationCase.runId,
    settlementId: arbitrationCase.settlementId,
    disputeId: arbitrationCase.disputeId,
    arbiterAgentId,
    signerKeyId: arbiterRegistration.keyId,
    signerPrivateKeyPem: arbiterKeypair.privateKeyPem,
    releaseRatePct: 0,
    outcome: "rejected",
    evidenceRefs: [],
    issuedAt: new Date(nowMs).toISOString()
  });

  const verdict = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/verdict",
    headers: { "x-proxy-tenant-id": tenantId, "x-settld-protocol": "1.0", "x-idempotency-key": "idmp_tc_verdict_2" },
    body: { caseId: arbitrationCase.caseId, arbitrationVerdict: signedVerdict }
  });
  assert.equal(verdict.statusCode, 200, verdict.body);
  assert.equal(verdict.json?.settlementAdjustment?.adjustmentId, `sadj_agmt_${agreementHash}_holdback`);
  assert.equal(verdict.json?.settlementAdjustment?.kind, "holdback_refund");

  const payerWalletAfter = await getWallet(api, { tenantId, agentId: payerAgentId });
  const payeeWalletAfter = await getWallet(api, { tenantId, agentId: payeeAgentId });
  assert.equal(payerWalletAfter.escrowLockedCents, 0);
  assert.equal(payeeWalletAfter.availableCents, 0);

  const storedHold = api.store.toolCallHolds.get(`${tenantId}\n${holdHash}`);
  assert.equal(storedHold?.status, "refunded");
});

