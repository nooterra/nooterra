import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair, sha256Hex } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
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
  return agentId;
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

async function createGate(api, { gateId, payerAgentId, payeeAgentId, amountCents, delegationGrantRef }) {
  const response = await request(api, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": `x402_gate_create_${gateId}` },
    body: {
      gateId,
      payerAgentId,
      payeeAgentId,
      amountCents,
      currency: "USD",
      toolId: "mock_weather",
      delegationGrantRef
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json?.gate ?? null;
}

async function authorizeGate(api, { gateId, idempotencyKey, extraBody = null }) {
  return await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": idempotencyKey },
    body: {
      gateId,
      ...(extraBody && typeof extraBody === "object" ? extraBody : {})
    }
  });
}

async function setX402AgentLifecycle(
  api,
  { agentId, status, idempotencyKey, reasonCode = null, reasonMessage = null }
) {
  return await request(api, {
    method: "POST",
    path: `/x402/gate/agents/${encodeURIComponent(agentId)}/lifecycle`,
    headers: {
      "x-idempotency-key": idempotencyKey,
      "x-settld-protocol": "1.0"
    },
    body: {
      status,
      ...(reasonCode ? { reasonCode } : {}),
      ...(reasonMessage ? { reasonMessage } : {})
    }
  });
}

async function createTaintedSession(api, { sessionId, participantAgentId }) {
  const created = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: { "x-idempotency-key": `session_create_${sessionId}` },
    body: {
      sessionId,
      visibility: "tenant",
      participants: [participantAgentId]
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const tainted = await request(api, {
    method: "POST",
    path: `/sessions/${encodeURIComponent(sessionId)}/events`,
    headers: {
      "x-idempotency-key": `session_taint_event_${sessionId}`,
      "x-proxy-expected-prev-chain-hash": "null"
    },
    body: {
      eventType: "MESSAGE",
      payload: { text: "untrusted prompt payload" },
      provenance: { label: "external" }
    }
  });
  assert.equal(tainted.statusCode, 201, tainted.body);
  assert.equal(tainted.json?.event?.payload?.provenance?.isTainted, true);
  const eventId = typeof tainted.json?.event?.id === "string" ? tainted.json.event.id : null;
  const chainHash = typeof tainted.json?.event?.chainHash === "string" ? tainted.json.event.chainHash : null;
  const evidenceRefs = [];
  if (eventId) evidenceRefs.push(`session:event:${eventId}`);
  if (chainHash) evidenceRefs.push(`session:chain:${chainHash}`);
  return {
    sessionRef: sessionId,
    eventId,
    chainHash,
    evidenceRefs
  };
}

async function verifyGateReleased(api, { gateId, idempotencyKey, extraBody = null }) {
  const requestSha256 = sha256Hex(`request:${gateId}`);
  const responseSha256 = sha256Hex(`response:${gateId}`);
  return await request(api, {
    method: "POST",
    path: "/x402/gate/verify",
    headers: { "x-idempotency-key": idempotencyKey },
    body: {
      gateId,
      verificationStatus: "green",
      runStatus: "completed",
      policy: {
        mode: "automatic",
        rules: {
          autoReleaseOnGreen: true,
          greenReleaseRatePct: 100,
          autoReleaseOnAmber: false,
          amberReleaseRatePct: 0,
          autoReleaseOnRed: true,
          redReleaseRatePct: 0
        }
      },
      verificationMethod: { mode: "deterministic", source: "delegation_grant_test_v1" },
      evidenceRefs: [`http:request_sha256:${requestSha256}`, `http:response_sha256:${responseSha256}`],
      ...(extraBody && typeof extraBody === "object" ? extraBody : {})
    }
  });
}

test("API e2e: DelegationGrant.v1 routes + x402 authorization enforcement", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const payerAgentId = await registerAgent(api, { agentId: "agt_x402_dgrant_payer_1" });
  const payeeAgentId = await registerAgent(api, { agentId: "agt_x402_dgrant_payee_1" });
  await creditWallet(api, {
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "wallet_credit_x402_dgrant_1"
  });

  const issueGrant = await request(api, {
    method: "POST",
    path: "/delegation-grants",
    headers: { "x-idempotency-key": "delegation_grant_issue_1" },
    body: {
      grantId: "dgrant_x402_1",
      delegatorAgentId: "agt_manager_1",
      delegateeAgentId: payerAgentId,
      scope: {
        allowedProviderIds: [payeeAgentId],
        allowedToolIds: ["mock_weather"],
        allowedRiskClasses: ["financial"],
        sideEffectingAllowed: true
      },
      spendLimit: {
        currency: "USD",
        maxPerCallCents: 400,
        maxTotalCents: 600
      },
      chainBinding: {
        depth: 0,
        maxDelegationDepth: 1
      },
      validity: {
        issuedAt: "2026-02-23T00:00:00.000Z",
        notBefore: "2026-02-23T00:00:00.000Z",
        expiresAt: "2027-02-23T00:00:00.000Z"
      }
    }
  });
  assert.equal(issueGrant.statusCode, 201, issueGrant.body);
  assert.equal(issueGrant.json?.delegationGrant?.grantId, "dgrant_x402_1");

  const listed = await request(api, {
    method: "GET",
    path: `/delegation-grants?delegateeAgentId=${encodeURIComponent(payerAgentId)}&includeRevoked=false`
  });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(Array.isArray(listed.json?.grants), true);
  assert.equal(listed.json.grants.length, 1);

  await createGate(api, {
    gateId: "gate_x402_dgrant_ok_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 300,
    delegationGrantRef: "dgrant_x402_1"
  });

  const authorizeOk = await authorizeGate(api, {
    gateId: "gate_x402_dgrant_ok_1",
    idempotencyKey: "x402_gate_authorize_dgrant_ok_1"
  });
  assert.equal(authorizeOk.statusCode, 200, authorizeOk.body);
  assert.equal(authorizeOk.json?.delegationGrantRef, "dgrant_x402_1");

  const verifyOk = await verifyGateReleased(api, {
    gateId: "gate_x402_dgrant_ok_1",
    idempotencyKey: "x402_gate_verify_dgrant_ok_1"
  });
  assert.equal(verifyOk.statusCode, 200, verifyOk.body);
  assert.equal(verifyOk.json?.settlement?.status, "released");
  assert.equal(verifyOk.json?.decisionRecord?.bindings?.spendAuthorization?.delegationGrantRef, "dgrant_x402_1");

  await createGate(api, {
    gateId: "gate_x402_dgrant_per_call_block_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 500,
    delegationGrantRef: "dgrant_x402_1"
  });

  const blockedPerCall = await authorizeGate(api, {
    gateId: "gate_x402_dgrant_per_call_block_1",
    idempotencyKey: "x402_gate_authorize_dgrant_per_call_block_1"
  });
  assert.equal(blockedPerCall.statusCode, 409, blockedPerCall.body);
  assert.equal(blockedPerCall.json?.code, "X402_DELEGATION_GRANT_PER_CALL_EXCEEDED");

  await createGate(api, {
    gateId: "gate_x402_dgrant_total_block_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 350,
    delegationGrantRef: "dgrant_x402_1"
  });

  const blockedTotal = await authorizeGate(api, {
    gateId: "gate_x402_dgrant_total_block_1",
    idempotencyKey: "x402_gate_authorize_dgrant_total_block_1"
  });
  assert.equal(blockedTotal.statusCode, 409, blockedTotal.body);
  assert.equal(blockedTotal.json?.code, "X402_DELEGATION_GRANT_TOTAL_EXCEEDED");

  const revokeGrant = await request(api, {
    method: "POST",
    path: "/delegation-grants/dgrant_x402_1/revoke",
    headers: { "x-idempotency-key": "delegation_grant_revoke_1" },
    body: {
      revocationReasonCode: "MANUAL_REVOKE"
    }
  });
  assert.equal(revokeGrant.statusCode, 200, revokeGrant.body);
  assert.equal(typeof revokeGrant.json?.delegationGrant?.revocation?.revokedAt, "string");

  await createGate(api, {
    gateId: "gate_x402_dgrant_revoked_block_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 100,
    delegationGrantRef: "dgrant_x402_1"
  });

  const blockedRevoked = await authorizeGate(api, {
    gateId: "gate_x402_dgrant_revoked_block_1",
    idempotencyKey: "x402_gate_authorize_dgrant_revoked_block_1"
  });
  assert.equal(blockedRevoked.statusCode, 409, blockedRevoked.body);
  assert.equal(blockedRevoked.json?.code, "X402_DELEGATION_GRANT_REVOKED");
});

