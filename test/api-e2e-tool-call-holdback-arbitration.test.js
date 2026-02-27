import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair, sha256Hex, signHashHexEd25519 } from "../src/core/crypto.js";
import { canonicalJsonStringify, normalizeForCanonicalJson } from "../src/core/canonical-json.js";
import { buildDisputeOpenEnvelopeV1 } from "../src/core/dispute-open-envelope.js";
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

async function setX402AgentLifecycle(
  api,
  { agentId, status, idempotencyKey, reasonCode = null, reasonMessage = null, tenantId = "tenant_default" }
) {
  return await request(api, {
    method: "POST",
    path: `/x402/gate/agents/${encodeURIComponent(agentId)}/lifecycle`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": idempotencyKey,
      "x-nooterra-protocol": "1.0"
    },
    body: {
      status,
      ...(reasonCode ? { reasonCode } : {}),
      ...(reasonMessage ? { reasonMessage } : {})
    }
  });
}

async function setSignerKeyLifecycle(api, { keyId, action, tenantId = "tenant_default" } = {}) {
  const normalizedAction = action === "rotate" ? "rotate" : action === "revoke" ? "revoke" : null;
  if (!normalizedAction) throw new TypeError("action must be rotate or revoke");
  const res = await request(api, {
    method: "POST",
    path: `/ops/signer-keys/${encodeURIComponent(keyId)}/${normalizedAction}`,
    headers: { "x-proxy-tenant-id": tenantId },
    body: {}
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json?.signerKey?.status, normalizedAction === "rotate" ? "rotated" : "revoked");
  return res.json?.signerKey ?? null;
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

function buildSignedDisputeOpenEnvelope({
  tenantId,
  agreementHash,
  receiptHash,
  holdHash,
  openedByAgentId,
  signerKeyId,
  signerPrivateKeyPem,
  openedAt
} = {}) {
  const envelopeWithPlaceholder = buildDisputeOpenEnvelopeV1({
    envelopeId: `dopen_tc_${agreementHash}`,
    caseId: `arb_case_tc_${agreementHash}`,
    tenantId,
    agreementHash,
    receiptHash,
    holdHash,
    openedByAgentId,
    openedAt: openedAt ?? new Date().toISOString(),
    reasonCode: "TOOL_CALL_DISPUTE",
    nonce: `nonce_${agreementHash.slice(0, 16)}`,
    signerKeyId,
    signature: "placeholder"
  });
  const signature = signHashHexEd25519(envelopeWithPlaceholder.envelopeHash, signerPrivateKeyPem);
  return {
    ...envelopeWithPlaceholder,
    signature
  };
}

async function seedToolCallSettlementBindingSource(
  api,
  { tenantId = "tenant_default", agreementHash, receiptHash, requestSha256, runId, settlementId, receiptId, at } = {}
) {
  const nowAt = at ?? (typeof api.store?.nowIso === "function" ? api.store.nowIso() : new Date().toISOString());
  const normalizedRunId = typeof runId === "string" && runId.trim() !== "" ? runId.trim() : `run_tc_binding_${agreementHash.slice(0, 12)}`;
  const normalizedSettlementId =
    typeof settlementId === "string" && settlementId.trim() !== "" ? settlementId.trim() : `setl_tc_binding_${agreementHash.slice(0, 12)}`;
  const normalizedReceiptId =
    typeof receiptId === "string" && receiptId.trim() !== "" ? receiptId.trim() : `x402_receipt_tc_binding_${agreementHash.slice(0, 12)}`;
  const settlement = {
    schemaVersion: "AgentRunSettlement.v1",
    tenantId,
    runId: normalizedRunId,
    settlementId: normalizedSettlementId,
    disputeId: `dsp_tc_binding_${agreementHash.slice(0, 12)}`,
    decisionTrace: {
      bindings: {
        request: { sha256: requestSha256 }
      },
      decisionRecord: {
        agreementId: agreementHash
      },
      settlementReceipt: {
        receiptId: normalizedReceiptId,
        runId: normalizedRunId,
        settlementId: normalizedSettlementId,
        receiptHash,
        status: "released",
        createdAt: nowAt,
        settledAt: nowAt
      }
    },
    createdAt: nowAt,
    updatedAt: nowAt
  };
  await api.store.commitTx({
    at: nowAt,
    ops: [{ kind: "AGENT_RUN_SETTLEMENT_UPSERT", tenantId, runId: normalizedRunId, settlement }]
  });
  await api.store.putX402Receipt({
    tenantId,
    receipt: {
      schemaVersion: "X402ReceiptRecord.v1",
      tenantId,
      receiptId: normalizedReceiptId,
      runId: normalizedRunId,
      settlementState: "released",
      settledAt: nowAt,
      createdAt: nowAt,
      updatedAt: nowAt,
      bindings: {
        request: { sha256: requestSha256 }
      },
      decisionRecord: {
        agreementId: agreementHash
      },
      settlementReceipt: {
        receiptId: normalizedReceiptId,
        runId: normalizedRunId,
        settlementId: normalizedSettlementId,
        receiptHash,
        status: "released",
        createdAt: nowAt,
        settledAt: nowAt
      }
    }
  });
  return { requestSha256, runId: normalizedRunId, settlementId: normalizedSettlementId, receiptId: normalizedReceiptId };
}

test("API e2e: tool-call dispute freezes holdback auto-release; payee-win verdict releases held escrow with deterministic adjustment", async () => {
  let nowMs = Date.parse("2026-02-10T00:00:00.000Z");
  const api = createApi({ now: () => new Date(nowMs).toISOString(), opsToken: "tok_ops" });
  const tenantId = "tenant_default";

  const payerAgentId = "agt_tc_payer_1";
  const payeeAgentId = "agt_tc_payee_1";
  const arbiterAgentId = "agt_tc_arbiter_1";
  const arbiterKeypair = createEd25519Keypair();

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  const payeeRegistration = await registerAgent(api, { tenantId, agentId: payeeAgentId });
  const arbiterRegistration = await registerAgent(api, { tenantId, agentId: arbiterAgentId, publicKeyPem: arbiterKeypair.publicKeyPem });
  assert.ok(typeof arbiterRegistration.keyId === "string" && arbiterRegistration.keyId.length > 0);

  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 10_000, key: "idmp_tc_credit_1" });

  const agreementHash = "1".repeat(64);
  const receiptHash = "2".repeat(64);
  const requestSha256 = "a".repeat(64);
  await seedToolCallSettlementBindingSource(api, { tenantId, agreementHash, receiptHash, requestSha256, at: new Date(nowMs).toISOString() });

  const lock = await request(api, {
    method: "POST",
    path: "/ops/tool-calls/holds/lock",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_hold_1" },
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
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_open_1" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payeeAgentId,
      disputeOpenEnvelope: buildSignedDisputeOpenEnvelope({
        tenantId,
        agreementHash,
        receiptHash,
        holdHash,
        openedByAgentId: payeeAgentId,
        signerKeyId: payeeRegistration.keyId,
        signerPrivateKeyPem: payeeRegistration.keypair.privateKeyPem,
        openedAt: new Date(nowMs).toISOString()
      }),
      arbiterAgentId,
      summary: "tool-call dispute: payee claims non-payment",
      evidenceRefs: [`http:request_sha256:${requestSha256}`]
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
  assert.equal(open.json?.disputeOpenEnvelopeArtifact?.artifactId, `dopen_tc_${agreementHash}`);

  const duplicateOpen = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/open",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_open_1_duplicate" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payeeAgentId,
      disputeOpenEnvelope: buildSignedDisputeOpenEnvelope({
        tenantId,
        agreementHash,
        receiptHash,
        holdHash,
        openedByAgentId: payeeAgentId,
        signerKeyId: payeeRegistration.keyId,
        signerPrivateKeyPem: payeeRegistration.keypair.privateKeyPem,
        openedAt: new Date(nowMs).toISOString()
      }),
      arbiterAgentId,
      summary: "duplicate open should fail",
      evidenceRefs: []
    }
  });
  assert.equal(duplicateOpen.statusCode, 409);
  assert.equal(duplicateOpen.json?.code, "DISPUTE_ALREADY_OPEN");

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
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0" },
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
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_verdict_1" },
    body: { caseId: arbitrationCase.caseId, arbitrationVerdict: signedVerdict }
  });
  assert.equal(verdict.statusCode, 200, verdict.body);
  assert.equal(verdict.json?.arbitrationCase?.status, "closed");
  assert.equal(verdict.json?.settlementAdjustment?.adjustmentId, `sadj_agmt_${agreementHash}_holdback`);
  assert.equal(verdict.json?.settlementAdjustment?.kind, "holdback_release");
  assert.equal(verdict.json?.settlementAdjustment?.amountCents, 2000);

  const reputationFacts = await request(api, {
    method: "GET",
    path: `/ops/reputation/facts?agentId=${encodeURIComponent(payeeAgentId)}&toolId=tool_call&window=allTime`,
    headers: { "x-proxy-tenant-id": tenantId, "x-proxy-ops-token": "tok_ops" }
  });
  assert.equal(reputationFacts.statusCode, 200, reputationFacts.body);
  assert.equal(reputationFacts.json?.facts?.totals?.disputes?.opened, 1);
  assert.equal(reputationFacts.json?.facts?.totals?.disputes?.payeeWin, 1);
  assert.equal(reputationFacts.json?.facts?.totals?.economics?.adjustmentAppliedCents, 2000);
  const reputationFactsWithEvents = await request(api, {
    method: "GET",
    path: `/ops/reputation/facts?agentId=${encodeURIComponent(payeeAgentId)}&toolId=tool_call&window=allTime&includeEvents=1`,
    headers: { "x-proxy-tenant-id": tenantId, "x-proxy-ops-token": "tok_ops" }
  });
  assert.equal(reputationFactsWithEvents.statusCode, 200, reputationFactsWithEvents.body);
  const eventIdsBeforeRetry = (reputationFactsWithEvents.json?.events ?? []).map((row) => String(row?.eventId ?? "")).filter(Boolean);
  assert.equal(new Set(eventIdsBeforeRetry).size, eventIdsBeforeRetry.length);
  const eventCountBeforeRetry = Number(reputationFactsWithEvents.json?.facts?.totals?.eventCount ?? eventIdsBeforeRetry.length);

  const replay = await request(api, {
    method: "GET",
    path: `/ops/tool-calls/replay-evaluate?agreementHash=${agreementHash}`,
    headers: { "x-proxy-tenant-id": tenantId, "x-proxy-ops-token": "tok_ops" }
  });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json?.replay?.stage, "terminal_dispute");
  assert.equal(replay.json?.replay?.expected?.adjustmentKind, "holdback_release");
  assert.equal(replay.json?.comparisons?.chainConsistent, true);

  const payerWalletAfter = await getWallet(api, { tenantId, agentId: payerAgentId });
  const payeeWalletAfter = await getWallet(api, { tenantId, agentId: payeeAgentId });
  assert.equal(payerWalletAfter.escrowLockedCents, 0);
  assert.equal(payeeWalletAfter.availableCents, 2000);

  const storedHold = api.store.toolCallHolds.get(`${tenantId}\n${holdHash}`);
  assert.equal(storedHold?.status, "released");

  const verdictReplay = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/verdict",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_verdict_replay_1" },
    body: { caseId: arbitrationCase.caseId, arbitrationVerdict: signedVerdict }
  });
  assert.equal(verdictReplay.statusCode, 200, verdictReplay.body);
  assert.equal(verdictReplay.json?.alreadyExisted, true);
  assert.equal(verdictReplay.json?.settlementAdjustment?.adjustmentId, `sadj_agmt_${agreementHash}_holdback`);

  const maintenanceReplay = await request(api, {
    method: "POST",
    path: "/ops/maintenance/tool-call-holdback/run",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-proxy-ops-token": "tok_ops" },
    body: { dryRun: false, limit: 1000 }
  });
  assert.equal(maintenanceReplay.statusCode, 200, maintenanceReplay.body);

  const reputationFactsAfterRetry = await request(api, {
    method: "GET",
    path: `/ops/reputation/facts?agentId=${encodeURIComponent(payeeAgentId)}&toolId=tool_call&window=allTime&includeEvents=1`,
    headers: { "x-proxy-tenant-id": tenantId, "x-proxy-ops-token": "tok_ops" }
  });
  assert.equal(reputationFactsAfterRetry.statusCode, 200, reputationFactsAfterRetry.body);
  const eventIdsAfterRetry = (reputationFactsAfterRetry.json?.events ?? []).map((row) => String(row?.eventId ?? "")).filter(Boolean);
  assert.equal(new Set(eventIdsAfterRetry).size, eventIdsAfterRetry.length);
  const eventCountAfterRetry = Number(reputationFactsAfterRetry.json?.facts?.totals?.eventCount ?? eventIdsAfterRetry.length);
  assert.equal(eventCountAfterRetry, eventCountBeforeRetry);
});

