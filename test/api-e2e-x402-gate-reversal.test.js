import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { canonicalJsonStringify, normalizeForCanonicalJson } from "../src/core/canonical-json.js";
import { createEd25519Keypair, sha256Hex, signHashHexEd25519 } from "../src/core/crypto.js";
import { signX402ProviderRefundDecisionV1 } from "../src/core/x402-provider-refund-decision.js";
import { signX402ReversalCommandV1 } from "../src/core/x402-reversal-command.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId, publicKeyPem: providedPublicKeyPem = null }) {
  const { publicKeyPem, privateKeyPem } = providedPublicKeyPem
    ? { publicKeyPem: providedPublicKeyPem, privateKeyPem: null }
    : createEd25519Keypair();
  const created = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `agent_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_test" },
      publicKeyPem
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  return { agentId, publicKeyPem, privateKeyPem, keyId: created.json?.keyId ?? null };
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

async function upsertX402WalletPolicy(api, { policy, idempotencyKey }) {
  const response = await request(api, {
    method: "POST",
    path: "/ops/x402/wallet-policies",
    headers: {
      "x-idempotency-key": idempotencyKey,
      "x-nooterra-protocol": "1.0"
    },
    body: { policy }
  });
  return response;
}

async function issueWalletAuthorizationDecision(
  api,
  { sponsorWalletRef, gateId, quoteId = null, requestBindingMode = null, requestBindingSha256 = null, idempotencyKey }
) {
  return await request(api, {
    method: "POST",
    path: `/x402/wallets/${encodeURIComponent(sponsorWalletRef)}/authorize`,
    headers: { "x-idempotency-key": idempotencyKey },
    body: {
      gateId,
      ...(quoteId ? { quoteId } : {}),
      ...(requestBindingMode ? { requestBindingMode } : {}),
      ...(requestBindingSha256 ? { requestBindingSha256 } : {})
    }
  });
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

async function loadReversalBindings(api, { gateId, payerAgentId }) {
  const gateRes = await request(api, {
    method: "GET",
    path: `/x402/gate/${encodeURIComponent(gateId)}`
  });
  assert.equal(gateRes.statusCode, 200, gateRes.body);
  const gate = gateRes.json?.gate ?? null;
  const settlement = gateRes.json?.settlement ?? null;
  const receiptId =
    typeof settlement?.decisionTrace?.settlementReceipt?.receiptId === "string" &&
    settlement.decisionTrace.settlementReceipt.receiptId.trim() !== ""
      ? settlement.decisionTrace.settlementReceipt.receiptId.trim()
      : typeof gate?.authorization?.authorizationRef === "string" && gate.authorization.authorizationRef.trim() !== ""
        ? gate.authorization.authorizationRef.trim()
        : `auth_${gateId}`;
  const quoteId =
    typeof settlement?.decisionTrace?.bindings?.quote?.quoteId === "string" &&
    settlement.decisionTrace.bindings.quote.quoteId.trim() !== ""
      ? settlement.decisionTrace.bindings.quote.quoteId.trim()
      : typeof gate?.quote?.quoteId === "string" && gate.quote.quoteId.trim() !== ""
        ? gate.quote.quoteId.trim()
        : null;
  const requestSha256 =
    typeof settlement?.decisionTrace?.bindings?.request?.sha256 === "string" &&
    /^[0-9a-f]{64}$/i.test(settlement.decisionTrace.bindings.request.sha256.trim())
      ? settlement.decisionTrace.bindings.request.sha256.trim().toLowerCase()
      : null;
  const sponsorRef =
    typeof settlement?.decisionTrace?.bindings?.spendAuthorization?.sponsorRef === "string" &&
    settlement.decisionTrace.bindings.spendAuthorization.sponsorRef.trim() !== ""
      ? settlement.decisionTrace.bindings.spendAuthorization.sponsorRef.trim()
      : typeof gate?.agentPassport?.sponsorRef === "string" && gate.agentPassport.sponsorRef.trim() !== ""
        ? gate.agentPassport.sponsorRef.trim()
        : payerAgentId;
  assert.ok(receiptId, "receiptId is required for reversal");
  return { receiptId, quoteId, requestSha256, sponsorRef };
}

function signReversalCommand({
  payer,
  gateId,
  receiptId,
  quoteId,
  requestSha256 = null,
  sponsorRef,
  action,
  commandId,
  idempotencyKey,
  nonce
}) {
  return signX402ReversalCommandV1({
    command: {
      commandId,
      sponsorRef,
      agentKeyId: payer.agentId,
      target: {
        gateId,
        receiptId,
        ...(quoteId ? { quoteId } : {}),
        ...(requestSha256 ? { requestSha256 } : {})
      },
      action,
      nonce,
      idempotencyKey,
      exp: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    },
    signedAt: new Date().toISOString(),
    publicKeyPem: payer.publicKeyPem,
    privateKeyPem: payer.privateKeyPem
  });
}

function signProviderRefundDecision({
  payee,
  gateId,
  receiptId,
  quoteId,
  requestSha256 = null,
  decision,
  reason = null
}) {
  return signX402ProviderRefundDecisionV1({
    decision: {
      decisionId: `dec_${gateId}_${decision}`,
      receiptId,
      gateId,
      ...(quoteId ? { quoteId } : {}),
      ...(requestSha256 ? { requestSha256 } : {}),
      decision,
      reason,
      decidedAt: new Date().toISOString()
    },
    signedAt: new Date().toISOString(),
    publicKeyPem: payee.publicKeyPem,
    privateKeyPem: payee.privateKeyPem
  });
}

function assertBindingEvidenceConflict(response, { code, operation, expectedRequestSha256, requestSha256 = null }) {
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json?.code, code);
  assert.equal(response.json?.details?.operation, operation);
  assert.equal(response.json?.details?.expectedRequestSha256, expectedRequestSha256);
  if (requestSha256 === null) {
    assert.equal(response.json?.details?.requestSha256 ?? null, null);
  } else {
    assert.equal(response.json?.details?.requestSha256, requestSha256);
  }
}

function overwriteArbitrationCaseEvidenceRefs(api, { caseId, evidenceRefs }) {
  assert.ok(api?.store?.arbitrationCases instanceof Map, "arbitrationCases map is required for test setup");
  let scopedCaseKey = null;
  for (const [candidateKey, row] of api.store.arbitrationCases.entries()) {
    if (row && typeof row === "object" && String(row.caseId ?? "") === String(caseId)) {
      scopedCaseKey = candidateKey;
      break;
    }
  }
  assert.ok(scopedCaseKey, `arbitration case not found for setup: ${caseId}`);
  const prior = api.store.arbitrationCases.get(scopedCaseKey);
  const next = normalizeForCanonicalJson(
    {
      ...prior,
      evidenceRefs: Array.isArray(evidenceRefs) ? evidenceRefs.slice() : []
    },
    { path: "$" }
  );
  api.store.arbitrationCases.set(scopedCaseKey, next);
}

function overwriteSettlementDisputeEvidenceRefs(api, { runId, evidenceRefs }) {
  assert.ok(api?.store?.agentRunSettlements instanceof Map, "agentRunSettlements map is required for test setup");
  let scopedSettlementKey = null;
  for (const [candidateKey, row] of api.store.agentRunSettlements.entries()) {
    if (row && typeof row === "object" && String(row.runId ?? "") === String(runId)) {
      scopedSettlementKey = candidateKey;
      break;
    }
  }
  assert.ok(scopedSettlementKey, `run settlement not found for setup: ${runId}`);
  const prior = api.store.agentRunSettlements.get(scopedSettlementKey);
  const priorDisputeContext =
    prior?.disputeContext && typeof prior.disputeContext === "object" && !Array.isArray(prior.disputeContext) ? prior.disputeContext : {};
  const next = normalizeForCanonicalJson(
    {
      ...prior,
      disputeContext: {
        ...priorDisputeContext,
        evidenceRefs: Array.isArray(evidenceRefs) ? evidenceRefs.slice() : []
      }
    },
    { path: "$" }
  );
  api.store.agentRunSettlements.set(scopedSettlementKey, next);
}

test("API e2e: x402 reversal void_authorization refunds locked gate before execution", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const payer = await registerAgent(api, { agentId: "agt_x402_void_payer_1" });
  const payee = await registerAgent(api, { agentId: "agt_x402_void_payee_1" });
  await creditWallet(api, { agentId: payer.agentId, amountCents: 5000, idempotencyKey: "wallet_credit_x402_void_1" });

  const gateId = "x402gate_void_1";
  const amountCents = 500;
  const created = await request(api, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_create_void_1" },
    body: {
      gateId,
      payerAgentId: payer.agentId,
      payeeAgentId: payee.agentId,
      amountCents,
      currency: "USD",
      toolId: "mock_search"
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const authorized = await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_authorize_void_1" },
    body: { gateId }
  });
  assert.equal(authorized.statusCode, 200, authorized.body);

  const bindings = await loadReversalBindings(api, { gateId, payerAgentId: payer.agentId });
  const voidCommand = signReversalCommand({
    payer,
    gateId,
    receiptId: bindings.receiptId,
    quoteId: bindings.quoteId,
    requestSha256: bindings.requestSha256,
    sponsorRef: bindings.sponsorRef,
    action: "void_authorization",
    commandId: "cmd_void_auth_1",
    idempotencyKey: "idem_void_auth_1",
    nonce: "nonce_void_auth_1"
  });

  const voided = await request(api, {
    method: "POST",
    path: "/x402/gate/reversal",
    headers: { "x-idempotency-key": "x402_gate_reversal_void_1" },
    body: {
      gateId,
      action: "void_authorization",
      reason: "operator_cancelled",
      evidenceRefs: ["ops:ticket:cancel_123"],
      command: voidCommand
    }
  });
  assert.equal(voided.statusCode, 200, voided.body);
  assert.equal(voided.json?.settlement?.status, "refunded");
  assert.equal(voided.json?.gate?.authorization?.status, "voided");
  assert.equal(voided.json?.reversal?.status, "voided");
  assert.equal(voided.json?.settlementReceipt?.status, "refunded");
  assert.equal(voided.json?.reversalEvent?.commandVerification?.verified, true);
  assert.ok(Array.isArray(voided.json?.reversal?.timeline));
  assert.ok(voided.json.reversal.timeline.some((row) => row?.eventType === "authorization_voided"));

  const payerWallet = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(payer.agentId)}/wallet`
  });
  assert.equal(payerWallet.statusCode, 200, payerWallet.body);
  assert.equal(payerWallet.json?.wallet?.availableCents, 5000);
  assert.equal(payerWallet.json?.wallet?.escrowLockedCents, 0);

  const events = await request(api, {
    method: "GET",
    path: `/x402/reversal-events?gateId=${encodeURIComponent(gateId)}`
  });
  assert.equal(events.statusCode, 200, events.body);
  assert.equal(Array.isArray(events.json?.events), true);
  assert.equal(events.json.events.length, 1);
  assert.equal(events.json.events[0]?.eventType, "authorization_voided");
  assert.equal(typeof events.json.events[0]?.eventHash, "string");
});