test("API e2e: delegation grant issue fails closed when delegator or delegatee lifecycle is non-active", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const delegatorAgentId = "agt_dgrant_lifecycle_delegator_1";
  const delegateeAgentId = "agt_dgrant_lifecycle_delegatee_1";

  await registerAgent(api, { agentId: delegatorAgentId });
  await registerAgent(api, { agentId: delegateeAgentId });

  const suspendDelegator = await setX402AgentLifecycle(api, {
    agentId: delegatorAgentId,
    status: "suspended",
    reasonCode: "X402_AGENT_SUSPENDED_MANUAL",
    idempotencyKey: "dgrant_lifecycle_suspend_delegator_1"
  });
  assert.equal(suspendDelegator.statusCode, 200, suspendDelegator.body);
  assert.equal(suspendDelegator.json?.lifecycle?.status, "suspended");

  const blockedDelegator = await request(api, {
    method: "POST",
    path: "/delegation-grants",
    headers: { "x-idempotency-key": "delegation_grant_issue_lifecycle_block_delegator_1" },
    body: {
      grantId: "dgrant_lifecycle_block_delegator_1",
      delegatorAgentId,
      delegateeAgentId,
      scope: {
        allowedRiskClasses: ["financial"],
        sideEffectingAllowed: true
      },
      spendLimit: {
        currency: "USD",
        maxPerCallCents: 400,
        maxTotalCents: 1_000
      },
      validity: {
        issuedAt: "2026-02-26T00:00:00.000Z",
        notBefore: "2026-02-26T00:00:00.000Z",
        expiresAt: "2027-02-26T00:00:00.000Z"
      }
    }
  });
  assert.equal(blockedDelegator.statusCode, 410, blockedDelegator.body);
  assert.equal(blockedDelegator.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedDelegator.json?.details?.role, "delegator");
  assert.equal(blockedDelegator.json?.details?.operation, "delegation_grant.issue");

  const reactivateDelegator = await setX402AgentLifecycle(api, {
    agentId: delegatorAgentId,
    status: "active",
    reasonCode: "X402_AGENT_ACTIVE_MANUAL",
    idempotencyKey: "dgrant_lifecycle_reactivate_delegator_1"
  });
  assert.equal(reactivateDelegator.statusCode, 200, reactivateDelegator.body);
  assert.equal(reactivateDelegator.json?.lifecycle?.status, "active");

  const throttleDelegatee = await setX402AgentLifecycle(api, {
    agentId: delegateeAgentId,
    status: "throttled",
    reasonCode: "X402_AGENT_THROTTLED_MANUAL",
    idempotencyKey: "dgrant_lifecycle_throttle_delegatee_1"
  });
  assert.equal(throttleDelegatee.statusCode, 200, throttleDelegatee.body);
  assert.equal(throttleDelegatee.json?.lifecycle?.status, "throttled");

  const blockedDelegatee = await request(api, {
    method: "POST",
    path: "/delegation-grants",
    headers: { "x-idempotency-key": "delegation_grant_issue_lifecycle_block_delegatee_1" },
    body: {
      grantId: "dgrant_lifecycle_block_delegatee_1",
      delegatorAgentId,
      delegateeAgentId,
      scope: {
        allowedRiskClasses: ["financial"],
        sideEffectingAllowed: true
      },
      spendLimit: {
        currency: "USD",
        maxPerCallCents: 400,
        maxTotalCents: 1_000
      },
      validity: {
        issuedAt: "2026-02-26T00:00:00.000Z",
        notBefore: "2026-02-26T00:00:00.000Z",
        expiresAt: "2027-02-26T00:00:00.000Z"
      }
    }
  });
  assert.equal(blockedDelegatee.statusCode, 429, blockedDelegatee.body);
  assert.equal(blockedDelegatee.json?.code, "X402_AGENT_THROTTLED");
  assert.equal(blockedDelegatee.json?.details?.role, "delegatee");
  assert.equal(blockedDelegatee.json?.details?.operation, "delegation_grant.issue");
});

