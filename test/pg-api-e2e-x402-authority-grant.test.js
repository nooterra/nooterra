import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { createPgStore } from "../src/db/store-pg.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

function makeSchema() {
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function tenantRequest(api, { tenantId, method, path, headers = null, body = undefined, auth = "auto" }) {
  return request(api, {
    method,
    path,
    headers: {
      "x-proxy-tenant-id": tenantId,
      ...(headers ?? {})
    },
    body,
    auth
  });
}

async function registerAgent(api, { tenantId, agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `register_${tenantId}_${agentId}` },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId: `svc_${tenantId}` },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function creditWallet(api, { tenantId, agentId, amountCents, idempotencyKey }) {
  const response = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-idempotency-key": idempotencyKey },
    body: { amountCents, currency: "USD" }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function issueAuthorityGrant(
  api,
  {
    tenantId,
    grantId,
    granteeAgentId,
    maxPerCallCents = 5_000,
    maxTotalCents = 50_000,
    allowedProviderIds = [],
    allowedToolIds = [],
    validity = null
  }
) {
  const normalizedValidity =
    validity && typeof validity === "object" && !Array.isArray(validity)
      ? {
          issuedAt: validity.issuedAt ?? "2026-02-24T00:00:00.000Z",
          notBefore: validity.notBefore ?? "2026-02-24T00:00:00.000Z",
          expiresAt: validity.expiresAt ?? "2027-02-24T00:00:00.000Z"
        }
      : {
          issuedAt: "2026-02-24T00:00:00.000Z",
          notBefore: "2026-02-24T00:00:00.000Z",
          expiresAt: "2027-02-24T00:00:00.000Z"
        };
  const response = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/authority-grants",
    headers: { "x-idempotency-key": `authority_grant_issue_${grantId}` },
    body: {
      grantId,
      principalRef: {
        principalType: "org",
        principalId: "org_pg_x402_authority"
      },
      granteeAgentId,
      scope: {
        allowedProviderIds,
        allowedToolIds,
        allowedRiskClasses: ["financial"],
        sideEffectingAllowed: true
      },
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents,
        maxTotalCents
      },
      chainBinding: {
        depth: 0,
        maxDelegationDepth: 1
      },
      validity: normalizedValidity
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function createGate(api, { tenantId, gateId, payerAgentId, payeeAgentId, amountCents, authorityGrantRef = null }) {
  return await tenantRequest(api, {
    tenantId,
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
      ...(authorityGrantRef ? { authorityGrantRef } : {})
    }
  });
}

async function authorizeGate(api, { tenantId, gateId, idempotencyKey, extraBody = null }) {
  return await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": idempotencyKey },
    body: {
      gateId,
      ...(extraBody && typeof extraBody === "object" && !Array.isArray(extraBody) ? extraBody : {})
    }
  });
}

