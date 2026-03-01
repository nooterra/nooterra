import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createStore } from "../src/api/store.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
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
  assert.equal(response.statusCode, 201, response.body);
}

async function registerAgentWithKey(api, { agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
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
  assert.equal(response.statusCode, 201, response.body);
  return { agentId, keyId: keyIdFromPublicKeyPem(publicKeyPem), publicKeyPem };
}

async function registerSignerKey(api, { keyId, publicKeyPem, purpose = "robot", description = "test signer key" }) {
  const response = await request(api, {
    method: "POST",
    path: "/ops/signer-keys",
    body: {
      keyId,
      publicKeyPem,
      purpose,
      status: "active",
      description
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json?.signerKey?.keyId, keyId);
}

async function rotateSignerKey(api, { keyId }) {
  const response = await request(api, {
    method: "POST",
    path: `/ops/signer-keys/${encodeURIComponent(keyId)}/rotate`,
    body: {}
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json?.signerKey?.status, "rotated");
}

async function revokeSignerKey(api, { keyId }) {
  const response = await request(api, {
    method: "POST",
    path: `/ops/signer-keys/${encodeURIComponent(keyId)}/revoke`,
    body: {}
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json?.signerKey?.status, "revoked");
}

async function issueAuthorityGrant(
  api,
  {
    grantId,
    granteeAgentId,
    maxPerCallCents = 10_000,
    maxTotalCents = 100_000,
    scope = null,
    chainBinding = null,
    validity = null
  }
) {
  const resolvedScope =
    scope && typeof scope === "object" && !Array.isArray(scope)
      ? scope
      : {
          sideEffectingAllowed: true,
          allowedRiskClasses: ["financial"]
        };
  const resolvedChainBinding =
    chainBinding && typeof chainBinding === "object" && !Array.isArray(chainBinding)
      ? chainBinding
      : {
          depth: 0,
          maxDelegationDepth: 2
        };
  const resolvedValidity =
    validity && typeof validity === "object" && !Array.isArray(validity)
      ? validity
      : {
          issuedAt: "2026-02-25T00:00:00.000Z",
          notBefore: "2026-02-25T00:00:00.000Z",
          expiresAt: "2027-02-25T00:00:00.000Z"
        };
  const response = await request(api, {
    method: "POST",
    path: "/authority-grants",
    headers: { "x-idempotency-key": `authority_grant_issue_${grantId}` },
    body: {
      grantId,
      principalRef: {
        principalType: "org",
        principalId: "org_test"
      },
      granteeAgentId,
      scope: resolvedScope,
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents,
        maxTotalCents
      },
      chainBinding: resolvedChainBinding,
      validity: resolvedValidity
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json?.authorityGrant ?? null;
}

async function issueDelegationGrant(
  api,
  {
    grantId,
    delegatorAgentId,
    delegateeAgentId,
    maxPerCallCents = 10_000,
    maxTotalCents = 100_000,
    scope = null,
    chainBinding = null,
    validity = null
  }
) {
  const resolvedScope =
    scope && typeof scope === "object" && !Array.isArray(scope)
      ? scope
      : {
          sideEffectingAllowed: true,
          allowedRiskClasses: ["financial"]
        };
  const resolvedChainBinding =
    chainBinding && typeof chainBinding === "object" && !Array.isArray(chainBinding)
      ? chainBinding
      : {
          depth: 0,
          maxDelegationDepth: 1
        };
  const resolvedValidity =
    validity && typeof validity === "object" && !Array.isArray(validity)
      ? validity
      : {
          issuedAt: "2026-02-25T00:00:00.000Z",
          notBefore: "2026-02-25T00:00:00.000Z",
          expiresAt: "2027-02-25T00:00:00.000Z"
        };
  const response = await request(api, {
    method: "POST",
    path: "/delegation-grants",
    headers: { "x-idempotency-key": `delegation_grant_issue_${grantId}` },
    body: {
      grantId,
      delegatorAgentId,
      delegateeAgentId,
      scope: resolvedScope,
      spendLimit: {
        currency: "USD",
        maxPerCallCents,
        maxTotalCents
      },
      chainBinding: resolvedChainBinding,
      validity: resolvedValidity
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json?.delegationGrant ?? null;
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

async function setX402AgentLifecycle(
  api,
  { agentId, status, idempotencyKey, reasonCode = null, reasonMessage = null }
) {
  return await request(api, {
    method: "POST",
    path: `/x402/gate/agents/${encodeURIComponent(agentId)}/lifecycle`,
    headers: {
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

test("API e2e: x402 gate create fails closed without authority grant when required", async () => {
  const api = createApi({ x402RequireAuthorityGrant: true });
  const payerAgentId = "agt_auth_required_gate_create_payer_1";
  const payeeAgentId = "agt_auth_required_gate_create_payee_1";
  await registerAgent(api, { agentId: payerAgentId });
  await registerAgent(api, { agentId: payeeAgentId });

  const blocked = await request(api, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_create_required_missing_1" },
    body: {
      gateId: "x402gate_auth_required_create_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 450,
      currency: "USD",
      autoFundPayerCents: 5_000
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_GRANT_REQUIRED");

  const grant = await issueAuthorityGrant(api, {
    grantId: "agrant_auth_required_create_1",
    granteeAgentId: payerAgentId
  });

  const allowed = await request(api, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_create_required_ok_1" },
    body: {
      gateId: "x402gate_auth_required_create_2",
      payerAgentId,
      payeeAgentId,
      amountCents: 450,
      currency: "USD",
      autoFundPayerCents: 5_000,
      authorityGrantRef: grant.grantId
    }
  });
  assert.equal(allowed.statusCode, 201, allowed.body);
  assert.equal(allowed.json?.gate?.authorityGrantRef, grant.grantId);
});

test("API e2e: authority grant issue fails closed when grantee lifecycle is non-active", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const granteeAgentId = "agt_authority_grant_lifecycle_grantee_1";
  await registerAgent(api, { agentId: granteeAgentId });

  const suspendGrantee = await setX402AgentLifecycle(api, {
    agentId: granteeAgentId,
    status: "suspended",
    reasonCode: "X402_AGENT_SUSPENDED_MANUAL",
    idempotencyKey: "authority_grant_lifecycle_suspend_1"
  });
  assert.equal(suspendGrantee.statusCode, 200, suspendGrantee.body);
  assert.equal(suspendGrantee.json?.lifecycle?.status, "suspended");

  const blockedSuspended = await request(api, {
    method: "POST",
    path: "/authority-grants",
    headers: { "x-idempotency-key": "authority_grant_issue_lifecycle_block_suspended_1" },
    body: {
      grantId: "agrant_lifecycle_block_suspended_1",
      principalRef: {
        principalType: "org",
        principalId: "org_test"
      },
      granteeAgentId,
      scope: {
        sideEffectingAllowed: true,
        allowedRiskClasses: ["financial"]
      },
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 2_000,
        maxTotalCents: 20_000
      },
      chainBinding: {
        depth: 0,
        maxDelegationDepth: 1
      },
      validity: {
        issuedAt: "2026-02-26T00:00:00.000Z",
        notBefore: "2026-02-26T00:00:00.000Z",
        expiresAt: "2027-02-26T00:00:00.000Z"
      }
    }
  });
  assert.equal(blockedSuspended.statusCode, 410, blockedSuspended.body);
  assert.equal(blockedSuspended.json?.code, "X402_AGENT_SUSPENDED");
  assert.equal(blockedSuspended.json?.details?.role, "grantee");
  assert.equal(blockedSuspended.json?.details?.operation, "authority_grant.issue");

  const reactivateGrantee = await setX402AgentLifecycle(api, {
    agentId: granteeAgentId,
    status: "active",
    reasonCode: "X402_AGENT_ACTIVE_MANUAL",
    idempotencyKey: "authority_grant_lifecycle_reactivate_1"
  });
  assert.equal(reactivateGrantee.statusCode, 200, reactivateGrantee.body);
  assert.equal(reactivateGrantee.json?.lifecycle?.status, "active");

  const throttleGrantee = await setX402AgentLifecycle(api, {
    agentId: granteeAgentId,
    status: "throttled",
    reasonCode: "X402_AGENT_THROTTLED_MANUAL",
    idempotencyKey: "authority_grant_lifecycle_throttle_1"
  });
  assert.equal(throttleGrantee.statusCode, 200, throttleGrantee.body);
  assert.equal(throttleGrantee.json?.lifecycle?.status, "throttled");

  const blockedThrottled = await request(api, {
    method: "POST",
    path: "/authority-grants",
    headers: { "x-idempotency-key": "authority_grant_issue_lifecycle_block_throttled_1" },
    body: {
      grantId: "agrant_lifecycle_block_throttled_1",
      principalRef: {
        principalType: "org",
        principalId: "org_test"
      },
      granteeAgentId,
      scope: {
        sideEffectingAllowed: true,
        allowedRiskClasses: ["financial"]
      },
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 2_000,
        maxTotalCents: 20_000
      },
      chainBinding: {
        depth: 0,
        maxDelegationDepth: 1
      },
      validity: {
        issuedAt: "2026-02-26T00:00:00.000Z",
        notBefore: "2026-02-26T00:00:00.000Z",
        expiresAt: "2027-02-26T00:00:00.000Z"
      }
    }
  });
  assert.equal(blockedThrottled.statusCode, 429, blockedThrottled.body);
  assert.equal(blockedThrottled.json?.code, "X402_AGENT_THROTTLED");
  assert.equal(blockedThrottled.json?.details?.role, "grantee");
  assert.equal(blockedThrottled.json?.details?.operation, "authority_grant.issue");
});

test("API e2e: authority grant revoke writes deterministic reason metadata when reason is omitted", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const granteeAgentId = "agt_authority_reason_default_grantee_1";
  await registerAgent(api, { agentId: granteeAgentId });

  const authorityGrant = await issueAuthorityGrant(api, {
    grantId: "agrant_reason_default_1",
    granteeAgentId
  });

  const revoked = await request(api, {
    method: "POST",
    path: `/authority-grants/${encodeURIComponent(authorityGrant.grantId)}/revoke`,
    headers: { "x-idempotency-key": "authority_grant_reason_default_revoke_1" },
    body: {}
  });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal(
    revoked.json?.authorityGrant?.revocation?.revocationReasonCode,
    "AUTHORITY_GRANT_REVOKED_UNSPECIFIED"
  );
});

test("API e2e: authority grant issue fails closed when grantee signer lifecycle is non-active", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const grantee = await registerAgentWithKey(api, { agentId: "agt_authority_signer_issue_grantee_1" });
  await registerSignerKey(api, {
    keyId: grantee.keyId,
    publicKeyPem: grantee.publicKeyPem,
    description: "authority issue signer lifecycle test"
  });
  await revokeSignerKey(api, { keyId: grantee.keyId });

  const blocked = await request(api, {
    method: "POST",
    path: "/authority-grants",
    headers: { "x-idempotency-key": "authority_grant_issue_signer_blocked_1" },
    body: {
      grantId: "agrant_signer_issue_blocked_1",
      principalRef: {
        principalType: "org",
        principalId: "org_test"
      },
      granteeAgentId: grantee.agentId,
      scope: {
        sideEffectingAllowed: true,
        allowedRiskClasses: ["financial"]
      },
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 2_000,
        maxTotalCents: 20_000
      },
      chainBinding: {
        depth: 0,
        maxDelegationDepth: 1
      },
      validity: {
        issuedAt: "2026-02-26T00:00:00.000Z",
        notBefore: "2026-02-26T00:00:00.000Z",
        expiresAt: "2027-02-26T00:00:00.000Z"
      }
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_GRANT_SIGNER_KEY_INVALID");
  assert.equal(blocked.json?.details?.operation, "authority_grant.issue");
  assert.equal(blocked.json?.details?.role, "grantee");
  assert.equal(blocked.json?.details?.reasonCode, "SIGNER_KEY_REVOKED");
  assert.equal(blocked.json?.details?.signerStatus, "revoked");
});

test("API e2e: x402 authorize fails closed without authority grant when required", async () => {
  const store = createStore();
  const setupApi = createApi({ store, x402RequireAuthorityGrant: false });
  const policyApi = createApi({ store, x402RequireAuthorityGrant: true });
  const payerAgentId = "agt_auth_required_authorize_payer_1";
  const payeeAgentId = "agt_auth_required_authorize_payee_1";
  await registerAgent(setupApi, { agentId: payerAgentId });
  await registerAgent(setupApi, { agentId: payeeAgentId });

  const created = await request(setupApi, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_authorize_required_create_1" },
    body: {
      gateId: "x402gate_auth_required_authorize_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 500,
      currency: "USD",
      autoFundPayerCents: 5_000
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const blocked = await request(policyApi, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_authorize_required_missing_1" },
    body: {
      gateId: "x402gate_auth_required_authorize_1"
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_GRANT_REQUIRED");

  const grant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_required_authorize_1",
    granteeAgentId: payerAgentId
  });

  const allowed = await request(policyApi, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_authorize_required_ok_1" },
    body: {
      gateId: "x402gate_auth_required_authorize_1",
      authorityGrantRef: grant.grantId
    }
  });
  assert.equal(allowed.statusCode, 200, allowed.body);
  assert.equal(allowed.json?.authorityGrantRef, grant.grantId);
});

test("API e2e: x402 authorize fails closed when authority grant grantee signer lifecycle is non-active", async () => {
  const api = createApi({ x402RequireAuthorityGrant: true, opsToken: "tok_ops" });
  const payer = await registerAgentWithKey(api, { agentId: "agt_auth_signer_authorize_payer_1" });
  const payeeAgentId = "agt_auth_signer_authorize_payee_1";
  await registerAgent(api, { agentId: payeeAgentId });
  await creditWallet(api, {
    agentId: payer.agentId,
    amountCents: 8_000,
    idempotencyKey: "wallet_credit_auth_signer_authorize_1"
  });

  const grant = await issueAuthorityGrant(api, {
    grantId: "agrant_auth_signer_authorize_1",
    granteeAgentId: payer.agentId
  });

  const created = await request(api, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_auth_signer_authorize_create_1" },
    body: {
      gateId: "x402gate_auth_signer_authorize_1",
      payerAgentId: payer.agentId,
      payeeAgentId,
      amountCents: 500,
      currency: "USD",
      authorityGrantRef: grant.grantId
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  await registerSignerKey(api, {
    keyId: payer.keyId,
    publicKeyPem: payer.publicKeyPem,
    description: "authority authorize signer lifecycle test"
  });
  await rotateSignerKey(api, { keyId: payer.keyId });

  const blocked = await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_auth_signer_authorize_blocked_1" },
    body: {
      gateId: "x402gate_auth_signer_authorize_1"
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_GRANT_SIGNER_KEY_INVALID");
  assert.equal(blocked.json?.details?.details?.operation, "authority_grant.authorize");
  assert.equal(blocked.json?.details?.details?.role, "grantee");
  assert.equal(blocked.json?.details?.details?.reasonCode, "SIGNER_KEY_NOT_ACTIVE");
  assert.equal(blocked.json?.details?.details?.signerStatus, "rotated");
});

test("API e2e: x402 authorize fails closed when delegation scope exceeds authority scope", async () => {
  const store = createStore();
  const setupApi = createApi({ store, x402RequireAuthorityGrant: false });
  const policyApi = createApi({ store, x402RequireAuthorityGrant: true });
  const payerAgentId = "agt_auth_scope_escalate_payer_1";
  const payeeAgentId = "agt_auth_scope_escalate_payee_1";
  await registerAgent(setupApi, { agentId: payerAgentId });
  await registerAgent(setupApi, { agentId: payeeAgentId });
  await creditWallet(setupApi, {
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "wallet_credit_auth_scope_escalate_1"
  });

  const delegationGrant = await issueDelegationGrant(setupApi, {
    grantId: "dgrant_auth_scope_escalate_1",
    delegatorAgentId: "agt_auth_scope_escalate_manager_1",
    delegateeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"]
    },
    maxPerCallCents: 1_000,
    maxTotalCents: 20_000
  });

  const created = await request(setupApi, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_auth_scope_escalate_create_1" },
    body: {
      gateId: "x402gate_auth_scope_escalate_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 300,
      currency: "USD",
      toolId: "mock_weather",
      delegationGrantRef: delegationGrant.grantId
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const authorityGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_scope_escalate_1",
    granteeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    maxPerCallCents: 800,
    maxTotalCents: 10_000
  });

  const blocked = await request(policyApi, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_auth_scope_escalate_authorize_1" },
    body: {
      gateId: "x402gate_auth_scope_escalate_1",
      authorityGrantRef: authorityGrant.grantId
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_DELEGATION_SCOPE_ESCALATION");
  assert.equal(blocked.json?.details?.details?.field, "scope.allowedProviderIds");
});

test("API e2e: x402 authorize fails closed when authority root grant is missing", async () => {
  const store = createStore();
  const setupApi = createApi({ store, x402RequireAuthorityGrant: false });
  const policyApi = createApi({ store, x402RequireAuthorityGrant: true });
  const payerAgentId = "agt_auth_root_missing_payer_1";
  const payeeAgentId = "agt_auth_root_missing_payee_1";
  const missingRootHash = "a".repeat(64);

  await registerAgent(setupApi, { agentId: payerAgentId });
  await registerAgent(setupApi, { agentId: payeeAgentId });
  await creditWallet(setupApi, {
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "wallet_credit_auth_root_missing_1"
  });

  const authorityGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_missing_child_1",
    granteeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: missingRootHash,
      parentGrantHash: "b".repeat(64),
      depth: 1,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const delegationGrant = await issueDelegationGrant(setupApi, {
    grantId: "dgrant_auth_root_missing_1",
    delegatorAgentId: "agt_auth_root_missing_manager_1",
    delegateeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: missingRootHash,
      parentGrantHash: authorityGrant.grantHash,
      depth: 2,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const created = await request(setupApi, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_auth_root_missing_create_1" },
    body: {
      gateId: "x402gate_auth_root_missing_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 300,
      currency: "USD",
      toolId: "mock_weather",
      delegationGrantRef: delegationGrant.grantId
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const blocked = await request(policyApi, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_auth_root_missing_authorize_1" },
    body: {
      gateId: "x402gate_auth_root_missing_1",
      authorityGrantRef: authorityGrant.grantId
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_DELEGATION_ROOT_NOT_FOUND");
});

test("API e2e: x402 authorize fails closed when authority grant root hash is missing from chain binding", async () => {
  const store = createStore();
  const setupApi = createApi({ store, x402RequireAuthorityGrant: false });
  const policyApi = createApi({ store, x402RequireAuthorityGrant: true });
  const payerAgentId = "agt_auth_root_hash_missing_payer_1";
  const payeeAgentId = "agt_auth_root_hash_missing_payee_1";

  await registerAgent(setupApi, { agentId: payerAgentId });
  await registerAgent(setupApi, { agentId: payeeAgentId });
  await creditWallet(setupApi, {
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "wallet_credit_auth_root_hash_missing_1"
  });

  const rootAuthorityGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_hash_missing_root_1",
    granteeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      depth: 0,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });
  const rootAuthorityEntry =
    Array.from(store.authorityGrants.entries()).find(([, row]) => String(row?.grantId ?? "") === rootAuthorityGrant.grantId) ?? null;
  assert.ok(rootAuthorityEntry, "root authority grant should exist in store");
  store.authorityGrants.set(rootAuthorityEntry[0], {
    ...(rootAuthorityEntry[1] ?? {}),
    chainBinding: {
      ...((rootAuthorityEntry[1] ?? {})?.chainBinding ?? {}),
      rootGrantHash: null
    }
  });

  const delegationGrant = await issueDelegationGrant(setupApi, {
    grantId: "dgrant_auth_root_hash_missing_1",
    delegatorAgentId: "agt_auth_root_hash_missing_manager_1",
    delegateeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: rootAuthorityGrant.grantHash,
      parentGrantHash: rootAuthorityGrant.grantHash,
      depth: 1,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const created = await request(setupApi, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_auth_root_hash_missing_create_1" },
    body: {
      gateId: "x402gate_auth_root_hash_missing_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 300,
      currency: "USD",
      toolId: "mock_weather",
      delegationGrantRef: delegationGrant.grantId
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const blocked = await request(policyApi, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_auth_root_hash_missing_authorize_1" },
    body: {
      gateId: "x402gate_auth_root_hash_missing_1",
      authorityGrantRef: rootAuthorityGrant.grantId
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_GRANT_SCHEMA_INVALID");
});

test("API e2e: x402 authorize fails closed when authority/delegation root hashes mismatch", async () => {
  const store = createStore();
  const setupApi = createApi({ store, x402RequireAuthorityGrant: false });
  const policyApi = createApi({ store, x402RequireAuthorityGrant: true });
  const payerAgentId = "agt_auth_root_mismatch_payer_1";
  const payeeAgentId = "agt_auth_root_mismatch_payee_1";
  const delegationRootHash = "c".repeat(64);

  await registerAgent(setupApi, { agentId: payerAgentId });
  await registerAgent(setupApi, { agentId: payeeAgentId });
  await creditWallet(setupApi, {
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "wallet_credit_auth_root_mismatch_1"
  });

  const rootGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_mismatch_root_1",
    granteeAgentId: payerAgentId,
    scope: { sideEffectingAllowed: true, allowedRiskClasses: ["financial"] },
    chainBinding: { depth: 0, maxDelegationDepth: 2 },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-12-31T00:00:00.000Z"
    }
  });

  const authorityGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_mismatch_child_1",
    granteeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: rootGrant.grantHash,
      parentGrantHash: rootGrant.grantHash,
      depth: 1,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const delegationGrant = await issueDelegationGrant(setupApi, {
    grantId: "dgrant_auth_root_mismatch_1",
    delegatorAgentId: "agt_auth_root_mismatch_manager_1",
    delegateeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: delegationRootHash,
      parentGrantHash: authorityGrant.grantHash,
      depth: 2,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const created = await request(setupApi, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_auth_root_mismatch_create_1" },
    body: {
      gateId: "x402gate_auth_root_mismatch_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 300,
      currency: "USD",
      toolId: "mock_weather",
      delegationGrantRef: delegationGrant.grantId
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const blocked = await request(policyApi, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_auth_root_mismatch_authorize_1" },
    body: {
      gateId: "x402gate_auth_root_mismatch_1",
      authorityGrantRef: authorityGrant.grantId
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_DELEGATION_ROOT_MISMATCH");
});

test("API e2e: x402 authorize fails closed when authority root resolver is unavailable", async () => {
  const store = createStore();
  const setupApi = createApi({ store, x402RequireAuthorityGrant: false });
  const policyApi = createApi({ store, x402RequireAuthorityGrant: true });
  const payerAgentId = "agt_auth_root_resolver_missing_payer_1";
  const payeeAgentId = "agt_auth_root_resolver_missing_payee_1";

  await registerAgent(setupApi, { agentId: payerAgentId });
  await registerAgent(setupApi, { agentId: payeeAgentId });
  await creditWallet(setupApi, {
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "wallet_credit_auth_root_resolver_missing_1"
  });

  const rootGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_resolver_missing_root_1",
    granteeAgentId: payerAgentId,
    scope: { sideEffectingAllowed: true, allowedRiskClasses: ["financial"] },
    chainBinding: { depth: 0, maxDelegationDepth: 2 },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-12-31T00:00:00.000Z"
    }
  });

  const authorityGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_resolver_missing_child_1",
    granteeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: rootGrant.grantHash,
      parentGrantHash: rootGrant.grantHash,
      depth: 1,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const delegationGrant = await issueDelegationGrant(setupApi, {
    grantId: "dgrant_auth_root_resolver_missing_1",
    delegatorAgentId: "agt_auth_root_resolver_missing_manager_1",
    delegateeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: rootGrant.grantHash,
      parentGrantHash: authorityGrant.grantHash,
      depth: 2,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const created = await request(setupApi, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_auth_root_resolver_missing_create_1" },
    body: {
      gateId: "x402gate_auth_root_resolver_missing_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 300,
      currency: "USD",
      toolId: "mock_weather",
      delegationGrantRef: delegationGrant.grantId
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  store.listAuthorityGrants = undefined;

  const blocked = await request(policyApi, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_auth_root_resolver_missing_authorize_1" },
    body: {
      gateId: "x402gate_auth_root_resolver_missing_1",
      authorityGrantRef: authorityGrant.grantId
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_DELEGATION_ROOT_RESOLVER_UNAVAILABLE");
});

test("API e2e: x402 authorize fails closed when authority root grant hash resolves ambiguously", async () => {
  const store = createStore();
  const setupApi = createApi({ store, x402RequireAuthorityGrant: false });
  const policyApi = createApi({ store, x402RequireAuthorityGrant: true });
  const payerAgentId = "agt_auth_root_ambiguous_payer_1";
  const payeeAgentId = "agt_auth_root_ambiguous_payee_1";

  await registerAgent(setupApi, { agentId: payerAgentId });
  await registerAgent(setupApi, { agentId: payeeAgentId });
  await creditWallet(setupApi, {
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "wallet_credit_auth_root_ambiguous_1"
  });

  const rootGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_ambiguous_root_1",
    granteeAgentId: payerAgentId,
    scope: { sideEffectingAllowed: true, allowedRiskClasses: ["financial"] },
    chainBinding: { depth: 0, maxDelegationDepth: 2 },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-12-31T00:00:00.000Z"
    }
  });

  const rootEntry = Array.from(store.authorityGrants.entries()).find(([, row]) => String(row?.grantId ?? "") === rootGrant.grantId) ?? null;
  assert.ok(rootEntry, "root authority grant should exist in store");
  const duplicateRootKey = `tenant_default\n${rootGrant.grantId}_dup`;
  store.authorityGrants.set(duplicateRootKey, {
    ...(rootEntry[1] ?? {}),
    grantId: `${rootGrant.grantId}_dup`
  });

  const authorityGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_ambiguous_child_1",
    granteeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: rootGrant.grantHash,
      parentGrantHash: rootGrant.grantHash,
      depth: 1,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const delegationGrant = await issueDelegationGrant(setupApi, {
    grantId: "dgrant_auth_root_ambiguous_1",
    delegatorAgentId: "agt_auth_root_ambiguous_manager_1",
    delegateeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: rootGrant.grantHash,
      parentGrantHash: authorityGrant.grantHash,
      depth: 2,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const created = await request(setupApi, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_auth_root_ambiguous_create_1" },
    body: {
      gateId: "x402gate_auth_root_ambiguous_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 300,
      currency: "USD",
      toolId: "mock_weather",
      delegationGrantRef: delegationGrant.grantId
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const blocked = await request(policyApi, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_auth_root_ambiguous_authorize_1" },
    body: {
      gateId: "x402gate_auth_root_ambiguous_1",
      authorityGrantRef: authorityGrant.grantId
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_DELEGATION_ROOT_AMBIGUOUS");
});

test("API e2e: x402 authorize fails closed when authority root grant schema is invalid", async () => {
  const store = createStore();
  const setupApi = createApi({ store, x402RequireAuthorityGrant: false });
  const policyApi = createApi({ store, x402RequireAuthorityGrant: true });
  const payerAgentId = "agt_auth_root_schema_invalid_payer_1";
  const payeeAgentId = "agt_auth_root_schema_invalid_payee_1";

  await registerAgent(setupApi, { agentId: payerAgentId });
  await registerAgent(setupApi, { agentId: payeeAgentId });
  await creditWallet(setupApi, {
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "wallet_credit_auth_root_schema_invalid_1"
  });

  const rootGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_schema_invalid_root_1",
    granteeAgentId: payerAgentId,
    scope: { sideEffectingAllowed: true, allowedRiskClasses: ["financial"] },
    chainBinding: { depth: 0, maxDelegationDepth: 2 },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-12-31T00:00:00.000Z"
    }
  });

  const rootEntry = Array.from(store.authorityGrants.entries()).find(([, row]) => String(row?.grantId ?? "") === rootGrant.grantId) ?? null;
  assert.ok(rootEntry, "root authority grant should exist in store");
  store.authorityGrants.set(rootEntry[0], {
    ...(rootEntry[1] ?? {}),
    validity: {
      ...((rootEntry[1] ?? {})?.validity ?? {}),
      notBefore: "invalid-iso-not-before"
    }
  });

  const authorityGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_schema_invalid_child_1",
    granteeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: rootGrant.grantHash,
      parentGrantHash: rootGrant.grantHash,
      depth: 1,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const delegationGrant = await issueDelegationGrant(setupApi, {
    grantId: "dgrant_auth_root_schema_invalid_1",
    delegatorAgentId: "agt_auth_root_schema_invalid_manager_1",
    delegateeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: rootGrant.grantHash,
      parentGrantHash: authorityGrant.grantHash,
      depth: 2,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const created = await request(setupApi, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_auth_root_schema_invalid_create_1" },
    body: {
      gateId: "x402gate_auth_root_schema_invalid_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 300,
      currency: "USD",
      toolId: "mock_weather",
      delegationGrantRef: delegationGrant.grantId
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const blocked = await request(policyApi, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_auth_root_schema_invalid_authorize_1" },
    body: {
      gateId: "x402gate_auth_root_schema_invalid_1",
      authorityGrantRef: authorityGrant.grantId
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_DELEGATION_ROOT_SCHEMA_INVALID");
});

test("API e2e: x402 authorize fails closed when authority root grant is not active yet", async () => {
  const store = createStore();
  const setupApi = createApi({ store, x402RequireAuthorityGrant: false });
  const policyApi = createApi({ store, x402RequireAuthorityGrant: true });
  const payerAgentId = "agt_auth_root_not_active_payer_1";
  const payeeAgentId = "agt_auth_root_not_active_payee_1";

  await registerAgent(setupApi, { agentId: payerAgentId });
  await registerAgent(setupApi, { agentId: payeeAgentId });
  await creditWallet(setupApi, {
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "wallet_credit_auth_root_not_active_1"
  });

  const rootGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_not_active_root_1",
    granteeAgentId: payerAgentId,
    scope: { sideEffectingAllowed: true, allowedRiskClasses: ["financial"] },
    chainBinding: { depth: 0, maxDelegationDepth: 2 },
    validity: {
      issuedAt: "2027-01-01T00:00:00.000Z",
      notBefore: "2027-01-01T00:00:00.000Z",
      expiresAt: "2099-12-31T00:00:00.000Z"
    }
  });

  const authorityGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_not_active_child_1",
    granteeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: rootGrant.grantHash,
      parentGrantHash: rootGrant.grantHash,
      depth: 1,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const delegationGrant = await issueDelegationGrant(setupApi, {
    grantId: "dgrant_auth_root_not_active_1",
    delegatorAgentId: "agt_auth_root_not_active_manager_1",
    delegateeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: rootGrant.grantHash,
      parentGrantHash: authorityGrant.grantHash,
      depth: 2,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const created = await request(setupApi, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_auth_root_not_active_create_1" },
    body: {
      gateId: "x402gate_auth_root_not_active_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 300,
      currency: "USD",
      toolId: "mock_weather",
      delegationGrantRef: delegationGrant.grantId
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const blocked = await request(policyApi, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_auth_root_not_active_authorize_1" },
    body: {
      gateId: "x402gate_auth_root_not_active_1",
      authorityGrantRef: authorityGrant.grantId
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_DELEGATION_ROOT_NOT_ACTIVE");
});

test("API e2e: x402 authorize fails closed when authority root grant is expired", async () => {
  const store = createStore();
  const setupApi = createApi({ store, x402RequireAuthorityGrant: false });
  const policyApi = createApi({ store, x402RequireAuthorityGrant: true });
  const payerAgentId = "agt_auth_root_expired_payer_1";
  const payeeAgentId = "agt_auth_root_expired_payee_1";

  await registerAgent(setupApi, { agentId: payerAgentId });
  await registerAgent(setupApi, { agentId: payeeAgentId });
  await creditWallet(setupApi, {
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "wallet_credit_auth_root_expired_1"
  });

  const rootGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_expired_root_1",
    granteeAgentId: payerAgentId,
    scope: { sideEffectingAllowed: true, allowedRiskClasses: ["financial"] },
    chainBinding: { depth: 0, maxDelegationDepth: 2 },
    validity: {
      issuedAt: "2024-01-01T00:00:00.000Z",
      notBefore: "2024-01-01T00:00:00.000Z",
      expiresAt: "2024-12-31T00:00:00.000Z"
    }
  });
  const authorityGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_expired_child_1",
    granteeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: rootGrant.grantHash,
      parentGrantHash: rootGrant.grantHash,
      depth: 1,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });
  const delegationGrant = await issueDelegationGrant(setupApi, {
    grantId: "dgrant_auth_root_expired_1",
    delegatorAgentId: "agt_auth_root_expired_manager_1",
    delegateeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: rootGrant.grantHash,
      parentGrantHash: authorityGrant.grantHash,
      depth: 2,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const created = await request(setupApi, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_auth_root_expired_create_1" },
    body: {
      gateId: "x402gate_auth_root_expired_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 300,
      currency: "USD",
      toolId: "mock_weather",
      delegationGrantRef: delegationGrant.grantId
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const blocked = await request(policyApi, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_auth_root_expired_authorize_1" },
    body: {
      gateId: "x402gate_auth_root_expired_1",
      authorityGrantRef: authorityGrant.grantId
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_DELEGATION_ROOT_EXPIRED");
});

test("API e2e: x402 authorize fails closed when authority root grant is revoked", async () => {
  const store = createStore();
  const setupApi = createApi({ store, x402RequireAuthorityGrant: false });
  const policyApi = createApi({ store, x402RequireAuthorityGrant: true });
  const payerAgentId = "agt_auth_root_revoked_payer_1";
  const payeeAgentId = "agt_auth_root_revoked_payee_1";

  await registerAgent(setupApi, { agentId: payerAgentId });
  await registerAgent(setupApi, { agentId: payeeAgentId });
  await creditWallet(setupApi, {
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "wallet_credit_auth_root_revoked_1"
  });

  const rootGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_revoked_root_1",
    granteeAgentId: payerAgentId,
    scope: { sideEffectingAllowed: true, allowedRiskClasses: ["financial"] },
    chainBinding: { depth: 0, maxDelegationDepth: 2 },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });
  const revoked = await request(policyApi, {
    method: "POST",
    path: `/authority-grants/${encodeURIComponent(rootGrant.grantId)}/revoke`,
    headers: { "x-idempotency-key": "authority_grant_revoke_auth_root_revoked_1" },
    body: { revocationReasonCode: "MANUAL_REVOKE" }
  });
  assert.equal(revoked.statusCode, 200, revoked.body);
  const revokedRootHash = String(revoked.json?.authorityGrant?.grantHash ?? "");
  assert.match(revokedRootHash, /^[a-f0-9]{64}$/);

  const authorityGrantAfterRevoke = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_root_revoked_child_1",
    granteeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: revokedRootHash,
      parentGrantHash: revokedRootHash,
      depth: 1,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });
  const delegationGrant = await issueDelegationGrant(setupApi, {
    grantId: "dgrant_auth_root_revoked_1",
    delegatorAgentId: "agt_auth_root_revoked_manager_1",
    delegateeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: revokedRootHash,
      parentGrantHash: authorityGrantAfterRevoke.grantHash,
      depth: 2,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const created = await request(setupApi, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_auth_root_revoked_create_1" },
    body: {
      gateId: "x402gate_auth_root_revoked_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 300,
      currency: "USD",
      toolId: "mock_weather",
      delegationGrantRef: delegationGrant.grantId
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const blocked = await request(policyApi, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_auth_root_revoked_authorize_1" },
    body: {
      gateId: "x402gate_auth_root_revoked_1",
      authorityGrantRef: authorityGrantAfterRevoke.grantId
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_DELEGATION_ROOT_REVOKED");
});

test("API e2e: x402 authorize fails closed when delegation chain depth exceeds authority max depth", async () => {
  const store = createStore();
  const setupApi = createApi({ store, x402RequireAuthorityGrant: false });
  const policyApi = createApi({ store, x402RequireAuthorityGrant: true });
  const payerAgentId = "agt_auth_depth_overflow_payer_1";
  const payeeAgentId = "agt_auth_depth_overflow_payee_1";

  await registerAgent(setupApi, { agentId: payerAgentId });
  await registerAgent(setupApi, { agentId: payeeAgentId });
  await creditWallet(setupApi, {
    agentId: payerAgentId,
    amountCents: 10_000,
    idempotencyKey: "wallet_credit_auth_depth_overflow_1"
  });

  const authorityGrant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_depth_overflow_1",
    granteeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      depth: 0,
      maxDelegationDepth: 1
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });
  const delegationGrant = await issueDelegationGrant(setupApi, {
    grantId: "dgrant_auth_depth_overflow_1",
    delegatorAgentId: "agt_auth_depth_overflow_manager_1",
    delegateeAgentId: payerAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"]
    },
    chainBinding: {
      rootGrantHash: authorityGrant.grantHash,
      parentGrantHash: authorityGrant.grantHash,
      depth: 1,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const created = await request(setupApi, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_auth_depth_overflow_create_1" },
    body: {
      gateId: "x402gate_auth_depth_overflow_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 300,
      currency: "USD",
      toolId: "mock_weather",
      delegationGrantRef: delegationGrant.grantId
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const blocked = await request(policyApi, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_auth_depth_overflow_authorize_1" },
    body: {
      gateId: "x402gate_auth_depth_overflow_1",
      authorityGrantRef: authorityGrant.grantId
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_DELEGATION_SCOPE_ESCALATION");
  assert.equal(blocked.json?.details?.details?.field, "chainBinding.maxDelegationDepth");
});

test("API e2e: work order create fails closed without authority grant when required", async () => {
  const api = createApi({ x402RequireAuthorityGrant: true });
  const principalAgentId = "agt_auth_required_work_create_principal_1";
  const subAgentId = "agt_auth_required_work_create_sub_1";
  await registerAgent(api, { agentId: principalAgentId });
  await registerAgent(api, { agentId: subAgentId });

  const blocked = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_required_missing_1" },
    body: {
      workOrderId: "workord_auth_required_create_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      specification: { taskType: "codegen", prompt: "build parser" },
      pricing: { amountCents: 300, currency: "USD" }
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_GRANT_REQUIRED");

  const grant = await issueAuthorityGrant(api, {
    grantId: "agrant_auth_required_work_create_1",
    granteeAgentId: principalAgentId
  });

  const allowed = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_create_required_ok_1" },
    body: {
      workOrderId: "workord_auth_required_create_2",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      specification: { taskType: "codegen", prompt: "build parser" },
      pricing: { amountCents: 300, currency: "USD" },
      authorityGrantRef: grant.grantId
    }
  });
  assert.equal(allowed.statusCode, 201, allowed.body);
  assert.equal(allowed.json?.workOrder?.authorityGrantRef, grant.grantId);
});

test("API e2e: work order create fails closed when delegation scope exceeds authority scope", async () => {
  const api = createApi({ x402RequireAuthorityGrant: true });
  const principalAgentId = "agt_auth_scope_escalate_work_principal_1";
  const subAgentId = "agt_auth_scope_escalate_work_sub_1";
  await registerAgent(api, { agentId: principalAgentId });
  await registerAgent(api, { agentId: subAgentId });

  const delegationGrant = await issueDelegationGrant(api, {
    grantId: "dgrant_auth_scope_escalate_work_1",
    delegatorAgentId: "agt_auth_scope_escalate_work_manager_1",
    delegateeAgentId: principalAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"]
    },
    maxPerCallCents: 1_000,
    maxTotalCents: 20_000
  });
  const authorityGrant = await issueAuthorityGrant(api, {
    grantId: "agrant_auth_scope_escalate_work_1",
    granteeAgentId: principalAgentId,
    scope: {
      sideEffectingAllowed: true,
      allowedRiskClasses: ["financial"],
      allowedProviderIds: [subAgentId],
      allowedToolIds: [subAgentId]
    },
    maxPerCallCents: 900,
    maxTotalCents: 10_000
  });

  const blocked = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_auth_scope_escalate_create_1" },
    body: {
      workOrderId: "workord_auth_scope_escalate_create_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      x402ProviderId: subAgentId,
      x402ToolId: subAgentId,
      specification: { taskType: "codegen", prompt: "build parser" },
      pricing: { amountCents: 300, currency: "USD" },
      delegationGrantRef: delegationGrant.grantId,
      authorityGrantRef: authorityGrant.grantId
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_DELEGATION_SCOPE_ESCALATION");
  assert.equal(blocked.json?.details?.field, "scope.allowedProviderIds");
});

test("API e2e: work order settle fails closed without authority grant when required", async () => {
  const store = createStore();
  const setupApi = createApi({ store, x402RequireAuthorityGrant: false });
  const policyApi = createApi({ store, x402RequireAuthorityGrant: true });
  const principalAgentId = "agt_auth_required_work_settle_principal_1";
  const subAgentId = "agt_auth_required_work_settle_sub_1";
  await registerAgent(setupApi, { agentId: principalAgentId });
  await registerAgent(setupApi, { agentId: subAgentId });

  const created = await request(setupApi, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_settle_required_create_1" },
    body: {
      workOrderId: "workord_auth_required_settle_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      specification: { taskType: "codegen", prompt: "implement deterministic parser" },
      pricing: { amountCents: 350, currency: "USD" }
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const accepted = await request(setupApi, {
    method: "POST",
    path: "/work-orders/workord_auth_required_settle_1/accept",
    headers: { "x-idempotency-key": "work_order_settle_required_accept_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-25T00:10:00.000Z"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);

  const completed = await request(setupApi, {
    method: "POST",
    path: "/work-orders/workord_auth_required_settle_1/complete",
    headers: { "x-idempotency-key": "work_order_settle_required_complete_1" },
    body: {
      receiptId: "worec_auth_required_settle_1",
      status: "success",
      outputs: { artifactRef: "artifact://code/auth-required-settle-1" },
      evidenceRefs: ["artifact://code/auth-required-settle-1", "report://verification/auth-required-settle-1"],
      amountCents: 350,
      currency: "USD",
      deliveredAt: "2026-02-25T00:20:00.000Z"
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);
  const completionReceiptHash = completed.json?.completionReceipt?.receiptHash;
  assert.equal(typeof completionReceiptHash, "string");

  const blocked = await request(policyApi, {
    method: "POST",
    path: "/work-orders/workord_auth_required_settle_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_required_missing_1" },
    body: {
      completionReceiptId: "worec_auth_required_settle_1",
      completionReceiptHash,
      status: "released",
      x402GateId: "x402gate_auth_required_settle_1",
      x402RunId: "run_auth_required_settle_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_auth_required_settle_1",
      evidenceRefs: ["artifact://code/auth-required-settle-1", "report://verification/auth-required-settle-1"]
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_GRANT_REQUIRED");

  const grant = await issueAuthorityGrant(policyApi, {
    grantId: "agrant_auth_required_work_settle_1",
    granteeAgentId: principalAgentId
  });

  const allowed = await request(policyApi, {
    method: "POST",
    path: "/work-orders/workord_auth_required_settle_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_required_ok_1" },
    body: {
      completionReceiptId: "worec_auth_required_settle_1",
      completionReceiptHash,
      status: "released",
      x402GateId: "x402gate_auth_required_settle_1",
      x402RunId: "run_auth_required_settle_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_auth_required_settle_1",
      evidenceRefs: ["artifact://code/auth-required-settle-1", "report://verification/auth-required-settle-1"],
      authorityGrantRef: grant.grantId
    }
  });
  assert.equal(allowed.statusCode, 200, allowed.body);
  assert.equal(allowed.json?.workOrder?.settlement?.authorityGrantRef, grant.grantId);
});

test("API e2e: work order settle fails closed when authority root grant is revoked", async () => {
  const api = createApi({ x402RequireAuthorityGrant: true });
  const principalAgentId = "agt_auth_work_settle_root_revoked_principal_1";
  const subAgentId = "agt_auth_work_settle_root_revoked_sub_1";
  await registerAgent(api, { agentId: principalAgentId });
  await registerAgent(api, { agentId: subAgentId });

  const rootGrant = await issueAuthorityGrant(api, {
    grantId: "agrant_auth_work_settle_root_revoked_root_1",
    granteeAgentId: principalAgentId,
    scope: { sideEffectingAllowed: true, allowedRiskClasses: ["financial"] },
    chainBinding: { depth: 0, maxDelegationDepth: 2 },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const authorityGrant = await issueAuthorityGrant(api, {
    grantId: "agrant_auth_work_settle_root_revoked_child_1",
    granteeAgentId: principalAgentId,
    scope: { sideEffectingAllowed: true, allowedRiskClasses: ["financial"] },
    chainBinding: {
      rootGrantHash: rootGrant.grantHash,
      parentGrantHash: rootGrant.grantHash,
      depth: 1,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const delegationGrant = await issueDelegationGrant(api, {
    grantId: "dgrant_auth_work_settle_root_revoked_1",
    delegatorAgentId: "agt_auth_work_settle_root_revoked_manager_1",
    delegateeAgentId: principalAgentId,
    scope: { sideEffectingAllowed: true, allowedRiskClasses: ["financial"] },
    chainBinding: {
      rootGrantHash: rootGrant.grantHash,
      parentGrantHash: authorityGrant.grantHash,
      depth: 2,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2099-02-25T00:00:00.000Z"
    }
  });

  const created = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "work_order_settle_root_revoked_create_1" },
    body: {
      workOrderId: "workord_auth_settle_root_revoked_1",
      principalAgentId,
      subAgentId,
      requiredCapability: "code.generation",
      specification: { taskType: "codegen", prompt: "implement parser with root-revoked guard" },
      pricing: { amountCents: 360, currency: "USD" },
      delegationGrantRef: delegationGrant.grantId,
      authorityGrantRef: authorityGrant.grantId
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const accepted = await request(api, {
    method: "POST",
    path: "/work-orders/workord_auth_settle_root_revoked_1/accept",
    headers: { "x-idempotency-key": "work_order_settle_root_revoked_accept_1" },
    body: {
      acceptedByAgentId: subAgentId,
      acceptedAt: "2026-02-25T01:10:00.000Z"
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);

  const completed = await request(api, {
    method: "POST",
    path: "/work-orders/workord_auth_settle_root_revoked_1/complete",
    headers: { "x-idempotency-key": "work_order_settle_root_revoked_complete_1" },
    body: {
      receiptId: "worec_auth_settle_root_revoked_1",
      status: "success",
      outputs: { artifactRef: "artifact://code/auth-settle-root-revoked-1" },
      evidenceRefs: ["artifact://code/auth-settle-root-revoked-1", "report://verification/auth-settle-root-revoked-1"],
      amountCents: 360,
      currency: "USD",
      deliveredAt: "2026-02-25T01:20:00.000Z"
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);
  const completionReceiptHash = completed.json?.completionReceipt?.receiptHash;
  assert.equal(typeof completionReceiptHash, "string");

  const revokedRoot = await request(api, {
    method: "POST",
    path: `/authority-grants/${encodeURIComponent(rootGrant.grantId)}/revoke`,
    headers: { "x-idempotency-key": "work_order_settle_root_revoked_revoke_root_1" },
    body: { revocationReasonCode: "MANUAL_REVOKE" }
  });
  assert.equal(revokedRoot.statusCode, 200, revokedRoot.body);

  const blocked = await request(api, {
    method: "POST",
    path: "/work-orders/workord_auth_settle_root_revoked_1/settle",
    headers: { "x-idempotency-key": "work_order_settle_root_revoked_blocked_1" },
    body: {
      completionReceiptId: "worec_auth_settle_root_revoked_1",
      completionReceiptHash,
      status: "released",
      x402GateId: "x402gate_auth_settle_root_revoked_1",
      x402RunId: "run_auth_settle_root_revoked_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_auth_settle_root_revoked_1",
      evidenceRefs: ["artifact://code/auth-settle-root-revoked-1", "report://verification/auth-settle-root-revoked-1"],
      authorityGrantRef: authorityGrant.grantId
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_DELEGATION_ROOT_NOT_FOUND");
  assert.equal(blocked.json?.details?.reasonCode, "X402_AUTHORITY_DELEGATION_ROOT_NOT_FOUND");
});