test("API e2e: tool-call dispute payer-win verdict refunds held escrow; admin override can open after challenge window", async () => {
  let nowMs = Date.parse("2026-02-10T00:10:00.000Z");
  const api = createApi({ now: () => new Date(nowMs).toISOString(), opsToken: "tok_ops" });
  const tenantId = "tenant_default";

  const payerAgentId = "agt_tc_payer_2";
  const payeeAgentId = "agt_tc_payee_2";
  const arbiterAgentId = "agt_tc_arbiter_2";
  const arbiterKeypair = createEd25519Keypair();

  const payerRegistration = await registerAgent(api, { tenantId, agentId: payerAgentId });
  await registerAgent(api, { tenantId, agentId: payeeAgentId });
  const arbiterRegistration = await registerAgent(api, { tenantId, agentId: arbiterAgentId, publicKeyPem: arbiterKeypair.publicKeyPem });

  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 5000, key: "idmp_tc_credit_2" });

  const agreementHash = "3".repeat(64);
  const receiptHash = "4".repeat(64);
  const requestSha256 = "b".repeat(64);
  await seedToolCallSettlementBindingSource(api, { tenantId, agreementHash, receiptHash, requestSha256, at: new Date(nowMs).toISOString() });

  const lock = await request(api, {
    method: "POST",
    path: "/ops/tool-calls/holds/lock",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_hold_2" },
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
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_open_2_late" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payerAgentId,
      disputeOpenEnvelope: buildSignedDisputeOpenEnvelope({
        tenantId,
        agreementHash,
        receiptHash,
        holdHash,
        openedByAgentId: payerAgentId,
        signerKeyId: payerRegistration.keyId,
        signerPrivateKeyPem: payerRegistration.keypair.privateKeyPem,
        openedAt: new Date(nowMs).toISOString()
      }),
      arbiterAgentId,
      summary: "late open should fail",
      evidenceRefs: []
    }
  });
  assert.equal(openTooLate.statusCode, 409);
  assert.equal(openTooLate.json?.code, "DISPUTE_WINDOW_EXPIRED");

  const open = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/open",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_open_2_override" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payerAgentId,
      arbiterAgentId,
      summary: "admin override open after window",
      evidenceRefs: [`http:request_sha256:${requestSha256}`],
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
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_verdict_2" },
    body: { caseId: arbitrationCase.caseId, arbitrationVerdict: signedVerdict }
  });
  assert.equal(verdict.statusCode, 200, verdict.body);
  assert.equal(verdict.json?.settlementAdjustment?.adjustmentId, `sadj_agmt_${agreementHash}_holdback`);
  assert.equal(verdict.json?.settlementAdjustment?.kind, "holdback_refund");

  const replay = await request(api, {
    method: "GET",
    path: `/ops/tool-calls/replay-evaluate?agreementHash=${agreementHash}`,
    headers: { "x-proxy-tenant-id": tenantId, "x-proxy-ops-token": "tok_ops" }
  });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json?.replay?.stage, "terminal_dispute");
  assert.equal(replay.json?.replay?.expected?.adjustmentKind, "holdback_refund");
  assert.equal(replay.json?.comparisons?.chainConsistent, true);

  const payerWalletAfter = await getWallet(api, { tenantId, agentId: payerAgentId });
  const payeeWalletAfter = await getWallet(api, { tenantId, agentId: payeeAgentId });
  assert.equal(payerWalletAfter.escrowLockedCents, 0);
  assert.equal(payeeWalletAfter.availableCents, 0);

  const storedHold = api.store.toolCallHolds.get(`${tenantId}\n${holdHash}`);
  assert.equal(storedHold?.status, "refunded");
});