test("API e2e: x402 prompt risk forced challenge blocks authorize unless override is recorded", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    x402PromptRiskForceMode: "challenge"
  });

  const payerAgentId = await registerAgent(api, { agentId: "agt_x402_prompt_force_payer_1" });
  const payeeAgentId = await registerAgent(api, { agentId: "agt_x402_prompt_force_payee_1" });
  await creditWallet(api, {
    agentId: payerAgentId,
    amountCents: 2_000,
    idempotencyKey: "wallet_credit_x402_prompt_force_1"
  });

  await createGate(api, {
    gateId: "gate_x402_prompt_force_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 300
  });

  const blocked = await authorizeGate(api, {
    gateId: "gate_x402_prompt_force_1",
    idempotencyKey: "x402_gate_authorize_prompt_force_block_1"
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_PROMPT_RISK_FORCE_CHALLENGE");

  const overridePass = await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_authorize_prompt_force_override_1" },
    body: {
      gateId: "gate_x402_prompt_force_1",
      promptRiskOverride: {
        enabled: true,
        reason: "human-approved for trusted run",
        ticketRef: "INC-2508"
      }
    }
  });
  assert.equal(overridePass.statusCode, 200, overridePass.body);
  assert.equal(typeof overridePass.json?.authorizationRef, "string");
});

