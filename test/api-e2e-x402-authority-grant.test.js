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

async function createGate(api, { gateId, payerAgentId, payeeAgentId, amountCents, authorityGrantRef }) {
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
      authorityGrantRef
    }
  });
  return response;
}

async function authorizeGate(api, { gateId, idempotencyKey, extraBody = null }) {
  return await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": idempotencyKey },
    body: {
      gateId,
      ...(extraBody && typeof extraBody === "object" && !Array.isArray(extraBody) ? extraBody : {})
    }
  });
}

async function verifyGateReleased(api, { gateId, idempotencyKey }) {
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
      verificationMethod: { mode: "deterministic", source: "authority_grant_test_v1" },
      evidenceRefs: [`http:request_sha256:${requestSha256}`, `http:response_sha256:${responseSha256}`]
    }
  });
}

test("API e2e: AuthorityGrant.v1 routes + x402 authorization enforcement", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const payerAgentId = await registerAgent(api, { agentId: "agt_x402_agrant_payer_1" });
  const payeeAgentId = await registerAgent(api, { agentId: "agt_x402_agrant_payee_1" });
  const otherPayerAgentId = await registerAgent(api, { agentId: "agt_x402_agrant_payer_2" });
  await creditWallet(api, {
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "wallet_credit_x402_agrant_1"
  });
  await creditWallet(api, {
    agentId: otherPayerAgentId,
    amountCents: 1_000,
    idempotencyKey: "wallet_credit_x402_agrant_2"
  });

  const issueGrant = await request(api, {
    method: "POST",
    path: "/authority-grants",
    headers: { "x-idempotency-key": "authority_grant_issue_1" },
    body: {
      grantId: "agrant_x402_1",
      principalRef: {
        principalType: "org",
        principalId: "org_acme"
      },
      granteeAgentId: payerAgentId,
      scope: {
        allowedProviderIds: [payeeAgentId],
        allowedToolIds: ["mock_weather"],
        allowedRiskClasses: ["financial"],
        sideEffectingAllowed: true
      },
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 400,
        maxTotalCents: 600
      },
      chainBinding: {
        depth: 0,
        maxDelegationDepth: 1
      },
      validity: {
        issuedAt: "2026-02-24T00:00:00.000Z",
        notBefore: "2026-02-24T00:00:00.000Z",
        expiresAt: "2027-02-24T00:00:00.000Z"
      }
    }
  });
  assert.equal(issueGrant.statusCode, 201, issueGrant.body);
  assert.equal(issueGrant.json?.authorityGrant?.grantId, "agrant_x402_1");

  const listed = await request(api, {
    method: "GET",
    path: `/authority-grants?granteeAgentId=${encodeURIComponent(payerAgentId)}&includeRevoked=false`
  });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(Array.isArray(listed.json?.grants), true);
  assert.equal(listed.json.grants.length, 1);

  const okGate = await createGate(api, {
    gateId: "gate_x402_agrant_ok_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 300,
    authorityGrantRef: "agrant_x402_1"
  });
  assert.equal(okGate.statusCode, 201, okGate.body);

  const authorizeOk = await authorizeGate(api, {
    gateId: "gate_x402_agrant_ok_1",
    idempotencyKey: "x402_gate_authorize_agrant_ok_1"
  });
  assert.equal(authorizeOk.statusCode, 200, authorizeOk.body);
  assert.equal(authorizeOk.json?.authorityGrantRef, "agrant_x402_1");

  const verifyOk = await verifyGateReleased(api, {
    gateId: "gate_x402_agrant_ok_1",
    idempotencyKey: "x402_gate_verify_agrant_ok_1"
  });
  assert.equal(verifyOk.statusCode, 200, verifyOk.body);
  assert.equal(verifyOk.json?.settlement?.status, "released");

  const blockedPerCall = await createGate(api, {
    gateId: "gate_x402_agrant_per_call_block_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 500,
    authorityGrantRef: "agrant_x402_1"
  });
  assert.equal(blockedPerCall.statusCode, 409, blockedPerCall.body);
  assert.equal(blockedPerCall.json?.code, "X402_AUTHORITY_GRANT_PER_CALL_EXCEEDED");

  const blockedTotal = await createGate(api, {
    gateId: "gate_x402_agrant_total_block_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 350,
    authorityGrantRef: "agrant_x402_1"
  });
  assert.equal(blockedTotal.statusCode, 409, blockedTotal.body);
  assert.equal(blockedTotal.json?.code, "X402_AUTHORITY_GRANT_TOTAL_EXCEEDED");

  const actorMismatch = await createGate(api, {
    gateId: "gate_x402_agrant_actor_mismatch_1",
    payerAgentId: otherPayerAgentId,
    payeeAgentId,
    amountCents: 100,
    authorityGrantRef: "agrant_x402_1"
  });
  assert.equal(actorMismatch.statusCode, 409, actorMismatch.body);
  assert.equal(actorMismatch.json?.code, "X402_AUTHORITY_GRANT_ACTOR_MISMATCH");

  const revokeGrant = await request(api, {
    method: "POST",
    path: "/authority-grants/agrant_x402_1/revoke",
    headers: { "x-idempotency-key": "authority_grant_revoke_1" },
    body: {
      revocationReasonCode: "MANUAL_REVOKE"
    }
  });
  assert.equal(revokeGrant.statusCode, 200, revokeGrant.body);
  assert.equal(typeof revokeGrant.json?.authorityGrant?.revocation?.revokedAt, "string");

  const blockedRevoked = await createGate(api, {
    gateId: "gate_x402_agrant_revoked_block_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 100,
    authorityGrantRef: "agrant_x402_1"
  });
  assert.equal(blockedRevoked.statusCode, 409, blockedRevoked.body);
  assert.equal(blockedRevoked.json?.code, "X402_AUTHORITY_GRANT_REVOKED");
});

