import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createStore } from "../src/api/store.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
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

async function issueAuthorityGrant(
  api,
  {
    grantId,
    granteeAgentId,
    maxPerCallCents = 10_000,
    maxTotalCents = 100_000,
    scope = null,
    chainBinding = null
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
      validity: {
        issuedAt: "2026-02-25T00:00:00.000Z",
        notBefore: "2026-02-25T00:00:00.000Z",
        expiresAt: "2027-02-25T00:00:00.000Z"
      }
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
    chainBinding = null
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
      validity: {
        issuedAt: "2026-02-25T00:00:00.000Z",
        notBefore: "2026-02-25T00:00:00.000Z",
        expiresAt: "2027-02-25T00:00:00.000Z"
      }
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
