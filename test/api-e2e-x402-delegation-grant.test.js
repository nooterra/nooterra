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

async function authorizeGate(api, { gateId, idempotencyKey }) {
  return await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": idempotencyKey },
    body: { gateId }
  });
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