test("API e2e: tool-call holdback auto-release emits reputation facts when no dispute is open", async () => {
  let nowMs = Date.parse("2026-02-10T01:00:00.000Z");
  const api = createApi({ now: () => new Date(nowMs).toISOString(), opsToken: "tok_ops" });
  const tenantId = "tenant_default";

  const payerAgentId = "agt_tc_payer_auto_1";
  const payeeAgentId = "agt_tc_payee_auto_1";

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  await registerAgent(api, { tenantId, agentId: payeeAgentId });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 5000, key: "idmp_tc_credit_auto_1" });

  const agreementHash = "5".repeat(64);
  const receiptHash = "6".repeat(64);
  const lock = await request(api, {
    method: "POST",
    path: "/ops/tool-calls/holds/lock",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_hold_auto_1" },
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
  assert.equal(lock.json?.hold?.heldAmountCents, 1000);

  nowMs += 2000;
  const maintenance = await request(api, {
    method: "POST",
    path: "/ops/maintenance/tool-call-holdback/run",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-proxy-ops-token": "tok_ops" },
    body: { dryRun: false, limit: 1000 }
  });
  assert.equal(maintenance.statusCode, 200, maintenance.body);
  assert.equal(maintenance.json?.released, 1);
  assert.equal(maintenance.json?.blocked, 0);

  const reputationFacts = await request(api, {
    method: "GET",
    path: `/ops/reputation/facts?agentId=${encodeURIComponent(payeeAgentId)}&toolId=tool_call&window=allTime`,
    headers: { "x-proxy-tenant-id": tenantId, "x-proxy-ops-token": "tok_ops" }
  });
  assert.equal(reputationFacts.statusCode, 200, reputationFacts.body);
  assert.equal(reputationFacts.json?.facts?.totals?.economics?.autoReleasedCents, 1000);
});

test("API e2e: tool-call arbitration routes fail closed when payer/arbiter lifecycle is non-active", async () => {
  let nowMs = Date.parse("2026-02-12T00:00:00.000Z");
  const api = createApi({ now: () => new Date(nowMs).toISOString(), opsToken: "tok_ops" });
  const tenantId = "tenant_default";

  const payerAgentId = "agt_tc_lifecycle_payer_1";
  const payeeAgentId = "agt_tc_lifecycle_payee_1";
  const arbiterAgentId = "agt_tc_lifecycle_arbiter_1";
  const arbiterKeypair = createEd25519Keypair();

  const payerRegistration = await registerAgent(api, { tenantId, agentId: payerAgentId });
  const payeeRegistration = await registerAgent(api, { tenantId, agentId: payeeAgentId });
  const arbiterRegistration = await registerAgent(api, { tenantId, agentId: arbiterAgentId, publicKeyPem: arbiterKeypair.publicKeyPem });
  assert.ok(typeof arbiterRegistration.keyId === "string" && arbiterRegistration.keyId.length > 0);

  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 10_000, key: "idmp_tc_lifecycle_credit_1" });

  const agreementHash = "3".repeat(64);
  const receiptHash = "4".repeat(64);
  const requestSha256 = "d".repeat(64);
  await seedToolCallSettlementBindingSource(api, { tenantId, agreementHash, receiptHash, requestSha256, at: new Date(nowMs).toISOString() });

  const lock = await request(api, {
    method: "POST",
    path: "/ops/tool-calls/holds/lock",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_lifecycle_hold_1" },
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

  const suspendPayer = await setX402AgentLifecycle(api, {
    tenantId,
    agentId: payerAgentId,
    status: "suspended",
    reasonCode: "X402_AGENT_SUSPENDED_MANUAL",
    idempotencyKey: "idmp_tc_lifecycle_suspend_payer_1"
  });
  assert.equal(suspendPayer.statusCode, 200, suspendPayer.body);
  assert.equal(suspendPayer.json?.lifecycle?.status, "suspended");

  const blockedOpen = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/open",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_lifecycle_open_block_1" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payeeAgentId,
      disputeOpenEnvelope: buildSignedDisputeOpenEnvelope({
        tenantId,
        agreementHash,
        receiptHash,
        holdHash,
        openedByAgentId: payeeAgentId,
        signerKeyId: payeeRegistration.keyId,
        signerPrivateKeyPem: payeeRegistration.keypair.privateKeyPem,
        openedAt: new Date(nowMs).toISOString()
      }),
      arbiterAgentId,
      summary: "tool-call lifecycle dispute",
      evidenceRefs: [`http:request_sha256:${requestSha256}`]
    }
  });
  assert.equal(blockedOpen.statusCode, 410, blockedOpen.body);
  assert.equal(blockedOpen.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedOpen.json?.details?.role, "payer");
  assert.equal(blockedOpen.json?.details?.operation, "tool_call_arbitration.open");

  const activatePayer = await setX402AgentLifecycle(api, {
    tenantId,
    agentId: payerAgentId,
    status: "active",
    reasonCode: "X402_AGENT_ACTIVE_MANUAL",
    idempotencyKey: "idmp_tc_lifecycle_activate_payer_1"
  });
  assert.equal(activatePayer.statusCode, 200, activatePayer.body);
  assert.equal(activatePayer.json?.lifecycle?.status, "active");

  const open = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/open",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_lifecycle_open_ok_1" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payeeAgentId,
      disputeOpenEnvelope: buildSignedDisputeOpenEnvelope({
        tenantId,
        agreementHash,
        receiptHash,
        holdHash,
        openedByAgentId: payeeAgentId,
        signerKeyId: payeeRegistration.keyId,
        signerPrivateKeyPem: payeeRegistration.keypair.privateKeyPem,
        openedAt: new Date(nowMs).toISOString()
      }),
      arbiterAgentId,
      summary: "tool-call lifecycle dispute",
      evidenceRefs: [`http:request_sha256:${requestSha256}`]
    }
  });
  assert.equal(open.statusCode, 201, open.body);
  const arbitrationCase = open.json?.arbitrationCase ?? null;
  assert.ok(arbitrationCase);
  assert.equal(arbitrationCase.caseId, `arb_case_tc_${agreementHash}`);

  const suspendArbiter = await setX402AgentLifecycle(api, {
    tenantId,
    agentId: arbiterAgentId,
    status: "suspended",
    reasonCode: "X402_AGENT_SUSPENDED_MANUAL",
    idempotencyKey: "idmp_tc_lifecycle_suspend_arbiter_1"
  });
  assert.equal(suspendArbiter.statusCode, 200, suspendArbiter.body);
  assert.equal(suspendArbiter.json?.lifecycle?.status, "suspended");

  const signedVerdict = buildSignedToolCallVerdict({
    tenantId,
    caseId: arbitrationCase.caseId,
    runId: arbitrationCase.runId,
    settlementId: arbitrationCase.settlementId,
    disputeId: arbitrationCase.disputeId,
    arbiterAgentId,
    signerKeyId: arbiterRegistration.keyId,
    signerPrivateKeyPem: arbiterKeypair.privateKeyPem,
    releaseRatePct: 100,
    outcome: "accepted",
    evidenceRefs: [],
    issuedAt: new Date(nowMs).toISOString()
  });
  const blockedVerdict = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/verdict",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_lifecycle_verdict_block_1" },
    body: {
      caseId: arbitrationCase.caseId,
      arbitrationVerdict: signedVerdict
    }
  });
  assert.equal(blockedVerdict.statusCode, 410, blockedVerdict.body);
  assert.equal(blockedVerdict.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedVerdict.json?.details?.role, "arbiter");
  assert.equal(blockedVerdict.json?.details?.operation, "tool_call_arbitration.verdict");
});