test("API e2e: x402 reversal-events unsupported paths return deterministic denial code", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  api.store.listX402ReversalEvents = null;
  api.store.getX402ReversalEvent = null;

  const listUnsupported = await request(api, {
    method: "GET",
    path: "/x402/reversal-events"
  });
  assert.equal(listUnsupported.statusCode, 501, listUnsupported.body);
  assert.equal(listUnsupported.json?.code, "X402_REVERSAL_EVENTS_LIST_UNSUPPORTED");

  const listUnsupportedAgain = await request(api, {
    method: "GET",
    path: "/x402/reversal-events?gateId=x402gate_missing"
  });
  assert.equal(listUnsupportedAgain.statusCode, 501, listUnsupportedAgain.body);
  assert.equal(listUnsupportedAgain.json?.code, listUnsupported.json?.code);

  const byIdUnsupported = await request(api, {
    method: "GET",
    path: "/x402/reversal-events/evt_missing"
  });
  assert.equal(byIdUnsupported.statusCode, 501, byIdUnsupported.body);
  assert.equal(byIdUnsupported.json?.code, "X402_REVERSAL_EVENT_GET_UNSUPPORTED");

  const byIdUnsupportedAgain = await request(api, {
    method: "GET",
    path: "/x402/reversal-events/evt_missing_2"
  });
  assert.equal(byIdUnsupportedAgain.statusCode, 501, byIdUnsupportedAgain.body);
  assert.equal(byIdUnsupportedAgain.json?.code, byIdUnsupported.json?.code);
});

test("API e2e: x402 reversal request_refund + resolve_refund accepted moves funds back and updates receipt state", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const payer = await registerAgent(api, { agentId: "agt_x402_refund_payer_1" });
  const payee = await registerAgent(api, { agentId: "agt_x402_refund_payee_1" });
  await creditWallet(api, { agentId: payer.agentId, amountCents: 5000, idempotencyKey: "wallet_credit_x402_refund_1" });

  const gateId = "x402gate_refund_1";
  const amountCents = 700;
  const created = await request(api, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_create_refund_1" },
    body: {
      gateId,
      payerAgentId: payer.agentId,
      payeeAgentId: payee.agentId,
      amountCents,
      currency: "USD",
      toolId: "mock_search"
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const authorized = await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_authorize_refund_1" },
    body: { gateId }
  });
  assert.equal(authorized.statusCode, 200, authorized.body);

  const verify = await request(api, {
    method: "POST",
    path: "/x402/gate/verify",
    headers: { "x-idempotency-key": "x402_gate_verify_refund_1" },
    body: {
      gateId,
      verificationStatus: "green",
      runStatus: "completed",
      policy: autoPolicy100(),
      verificationMethod: { mode: "deterministic", source: "http_status_v1" },
      evidenceRefs: [`http:request_sha256:${"a".repeat(64)}`, `http:response_sha256:${"b".repeat(64)}`]
    }
  });
  assert.equal(verify.statusCode, 200, verify.body);
  assert.equal(verify.json?.settlement?.status, "released");

  const bindings = await loadReversalBindings(api, { gateId, payerAgentId: payer.agentId });
  const refundRequestCommand = signReversalCommand({
    payer,
    gateId,
    receiptId: bindings.receiptId,
    quoteId: bindings.quoteId,
    requestSha256: bindings.requestSha256,
    sponsorRef: bindings.sponsorRef,
    action: "request_refund",
    commandId: "cmd_refund_request_1",
    idempotencyKey: "idem_refund_request_1",
    nonce: "nonce_refund_request_1"
  });

  const requested = await request(api, {
    method: "POST",
    path: "/x402/gate/reversal",
    headers: { "x-idempotency-key": "x402_gate_reversal_request_refund_1" },
    body: {
      gateId,
      action: "request_refund",
      reason: "result_not_usable",
      evidenceRefs: [`http:request_sha256:${bindings.requestSha256}`, "provider:incident:001"],
      command: refundRequestCommand
    }
  });
  assert.equal(requested.statusCode, 202, requested.body);
  assert.equal(requested.json?.reversal?.status, "refund_pending");
  const requestedIdempotentReplay = await request(api, {
    method: "POST",
    path: "/x402/gate/reversal",
    headers: { "x-idempotency-key": "x402_gate_reversal_request_refund_1" },
    body: {
      gateId,
      action: "request_refund",
      reason: "result_not_usable",
      evidenceRefs: [`http:request_sha256:${bindings.requestSha256}`, "provider:incident:001"],
      command: refundRequestCommand
    }
  });
  assert.equal(requestedIdempotentReplay.statusCode, 202, requestedIdempotentReplay.body);
  assert.deepEqual(requestedIdempotentReplay.json, requested.json);
  const requestReplay = await request(api, {
    method: "POST",
    path: "/x402/gate/reversal",
    headers: { "x-idempotency-key": "x402_gate_reversal_request_refund_1_replay" },
    body: {
      gateId,
      action: "request_refund",
      reason: "result_not_usable",
      evidenceRefs: [`http:request_sha256:${bindings.requestSha256}`, "provider:incident:001"],
      command: refundRequestCommand
    }
  });
  assert.equal(requestReplay.statusCode, 409, requestReplay.body);
  assert.equal(requestReplay.json?.code, "X402_REVERSAL_COMMAND_REPLAY");
  const requestReplayAgain = await request(api, {
    method: "POST",
    path: "/x402/gate/reversal",
    headers: { "x-idempotency-key": "x402_gate_reversal_request_refund_1_replay_again" },
    body: {
      gateId,
      action: "request_refund",
      reason: "result_not_usable",
      evidenceRefs: [`http:request_sha256:${bindings.requestSha256}`, "provider:incident:001"],
      command: refundRequestCommand
    }
  });
  assert.equal(requestReplayAgain.statusCode, 409, requestReplayAgain.body);
  assert.equal(requestReplayAgain.json?.code, requestReplay.json?.code);

  const mutatedRefundRequestCommand = JSON.parse(JSON.stringify(refundRequestCommand));
  mutatedRefundRequestCommand.target.quoteId = "x402quote_tampered_refund_1";
  const requestMutationDenied = await request(api, {
    method: "POST",
    path: "/x402/gate/reversal",
    headers: { "x-idempotency-key": "x402_gate_reversal_request_refund_1_mutation" },
    body: {
      gateId,
      action: "request_refund",
      reason: "result_not_usable",
      evidenceRefs: [`http:request_sha256:${bindings.requestSha256}`, "provider:incident:001"],
      command: mutatedRefundRequestCommand
    }
  });
  assert.equal(requestMutationDenied.statusCode, 409, requestMutationDenied.body);
  assert.equal(requestMutationDenied.json?.code, "X402_REVERSAL_COMMAND_PAYLOAD_HASH_MISMATCH");
  const requestMutationDeniedAgain = await request(api, {
    method: "POST",
    path: "/x402/gate/reversal",
    headers: { "x-idempotency-key": "x402_gate_reversal_request_refund_1_mutation_again" },
    body: {
      gateId,
      action: "request_refund",
      reason: "result_not_usable",
      evidenceRefs: [`http:request_sha256:${bindings.requestSha256}`, "provider:incident:001"],
      command: mutatedRefundRequestCommand
    }
  });
  assert.equal(requestMutationDeniedAgain.statusCode, 409, requestMutationDeniedAgain.body);
  assert.equal(requestMutationDeniedAgain.json?.code, requestMutationDenied.json?.code);

  const resolveCommandMissingArtifact = signReversalCommand({
    payer,
    gateId,
    receiptId: bindings.receiptId,
    quoteId: bindings.quoteId,
    requestSha256: bindings.requestSha256,
    sponsorRef: bindings.sponsorRef,
    action: "resolve_refund",
    commandId: "cmd_refund_resolve_missing_artifact_1",
    idempotencyKey: "idem_refund_resolve_missing_artifact_1",
    nonce: "nonce_refund_resolve_missing_artifact_1"
  });
  const missingArtifact = await request(api, {
    method: "POST",
    path: "/x402/gate/reversal",
    headers: { "x-idempotency-key": "x402_gate_reversal_resolve_refund_missing_artifact_1" },
    body: {
      gateId,
      action: "resolve_refund",
      providerDecision: "accepted",
      evidenceRefs: [`http:request_sha256:${bindings.requestSha256}`],
      command: resolveCommandMissingArtifact
    }
  });
  assert.equal(missingArtifact.statusCode, 400, missingArtifact.body);
  assert.equal(missingArtifact.json?.code, "SCHEMA_INVALID");

  const resolveCommand = signReversalCommand({
    payer,
    gateId,
    receiptId: bindings.receiptId,
    quoteId: bindings.quoteId,
    requestSha256: bindings.requestSha256,
    sponsorRef: bindings.sponsorRef,
    action: "resolve_refund",
    commandId: "cmd_refund_resolve_1",
    idempotencyKey: "idem_refund_resolve_1",
    nonce: "nonce_refund_resolve_1"
  });
  const providerDecisionArtifact = signProviderRefundDecision({
    payee,
    gateId,
    receiptId: bindings.receiptId,
    quoteId: bindings.quoteId,
    requestSha256: bindings.requestSha256,
    decision: "accepted",
    reason: "provider_acknowledged"
  });
  const resolved = await request(api, {
    method: "POST",
    path: "/x402/gate/reversal",
    headers: { "x-idempotency-key": "x402_gate_reversal_resolve_refund_1" },
    body: {
      gateId,
      action: "resolve_refund",
      providerDecision: "accepted",
      reason: "provider_acknowledged",
      evidenceRefs: [`http:request_sha256:${bindings.requestSha256}`, "provider:decision:accepted"],
      command: resolveCommand,
      providerDecisionArtifact
    }
  });
  assert.equal(resolved.statusCode, 200, resolved.body);
  assert.equal(resolved.json?.reversal?.status, "refunded");
  assert.equal(resolved.json?.settlement?.status, "refunded");
  assert.equal(resolved.json?.settlement?.releasedAmountCents, 0);
  assert.equal(resolved.json?.settlement?.refundedAmountCents, amountCents);
  assert.equal(resolved.json?.settlementReceipt?.status, "refunded");
  assert.equal(resolved.json?.reversalEvent?.providerDecisionVerification?.verified, true);
  assert.ok(resolved.json?.reversal?.timeline?.some((row) => row?.eventType === "refund_requested"));
  assert.ok(resolved.json?.reversal?.timeline?.some((row) => row?.eventType === "refund_resolved"));
  const resolvedIdempotentReplay = await request(api, {
    method: "POST",
    path: "/x402/gate/reversal",
    headers: { "x-idempotency-key": "x402_gate_reversal_resolve_refund_1" },
    body: {
      gateId,
      action: "resolve_refund",
      providerDecision: "accepted",
      reason: "provider_acknowledged",
      evidenceRefs: [`http:request_sha256:${bindings.requestSha256}`, "provider:decision:accepted"],
      command: resolveCommand,
      providerDecisionArtifact
    }
  });
  assert.equal(resolvedIdempotentReplay.statusCode, 200, resolvedIdempotentReplay.body);
  assert.deepEqual(resolvedIdempotentReplay.json, resolved.json);

  const payerWallet = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(payer.agentId)}/wallet`
  });
  assert.equal(payerWallet.statusCode, 200, payerWallet.body);
  assert.equal(payerWallet.json?.wallet?.availableCents, 5000);

  const payeeWallet = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(payee.agentId)}/wallet`
  });
  assert.equal(payeeWallet.statusCode, 200, payeeWallet.body);
  assert.equal(payeeWallet.json?.wallet?.availableCents, 0);

  const events = await request(api, {
    method: "GET",
    path: `/x402/reversal-events?gateId=${encodeURIComponent(gateId)}`
  });
  assert.equal(events.statusCode, 200, events.body);
  assert.equal(Array.isArray(events.json?.events), true);
  assert.equal(events.json.events.length, 2);
  const latest = events.json.events[0];
  const prior = events.json.events[1];
  assert.equal(latest.eventType, "refund_resolved");
  assert.equal(prior.eventType, "refund_requested");
  assert.equal(latest.prevEventHash, prior.eventHash);
});