(databaseUrl ? test : test.skip)("pg api e2e: x402 authorize-payment fails closed for authority grant validity windows", async () => {
  const schema = makeSchema();
  const tenantId = "tenant_pg_x402_authority_window";
  let nowAt = "2026-02-24T00:10:00.000Z";
  const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
  try {
    const api = createApi({
      store,
      now: () => nowAt
    });
    const payerAgentId = "agt_pg_x402_authority_window_payer";
    const payeeAgentId = "agt_pg_x402_authority_window_payee";

    await registerAgent(api, { tenantId, agentId: payerAgentId });
    await registerAgent(api, { tenantId, agentId: payeeAgentId });
    await creditWallet(api, {
      tenantId,
      agentId: payerAgentId,
      amountCents: 10_000,
      idempotencyKey: "pg_x402_authority_window_credit_1"
    });

    await issueAuthorityGrant(api, {
      tenantId,
      grantId: "pg_x402_authority_window_future_1",
      granteeAgentId: payerAgentId,
      maxPerCallCents: 800,
      maxTotalCents: 4_000,
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"],
      validity: {
        issuedAt: "2026-02-24T00:00:00.000Z",
        notBefore: "2026-02-24T01:00:00.000Z",
        expiresAt: "2026-02-24T02:00:00.000Z"
      }
    });

    const gateNotActive = await createGate(api, {
      tenantId,
      gateId: "pg_x402_authority_window_not_active_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 200
    });
    assert.equal(gateNotActive.statusCode, 201, gateNotActive.body);

    nowAt = "2026-02-24T00:30:00.000Z";
    const blockedNotActive = await authorizeGate(api, {
      tenantId,
      gateId: "pg_x402_authority_window_not_active_1",
      idempotencyKey: "pg_x402_authority_window_not_active_authz_1",
      extraBody: {
        authorityGrantRef: "pg_x402_authority_window_future_1"
      }
    });
    assert.equal(blockedNotActive.statusCode, 409, blockedNotActive.body);
    assert.equal(blockedNotActive.json?.code, "X402_AUTHORITY_GRANT_NOT_ACTIVE");

    await issueAuthorityGrant(api, {
      tenantId,
      grantId: "pg_x402_authority_window_expired_1",
      granteeAgentId: payerAgentId,
      maxPerCallCents: 800,
      maxTotalCents: 4_000,
      allowedProviderIds: [payeeAgentId],
      allowedToolIds: ["mock_weather"],
      validity: {
        issuedAt: "2026-02-24T00:00:00.000Z",
        notBefore: "2026-02-24T00:00:00.000Z",
        expiresAt: "2026-02-24T00:45:00.000Z"
      }
    });

    const gateExpired = await createGate(api, {
      tenantId,
      gateId: "pg_x402_authority_window_expired_gate_1",
      payerAgentId,
      payeeAgentId,
      amountCents: 200,
      authorityGrantRef: "pg_x402_authority_window_expired_1"
    });
    assert.equal(gateExpired.statusCode, 201, gateExpired.body);

    nowAt = "2026-02-24T00:46:00.000Z";
    const blockedExpired = await authorizeGate(api, {
      tenantId,
      gateId: "pg_x402_authority_window_expired_gate_1",
      idempotencyKey: "pg_x402_authority_window_expired_authz_1"
    });
    assert.equal(blockedExpired.statusCode, 409, blockedExpired.body);
    assert.equal(blockedExpired.json?.code, "X402_AUTHORITY_GRANT_EXPIRED");
  } finally {
    try {
      await store.close();
    } catch {}
  }
});