test("API e2e: x402 authorize-payment fails closed for authority grant validity windows", async () => {
  let nowAt = "2026-02-24T00:10:00.000Z";
  const api = createApi({
    opsToken: "tok_ops",
    now: () => nowAt
  });

  const payerAgentId = await registerAgent(api, { agentId: "agt_x402_agrant_window_payer_1" });
  const payeeAgentId = await registerAgent(api, { agentId: "agt_x402_agrant_window_payee_1" });
  await creditWallet(api, {
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "wallet_credit_x402_agrant_window_1"
  });

  const issueFutureGrant = await request(api, {
    method: "POST",
    path: "/authority-grants",
    headers: { "x-idempotency-key": "authority_grant_issue_window_future_1" },
    body: {
      grantId: "agrant_x402_window_future_1",
      principalRef: {
        principalType: "org",
        principalId: "org_acme"
      },
      granteeAgentId: payerAgentId,
      scope: {
        allowedProviderIds: [payeeAgentId],
        allowedToolIds: ["mock_weather"],
        allowedRiskClasses: ["financial"],
        sideEffectingAllowed: true
      },
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 800,
        maxTotalCents: 4_000
      },
      chainBinding: {
        depth: 0,
        maxDelegationDepth: 1
      },
      validity: {
        issuedAt: "2026-02-24T00:00:00.000Z",
        notBefore: "2026-02-24T01:00:00.000Z",
        expiresAt: "2026-02-24T02:00:00.000Z"
      }
    }
  });
  assert.equal(issueFutureGrant.statusCode, 201, issueFutureGrant.body);

  const gateNotActive = await createGate(api, {
    gateId: "gate_x402_agrant_window_not_active_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 200
  });
  assert.equal(gateNotActive.statusCode, 201, gateNotActive.body);

  nowAt = "2026-02-24T00:30:00.000Z";
  const blockedNotActive = await authorizeGate(api, {
    gateId: "gate_x402_agrant_window_not_active_1",
    idempotencyKey: "x402_gate_authorize_agrant_window_not_active_1",
    extraBody: {
      authorityGrantRef: "agrant_x402_window_future_1"
    }
  });
  assert.equal(blockedNotActive.statusCode, 409, blockedNotActive.body);
  assert.equal(blockedNotActive.json?.code, "X402_AUTHORITY_GRANT_NOT_ACTIVE");

  const issueExpiringGrant = await request(api, {
    method: "POST",
    path: "/authority-grants",
    headers: { "x-idempotency-key": "authority_grant_issue_window_expire_1" },
    body: {
      grantId: "agrant_x402_window_expire_1",
      principalRef: {
        principalType: "org",
        principalId: "org_acme"
      },
      granteeAgentId: payerAgentId,
      scope: {
        allowedProviderIds: [payeeAgentId],
        allowedToolIds: ["mock_weather"],
        allowedRiskClasses: ["financial"],
        sideEffectingAllowed: true
      },
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 800,
        maxTotalCents: 4_000
      },
      chainBinding: {
        depth: 0,
        maxDelegationDepth: 1
      },
      validity: {
        issuedAt: "2026-02-24T00:00:00.000Z",
        notBefore: "2026-02-24T00:00:00.000Z",
        expiresAt: "2026-02-24T00:45:00.000Z"
      }
    }
  });
  assert.equal(issueExpiringGrant.statusCode, 201, issueExpiringGrant.body);

  const gateExpiresBeforeAuthorize = await createGate(api, {
    gateId: "gate_x402_agrant_window_expired_1",
    payerAgentId,
    payeeAgentId,
    amountCents: 200,
    authorityGrantRef: "agrant_x402_window_expire_1"
  });
  assert.equal(gateExpiresBeforeAuthorize.statusCode, 201, gateExpiresBeforeAuthorize.body);

  nowAt = "2026-02-24T00:46:00.000Z";
  const blockedExpired = await authorizeGate(api, {
    gateId: "gate_x402_agrant_window_expired_1",
    idempotencyKey: "x402_gate_authorize_agrant_window_expired_1"
  });
  assert.equal(blockedExpired.statusCode, 409, blockedExpired.body);
  assert.equal(blockedExpired.json?.code, "X402_AUTHORITY_GRANT_EXPIRED");
});