test("API e2e: x402 reversal fails closed when request-hash evidence is missing or mismatched", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const payer = await registerAgent(api, { agentId: "agt_x402_refund_binding_payer_1" });
  const payee = await registerAgent(api, { agentId: "agt_x402_refund_binding_payee_1" });
  await creditWallet(api, { agentId: payer.agentId, amountCents: 5000, idempotencyKey: "wallet_credit_x402_refund_binding_1" });

  const gateId = "x402gate_refund_binding_1";
  const created = await request(api, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_create_refund_binding_1" },
    body: {
      gateId,
      payerAgentId: payer.agentId,
      payeeAgentId: payee.agentId,
      amountCents: 600,
      currency: "USD",
      toolId: "mock_search",
      disputeWindowDays: 2
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const authorized = await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_authorize_refund_binding_1" },
    body: { gateId }
  });
  assert.equal(authorized.statusCode, 200, authorized.body);

  const verify = await request(api, {
    method: "POST",
    path: "/x402/gate/verify",
    headers: { "x-idempotency-key": "x402_gate_verify_refund_binding_1" },
    body: {
      gateId,
      verificationStatus: "green",
      runStatus: "completed",
      policy: autoPolicy100(),
      verificationMethod: { mode: "deterministic", source: "http_status_v1" },
      evidenceRefs: [`http:request_sha256:${"c".repeat(64)}`, `http:response_sha256:${"d".repeat(64)}`]
    }
  });
  assert.equal(verify.statusCode, 200, verify.body);

  const bindings = await loadReversalBindings(api, { gateId, payerAgentId: payer.agentId });
  assert.ok(bindings.requestSha256);

  const missingEvidenceCommand = signReversalCommand({
    payer,
    gateId,
    receiptId: bindings.receiptId,
    quoteId: bindings.quoteId,
    requestSha256: bindings.requestSha256,
    sponsorRef: bindings.sponsorRef,
    action: "request_refund",
    commandId: "cmd_refund_binding_missing_1",
    idempotencyKey: "idem_refund_binding_missing_1",
    nonce: "nonce_refund_binding_missing_1"
  });
  const missingEvidence = await request(api, {
    method: "POST",
    path: "/x402/gate/reversal",
    headers: { "x-idempotency-key": "x402_gate_reversal_binding_missing_1" },
    body: {
      gateId,
      action: "request_refund",
      reason: "result_not_usable",
      evidenceRefs: ["provider:incident:missing_request_hash"],
      command: missingEvidenceCommand
    }
  });
  assert.equal(missingEvidence.statusCode, 409, missingEvidence.body);
  assert.equal(missingEvidence.json?.code, "X402_REVERSAL_BINDING_EVIDENCE_REQUIRED");

  const mismatchEvidenceCommand = signReversalCommand({
    payer,
    gateId,
    receiptId: bindings.receiptId,
    quoteId: bindings.quoteId,
    requestSha256: bindings.requestSha256,
    sponsorRef: bindings.sponsorRef,
    action: "request_refund",
    commandId: "cmd_refund_binding_mismatch_1",
    idempotencyKey: "idem_refund_binding_mismatch_1",
    nonce: "nonce_refund_binding_mismatch_1"
  });
  const mismatchEvidence = await request(api, {
    method: "POST",
    path: "/x402/gate/reversal",
    headers: { "x-idempotency-key": "x402_gate_reversal_binding_mismatch_1" },
    body: {
      gateId,
      action: "request_refund",
      reason: "result_not_usable",
      evidenceRefs: [`http:request_sha256:${"e".repeat(64)}`],
      command: mismatchEvidenceCommand
    }
  });
  assert.equal(mismatchEvidence.statusCode, 409, mismatchEvidence.body);
  assert.equal(mismatchEvidence.json?.code, "X402_REVERSAL_BINDING_EVIDENCE_MISMATCH");
});