test("API e2e: tool-call arbitration open fails closed when binding source is missing", async () => {
  let nowMs = Date.parse("2026-02-13T00:00:00.000Z");
  const api = createApi({ now: () => new Date(nowMs).toISOString(), opsToken: "tok_ops" });
  const tenantId = "tenant_default";
  const payerAgentId = "agt_tc_bindsrc_payer_1";
  const payeeAgentId = "agt_tc_bindsrc_payee_1";
  const arbiterAgentId = "agt_tc_bindsrc_arbiter_1";
  const arbiterKeypair = createEd25519Keypair();

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  const payeeRegistration = await registerAgent(api, { tenantId, agentId: payeeAgentId });
  await registerAgent(api, { tenantId, agentId: arbiterAgentId, publicKeyPem: arbiterKeypair.publicKeyPem });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 10_000, key: "idmp_tc_bindsrc_credit_1" });

  const agreementHash = "7".repeat(64);
  const receiptHash = "8".repeat(64);
  const holdLock = await request(api, {
    method: "POST",
    path: "/ops/tool-calls/holds/lock",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindsrc_hold_1" },
    body: {
      agreementHash,
      receiptHash,
      payerAgentId,
      payeeAgentId,
      amountCents: 10_000,
      currency: "USD",
      holdbackBps: 2000,
      challengeWindowMs: 30_000
    }
  });
  assert.equal(holdLock.statusCode, 201, holdLock.body);
  const holdHash = String(holdLock.json?.hold?.holdHash ?? "");
  assert.match(holdHash, /^[0-9a-f]{64}$/);

  const open = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/open",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindsrc_open_1" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payeeAgentId,
      disputeOpenEnvelope: buildSignedDisputeOpenEnvelope({
        tenantId,
        agreementHash,
        receiptHash,
        holdHash,
        openedByAgentId: payeeAgentId,
        signerKeyId: payeeRegistration.keyId,
        signerPrivateKeyPem: payeeRegistration.keypair.privateKeyPem,
        openedAt: new Date(nowMs).toISOString()
      }),
      arbiterAgentId,
      summary: "binding source must be present",
      evidenceRefs: [`http:request_sha256:${"1".repeat(64)}`]
    }
  });
  assert.equal(open.statusCode, 409, open.body);
  assert.equal(open.json?.code, "X402_TOOL_CALL_BINDING_SOURCE_REQUIRED");
});

test("API e2e: tool-call arbitration open fails closed when request-hash evidence is missing", async () => {
  let nowMs = Date.parse("2026-02-13T00:20:00.000Z");
  const api = createApi({ now: () => new Date(nowMs).toISOString(), opsToken: "tok_ops" });
  const tenantId = "tenant_default";
  const payerAgentId = "agt_tc_bindopen_payer_1";
  const payeeAgentId = "agt_tc_bindopen_payee_1";
  const arbiterAgentId = "agt_tc_bindopen_arbiter_1";
  const arbiterKeypair = createEd25519Keypair();

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  const payeeRegistration = await registerAgent(api, { tenantId, agentId: payeeAgentId });
  await registerAgent(api, { tenantId, agentId: arbiterAgentId, publicKeyPem: arbiterKeypair.publicKeyPem });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 10_000, key: "idmp_tc_bindopen_credit_1" });

  const agreementHash = "9".repeat(64);
  const receiptHash = "a".repeat(64);
  const requestSha256 = "b".repeat(64);
  await seedToolCallSettlementBindingSource(api, { tenantId, agreementHash, receiptHash, requestSha256, at: new Date(nowMs).toISOString() });
  const holdLock = await request(api, {
    method: "POST",
    path: "/ops/tool-calls/holds/lock",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindopen_hold_1" },
    body: {
      agreementHash,
      receiptHash,
      payerAgentId,
      payeeAgentId,
      amountCents: 10_000,
      currency: "USD",
      holdbackBps: 2000,
      challengeWindowMs: 30_000
    }
  });
  assert.equal(holdLock.statusCode, 201, holdLock.body);
  const holdHash = String(holdLock.json?.hold?.holdHash ?? "");
  assert.match(holdHash, /^[0-9a-f]{64}$/);

  const open = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/open",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindopen_open_1" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payeeAgentId,
      disputeOpenEnvelope: buildSignedDisputeOpenEnvelope({
        tenantId,
        agreementHash,
        receiptHash,
        holdHash,
        openedByAgentId: payeeAgentId,
        signerKeyId: payeeRegistration.keyId,
        signerPrivateKeyPem: payeeRegistration.keypair.privateKeyPem,
        openedAt: new Date(nowMs).toISOString()
      }),
      arbiterAgentId,
      summary: "request hash evidence required",
      evidenceRefs: []
    }
  });
  assert.equal(open.statusCode, 409, open.body);
  assert.equal(open.json?.code, "X402_TOOL_CALL_OPEN_BINDING_EVIDENCE_REQUIRED");
});