test("API e2e: suspicious x402 verify cannot release until human override is recorded", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const payerAgentId = await registerAgent(api, { agentId: "agt_x402_prompt_verify_payer_1" });
  const payeeAgentId = await registerAgent(api, { agentId: "agt_x402_prompt_verify_payee_1" });
  await creditWallet(api, {
    agentId: payerAgentId,
    amountCents: 5_000,
    idempotencyKey: "wallet_credit_x402_prompt_verify_1"
  });

  await createGate(api, {
    gateId: "gate_x402_prompt_verify_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 350
  });

  const authorized = await authorizeGate(api, {
    gateId: "gate_x402_prompt_verify_1",
    idempotencyKey: "x402_gate_authorize_prompt_verify_1"
  });
  assert.equal(authorized.statusCode, 200, authorized.body);

  const blockedVerify = await verifyGateReleased(api, {
    gateId: "gate_x402_prompt_verify_1",
    idempotencyKey: "x402_gate_verify_prompt_verify_block_1",
    extraBody: {
      promptRiskSignals: {
        promptContagion: true,
        reasonCodes: ["PROMPT_CONTAGION_DETECTED"]
      }
    }
  });
  assert.equal(blockedVerify.statusCode, 409, blockedVerify.body);
  assert.equal(blockedVerify.json?.code, "X402_PROMPT_RISK_OVERRIDE_REQUIRED");

  const releasedWithOverride = await verifyGateReleased(api, {
    gateId: "gate_x402_prompt_verify_1",
    idempotencyKey: "x402_gate_verify_prompt_verify_override_1",
    extraBody: {
      promptRiskSignals: {
        promptContagion: true,
        reasonCodes: ["PROMPT_CONTAGION_DETECTED"]
      },
      promptRiskOverride: {
        enabled: true,
        reason: "human override after manual review",
        ticketRef: "INC-2508-OVERRIDE"
      }
    }
  });
  assert.equal(releasedWithOverride.statusCode, 200, releasedWithOverride.body);
  assert.equal(releasedWithOverride.json?.settlement?.status, "released");
  assert.equal(releasedWithOverride.json?.gate?.promptRisk?.suspicious, true);
  assert.equal(releasedWithOverride.json?.gate?.promptRisk?.override?.enabled, true);
});