(databaseUrl ? test : test.skip)("pg api e2e: work-order settle fails closed for revoked authority grant and idempotent blocked replay", async () => {
  const schema = makeSchema();
  const tenantId = "tenant_pg_workord_authority_revoked";
  const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
  try {
    const api = createApi({ store, now: () => "2026-02-24T04:00:00.000Z" });
    const principalAgentId = "agt_pg_workord_authority_principal";
    const subAgentId = "agt_pg_workord_authority_worker";

    await registerAgent(api, { tenantId, agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
    await registerAgent(api, { tenantId, agentId: subAgentId, capabilities: ["code.generation"] });

    await issueAuthorityGrant(api, {
      tenantId,
      grantId: "pg_workord_authority_revoked_1",
      granteeAgentId: principalAgentId,
      maxPerCallCents: 2_000,
      maxTotalCents: 10_000
    });

    const created = await tenantRequest(api, {
      tenantId,
      method: "POST",
      path: "/work-orders",
      headers: { "x-idempotency-key": "pg_workord_authority_create_1" },
      body: {
        workOrderId: "pg_workord_authority_settle_1",
        principalAgentId,
        subAgentId,
        requiredCapability: "code.generation",
        pricing: { amountCents: 700, currency: "USD" },
        authorityGrantRef: "pg_workord_authority_revoked_1"
      }
    });
    assert.equal(created.statusCode, 201, created.body);

    const accepted = await tenantRequest(api, {
      tenantId,
      method: "POST",
      path: "/work-orders/pg_workord_authority_settle_1/accept",
      headers: { "x-idempotency-key": "pg_workord_authority_accept_1" },
      body: {
        acceptedByAgentId: subAgentId,
        acceptedAt: "2026-02-24T04:10:00.000Z"
      }
    });
    assert.equal(accepted.statusCode, 200, accepted.body);

    const completed = await tenantRequest(api, {
      tenantId,
      method: "POST",
      path: "/work-orders/pg_workord_authority_settle_1/complete",
      headers: { "x-idempotency-key": "pg_workord_authority_complete_1" },
      body: {
        receiptId: "pg_worec_authority_revoked_1",
        status: "success",
        outputs: { artifactRef: "artifact://pg/workorder/revoked/1" },
        evidenceRefs: ["artifact://pg/workorder/revoked/1", "report://pg/workorder/revoked/1"],
        amountCents: 700,
        currency: "USD",
        deliveredAt: "2026-02-24T04:20:00.000Z",
        completedAt: "2026-02-24T04:21:00.000Z"
      }
    });
    assert.equal(completed.statusCode, 200, completed.body);

    const revoked = await tenantRequest(api, {
      tenantId,
      method: "POST",
      path: "/authority-grants/pg_workord_authority_revoked_1/revoke",
      headers: { "x-idempotency-key": "pg_workord_authority_revoke_1" },
      body: {
        revocationReasonCode: "MANUAL_REVOKE"
      }
    });
    assert.equal(revoked.statusCode, 200, revoked.body);

    const settleBlocked = await tenantRequest(api, {
      tenantId,
      method: "POST",
      path: "/work-orders/pg_workord_authority_settle_1/settle",
      headers: { "x-idempotency-key": "pg_workord_authority_settle_blocked_1" },
      body: {
        completionReceiptId: "pg_worec_authority_revoked_1",
        completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
        status: "released",
        x402GateId: "x402gate_pg_workord_authority_settle_1",
        x402RunId: "run_pg_workord_authority_settle_1",
        x402SettlementStatus: "released",
        x402ReceiptId: "x402rcpt_pg_workord_authority_settle_1",
        settledAt: "2026-02-24T04:30:00.000Z"
      }
    });
    assert.equal(settleBlocked.statusCode, 409, settleBlocked.body);
    assert.equal(settleBlocked.json?.code, "X402_AUTHORITY_GRANT_REVOKED");

    const settleReplay = await tenantRequest(api, {
      tenantId,
      method: "POST",
      path: "/work-orders/pg_workord_authority_settle_1/settle",
      headers: { "x-idempotency-key": "pg_workord_authority_settle_blocked_1" },
      body: {
        completionReceiptId: "pg_worec_authority_revoked_1",
        completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
        status: "released",
        x402GateId: "x402gate_pg_workord_authority_settle_1",
        x402RunId: "run_pg_workord_authority_settle_1",
        x402SettlementStatus: "released",
        x402ReceiptId: "x402rcpt_pg_workord_authority_settle_1",
        settledAt: "2026-02-24T04:30:00.000Z"
      }
    });
    assert.equal(settleReplay.statusCode, 409, settleReplay.body);
    assert.equal(settleReplay.json?.code, "X402_AUTHORITY_GRANT_REVOKED");
    assert.equal(settleReplay.json?.details?.authorityGrantRef, settleBlocked.json?.details?.authorityGrantRef);

    const workOrderAfterBlockedSettle = await tenantRequest(api, {
      tenantId,
      method: "GET",
      path: "/work-orders/pg_workord_authority_settle_1"
    });
    assert.equal(workOrderAfterBlockedSettle.statusCode, 200, workOrderAfterBlockedSettle.body);
    assert.equal(workOrderAfterBlockedSettle.json?.workOrder?.status, "completed");
  } finally {
    try {
      await store.close();
    } catch {}
  }
});

(databaseUrl ? test : test.skip)("pg api e2e: work-order settle fails closed when authority grant expires between completion and settle", async () => {
  const schema = makeSchema();
  const tenantId = "tenant_pg_workord_authority_expired";
  let nowAt = "2026-02-24T04:00:00.000Z";
  const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
  try {
    const api = createApi({
      store,
      now: () => nowAt
    });
    const principalAgentId = "agt_pg_workord_authority_expiry_principal";
    const subAgentId = "agt_pg_workord_authority_expiry_worker";

    await registerAgent(api, { tenantId, agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
    await registerAgent(api, { tenantId, agentId: subAgentId, capabilities: ["code.generation"] });

    await issueAuthorityGrant(api, {
      tenantId,
      grantId: "pg_workord_authority_expired_1",
      granteeAgentId: principalAgentId,
      maxPerCallCents: 2_000,
      maxTotalCents: 10_000,
      validity: {
        issuedAt: "2026-02-24T00:00:00.000Z",
        notBefore: "2026-02-24T00:00:00.000Z",
        expiresAt: "2026-02-24T04:30:00.000Z"
      }
    });

    const created = await tenantRequest(api, {
      tenantId,
      method: "POST",
      path: "/work-orders",
      headers: { "x-idempotency-key": "pg_workord_authority_expiry_create_1" },
      body: {
        workOrderId: "pg_workord_authority_expiry_settle_1",
        principalAgentId,
        subAgentId,
        requiredCapability: "code.generation",
        pricing: { amountCents: 700, currency: "USD" },
        authorityGrantRef: "pg_workord_authority_expired_1"
      }
    });
    assert.equal(created.statusCode, 201, created.body);

    const accepted = await tenantRequest(api, {
      tenantId,
      method: "POST",
      path: "/work-orders/pg_workord_authority_expiry_settle_1/accept",
      headers: { "x-idempotency-key": "pg_workord_authority_expiry_accept_1" },
      body: {
        acceptedByAgentId: subAgentId,
        acceptedAt: "2026-02-24T04:10:00.000Z"
      }
    });
    assert.equal(accepted.statusCode, 200, accepted.body);

    const completed = await tenantRequest(api, {
      tenantId,
      method: "POST",
      path: "/work-orders/pg_workord_authority_expiry_settle_1/complete",
      headers: { "x-idempotency-key": "pg_workord_authority_expiry_complete_1" },
      body: {
        receiptId: "pg_worec_authority_expired_1",
        status: "success",
        outputs: { artifactRef: "artifact://pg/workorder/expired/1" },
        evidenceRefs: ["artifact://pg/workorder/expired/1", "report://pg/workorder/expired/1"],
        amountCents: 700,
        currency: "USD",
        deliveredAt: "2026-02-24T04:20:00.000Z",
        completedAt: "2026-02-24T04:21:00.000Z"
      }
    });
    assert.equal(completed.statusCode, 200, completed.body);

    nowAt = "2026-02-24T04:31:00.000Z";

    const settleExpiredBlocked = await tenantRequest(api, {
      tenantId,
      method: "POST",
      path: "/work-orders/pg_workord_authority_expiry_settle_1/settle",
      headers: { "x-idempotency-key": "pg_workord_authority_expiry_settle_blocked_1" },
      body: {
        completionReceiptId: "pg_worec_authority_expired_1",
        completionReceiptHash: completed.json?.completionReceipt?.receiptHash,
        status: "released",
        x402GateId: "x402gate_pg_workord_authority_expiry_1",
        x402RunId: "run_pg_workord_authority_expiry_1",
        x402SettlementStatus: "released",
        x402ReceiptId: "x402rcpt_pg_workord_authority_expiry_1",
        settledAt: "2026-02-24T04:31:00.000Z"
      }
    });
    assert.equal(settleExpiredBlocked.statusCode, 409, settleExpiredBlocked.body);
    assert.equal(settleExpiredBlocked.json?.code, "X402_AUTHORITY_GRANT_EXPIRED");
  } finally {
    try {
      await store.close();
    } catch {}
  }
});