test("API e2e: tool-call arbitration open fails closed when request-hash evidence mismatches source", async () => {
  let nowMs = Date.parse("2026-02-13T00:30:00.000Z");
  const api = createApi({ now: () => new Date(nowMs).toISOString(), opsToken: "tok_ops" });
  const tenantId = "tenant_default";
  const payerAgentId = "agt_tc_bindopen_mismatch_payer_1";
  const payeeAgentId = "agt_tc_bindopen_mismatch_payee_1";
  const arbiterAgentId = "agt_tc_bindopen_mismatch_arbiter_1";
  const arbiterKeypair = createEd25519Keypair();

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  const payeeRegistration = await registerAgent(api, { tenantId, agentId: payeeAgentId });
  await registerAgent(api, { tenantId, agentId: arbiterAgentId, publicKeyPem: arbiterKeypair.publicKeyPem });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 10_000, key: "idmp_tc_bindopen_mismatch_credit_1" });

  const agreementHash = "1".repeat(64);
  const receiptHash = "2".repeat(64);
  const requestSha256 = "3".repeat(64);
  const mismatchedRequestSha = "4".repeat(64);
  await seedToolCallSettlementBindingSource(api, { tenantId, agreementHash, receiptHash, requestSha256, at: new Date(nowMs).toISOString() });
  const holdLock = await request(api, {
    method: "POST",
    path: "/ops/tool-calls/holds/lock",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindopen_mismatch_hold_1" },
    body: {
      agreementHash,
      receiptHash,
      payerAgentId,
      payeeAgentId,
      amountCents: 10_000,
      currency: "USD",
      holdbackBps: 2000,
      challengeWindowMs: 30_000
    }
  });
  assert.equal(holdLock.statusCode, 201, holdLock.body);
  const holdHash = String(holdLock.json?.hold?.holdHash ?? "");
  assert.match(holdHash, /^[0-9a-f]{64}$/);

  const open = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/open",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindopen_mismatch_open_1" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payeeAgentId,
      disputeOpenEnvelope: buildSignedDisputeOpenEnvelope({
        tenantId,
        agreementHash,
        receiptHash,
        holdHash,
        openedByAgentId: payeeAgentId,
        signerKeyId: payeeRegistration.keyId,
        signerPrivateKeyPem: payeeRegistration.keypair.privateKeyPem,
        openedAt: new Date(nowMs).toISOString()
      }),
      arbiterAgentId,
      summary: "request hash evidence mismatch should fail",
      evidenceRefs: [`http:request_sha256:${mismatchedRequestSha}`]
    }
  });
  assert.equal(open.statusCode, 409, open.body);
  assert.equal(open.json?.code, "X402_TOOL_CALL_OPEN_BINDING_EVIDENCE_MISMATCH");
});

test("API e2e: tool-call arbitration open fails closed when request-hash evidence has conflicting values", async () => {
  let nowMs = Date.parse("2026-02-13T00:32:00.000Z");
  const api = createApi({ now: () => new Date(nowMs).toISOString(), opsToken: "tok_ops" });
  const tenantId = "tenant_default";
  const payerAgentId = "agt_tc_bindopen_conflict_payer_1";
  const payeeAgentId = "agt_tc_bindopen_conflict_payee_1";
  const arbiterAgentId = "agt_tc_bindopen_conflict_arbiter_1";
  const arbiterKeypair = createEd25519Keypair();

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  const payeeRegistration = await registerAgent(api, { tenantId, agentId: payeeAgentId });
  await registerAgent(api, { tenantId, agentId: arbiterAgentId, publicKeyPem: arbiterKeypair.publicKeyPem });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 10_000, key: "idmp_tc_bindopen_conflict_credit_1" });

  const agreementHash = "4".repeat(64);
  const receiptHash = "5".repeat(64);
  const requestSha256 = "6".repeat(64);
  const conflictingRequestSha256 = "7".repeat(64);
  await seedToolCallSettlementBindingSource(api, { tenantId, agreementHash, receiptHash, requestSha256, at: new Date(nowMs).toISOString() });
  const holdLock = await request(api, {
    method: "POST",
    path: "/ops/tool-calls/holds/lock",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindopen_conflict_hold_1" },
    body: {
      agreementHash,
      receiptHash,
      payerAgentId,
      payeeAgentId,
      amountCents: 10_000,
      currency: "USD",
      holdbackBps: 2000,
      challengeWindowMs: 30_000
    }
  });
  assert.equal(holdLock.statusCode, 201, holdLock.body);
  const holdHash = String(holdLock.json?.hold?.holdHash ?? "");
  assert.match(holdHash, /^[0-9a-f]{64}$/);

  const open = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/open",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindopen_conflict_open_1" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payeeAgentId,
      disputeOpenEnvelope: buildSignedDisputeOpenEnvelope({
        tenantId,
        agreementHash,
        receiptHash,
        holdHash,
        openedByAgentId: payeeAgentId,
        signerKeyId: payeeRegistration.keyId,
        signerPrivateKeyPem: payeeRegistration.keypair.privateKeyPem,
        openedAt: new Date(nowMs).toISOString()
      }),
      arbiterAgentId,
      summary: "conflicting request hash evidence should fail",
      evidenceRefs: [`http:request_sha256:${requestSha256}`, `http:request_sha256:${conflictingRequestSha256}`]
    }
  });
  assert.equal(open.statusCode, 409, open.body);
  assert.equal(open.json?.code, "X402_TOOL_CALL_OPEN_BINDING_EVIDENCE_MISMATCH");
  assert.equal(open.json?.details?.operation, "tool_call_arbitration.open");
  assert.equal(open.json?.details?.expectedRequestSha256, requestSha256);
  assert.equal(open.json?.details?.requestSha256, requestSha256);
  assert.deepEqual(open.json?.details?.requestSha256Values, [requestSha256, conflictingRequestSha256].sort((left, right) => left.localeCompare(right)));
});