test("API e2e: x402 prompt risk forced mode can target a specific principal", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    x402PromptRiskForceModeByPrincipal: {
      "legacy_ops:tok_ops": "escalate"
    }
  });

  const payerAgentId = await registerAgent(api, { agentId: "agt_x402_prompt_principal_payer_1" });
  const payeeAgentId = await registerAgent(api, { agentId: "agt_x402_prompt_principal_payee_1" });
  await creditWallet(api, {
    agentId: payerAgentId,
    amountCents: 2_000,
    idempotencyKey: "wallet_credit_x402_prompt_principal_1"
  });

  await createGate(api, {
    gateId: "gate_x402_prompt_principal_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 250
  });

  const blockedForPrincipal = await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: {
      "x-idempotency-key": "x402_gate_authorize_prompt_principal_block_1",
      "x-proxy-ops-token": "tok_ops"
    },
    body: {
      gateId: "gate_x402_prompt_principal_1"
    }
  });
  assert.equal(blockedForPrincipal.statusCode, 409, blockedForPrincipal.body);
  assert.equal(blockedForPrincipal.json?.code, "X402_PROMPT_RISK_FORCE_ESCALATE");
});

test("API e2e: tainted session provenance forces challenge on x402 authorize below escalation threshold", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    x402SessionTaintEscalateAmountCents: 1_000
  });
  const payerAgentId = await registerAgent(api, { agentId: "agt_x402_taint_challenge_payer_1" });
  const payeeAgentId = await registerAgent(api, { agentId: "agt_x402_taint_challenge_payee_1" });
  await creditWallet(api, {
    agentId: payerAgentId,
    amountCents: 5_000,
    idempotencyKey: "wallet_credit_x402_taint_challenge_1"
  });
  await createTaintedSession(api, {
    sessionId: "sess_x402_taint_challenge_1",
    participantAgentId: payerAgentId
  });
  await createGate(api, {
    gateId: "gate_x402_taint_challenge_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 300
  });

  const blocked = await authorizeGate(api, {
    gateId: "gate_x402_taint_challenge_1",
    idempotencyKey: "x402_gate_authorize_taint_challenge_1",
    extraBody: { sessionRef: "sess_x402_taint_challenge_1" }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_PROMPT_RISK_FORCE_CHALLENGE");

  const overridePass = await authorizeGate(api, {
    gateId: "gate_x402_taint_challenge_1",
    idempotencyKey: "x402_gate_authorize_taint_challenge_override_1",
    extraBody: {
      sessionRef: "sess_x402_taint_challenge_1",
      promptRiskOverride: {
        enabled: true,
        reason: "human reviewed tainted chain and approved",
        ticketRef: "INC-TAINT-1"
      }
    }
  });
  assert.equal(overridePass.statusCode, 200, overridePass.body);
  assert.equal(overridePass.json?.sessionRef, "sess_x402_taint_challenge_1");
});

test("API e2e: tainted session provenance forces escalate on x402 authorize above escalation threshold", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    x402SessionTaintEscalateAmountCents: 500
  });
  const payerAgentId = await registerAgent(api, { agentId: "agt_x402_taint_escalate_payer_1" });
  const payeeAgentId = await registerAgent(api, { agentId: "agt_x402_taint_escalate_payee_1" });
  await creditWallet(api, {
    agentId: payerAgentId,
    amountCents: 5_000,
    idempotencyKey: "wallet_credit_x402_taint_escalate_1"
  });
  await createTaintedSession(api, {
    sessionId: "sess_x402_taint_escalate_1",
    participantAgentId: payerAgentId
  });
  await createGate(api, {
    gateId: "gate_x402_taint_escalate_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 900
  });

  const blocked = await authorizeGate(api, {
    gateId: "gate_x402_taint_escalate_1",
    idempotencyKey: "x402_gate_authorize_taint_escalate_1",
    extraBody: { sessionRef: "sess_x402_taint_escalate_1" }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_PROMPT_RISK_FORCE_ESCALATE");
});

