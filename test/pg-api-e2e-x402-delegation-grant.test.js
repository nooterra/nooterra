import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createPgStore } from "../src/db/store-pg.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
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

async function registerAgent(api, { tenantId, agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
  const created = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `pg_dgrant_register_${agentId}` },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId: `svc_${tenantId}` },
      publicKeyPem
    }
  });
  assert.equal(created.statusCode, 201, created.body);
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

async function createGate(api, { tenantId, gateId, payerAgentId, payeeAgentId, amountCents, delegationGrantRef }) {
  return tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": `pg_dgrant_gate_create_${gateId}` },
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
}

async function authorizeGate(api, { tenantId, gateId, idempotencyKey }) {
  return tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": idempotencyKey },
    body: { gateId }
  });
}

(databaseUrl ? test : test.skip)(
  "pg api e2e: delegation grant revoke lifecycle fail-closes authorize after revoke",
  async () => {
    const schema = makeSchema();
    const tenantId = "tenant_pg_dgrant_lifecycle_1";
    const delegatorAgentId = "agt_pg_dgrant_delegator_1";
    const delegateeAgentId = "agt_pg_dgrant_delegatee_1";
    const payeeAgentId = "agt_pg_dgrant_payee_1";
    const grantId = "dgrant_pg_x402_1";

    const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    try {
      const api = createApi({ store });

      await registerAgent(api, { tenantId, agentId: delegatorAgentId });
      await registerAgent(api, { tenantId, agentId: delegateeAgentId });
      await registerAgent(api, { tenantId, agentId: payeeAgentId });
      await creditWallet(api, {
        tenantId,
        agentId: delegateeAgentId,
        amountCents: 10_000,
        idempotencyKey: "pg_dgrant_wallet_credit_1"
      });

      const issued = await tenantRequest(api, {
        tenantId,
        method: "POST",
        path: "/delegation-grants",
        headers: { "x-idempotency-key": "pg_dgrant_issue_1" },
        body: {
          grantId,
          delegatorAgentId,
          delegateeAgentId,
          scope: {
            allowedProviderIds: [payeeAgentId],
            allowedToolIds: ["mock_weather"],
            allowedRiskClasses: ["financial"],
            sideEffectingAllowed: true
          },
          spendLimit: {
            currency: "USD",
            maxPerCallCents: 400,
            maxTotalCents: 700
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
      assert.equal(issued.statusCode, 201, issued.body);
      assert.equal(issued.json?.delegationGrant?.grantId, grantId);

      const activeList = await tenantRequest(api, {
        tenantId,
        method: "GET",
        path: `/delegation-grants?delegateeAgentId=${encodeURIComponent(delegateeAgentId)}&includeRevoked=false`
      });
      assert.equal(activeList.statusCode, 200, activeList.body);
      assert.equal(activeList.json?.grants?.length, 1);
      assert.equal(activeList.json?.grants?.[0]?.grantId, grantId);

      const firstGate = await createGate(api, {
        tenantId,
        gateId: "x402gate_pg_dgrant_ok_1",
        payerAgentId: delegateeAgentId,
        payeeAgentId,
        amountCents: 300,
        delegationGrantRef: grantId
      });
      assert.equal(firstGate.statusCode, 201, firstGate.body);

      const authorized = await authorizeGate(api, {
        tenantId,
        gateId: "x402gate_pg_dgrant_ok_1",
        idempotencyKey: "pg_dgrant_authorize_ok_1"
      });
      assert.equal(authorized.statusCode, 200, authorized.body);
      assert.equal(authorized.json?.delegationGrantRef, grantId);

      const revoked = await tenantRequest(api, {
        tenantId,
        method: "POST",
        path: `/delegation-grants/${encodeURIComponent(grantId)}/revoke`,
        headers: { "x-idempotency-key": "pg_dgrant_revoke_1" },
        body: {
          revocationReasonCode: "MANUAL_REVOKE"
        }
      });
      assert.equal(revoked.statusCode, 200, revoked.body);
      assert.equal(typeof revoked.json?.delegationGrant?.revocation?.revokedAt, "string");

      const activeListAfterRevoke = await tenantRequest(api, {
        tenantId,
        method: "GET",
        path: `/delegation-grants?delegateeAgentId=${encodeURIComponent(delegateeAgentId)}&includeRevoked=false`
      });
      assert.equal(activeListAfterRevoke.statusCode, 200, activeListAfterRevoke.body);
      assert.equal(activeListAfterRevoke.json?.grants?.length, 0);

      const allListAfterRevoke = await tenantRequest(api, {
        tenantId,
        method: "GET",
        path: `/delegation-grants?delegateeAgentId=${encodeURIComponent(delegateeAgentId)}&includeRevoked=true`
      });
      assert.equal(allListAfterRevoke.statusCode, 200, allListAfterRevoke.body);
      assert.equal(allListAfterRevoke.json?.grants?.length, 1);
      assert.equal(allListAfterRevoke.json?.grants?.[0]?.grantId, grantId);

      const secondGate = await createGate(api, {
        tenantId,
        gateId: "x402gate_pg_dgrant_revoked_1",
        payerAgentId: delegateeAgentId,
        payeeAgentId,
        amountCents: 100,
        delegationGrantRef: grantId
      });
      assert.equal(secondGate.statusCode, 201, secondGate.body);

      const blocked = await authorizeGate(api, {
        tenantId,
        gateId: "x402gate_pg_dgrant_revoked_1",
        idempotencyKey: "pg_dgrant_authorize_revoked_block_1"
      });
      assert.equal(blocked.statusCode, 409, blocked.body);
      assert.equal(blocked.json?.code, "X402_DELEGATION_GRANT_REVOKED");
    } finally {
      await store.close();
    }
  }
);