test("API e2e: tool-call arbitration verdict fails closed when request-hash evidence is missing", async () => {
  let nowMs = Date.parse("2026-02-13T00:35:00.000Z");
  const api = createApi({ now: () => new Date(nowMs).toISOString(), opsToken: "tok_ops" });
  const tenantId = "tenant_default";
  const payerAgentId = "agt_tc_bindverd_required_payer_1";
  const payeeAgentId = "agt_tc_bindverd_required_payee_1";
  const arbiterAgentId = "agt_tc_bindverd_required_arbiter_1";
  const arbiterKeypair = createEd25519Keypair();

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  const payeeRegistration = await registerAgent(api, { tenantId, agentId: payeeAgentId });
  const arbiterRegistration = await registerAgent(api, { tenantId, agentId: arbiterAgentId, publicKeyPem: arbiterKeypair.publicKeyPem });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 10_000, key: "idmp_tc_bindverd_required_credit_1" });

  const agreementHash = "5".repeat(64);
  const receiptHash = "6".repeat(64);
  const requestSha256 = "7".repeat(64);
  await seedToolCallSettlementBindingSource(api, { tenantId, agreementHash, receiptHash, requestSha256, at: new Date(nowMs).toISOString() });

  const holdLock = await request(api, {
    method: "POST",
    path: "/ops/tool-calls/holds/lock",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindverd_required_hold_1" },
    body: {
      agreementHash,
      receiptHash,
      payerAgentId,
      payeeAgentId,
      amountCents: 10_000,
      currency: "USD",
      holdbackBps: 2000,
      challengeWindowMs: 30_000
    }
  });
  assert.equal(holdLock.statusCode, 201, holdLock.body);
  const holdHash = String(holdLock.json?.hold?.holdHash ?? "");
  assert.match(holdHash, /^[0-9a-f]{64}$/);

  const open = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/open",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindverd_required_open_1" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payeeAgentId,
      disputeOpenEnvelope: buildSignedDisputeOpenEnvelope({
        tenantId,
        agreementHash,
        receiptHash,
        holdHash,
        openedByAgentId: payeeAgentId,
        signerKeyId: payeeRegistration.keyId,
        signerPrivateKeyPem: payeeRegistration.keypair.privateKeyPem,
        openedAt: new Date(nowMs).toISOString()
      }),
      arbiterAgentId,
      summary: "open for verdict required test",
      evidenceRefs: [`http:request_sha256:${requestSha256}`]
    }
  });
  assert.equal(open.statusCode, 201, open.body);
  const arbitrationCase = open.json?.arbitrationCase ?? null;
  assert.ok(arbitrationCase);

  const scopedCaseKey = `${tenantId}\n${arbitrationCase.caseId}`;
  const priorCase = api.store.arbitrationCases.get(scopedCaseKey);
  assert.ok(priorCase, "expected arbitration case in store");
  api.store.arbitrationCases.set(scopedCaseKey, {
    ...priorCase,
    evidenceRefs: [],
    revision: Number(priorCase.revision ?? 0) + 1,
    updatedAt: new Date(nowMs).toISOString()
  });

  const signedVerdict = buildSignedToolCallVerdict({
    tenantId,
    caseId: arbitrationCase.caseId,
    runId: arbitrationCase.runId,
    settlementId: arbitrationCase.settlementId,
    disputeId: arbitrationCase.disputeId,
    arbiterAgentId,
    signerKeyId: arbiterRegistration.keyId,
    signerPrivateKeyPem: arbiterKeypair.privateKeyPem,
    releaseRatePct: 100,
    outcome: "accepted",
    evidenceRefs: [],
    issuedAt: new Date(nowMs).toISOString()
  });
  const verdict = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/verdict",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindverd_required_verdict_1" },
    body: { caseId: arbitrationCase.caseId, arbitrationVerdict: signedVerdict }
  });
  assert.equal(verdict.statusCode, 409, verdict.body);
  assert.equal(verdict.json?.code, "X402_TOOL_CALL_VERDICT_BINDING_EVIDENCE_REQUIRED");
});

test("API e2e: tool-call arbitration verdict fails closed when request-hash evidence mismatches source", async () => {
  let nowMs = Date.parse("2026-02-13T00:40:00.000Z");
  const api = createApi({ now: () => new Date(nowMs).toISOString(), opsToken: "tok_ops" });
  const tenantId = "tenant_default";
  const payerAgentId = "agt_tc_bindverd_payer_1";
  const payeeAgentId = "agt_tc_bindverd_payee_1";
  const arbiterAgentId = "agt_tc_bindverd_arbiter_1";
  const arbiterKeypair = createEd25519Keypair();

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  const payeeRegistration = await registerAgent(api, { tenantId, agentId: payeeAgentId });
  const arbiterRegistration = await registerAgent(api, { tenantId, agentId: arbiterAgentId, publicKeyPem: arbiterKeypair.publicKeyPem });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 10_000, key: "idmp_tc_bindverd_credit_1" });

  const agreementHash = "c".repeat(64);
  const receiptHash = "d".repeat(64);
  const requestSha256 = "e".repeat(64);
  await seedToolCallSettlementBindingSource(api, { tenantId, agreementHash, receiptHash, requestSha256, at: new Date(nowMs).toISOString() });

  const holdLock = await request(api, {
    method: "POST",
    path: "/ops/tool-calls/holds/lock",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindverd_hold_1" },
    body: {
      agreementHash,
      receiptHash,
      payerAgentId,
      payeeAgentId,
      amountCents: 10_000,
      currency: "USD",
      holdbackBps: 2000,
      challengeWindowMs: 30_000
    }
  });
  assert.equal(holdLock.statusCode, 201, holdLock.body);
  const holdHash = String(holdLock.json?.hold?.holdHash ?? "");
  assert.match(holdHash, /^[0-9a-f]{64}$/);

  const open = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/open",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindverd_open_1" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payeeAgentId,
      disputeOpenEnvelope: buildSignedDisputeOpenEnvelope({
        tenantId,
        agreementHash,
        receiptHash,
        holdHash,
        openedByAgentId: payeeAgentId,
        signerKeyId: payeeRegistration.keyId,
        signerPrivateKeyPem: payeeRegistration.keypair.privateKeyPem,
        openedAt: new Date(nowMs).toISOString()
      }),
      arbiterAgentId,
      summary: "open for verdict mismatch test",
      evidenceRefs: [`http:request_sha256:${requestSha256}`]
    }
  });
  assert.equal(open.statusCode, 201, open.body);
  const arbitrationCase = open.json?.arbitrationCase ?? null;
  assert.ok(arbitrationCase);

  const scopedCaseKey = `${tenantId}\n${arbitrationCase.caseId}`;
  const priorCase = api.store.arbitrationCases.get(scopedCaseKey);
  assert.ok(priorCase, "expected arbitration case in store");
  const mismatchedEvidenceSha = "f".repeat(64);
  api.store.arbitrationCases.set(scopedCaseKey, {
    ...priorCase,
    evidenceRefs: [`http:request_sha256:${mismatchedEvidenceSha}`],
    revision: Number(priorCase.revision ?? 0) + 1,
    updatedAt: new Date(nowMs).toISOString()
  });

  const signedVerdict = buildSignedToolCallVerdict({
    tenantId,
    caseId: arbitrationCase.caseId,
    runId: arbitrationCase.runId,
    settlementId: arbitrationCase.settlementId,
    disputeId: arbitrationCase.disputeId,
    arbiterAgentId,
    signerKeyId: arbiterRegistration.keyId,
    signerPrivateKeyPem: arbiterKeypair.privateKeyPem,
    releaseRatePct: 100,
    outcome: "accepted",
    evidenceRefs: [],
    issuedAt: new Date(nowMs).toISOString()
  });
  const verdict = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/verdict",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindverd_verdict_1" },
    body: { caseId: arbitrationCase.caseId, arbitrationVerdict: signedVerdict }
  });
  assert.equal(verdict.statusCode, 409, verdict.body);
  assert.equal(verdict.json?.code, "X402_TOOL_CALL_VERDICT_BINDING_EVIDENCE_MISMATCH");
});