test("API e2e: tainted session verify fails closed until provenance evidence refs are submitted", async () => {
  const api = createApi({
    opsToken: "tok_ops",
    x402SessionTaintEscalateAmountCents: 1_000
  });
  const payerAgentId = await registerAgent(api, { agentId: "agt_x402_taint_verify_payer_1" });
  const payeeAgentId = await registerAgent(api, { agentId: "agt_x402_taint_verify_payee_1" });
  await creditWallet(api, {
    agentId: payerAgentId,
    amountCents: 5_000,
    idempotencyKey: "wallet_credit_x402_taint_verify_1"
  });
  const taintedSession = await createTaintedSession(api, {
    sessionId: "sess_x402_taint_verify_1",
    participantAgentId: payerAgentId
  });
  await createGate(api, {
    gateId: "gate_x402_taint_verify_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 300
  });

  const authorizeWithOverride = await authorizeGate(api, {
    gateId: "gate_x402_taint_verify_1",
    idempotencyKey: "x402_gate_authorize_taint_verify_override_1",
    extraBody: {
      sessionRef: taintedSession.sessionRef,
      promptRiskOverride: {
        enabled: true,
        reason: "human reviewed tainted chain and approved",
        ticketRef: "INC-TAINT-VERIFY-1"
      }
    }
  });
  assert.equal(authorizeWithOverride.statusCode, 200, authorizeWithOverride.body);

  const blockedMissingProvenanceEvidence = await verifyGateReleased(api, {
    gateId: "gate_x402_taint_verify_1",
    idempotencyKey: "x402_gate_verify_taint_evidence_blocked_1",
    extraBody: {
      sessionRef: taintedSession.sessionRef,
      promptRiskOverride: {
        enabled: true,
        reason: "manual review complete",
        ticketRef: "INC-TAINT-VERIFY-2"
      }
    }
  });
  assert.equal(blockedMissingProvenanceEvidence.statusCode, 409, blockedMissingProvenanceEvidence.body);
  assert.equal(blockedMissingProvenanceEvidence.json?.code, "X402_PROMPT_RISK_EVIDENCE_REQUIRED");
  assert.deepEqual(
    [...(blockedMissingProvenanceEvidence.json?.details?.missingEvidenceRefs ?? [])].sort((a, b) => a.localeCompare(b)),
    [...taintedSession.evidenceRefs].sort((a, b) => a.localeCompare(b))
  );

  const requestSha256 = sha256Hex("request:gate_x402_taint_verify_1");
  const responseSha256 = sha256Hex("response:gate_x402_taint_verify_1");
  const blockedPartialProvenanceEvidence = await verifyGateReleased(api, {
    gateId: "gate_x402_taint_verify_1",
    idempotencyKey: "x402_gate_verify_taint_evidence_blocked_partial_1",
    extraBody: {
      sessionRef: taintedSession.sessionRef,
      promptRiskOverride: {
        enabled: true,
        reason: "manual review complete",
        ticketRef: "INC-TAINT-VERIFY-2B"
      },
      evidenceRefs: [
        `http:request_sha256:${requestSha256}`,
        `http:response_sha256:${responseSha256}`,
        taintedSession.evidenceRefs[0]
      ]
    }
  });
  assert.equal(blockedPartialProvenanceEvidence.statusCode, 409, blockedPartialProvenanceEvidence.body);
  assert.equal(blockedPartialProvenanceEvidence.json?.code, "X402_PROMPT_RISK_EVIDENCE_REQUIRED");
  const expectedMissingPartialEvidence = taintedSession.evidenceRefs
    .filter((value) => value !== taintedSession.evidenceRefs[0])
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(
    [...(blockedPartialProvenanceEvidence.json?.details?.missingEvidenceRefs ?? [])].sort((a, b) => a.localeCompare(b)),
    expectedMissingPartialEvidence
  );
  const releasedWithProvenanceEvidence = await verifyGateReleased(api, {
    gateId: "gate_x402_taint_verify_1",
    idempotencyKey: "x402_gate_verify_taint_evidence_pass_1",
    extraBody: {
      sessionRef: taintedSession.sessionRef,
      promptRiskOverride: {
        enabled: true,
        reason: "manual review complete with provenance evidence",
        ticketRef: "INC-TAINT-VERIFY-3"
      },
      evidenceRefs: [
        `http:request_sha256:${requestSha256}`,
        `http:response_sha256:${responseSha256}`,
        ...taintedSession.evidenceRefs
      ]
    }
  });
  assert.equal(releasedWithProvenanceEvidence.statusCode, 200, releasedWithProvenanceEvidence.body);
  assert.equal(releasedWithProvenanceEvidence.json?.settlement?.status, "released");
});