test("API e2e: run dispute close fails closed on missing or mismatched settlement request-hash evidence", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const payer = await registerAgent(api, { agentId: "agt_x402_dispute_binding_payer_1" });
  const payee = await registerAgent(api, { agentId: "agt_x402_dispute_binding_payee_1" });
  const operator = await registerAgent(api, { agentId: "agt_x402_dispute_binding_operator_1" });
  await creditWallet(api, { agentId: payer.agentId, amountCents: 5000, idempotencyKey: "wallet_credit_x402_dispute_binding_1" });

  const gateId = "x402gate_dispute_binding_1";
  const created = await request(api, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_create_dispute_binding_1" },
    body: {
      gateId,
      payerAgentId: payer.agentId,
      payeeAgentId: payee.agentId,
      amountCents: 600,
      currency: "USD",
      toolId: "mock_search",
      disputeWindowDays: 2
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const authorized = await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_authorize_dispute_binding_1" },
    body: { gateId }
  });
  assert.equal(authorized.statusCode, 200, authorized.body);

  const verify = await request(api, {
    method: "POST",
    path: "/x402/gate/verify",
    headers: { "x-idempotency-key": "x402_gate_verify_dispute_binding_1" },
    body: {
      gateId,
      verificationStatus: "green",
      runStatus: "completed",
      policy: autoPolicy100(),
      verificationMethod: { mode: "deterministic", source: "http_status_v1" },
      evidenceRefs: [`http:request_sha256:${"f".repeat(64)}`, `http:response_sha256:${"a".repeat(64)}`]
    }
  });
  assert.equal(verify.statusCode, 200, verify.body);

  const gateRead = await request(api, { method: "GET", path: `/x402/gate/${encodeURIComponent(gateId)}` });
  assert.equal(gateRead.statusCode, 200, gateRead.body);
  const runId = gateRead.json?.settlement?.runId;
  assert.ok(typeof runId === "string" && runId.length > 0);
  const bindings = await loadReversalBindings(api, { gateId, payerAgentId: payer.agentId });
  assert.ok(bindings.requestSha256);

  const openDispute = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
    headers: { "x-idempotency-key": "x402_dispute_binding_open_1" },
    body: {
      disputeId: "dsp_x402_binding_1",
      disputeType: "quality",
      disputePriority: "high",
      disputeChannel: "counterparty",
      escalationLevel: "l1_counterparty",
      openedByAgentId: operator.agentId,
      reason: "binding validation",
      evidenceRefs: [`http:request_sha256:${bindings.requestSha256}`, "evidence://x402/dispute-binding/context.json"]
    }
  });
  assert.equal(openDispute.statusCode, 200, openDispute.body);

  const closeMissing = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/close`,
    headers: { "x-idempotency-key": "x402_dispute_binding_close_missing_1" },
    body: {
      disputeId: "dsp_x402_binding_1",
      resolutionOutcome: "accepted",
      resolutionSummary: "missing request hash should fail",
      closedByAgentId: operator.agentId,
      resolutionEvidenceRefs: ["ops:ticket:dispute_binding_missing"]
    }
  });
  assert.equal(closeMissing.statusCode, 409, closeMissing.body);
  assert.equal(closeMissing.json?.code, "X402_DISPUTE_CLOSE_BINDING_EVIDENCE_REQUIRED");

  const closeMismatch = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/close`,
    headers: { "x-idempotency-key": "x402_dispute_binding_close_mismatch_1" },
    body: {
      disputeId: "dsp_x402_binding_1",
      resolutionOutcome: "accepted",
      resolutionSummary: "mismatched request hash should fail",
      closedByAgentId: operator.agentId,
      resolutionEvidenceRefs: [`http:request_sha256:${"1".repeat(64)}`]
    }
  });
  assert.equal(closeMismatch.statusCode, 409, closeMismatch.body);
  assert.equal(closeMismatch.json?.code, "X402_DISPUTE_CLOSE_BINDING_EVIDENCE_MISMATCH");

  const closeSuccess = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/close`,
    headers: { "x-idempotency-key": "x402_dispute_binding_close_success_1" },
    body: {
      disputeId: "dsp_x402_binding_1",
      resolutionOutcome: "accepted",
      resolutionSummary: "request hash matches",
      closedByAgentId: operator.agentId,
      resolutionEvidenceRefs: [`http:request_sha256:${bindings.requestSha256}`]
    }
  });
  assert.equal(closeSuccess.statusCode, 200, closeSuccess.body);
  assert.equal(closeSuccess.json?.settlement?.disputeStatus, "closed");
});

test("API e2e: run arbitration open/assign/evidence fail closed on missing or mismatched settlement request-hash evidence", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const payer = await registerAgent(api, { agentId: "agt_x402_arb_ops_binding_payer_1" });
  const payee = await registerAgent(api, { agentId: "agt_x402_arb_ops_binding_payee_1" });
  const operator = await registerAgent(api, { agentId: "agt_x402_arb_ops_binding_operator_1" });
  const arbiter = await registerAgent(api, { agentId: "agt_x402_arb_ops_binding_arbiter_1" });
  await creditWallet(api, { agentId: payer.agentId, amountCents: 60000, idempotencyKey: "wallet_credit_x402_arb_ops_binding_1" });

  async function setupRun({ seed, verifyRequestSha256 }) {
    const gateId = `x402gate_arb_ops_binding_${seed}`;
    const created = await request(api, {
      method: "POST",
      path: "/x402/gate/create",
      headers: { "x-idempotency-key": `x402_gate_create_arb_ops_binding_${seed}` },
      body: {
        gateId,
        payerAgentId: payer.agentId,
        payeeAgentId: payee.agentId,
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
      headers: { "x-idempotency-key": `x402_gate_authorize_arb_ops_binding_${seed}` },
      body: { gateId }
    });
    assert.equal(authorized.statusCode, 200, authorized.body);
    const verify = await request(api, {
      method: "POST",
      path: "/x402/gate/verify",
      headers: { "x-idempotency-key": `x402_gate_verify_arb_ops_binding_${seed}` },
      body: {
        gateId,
        verificationStatus: "green",
        runStatus: "completed",
        policy: autoPolicy100(),
        verificationMethod: { mode: "deterministic", source: "http_status_v1" },
        evidenceRefs: [`http:request_sha256:${verifyRequestSha256}`, `http:response_sha256:${"c".repeat(64)}`]
      }
    });
    assert.equal(verify.statusCode, 200, verify.body);
    const gateRead = await request(api, { method: "GET", path: `/x402/gate/${encodeURIComponent(gateId)}` });
    assert.equal(gateRead.statusCode, 200, gateRead.body);
    const runId = gateRead.json?.settlement?.runId;
    assert.ok(typeof runId === "string" && runId.length > 0);
    const bindings = await loadReversalBindings(api, { gateId, payerAgentId: payer.agentId });
    assert.ok(bindings.requestSha256);
    return {
      runId,
      disputeId: `dsp_x402_arb_ops_binding_${seed}`,
      caseId: `arb_case_x402_arb_ops_binding_${seed}`,
      requestSha256: bindings.requestSha256
    };
  }

  async function openDispute({ runId, disputeId, idempotencyKey, reason, evidenceRefs }) {
    return await request(api, {
      method: "POST",
      path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
      headers: { "x-idempotency-key": idempotencyKey },
      body: {
        disputeId,
        disputeType: "quality",
        disputePriority: "high",
        disputeChannel: "arbiter",
        escalationLevel: "l2_arbiter",
        openedByAgentId: operator.agentId,
        reason,
        evidenceRefs
      }
    });
  }

  async function openArbitrationCase({ runId, disputeId, caseId, idempotencyKey, evidenceRefs }) {
    return await request(api, {
      method: "POST",
      path: `/runs/${encodeURIComponent(runId)}/arbitration/open`,
      headers: { "x-idempotency-key": idempotencyKey },
      body: {
        caseId,
        disputeId,
        arbiterAgentId: arbiter.agentId,
        evidenceRefs
      }
    });
  }

  const arbOpenRequired = await setupRun({
    seed: "open_required_1",
    verifyRequestSha256: "1".repeat(64)
  });
  const arbOpenRequiredContextRef = "evidence://x402/arb-open-required/context.json";
  const openDisputeForArbOpenRequired = await openDispute({
    runId: arbOpenRequired.runId,
    disputeId: arbOpenRequired.disputeId,
    idempotencyKey: "x402_dispute_open_arb_open_required_1",
    reason: "prepare arbitration open required check",
    evidenceRefs: [`http:request_sha256:${arbOpenRequired.requestSha256}`, arbOpenRequiredContextRef]
  });
  assert.equal(openDisputeForArbOpenRequired.statusCode, 200, openDisputeForArbOpenRequired.body);
  const arbitrationOpenRequired = await openArbitrationCase({
    runId: arbOpenRequired.runId,
    disputeId: arbOpenRequired.disputeId,
    caseId: arbOpenRequired.caseId,
    idempotencyKey: "x402_arb_open_required_1",
    evidenceRefs: [arbOpenRequiredContextRef]
  });
  assertBindingEvidenceConflict(arbitrationOpenRequired, {
    code: "X402_ARBITRATION_OPEN_BINDING_EVIDENCE_REQUIRED",
    operation: "run_arbitration.open",
    expectedRequestSha256: arbOpenRequired.requestSha256
  });

  const arbOpenMismatch = await setupRun({
    seed: "open_mismatch_1",
    verifyRequestSha256: "2".repeat(64)
  });
  const arbOpenMismatchSha = "3".repeat(64);
  const arbOpenMismatchContextRef = "evidence://x402/arb-open-mismatch/context.json";
  const openDisputeForArbOpenMismatch = await openDispute({
    runId: arbOpenMismatch.runId,
    disputeId: arbOpenMismatch.disputeId,
    idempotencyKey: "x402_dispute_open_arb_open_mismatch_1",
    reason: "prepare arbitration open mismatch check",
    evidenceRefs: [
      `http:request_sha256:${arbOpenMismatch.requestSha256}`,
      `http:request_sha256:${arbOpenMismatchSha}`,
      arbOpenMismatchContextRef
    ]
  });
  assert.equal(openDisputeForArbOpenMismatch.statusCode, 200, openDisputeForArbOpenMismatch.body);
  const arbitrationOpenMismatch = await openArbitrationCase({
    runId: arbOpenMismatch.runId,
    disputeId: arbOpenMismatch.disputeId,
    caseId: arbOpenMismatch.caseId,
    idempotencyKey: "x402_arb_open_mismatch_1",
    evidenceRefs: [`http:request_sha256:${arbOpenMismatchSha}`]
  });
  assertBindingEvidenceConflict(arbitrationOpenMismatch, {
    code: "X402_ARBITRATION_OPEN_BINDING_EVIDENCE_MISMATCH",
    operation: "run_arbitration.open",
    expectedRequestSha256: arbOpenMismatch.requestSha256,
    requestSha256: arbOpenMismatchSha
  });

  const arbAssignRequired = await setupRun({
    seed: "assign_required_1",
    verifyRequestSha256: "4".repeat(64)
  });
  const openDisputeForArbAssignRequired = await openDispute({
    runId: arbAssignRequired.runId,
    disputeId: arbAssignRequired.disputeId,
    idempotencyKey: "x402_dispute_open_arb_assign_required_1",
    reason: "prepare arbitration assign required check",
    evidenceRefs: [`http:request_sha256:${arbAssignRequired.requestSha256}`, "evidence://x402/arb-assign-required/context.json"]
  });
  assert.equal(openDisputeForArbAssignRequired.statusCode, 200, openDisputeForArbAssignRequired.body);
  const openCaseForArbAssignRequired = await openArbitrationCase({
    runId: arbAssignRequired.runId,
    disputeId: arbAssignRequired.disputeId,
    caseId: arbAssignRequired.caseId,
    idempotencyKey: "x402_arb_open_assign_required_1",
    evidenceRefs: [`http:request_sha256:${arbAssignRequired.requestSha256}`]
  });
  assert.equal(openCaseForArbAssignRequired.statusCode, 201, openCaseForArbAssignRequired.body);
  overwriteArbitrationCaseEvidenceRefs(api, {
    caseId: arbAssignRequired.caseId,
    evidenceRefs: ["evidence://x402/arb-assign-required/no-request-hash.json"]
  });
  const arbitrationAssignRequired = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(arbAssignRequired.runId)}/arbitration/assign`,
    headers: { "x-idempotency-key": "x402_arb_assign_required_1" },
    body: {
      caseId: arbAssignRequired.caseId,
      arbiterAgentId: arbiter.agentId
    }
  });
  assertBindingEvidenceConflict(arbitrationAssignRequired, {
    code: "X402_ARBITRATION_ASSIGN_BINDING_EVIDENCE_REQUIRED",
    operation: "run_arbitration.assign",
    expectedRequestSha256: arbAssignRequired.requestSha256
  });

  const arbAssignMismatch = await setupRun({
    seed: "assign_mismatch_1",
    verifyRequestSha256: "5".repeat(64)
  });
  const arbAssignMismatchSha = "6".repeat(64);
  const openDisputeForArbAssignMismatch = await openDispute({
    runId: arbAssignMismatch.runId,
    disputeId: arbAssignMismatch.disputeId,
    idempotencyKey: "x402_dispute_open_arb_assign_mismatch_1",
    reason: "prepare arbitration assign mismatch check",
    evidenceRefs: [`http:request_sha256:${arbAssignMismatch.requestSha256}`, `http:request_sha256:${arbAssignMismatchSha}`]
  });
  assert.equal(openDisputeForArbAssignMismatch.statusCode, 200, openDisputeForArbAssignMismatch.body);
  const openCaseForArbAssignMismatch = await openArbitrationCase({
    runId: arbAssignMismatch.runId,
    disputeId: arbAssignMismatch.disputeId,
    caseId: arbAssignMismatch.caseId,
    idempotencyKey: "x402_arb_open_assign_mismatch_1",
    evidenceRefs: [`http:request_sha256:${arbAssignMismatch.requestSha256}`]
  });
  assert.equal(openCaseForArbAssignMismatch.statusCode, 201, openCaseForArbAssignMismatch.body);
  overwriteArbitrationCaseEvidenceRefs(api, {
    caseId: arbAssignMismatch.caseId,
    evidenceRefs: [`http:request_sha256:${arbAssignMismatchSha}`]
  });
  const arbitrationAssignMismatch = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(arbAssignMismatch.runId)}/arbitration/assign`,
    headers: { "x-idempotency-key": "x402_arb_assign_mismatch_1" },
    body: {
      caseId: arbAssignMismatch.caseId,
      arbiterAgentId: arbiter.agentId
    }
  });
  assertBindingEvidenceConflict(arbitrationAssignMismatch, {
    code: "X402_ARBITRATION_ASSIGN_BINDING_EVIDENCE_MISMATCH",
    operation: "run_arbitration.assign",
    expectedRequestSha256: arbAssignMismatch.requestSha256,
    requestSha256: arbAssignMismatchSha
  });

  const arbEvidenceRequired = await setupRun({
    seed: "evidence_required_1",
    verifyRequestSha256: "7".repeat(64)
  });
  const arbEvidenceRequiredContextA = "evidence://x402/arb-evidence-required/context-a.json";
  const arbEvidenceRequiredContextB = "evidence://x402/arb-evidence-required/context-b.json";
  const openDisputeForArbEvidenceRequired = await openDispute({
    runId: arbEvidenceRequired.runId,
    disputeId: arbEvidenceRequired.disputeId,
    idempotencyKey: "x402_dispute_open_arb_evidence_required_1",
    reason: "prepare arbitration evidence required check",
    evidenceRefs: [
      `http:request_sha256:${arbEvidenceRequired.requestSha256}`,
      arbEvidenceRequiredContextA,
      arbEvidenceRequiredContextB
    ]
  });
  assert.equal(openDisputeForArbEvidenceRequired.statusCode, 200, openDisputeForArbEvidenceRequired.body);
  const openCaseForArbEvidenceRequired = await openArbitrationCase({
    runId: arbEvidenceRequired.runId,
    disputeId: arbEvidenceRequired.disputeId,
    caseId: arbEvidenceRequired.caseId,
    idempotencyKey: "x402_arb_open_evidence_required_1",
    evidenceRefs: [`http:request_sha256:${arbEvidenceRequired.requestSha256}`, arbEvidenceRequiredContextA]
  });
  assert.equal(openCaseForArbEvidenceRequired.statusCode, 201, openCaseForArbEvidenceRequired.body);
  overwriteArbitrationCaseEvidenceRefs(api, {
    caseId: arbEvidenceRequired.caseId,
    evidenceRefs: [arbEvidenceRequiredContextA]
  });
  const arbitrationEvidenceRequired = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(arbEvidenceRequired.runId)}/arbitration/evidence`,
    headers: { "x-idempotency-key": "x402_arb_evidence_required_1" },
    body: {
      caseId: arbEvidenceRequired.caseId,
      evidenceRef: arbEvidenceRequiredContextB
    }
  });
  assertBindingEvidenceConflict(arbitrationEvidenceRequired, {
    code: "X402_ARBITRATION_EVIDENCE_BINDING_EVIDENCE_REQUIRED",
    operation: "run_arbitration.evidence",
    expectedRequestSha256: arbEvidenceRequired.requestSha256
  });

  const arbEvidenceMismatch = await setupRun({
    seed: "evidence_mismatch_1",
    verifyRequestSha256: "8".repeat(64)
  });
  const arbEvidenceMismatchSha = "9".repeat(64);
  const arbEvidenceMismatchContextRef = "evidence://x402/arb-evidence-mismatch/context.json";
  const openDisputeForArbEvidenceMismatch = await openDispute({
    runId: arbEvidenceMismatch.runId,
    disputeId: arbEvidenceMismatch.disputeId,
    idempotencyKey: "x402_dispute_open_arb_evidence_mismatch_1",
    reason: "prepare arbitration evidence mismatch check",
    evidenceRefs: [
      `http:request_sha256:${arbEvidenceMismatch.requestSha256}`,
      `http:request_sha256:${arbEvidenceMismatchSha}`,
      arbEvidenceMismatchContextRef
    ]
  });
  assert.equal(openDisputeForArbEvidenceMismatch.statusCode, 200, openDisputeForArbEvidenceMismatch.body);
  const openCaseForArbEvidenceMismatch = await openArbitrationCase({
    runId: arbEvidenceMismatch.runId,
    disputeId: arbEvidenceMismatch.disputeId,
    caseId: arbEvidenceMismatch.caseId,
    idempotencyKey: "x402_arb_open_evidence_mismatch_1",
    evidenceRefs: [`http:request_sha256:${arbEvidenceMismatch.requestSha256}`, arbEvidenceMismatchContextRef]
  });
  assert.equal(openCaseForArbEvidenceMismatch.statusCode, 201, openCaseForArbEvidenceMismatch.body);
  const arbitrationEvidenceMismatch = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(arbEvidenceMismatch.runId)}/arbitration/evidence`,
    headers: { "x-idempotency-key": "x402_arb_evidence_mismatch_1" },
    body: {
      caseId: arbEvidenceMismatch.caseId,
      evidenceRef: `http:request_sha256:${arbEvidenceMismatchSha}`
    }
  });
  assertBindingEvidenceConflict(arbitrationEvidenceMismatch, {
    code: "X402_ARBITRATION_EVIDENCE_BINDING_EVIDENCE_MISMATCH",
    operation: "run_arbitration.evidence",
    expectedRequestSha256: arbEvidenceMismatch.requestSha256,
    requestSha256: arbEvidenceMismatchSha
  });
});

test("API e2e: run dispute open/evidence/escalate fail closed on missing or mismatched settlement request-hash evidence", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const payer = await registerAgent(api, { agentId: "agt_x402_dispute_ops_binding_payer_1" });
  const payee = await registerAgent(api, { agentId: "agt_x402_dispute_ops_binding_payee_1" });
  const operator = await registerAgent(api, { agentId: "agt_x402_dispute_ops_binding_operator_1" });
  await creditWallet(api, { agentId: payer.agentId, amountCents: 60000, idempotencyKey: "wallet_credit_x402_dispute_ops_binding_1" });

  async function setupRun({ seed, verifyRequestSha256 }) {
    const gateId = `x402gate_dispute_ops_binding_${seed}`;
    const created = await request(api, {
      method: "POST",
      path: "/x402/gate/create",
      headers: { "x-idempotency-key": `x402_gate_create_dispute_ops_binding_${seed}` },
      body: {
        gateId,
        payerAgentId: payer.agentId,
        payeeAgentId: payee.agentId,
        amountCents: 625,
        currency: "USD",
        toolId: "mock_search",
        disputeWindowDays: 2
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    const authorized = await request(api, {
      method: "POST",
      path: "/x402/gate/authorize-payment",
      headers: { "x-idempotency-key": `x402_gate_authorize_dispute_ops_binding_${seed}` },
      body: { gateId }
    });
    assert.equal(authorized.statusCode, 200, authorized.body);
    const verify = await request(api, {
      method: "POST",
      path: "/x402/gate/verify",
      headers: { "x-idempotency-key": `x402_gate_verify_dispute_ops_binding_${seed}` },
      body: {
        gateId,
        verificationStatus: "green",
        runStatus: "completed",
        policy: autoPolicy100(),
        verificationMethod: { mode: "deterministic", source: "http_status_v1" },
        evidenceRefs: [`http:request_sha256:${verifyRequestSha256}`, `http:response_sha256:${"d".repeat(64)}`]
      }
    });
    assert.equal(verify.statusCode, 200, verify.body);
    const gateRead = await request(api, { method: "GET", path: `/x402/gate/${encodeURIComponent(gateId)}` });
    assert.equal(gateRead.statusCode, 200, gateRead.body);
    const runId = gateRead.json?.settlement?.runId;
    assert.ok(typeof runId === "string" && runId.length > 0);
    const bindings = await loadReversalBindings(api, { gateId, payerAgentId: payer.agentId });
    assert.ok(bindings.requestSha256);
    return {
      runId,
      disputeId: `dsp_x402_dispute_ops_binding_${seed}`,
      requestSha256: bindings.requestSha256
    };
  }

  async function openDispute({ runId, disputeId, idempotencyKey, reason, evidenceRefs }) {
    return await request(api, {
      method: "POST",
      path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
      headers: { "x-idempotency-key": idempotencyKey },
      body: {
        disputeId,
        disputeType: "quality",
        disputePriority: "high",
        disputeChannel: "counterparty",
        escalationLevel: "l1_counterparty",
        openedByAgentId: operator.agentId,
        reason,
        evidenceRefs
      }
    });
  }

  const disputeOpenRequired = await setupRun({
    seed: "open_required_1",
    verifyRequestSha256: "a".repeat(64)
  });
  const issueDisputeOpenRequired = await openDispute({
    runId: disputeOpenRequired.runId,
    disputeId: disputeOpenRequired.disputeId,
    idempotencyKey: "x402_dispute_ops_open_required_1",
    reason: "missing request hash should fail",
    evidenceRefs: ["evidence://x402/dispute-open-required/context.json"]
  });
  assertBindingEvidenceConflict(issueDisputeOpenRequired, {
    code: "X402_DISPUTE_OPEN_BINDING_EVIDENCE_REQUIRED",
    operation: "run_dispute.open",
    expectedRequestSha256: disputeOpenRequired.requestSha256
  });

  const disputeOpenMismatch = await setupRun({
    seed: "open_mismatch_1",
    verifyRequestSha256: "b".repeat(64)
  });
  const disputeOpenMismatchSha = "c".repeat(64);
  const issueDisputeOpenMismatch = await openDispute({
    runId: disputeOpenMismatch.runId,
    disputeId: disputeOpenMismatch.disputeId,
    idempotencyKey: "x402_dispute_ops_open_mismatch_1",
    reason: "mismatched request hash should fail",
    evidenceRefs: [`http:request_sha256:${disputeOpenMismatchSha}`, "evidence://x402/dispute-open-mismatch/context.json"]
  });
  assertBindingEvidenceConflict(issueDisputeOpenMismatch, {
    code: "X402_DISPUTE_OPEN_BINDING_EVIDENCE_MISMATCH",
    operation: "run_dispute.open",
    expectedRequestSha256: disputeOpenMismatch.requestSha256,
    requestSha256: disputeOpenMismatchSha
  });

  const disputeEvidenceRequired = await setupRun({
    seed: "evidence_required_1",
    verifyRequestSha256: "d".repeat(64)
  });
  const disputeEvidenceRequiredContextRef = "evidence://x402/dispute-evidence-required/context.json";
  const openForDisputeEvidenceRequired = await openDispute({
    runId: disputeEvidenceRequired.runId,
    disputeId: disputeEvidenceRequired.disputeId,
    idempotencyKey: "x402_dispute_ops_open_for_evidence_required_1",
    reason: "prepare dispute evidence required check",
    evidenceRefs: [`http:request_sha256:${disputeEvidenceRequired.requestSha256}`, disputeEvidenceRequiredContextRef]
  });
  assert.equal(openForDisputeEvidenceRequired.statusCode, 200, openForDisputeEvidenceRequired.body);
  overwriteSettlementDisputeEvidenceRefs(api, {
    runId: disputeEvidenceRequired.runId,
    evidenceRefs: [disputeEvidenceRequiredContextRef]
  });
  const issueDisputeEvidenceRequired = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(disputeEvidenceRequired.runId)}/dispute/evidence`,
    headers: { "x-idempotency-key": "x402_dispute_evidence_required_1" },
    body: {
      disputeId: disputeEvidenceRequired.disputeId,
      submittedByAgentId: operator.agentId,
      reason: "missing request hash should fail",
      evidenceRef: disputeEvidenceRequiredContextRef
    }
  });
  assertBindingEvidenceConflict(issueDisputeEvidenceRequired, {
    code: "X402_DISPUTE_EVIDENCE_BINDING_EVIDENCE_REQUIRED",
    operation: "run_dispute.evidence",
    expectedRequestSha256: disputeEvidenceRequired.requestSha256
  });

  const disputeEvidenceMismatch = await setupRun({
    seed: "evidence_mismatch_1",
    verifyRequestSha256: "e".repeat(64)
  });
  const disputeEvidenceMismatchSha = "f".repeat(64);
  const openForDisputeEvidenceMismatch = await openDispute({
    runId: disputeEvidenceMismatch.runId,
    disputeId: disputeEvidenceMismatch.disputeId,
    idempotencyKey: "x402_dispute_ops_open_for_evidence_mismatch_1",
    reason: "prepare dispute evidence mismatch check",
    evidenceRefs: [`http:request_sha256:${disputeEvidenceMismatch.requestSha256}`, "evidence://x402/dispute-evidence-mismatch/context.json"]
  });
  assert.equal(openForDisputeEvidenceMismatch.statusCode, 200, openForDisputeEvidenceMismatch.body);
  const issueDisputeEvidenceMismatch = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(disputeEvidenceMismatch.runId)}/dispute/evidence`,
    headers: { "x-idempotency-key": "x402_dispute_evidence_mismatch_1" },
    body: {
      disputeId: disputeEvidenceMismatch.disputeId,
      submittedByAgentId: operator.agentId,
      reason: "mismatched request hash should fail",
      evidenceRef: `http:request_sha256:${disputeEvidenceMismatchSha}`
    }
  });
  assertBindingEvidenceConflict(issueDisputeEvidenceMismatch, {
    code: "X402_DISPUTE_EVIDENCE_BINDING_EVIDENCE_MISMATCH",
    operation: "run_dispute.evidence",
    expectedRequestSha256: disputeEvidenceMismatch.requestSha256,
    requestSha256: disputeEvidenceMismatchSha
  });

  const disputeEscalateRequired = await setupRun({
    seed: "escalate_required_1",
    verifyRequestSha256: "1".repeat(64)
  });
  const disputeEscalateRequiredContextRef = "evidence://x402/dispute-escalate-required/context.json";
  const openForDisputeEscalateRequired = await openDispute({
    runId: disputeEscalateRequired.runId,
    disputeId: disputeEscalateRequired.disputeId,
    idempotencyKey: "x402_dispute_ops_open_for_escalate_required_1",
    reason: "prepare dispute escalate required check",
    evidenceRefs: [`http:request_sha256:${disputeEscalateRequired.requestSha256}`, disputeEscalateRequiredContextRef]
  });
  assert.equal(openForDisputeEscalateRequired.statusCode, 200, openForDisputeEscalateRequired.body);
  overwriteSettlementDisputeEvidenceRefs(api, {
    runId: disputeEscalateRequired.runId,
    evidenceRefs: [disputeEscalateRequiredContextRef]
  });
  const issueDisputeEscalateRequired = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(disputeEscalateRequired.runId)}/dispute/escalate`,
    headers: { "x-idempotency-key": "x402_dispute_escalate_required_1" },
    body: {
      disputeId: disputeEscalateRequired.disputeId,
      escalationLevel: "l2_arbiter",
      channel: "arbiter",
      reason: "missing request hash should fail",
      escalatedByAgentId: operator.agentId
    }
  });
  assertBindingEvidenceConflict(issueDisputeEscalateRequired, {
    code: "X402_DISPUTE_ESCALATE_BINDING_EVIDENCE_REQUIRED",
    operation: "run_dispute.escalate",
    expectedRequestSha256: disputeEscalateRequired.requestSha256
  });

  const disputeEscalateMismatch = await setupRun({
    seed: "escalate_mismatch_1",
    verifyRequestSha256: "2".repeat(64)
  });
  const disputeEscalateMismatchSha = "3".repeat(64);
  const disputeEscalateMismatchContextRef = "evidence://x402/dispute-escalate-mismatch/context.json";
  const openForDisputeEscalateMismatch = await openDispute({
    runId: disputeEscalateMismatch.runId,
    disputeId: disputeEscalateMismatch.disputeId,
    idempotencyKey: "x402_dispute_ops_open_for_escalate_mismatch_1",
    reason: "prepare dispute escalate mismatch check",
    evidenceRefs: [`http:request_sha256:${disputeEscalateMismatch.requestSha256}`, disputeEscalateMismatchContextRef]
  });
  assert.equal(openForDisputeEscalateMismatch.statusCode, 200, openForDisputeEscalateMismatch.body);
  overwriteSettlementDisputeEvidenceRefs(api, {
    runId: disputeEscalateMismatch.runId,
    evidenceRefs: [`http:request_sha256:${disputeEscalateMismatchSha}`, disputeEscalateMismatchContextRef]
  });
  const issueDisputeEscalateMismatch = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(disputeEscalateMismatch.runId)}/dispute/escalate`,
    headers: { "x-idempotency-key": "x402_dispute_escalate_mismatch_1" },
    body: {
      disputeId: disputeEscalateMismatch.disputeId,
      escalationLevel: "l2_arbiter",
      channel: "arbiter",
      reason: "mismatched request hash should fail",
      escalatedByAgentId: operator.agentId
    }
  });
  assertBindingEvidenceConflict(issueDisputeEscalateMismatch, {
    code: "X402_DISPUTE_ESCALATE_BINDING_EVIDENCE_MISMATCH",
    operation: "run_dispute.escalate",
    expectedRequestSha256: disputeEscalateMismatch.requestSha256,
    requestSha256: disputeEscalateMismatchSha
  });
});

test("API e2e: run arbitration verdict fails closed on missing or mismatched settlement request-hash evidence", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const payer = await registerAgent(api, { agentId: "agt_x402_arb_verdict_binding_payer_1" });
  const payee = await registerAgent(api, { agentId: "agt_x402_arb_verdict_binding_payee_1" });
  const operator = await registerAgent(api, { agentId: "agt_x402_arb_verdict_binding_operator_1" });
  const arbiterKeypair = createEd25519Keypair();
  const arbiterRegistration = await registerAgent(api, {
    agentId: "agt_x402_arb_verdict_binding_arbiter_1",
    publicKeyPem: arbiterKeypair.publicKeyPem
  });
  await creditWallet(api, { agentId: payer.agentId, amountCents: 7000, idempotencyKey: "wallet_credit_x402_arb_verdict_binding_1" });

  async function setupCase({ seed, verifyRequestSha256, disputeEvidenceRefs, arbitrationCaseEvidenceRefs }) {
    const gateId = `x402gate_arb_verdict_binding_${seed}`;
    const created = await request(api, {
      method: "POST",
      path: "/x402/gate/create",
      headers: { "x-idempotency-key": `x402_gate_create_arb_verdict_binding_${seed}` },
      body: {
        gateId,
        payerAgentId: payer.agentId,
        payeeAgentId: payee.agentId,
        amountCents: 750,
        currency: "USD",
        toolId: "mock_search",
        disputeWindowDays: 2
      }
    });
    assert.equal(created.statusCode, 201, created.body);

    const authorized = await request(api, {
      method: "POST",
      path: "/x402/gate/authorize-payment",
      headers: { "x-idempotency-key": `x402_gate_authorize_arb_verdict_binding_${seed}` },
      body: { gateId }
    });
    assert.equal(authorized.statusCode, 200, authorized.body);

    const verify = await request(api, {
      method: "POST",
      path: "/x402/gate/verify",
      headers: { "x-idempotency-key": `x402_gate_verify_arb_verdict_binding_${seed}` },
      body: {
        gateId,
        verificationStatus: "green",
        runStatus: "completed",
        policy: autoPolicy100(),
        verificationMethod: { mode: "deterministic", source: "http_status_v1" },
        evidenceRefs: [`http:request_sha256:${verifyRequestSha256}`, `http:response_sha256:${"d".repeat(64)}`]
      }
    });
    assert.equal(verify.statusCode, 200, verify.body);

    const gateRead = await request(api, { method: "GET", path: `/x402/gate/${encodeURIComponent(gateId)}` });
    assert.equal(gateRead.statusCode, 200, gateRead.body);
    const runId = gateRead.json?.settlement?.runId;
    const settlementId = gateRead.json?.settlement?.settlementId;
    assert.ok(typeof runId === "string" && runId.length > 0);
    assert.ok(typeof settlementId === "string" && settlementId.length > 0);

    const disputeId = `dsp_x402_arb_verdict_binding_${seed}`;
    const caseId = `arb_case_x402_arb_verdict_binding_${seed}`;
    const openDispute = await request(api, {
      method: "POST",
      path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
      headers: { "x-idempotency-key": `x402_dispute_open_arb_verdict_binding_${seed}` },
      body: {
        disputeId,
        disputeType: "quality",
        disputePriority: "high",
        disputeChannel: "arbiter",
        escalationLevel: "l2_arbiter",
        openedByAgentId: operator.agentId,
        reason: "arbitration verdict binding check",
        evidenceRefs: disputeEvidenceRefs
      }
    });
    assert.equal(openDispute.statusCode, 200, openDispute.body);

    const openArbitration = await request(api, {
      method: "POST",
      path: `/runs/${encodeURIComponent(runId)}/arbitration/open`,
      headers: { "x-idempotency-key": `x402_arb_open_verdict_binding_${seed}` },
      body: {
        caseId,
        disputeId,
        arbiterAgentId: "agt_x402_arb_verdict_binding_arbiter_1",
        evidenceRefs: arbitrationCaseEvidenceRefs
      }
    });
    assert.equal(openArbitration.statusCode, 201, openArbitration.body);

    return { runId, settlementId, disputeId, caseId };
  }

  const requiredScenario = await setupCase({
    seed: "required_1",
    verifyRequestSha256: "6".repeat(64),
    disputeEvidenceRefs: [`http:request_sha256:${"6".repeat(64)}`, "evidence://x402/arb-verdict-binding-required/context.json"],
    arbitrationCaseEvidenceRefs: [`http:request_sha256:${"6".repeat(64)}`, "evidence://x402/arb-verdict-binding-required/context.json"]
  });
  overwriteArbitrationCaseEvidenceRefs(api, {
    caseId: requiredScenario.caseId,
    evidenceRefs: ["evidence://x402/arb-verdict-binding-required/context.json"]
  });
  const requiredIssuedAt = "2026-02-06T00:00:00.000Z";
  const requiredVerdictCore = normalizeForCanonicalJson(
    {
      schemaVersion: "ArbitrationVerdict.v1",
      verdictId: "arb_vrd_x402_arb_verdict_binding_required_1",
      caseId: requiredScenario.caseId,
      tenantId: "tenant_default",
      runId: requiredScenario.runId,
      settlementId: requiredScenario.settlementId,
      disputeId: requiredScenario.disputeId,
      arbiterAgentId: "agt_x402_arb_verdict_binding_arbiter_1",
      outcome: "accepted",
      releaseRatePct: 100,
      rationale: "missing request hash should fail",
      evidenceRefs: ["evidence://x402/arb-verdict-binding-required/context.json"],
      issuedAt: requiredIssuedAt,
      appealRef: null
    },
    { path: "$" }
  );
  const requiredVerdictHash = sha256Hex(canonicalJsonStringify(requiredVerdictCore));
  const requiredSignature = signHashHexEd25519(requiredVerdictHash, arbiterKeypair.privateKeyPem);
  const issueRequired = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(requiredScenario.runId)}/arbitration/verdict`,
    headers: { "x-idempotency-key": "x402_arb_verdict_binding_required_1" },
    body: {
      caseId: requiredScenario.caseId,
      arbitrationVerdict: {
        caseId: requiredScenario.caseId,
        verdictId: "arb_vrd_x402_arb_verdict_binding_required_1",
        arbiterAgentId: "agt_x402_arb_verdict_binding_arbiter_1",
        outcome: "accepted",
        releaseRatePct: 100,
        rationale: "missing request hash should fail",
        evidenceRefs: ["evidence://x402/arb-verdict-binding-required/context.json"],
        issuedAt: requiredIssuedAt,
        signerKeyId: arbiterRegistration.keyId,
        signature: requiredSignature
      }
    }
  });
  assert.equal(issueRequired.statusCode, 409, issueRequired.body);
  assert.equal(issueRequired.json?.code, "X402_ARBITRATION_VERDICT_BINDING_EVIDENCE_REQUIRED");

  const mismatchScenario = await setupCase({
    seed: "mismatch_1",
    verifyRequestSha256: "7".repeat(64),
    disputeEvidenceRefs: [`http:request_sha256:${"7".repeat(64)}`, `http:request_sha256:${"8".repeat(64)}`],
    arbitrationCaseEvidenceRefs: [`http:request_sha256:${"7".repeat(64)}`]
  });
  overwriteArbitrationCaseEvidenceRefs(api, {
    caseId: mismatchScenario.caseId,
    evidenceRefs: [`http:request_sha256:${"8".repeat(64)}`]
  });
  const mismatchIssuedAt = "2026-02-06T00:00:00.000Z";
  const mismatchVerdictCore = normalizeForCanonicalJson(
    {
      schemaVersion: "ArbitrationVerdict.v1",
      verdictId: "arb_vrd_x402_arb_verdict_binding_mismatch_1",
      caseId: mismatchScenario.caseId,
      tenantId: "tenant_default",
      runId: mismatchScenario.runId,
      settlementId: mismatchScenario.settlementId,
      disputeId: mismatchScenario.disputeId,
      arbiterAgentId: "agt_x402_arb_verdict_binding_arbiter_1",
      outcome: "accepted",
      releaseRatePct: 100,
      rationale: "mismatched request hash should fail",
      evidenceRefs: [`http:request_sha256:${"8".repeat(64)}`],
      issuedAt: mismatchIssuedAt,
      appealRef: null
    },
    { path: "$" }
  );
  const mismatchVerdictHash = sha256Hex(canonicalJsonStringify(mismatchVerdictCore));
  const mismatchSignature = signHashHexEd25519(mismatchVerdictHash, arbiterKeypair.privateKeyPem);
  const issueMismatch = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(mismatchScenario.runId)}/arbitration/verdict`,
    headers: { "x-idempotency-key": "x402_arb_verdict_binding_mismatch_1" },
    body: {
      caseId: mismatchScenario.caseId,
      arbitrationVerdict: {
        caseId: mismatchScenario.caseId,
        verdictId: "arb_vrd_x402_arb_verdict_binding_mismatch_1",
        arbiterAgentId: "agt_x402_arb_verdict_binding_arbiter_1",
        outcome: "accepted",
        releaseRatePct: 100,
        rationale: "mismatched request hash should fail",
        evidenceRefs: [`http:request_sha256:${"8".repeat(64)}`],
        issuedAt: mismatchIssuedAt,
        signerKeyId: arbiterRegistration.keyId,
        signature: mismatchSignature
      }
    }
  });
  assert.equal(issueMismatch.statusCode, 409, issueMismatch.body);
  assert.equal(issueMismatch.json?.code, "X402_ARBITRATION_VERDICT_BINDING_EVIDENCE_MISMATCH");
});

test("API e2e: run arbitration appeal fails closed on missing or mismatched settlement request-hash evidence", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const payer = await registerAgent(api, { agentId: "agt_x402_arb_appeal_binding_payer_1" });
  const payee = await registerAgent(api, { agentId: "agt_x402_arb_appeal_binding_payee_1" });
  const operator = await registerAgent(api, { agentId: "agt_x402_arb_appeal_binding_operator_1" });
  const arbiterKeypair = createEd25519Keypair();
  const arbiterRegistration = await registerAgent(api, {
    agentId: "agt_x402_arb_appeal_binding_arbiter_1",
    publicKeyPem: arbiterKeypair.publicKeyPem
  });
  await creditWallet(api, { agentId: payer.agentId, amountCents: 7000, idempotencyKey: "wallet_credit_x402_arb_appeal_binding_1" });

  async function setupParentCase({ seed, verifyRequestSha256, disputeEvidenceRefs, verdictEvidenceRefs }) {
    const gateId = `x402gate_arb_appeal_binding_${seed}`;
    const created = await request(api, {
      method: "POST",
      path: "/x402/gate/create",
      headers: { "x-idempotency-key": `x402_gate_create_arb_appeal_binding_${seed}` },
      body: {
        gateId,
        payerAgentId: payer.agentId,
        payeeAgentId: payee.agentId,
        amountCents: 750,
        currency: "USD",
        toolId: "mock_search",
        disputeWindowDays: 2
      }
    });
    assert.equal(created.statusCode, 201, created.body);

    const authorized = await request(api, {
      method: "POST",
      path: "/x402/gate/authorize-payment",
      headers: { "x-idempotency-key": `x402_gate_authorize_arb_appeal_binding_${seed}` },
      body: { gateId }
    });
    assert.equal(authorized.statusCode, 200, authorized.body);

    const verify = await request(api, {
      method: "POST",
      path: "/x402/gate/verify",
      headers: { "x-idempotency-key": `x402_gate_verify_arb_appeal_binding_${seed}` },
      body: {
        gateId,
        verificationStatus: "green",
        runStatus: "completed",
        policy: autoPolicy100(),
        verificationMethod: { mode: "deterministic", source: "http_status_v1" },
        evidenceRefs: [`http:request_sha256:${verifyRequestSha256}`, `http:response_sha256:${"e".repeat(64)}`]
      }
    });
    assert.equal(verify.statusCode, 200, verify.body);

    const gateRead = await request(api, { method: "GET", path: `/x402/gate/${encodeURIComponent(gateId)}` });
    assert.equal(gateRead.statusCode, 200, gateRead.body);
    const runId = gateRead.json?.settlement?.runId;
    const settlementId = gateRead.json?.settlement?.settlementId;
    assert.ok(typeof runId === "string" && runId.length > 0);

    const disputeId = `dsp_x402_arb_appeal_binding_${seed}`;
    const parentCaseId = `arb_case_x402_arb_appeal_binding_${seed}`;
    const parentVerdictId = `arb_vrd_x402_arb_appeal_binding_${seed}`;
    const openDispute = await request(api, {
      method: "POST",
      path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
      headers: { "x-idempotency-key": `x402_dispute_open_arb_appeal_binding_${seed}` },
      body: {
        disputeId,
        disputeType: "quality",
        disputePriority: "high",
        disputeChannel: "arbiter",
        escalationLevel: "l2_arbiter",
        openedByAgentId: operator.agentId,
        reason: "arbitration appeal binding check",
        evidenceRefs: disputeEvidenceRefs
      }
    });
    assert.equal(openDispute.statusCode, 200, openDispute.body);

    const openArbitration = await request(api, {
      method: "POST",
      path: `/runs/${encodeURIComponent(runId)}/arbitration/open`,
      headers: { "x-idempotency-key": `x402_arb_open_appeal_binding_${seed}` },
      body: {
        caseId: parentCaseId,
        disputeId,
        arbiterAgentId: "agt_x402_arb_appeal_binding_arbiter_1",
        evidenceRefs: verdictEvidenceRefs
      }
    });
    assert.equal(openArbitration.statusCode, 201, openArbitration.body);

    const issuedAt = "2026-02-06T00:00:00.000Z";
    const verdictCore = normalizeForCanonicalJson(
      {
        schemaVersion: "ArbitrationVerdict.v1",
        verdictId: parentVerdictId,
        caseId: parentCaseId,
        tenantId: "tenant_default",
        runId,
        settlementId,
        disputeId,
        arbiterAgentId: "agt_x402_arb_appeal_binding_arbiter_1",
        outcome: "accepted",
        releaseRatePct: 100,
        rationale: "parent verdict",
        evidenceRefs: verdictEvidenceRefs,
        issuedAt,
        appealRef: null
      },
      { path: "$" }
    );
    const verdictHash = sha256Hex(canonicalJsonStringify(verdictCore));
    const signature = signHashHexEd25519(verdictHash, arbiterKeypair.privateKeyPem);
    const issueVerdict = await request(api, {
      method: "POST",
      path: `/runs/${encodeURIComponent(runId)}/arbitration/verdict`,
      headers: { "x-idempotency-key": `x402_arb_verdict_appeal_binding_${seed}` },
      body: {
        caseId: parentCaseId,
        arbitrationVerdict: {
          caseId: parentCaseId,
          verdictId: parentVerdictId,
          arbiterAgentId: "agt_x402_arb_appeal_binding_arbiter_1",
          outcome: "accepted",
          releaseRatePct: 100,
          rationale: "parent verdict",
          evidenceRefs: verdictEvidenceRefs,
          issuedAt,
          signerKeyId: arbiterRegistration.keyId,
          signature
        }
      }
    });
    assert.equal(issueVerdict.statusCode, 200, issueVerdict.body);

    return { runId, parentCaseId };
  }

  const requiredScenario = await setupParentCase({
    seed: "required_1",
    verifyRequestSha256: "9".repeat(64),
    disputeEvidenceRefs: [`http:request_sha256:${"9".repeat(64)}`, "evidence://x402/arb-appeal-binding-required/context.json"],
    verdictEvidenceRefs: [`http:request_sha256:${"9".repeat(64)}`]
  });
  const appealRequired = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(requiredScenario.runId)}/arbitration/appeal`,
    headers: { "x-idempotency-key": "x402_arb_appeal_binding_required_1" },
    body: {
      caseId: "arb_case_x402_arb_appeal_binding_required_1_child",
      parentCaseId: requiredScenario.parentCaseId,
      reason: "missing request hash should fail",
      panelCandidateAgentIds: ["agt_x402_arb_appeal_binding_arbiter_1"],
      evidenceRefs: ["evidence://x402/arb-appeal-binding-required/context.json"]
    }
  });
  assert.equal(appealRequired.statusCode, 409, appealRequired.body);
  assert.equal(appealRequired.json?.code, "X402_ARBITRATION_APPEAL_BINDING_EVIDENCE_REQUIRED");

  const mismatchScenario = await setupParentCase({
    seed: "mismatch_1",
    verifyRequestSha256: "a".repeat(64),
    disputeEvidenceRefs: [
      `http:request_sha256:${"a".repeat(64)}`,
      `http:request_sha256:${"b".repeat(64)}`,
      "evidence://x402/arb-appeal-binding-mismatch/context.json"
    ],
    verdictEvidenceRefs: [`http:request_sha256:${"a".repeat(64)}`]
  });
  const appealMismatch = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(mismatchScenario.runId)}/arbitration/appeal`,
    headers: { "x-idempotency-key": "x402_arb_appeal_binding_mismatch_1" },
    body: {
      caseId: "arb_case_x402_arb_appeal_binding_mismatch_1_child",
      parentCaseId: mismatchScenario.parentCaseId,
      reason: "mismatched request hash should fail",
      panelCandidateAgentIds: ["agt_x402_arb_appeal_binding_arbiter_1"],
      evidenceRefs: [`http:request_sha256:${"b".repeat(64)}`]
    }
  });
  assert.equal(appealMismatch.statusCode, 409, appealMismatch.body);
  assert.equal(appealMismatch.json?.code, "X402_ARBITRATION_APPEAL_BINDING_EVIDENCE_MISMATCH");
});

test("API e2e: x402 reversal enforces wallet policy allowedReversalActions", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const payer = await registerAgent(api, { agentId: "agt_x402_reversal_policy_payer_1" });
  const payee = await registerAgent(api, { agentId: "agt_x402_reversal_policy_payee_1" });
  await creditWallet(api, { agentId: payer.agentId, amountCents: 5000, idempotencyKey: "wallet_credit_x402_reversal_policy_1" });

  const policy = {
    schemaVersion: "X402WalletPolicy.v1",
    sponsorRef: "sponsor_reversal_policy_1",
    sponsorWalletRef: "wallet_reversal_policy_1",
    policyRef: "policy_reversal_1",
    policyVersion: 3,
    status: "active",
    allowedReversalActions: ["request_refund"],
    requireQuote: false,
    requireStrictRequestBinding: false,
    requireAgentKeyMatch: false
  };
  const upsertedPolicy = await upsertX402WalletPolicy(api, {
    policy,
    idempotencyKey: "x402_wallet_policy_reversal_upsert_1"
  });
  assert.equal(upsertedPolicy.statusCode, 201, upsertedPolicy.body);

  const gateId = "x402gate_reversal_policy_1";
  const amountCents = 500;
  const created = await request(api, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_create_reversal_policy_1" },
    body: {
      gateId,
      payerAgentId: payer.agentId,
      payeeAgentId: payee.agentId,
      amountCents,
      currency: "USD",
      toolId: "mock_search",
      agentPassport: {
        sponsorRef: policy.sponsorRef,
        sponsorWalletRef: policy.sponsorWalletRef,
        agentKeyId: payer.agentId,
        delegationRef: "delegation_reversal_policy_1",
        policyRef: policy.policyRef,
        policyVersion: policy.policyVersion
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const authorized = await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_authorize_reversal_policy_1" },
    body: { gateId }
  });
  assert.equal(authorized.statusCode, 409, authorized.body);
  assert.equal(authorized.json?.code, "X402_WALLET_ISSUER_DECISION_REQUIRED");

  const issuerDecision = await issueWalletAuthorizationDecision(api, {
    sponsorWalletRef: policy.sponsorWalletRef,
    gateId,
    idempotencyKey: "x402_wallet_issuer_reversal_policy_1"
  });
  assert.equal(issuerDecision.statusCode, 200, issuerDecision.body);

  const authorizedWithDecision = await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_authorize_reversal_policy_1_with_decision" },
    body: {
      gateId,
      walletAuthorizationDecisionToken: issuerDecision.json?.walletAuthorizationDecisionToken
    }
  });
  assert.equal(authorizedWithDecision.statusCode, 200, authorizedWithDecision.body);

  const bindings = await loadReversalBindings(api, { gateId, payerAgentId: payer.agentId });
  const voidCommand = signReversalCommand({
    payer,
    gateId,
    receiptId: bindings.receiptId,
    quoteId: bindings.quoteId,
    requestSha256: bindings.requestSha256,
    sponsorRef: bindings.sponsorRef,
    action: "void_authorization",
    commandId: "cmd_reversal_policy_void_1",
    idempotencyKey: "idem_reversal_policy_void_1",
    nonce: "nonce_reversal_policy_void_1"
  });
  const blocked = await request(api, {
    method: "POST",
    path: "/x402/gate/reversal",
    headers: { "x-idempotency-key": "x402_gate_reversal_policy_void_1" },
    body: {
      gateId,
      action: "void_authorization",
      reason: "operator_cancelled",
      command: voidCommand
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_WALLET_POLICY_REVERSAL_ACTION_NOT_ALLOWED");
});