test("API e2e: tool-call arbitration verdict fails closed when request-hash evidence has conflicting values", async () => {
  let nowMs = Date.parse("2026-02-13T00:45:00.000Z");
  const api = createApi({ now: () => new Date(nowMs).toISOString(), opsToken: "tok_ops" });
  const tenantId = "tenant_default";
  const payerAgentId = "agt_tc_bindverd_conflict_payer_1";
  const payeeAgentId = "agt_tc_bindverd_conflict_payee_1";
  const arbiterAgentId = "agt_tc_bindverd_conflict_arbiter_1";
  const arbiterKeypair = createEd25519Keypair();

  await registerAgent(api, { tenantId, agentId: payerAgentId });
  const payeeRegistration = await registerAgent(api, { tenantId, agentId: payeeAgentId });
  const arbiterRegistration = await registerAgent(api, { tenantId, agentId: arbiterAgentId, publicKeyPem: arbiterKeypair.publicKeyPem });
  await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 10_000, key: "idmp_tc_bindverd_conflict_credit_1" });

  const agreementHash = "8".repeat(64);
  const receiptHash = "9".repeat(64);
  const requestSha256 = "a".repeat(64);
  const conflictingRequestSha256 = "b".repeat(64);
  await seedToolCallSettlementBindingSource(api, { tenantId, agreementHash, receiptHash, requestSha256, at: new Date(nowMs).toISOString() });

  const holdLock = await request(api, {
    method: "POST",
    path: "/ops/tool-calls/holds/lock",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindverd_conflict_hold_1" },
    body: {
      agreementHash,
      receiptHash,
      payerAgentId,
      payeeAgentId,
      amountCents: 10_000,
      currency: "USD",
      holdbackBps: 2000,
      challengeWindowMs: 30_000
    }
  });
  assert.equal(holdLock.statusCode, 201, holdLock.body);
  const holdHash = String(holdLock.json?.hold?.holdHash ?? "");
  assert.match(holdHash, /^[0-9a-f]{64}$/);

  const open = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/open",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindverd_conflict_open_1" },
    body: {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payeeAgentId,
      disputeOpenEnvelope: buildSignedDisputeOpenEnvelope({
        tenantId,
        agreementHash,
        receiptHash,
        holdHash,
        openedByAgentId: payeeAgentId,
        signerKeyId: payeeRegistration.keyId,
        signerPrivateKeyPem: payeeRegistration.keypair.privateKeyPem,
        openedAt: new Date(nowMs).toISOString()
      }),
      arbiterAgentId,
      summary: "open for verdict conflict test",
      evidenceRefs: [`http:request_sha256:${requestSha256}`]
    }
  });
  assert.equal(open.statusCode, 201, open.body);
  const arbitrationCase = open.json?.arbitrationCase ?? null;
  assert.ok(arbitrationCase);

  const scopedCaseKey = `${tenantId}\n${arbitrationCase.caseId}`;
  const priorCase = api.store.arbitrationCases.get(scopedCaseKey);
  assert.ok(priorCase, "expected arbitration case in store");
  api.store.arbitrationCases.set(scopedCaseKey, {
    ...priorCase,
    evidenceRefs: [`http:request_sha256:${requestSha256}`, `http:request_sha256:${conflictingRequestSha256}`],
    revision: Number(priorCase.revision ?? 0) + 1,
    updatedAt: new Date(nowMs).toISOString()
  });

  const signedVerdict = buildSignedToolCallVerdict({
    tenantId,
    caseId: arbitrationCase.caseId,
    runId: arbitrationCase.runId,
    settlementId: arbitrationCase.settlementId,
    disputeId: arbitrationCase.disputeId,
    arbiterAgentId,
    signerKeyId: arbiterRegistration.keyId,
    signerPrivateKeyPem: arbiterKeypair.privateKeyPem,
    releaseRatePct: 100,
    outcome: "accepted",
    evidenceRefs: [`http:request_sha256:${requestSha256}`],
    issuedAt: new Date(nowMs).toISOString()
  });
  const verdict = await request(api, {
    method: "POST",
    path: "/tool-calls/arbitration/verdict",
    headers: { "x-proxy-tenant-id": tenantId, "x-nooterra-protocol": "1.0", "x-idempotency-key": "idmp_tc_bindverd_conflict_verdict_1" },
    body: { caseId: arbitrationCase.caseId, arbitrationVerdict: signedVerdict }
  });
  assert.equal(verdict.statusCode, 409, verdict.body);
  assert.equal(verdict.json?.code, "X402_TOOL_CALL_VERDICT_BINDING_EVIDENCE_MISMATCH");
  assert.equal(verdict.json?.details?.operation, "tool_call_arbitration.verdict");
  assert.equal(verdict.json?.details?.expectedRequestSha256, requestSha256);
  assert.equal(verdict.json?.details?.requestSha256, requestSha256);
  assert.deepEqual(
    verdict.json?.details?.requestSha256Values,
    [requestSha256, conflictingRequestSha256].sort((left, right) => left.localeCompare(right))
  );
});

test("API e2e: tool-call arbitration open fails closed when disputeOpenEnvelope signer key lifecycle is rotated/revoked", async () => {
  const scenarios = [
    {
      label: "rotated",
      action: "rotate",
      reasonCode: "SIGNER_KEY_NOT_ACTIVE",
      signerStatus: "rotated",
      agreementHash: "a".repeat(64),
      receiptHash: "b".repeat(64),
      requestSha256: "c".repeat(64),
      nowIso: "2026-02-14T00:00:00.000Z"
    },
    {
      label: "revoked",
      action: "revoke",
      reasonCode: "SIGNER_KEY_REVOKED",
      signerStatus: "revoked",
      agreementHash: "d".repeat(64),
      receiptHash: "e".repeat(64),
      requestSha256: "f".repeat(64),
      nowIso: "2026-02-14T00:30:00.000Z"
    }
  ];

  for (const scenario of scenarios) {
    let nowMs = Date.parse(scenario.nowIso);
    const api = createApi({ now: () => new Date(nowMs).toISOString(), opsToken: "tok_ops" });
    const tenantId = "tenant_default";
    const payerAgentId = `agt_tc_signer_open_${scenario.label}_payer_1`;
    const payeeAgentId = `agt_tc_signer_open_${scenario.label}_payee_1`;
    const arbiterAgentId = `agt_tc_signer_open_${scenario.label}_arbiter_1`;
    const arbiterKeypair = createEd25519Keypair();

    await registerAgent(api, { tenantId, agentId: payerAgentId });
    const payeeRegistration = await registerAgent(api, { tenantId, agentId: payeeAgentId });
    await registerAgent(api, { tenantId, agentId: arbiterAgentId, publicKeyPem: arbiterKeypair.publicKeyPem });
    await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 10_000, key: `idmp_tc_signer_open_credit_${scenario.label}` });

    await seedToolCallSettlementBindingSource(api, {
      tenantId,
      agreementHash: scenario.agreementHash,
      receiptHash: scenario.receiptHash,
      requestSha256: scenario.requestSha256,
      at: new Date(nowMs).toISOString()
    });

    const holdLock = await request(api, {
      method: "POST",
      path: "/ops/tool-calls/holds/lock",
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-nooterra-protocol": "1.0",
        "x-idempotency-key": `idmp_tc_signer_open_hold_${scenario.label}`
      },
      body: {
        agreementHash: scenario.agreementHash,
        receiptHash: scenario.receiptHash,
        payerAgentId,
        payeeAgentId,
        amountCents: 10_000,
        currency: "USD",
        holdbackBps: 2000,
        challengeWindowMs: 30_000
      }
    });
    assert.equal(holdLock.statusCode, 201, holdLock.body);
    const holdHash = String(holdLock.json?.hold?.holdHash ?? "");
    assert.match(holdHash, /^[0-9a-f]{64}$/);

    await setSignerKeyLifecycle(api, {
      tenantId,
      keyId: payeeRegistration.keyId,
      action: scenario.action
    });

    nowMs += 1000;
    const open = await request(api, {
      method: "POST",
      path: "/tool-calls/arbitration/open",
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-nooterra-protocol": "1.0",
        "x-idempotency-key": `idmp_tc_signer_open_block_${scenario.label}`
      },
      body: {
        agreementHash: scenario.agreementHash,
        receiptHash: scenario.receiptHash,
        holdHash,
        openedByAgentId: payeeAgentId,
        disputeOpenEnvelope: buildSignedDisputeOpenEnvelope({
          tenantId,
          agreementHash: scenario.agreementHash,
          receiptHash: scenario.receiptHash,
          holdHash,
          openedByAgentId: payeeAgentId,
          signerKeyId: payeeRegistration.keyId,
          signerPrivateKeyPem: payeeRegistration.keypair.privateKeyPem,
          openedAt: new Date(nowMs).toISOString()
        }),
        arbiterAgentId,
        summary: "tool-call signer lifecycle open test",
        evidenceRefs: [`http:request_sha256:${scenario.requestSha256}`]
      }
    });
    assert.equal(open.statusCode, 409, open.body);
    assert.equal(open.json?.code, "DISPUTE_INVALID_SIGNER");
    const signerDetails =
      open.json?.details?.details && typeof open.json.details.details === "object" ? open.json.details.details : open.json?.details;
    assert.equal(signerDetails?.reasonCode, scenario.reasonCode);
    assert.equal(signerDetails?.signerStatus, scenario.signerStatus);
    assert.equal(signerDetails?.signerKeyId, payeeRegistration.keyId);
  }
});

test("API e2e: tool-call arbitration verdict fails closed when arbitrationVerdict signer key lifecycle is rotated/revoked", async () => {
  const scenarios = [
    {
      label: "rotated",
      action: "rotate",
      reasonCode: "SIGNER_KEY_NOT_ACTIVE",
      signerStatus: "rotated",
      agreementHash: "1".repeat(64),
      receiptHash: "2".repeat(64),
      requestSha256: "3".repeat(64),
      nowIso: "2026-02-14T01:00:00.000Z"
    },
    {
      label: "revoked",
      action: "revoke",
      reasonCode: "SIGNER_KEY_REVOKED",
      signerStatus: "revoked",
      agreementHash: "4".repeat(64),
      receiptHash: "5".repeat(64),
      requestSha256: "6".repeat(64),
      nowIso: "2026-02-14T01:30:00.000Z"
    }
  ];

  for (const scenario of scenarios) {
    let nowMs = Date.parse(scenario.nowIso);
    const api = createApi({ now: () => new Date(nowMs).toISOString(), opsToken: "tok_ops" });
    const tenantId = "tenant_default";
    const payerAgentId = `agt_tc_signer_verdict_${scenario.label}_payer_1`;
    const payeeAgentId = `agt_tc_signer_verdict_${scenario.label}_payee_1`;
    const arbiterAgentId = `agt_tc_signer_verdict_${scenario.label}_arbiter_1`;
    const arbiterKeypair = createEd25519Keypair();

    await registerAgent(api, { tenantId, agentId: payerAgentId });
    const payeeRegistration = await registerAgent(api, { tenantId, agentId: payeeAgentId });
    const arbiterRegistration = await registerAgent(api, { tenantId, agentId: arbiterAgentId, publicKeyPem: arbiterKeypair.publicKeyPem });
    await creditWallet(api, { tenantId, agentId: payerAgentId, amountCents: 10_000, key: `idmp_tc_signer_verdict_credit_${scenario.label}` });

    await seedToolCallSettlementBindingSource(api, {
      tenantId,
      agreementHash: scenario.agreementHash,
      receiptHash: scenario.receiptHash,
      requestSha256: scenario.requestSha256,
      at: new Date(nowMs).toISOString()
    });

    const holdLock = await request(api, {
      method: "POST",
      path: "/ops/tool-calls/holds/lock",
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-nooterra-protocol": "1.0",
        "x-idempotency-key": `idmp_tc_signer_verdict_hold_${scenario.label}`
      },
      body: {
        agreementHash: scenario.agreementHash,
        receiptHash: scenario.receiptHash,
        payerAgentId,
        payeeAgentId,
        amountCents: 10_000,
        currency: "USD",
        holdbackBps: 2000,
        challengeWindowMs: 30_000
      }
    });
    assert.equal(holdLock.statusCode, 201, holdLock.body);
    const holdHash = String(holdLock.json?.hold?.holdHash ?? "");
    assert.match(holdHash, /^[0-9a-f]{64}$/);

    const open = await request(api, {
      method: "POST",
      path: "/tool-calls/arbitration/open",
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-nooterra-protocol": "1.0",
        "x-idempotency-key": `idmp_tc_signer_verdict_open_${scenario.label}`
      },
      body: {
        agreementHash: scenario.agreementHash,
        receiptHash: scenario.receiptHash,
        holdHash,
        openedByAgentId: payeeAgentId,
        disputeOpenEnvelope: buildSignedDisputeOpenEnvelope({
          tenantId,
          agreementHash: scenario.agreementHash,
          receiptHash: scenario.receiptHash,
          holdHash,
          openedByAgentId: payeeAgentId,
          signerKeyId: payeeRegistration.keyId,
          signerPrivateKeyPem: payeeRegistration.keypair.privateKeyPem,
          openedAt: new Date(nowMs).toISOString()
        }),
        arbiterAgentId,
        summary: "tool-call signer lifecycle verdict test",
        evidenceRefs: [`http:request_sha256:${scenario.requestSha256}`]
      }
    });
    assert.equal(open.statusCode, 201, open.body);
    const arbitrationCase = open.json?.arbitrationCase ?? null;
    assert.ok(arbitrationCase);

    await setSignerKeyLifecycle(api, {
      tenantId,
      keyId: arbiterRegistration.keyId,
      action: scenario.action
    });

    nowMs += 1000;
    const signedVerdict = buildSignedToolCallVerdict({
      tenantId,
      caseId: arbitrationCase.caseId,
      runId: arbitrationCase.runId,
      settlementId: arbitrationCase.settlementId,
      disputeId: arbitrationCase.disputeId,
      arbiterAgentId,
      signerKeyId: arbiterRegistration.keyId,
      signerPrivateKeyPem: arbiterKeypair.privateKeyPem,
      releaseRatePct: 100,
      outcome: "accepted",
      evidenceRefs: [],
      issuedAt: new Date(nowMs).toISOString()
    });

    const verdict = await request(api, {
      method: "POST",
      path: "/tool-calls/arbitration/verdict",
      headers: {
        "x-proxy-tenant-id": tenantId,
        "x-nooterra-protocol": "1.0",
        "x-idempotency-key": `idmp_tc_signer_verdict_block_${scenario.label}`
      },
      body: { caseId: arbitrationCase.caseId, arbitrationVerdict: signedVerdict }
    });
    assert.equal(verdict.statusCode, 409, verdict.body);
    assert.equal(verdict.json?.code, "DISPUTE_INVALID_SIGNER");
    const signerDetails =
      verdict.json?.details?.details && typeof verdict.json.details.details === "object"
        ? verdict.json.details.details
        : verdict.json?.details;
    assert.equal(signerDetails?.reasonCode, scenario.reasonCode);
    assert.equal(signerDetails?.signerStatus, scenario.signerStatus);
    assert.equal(signerDetails?.signerKeyId, arbiterRegistration.keyId);
  }
});
