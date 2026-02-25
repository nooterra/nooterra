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

(databaseUrl ? test : test.skip)("pg: agent substrate primitives persist across restart + public discovery spans tenants", async () => {
  const schema = makeSchema();
  const tenantA = "tenant_pg_substrate_a";
  const tenantB = "tenant_pg_substrate_b";
  const principalA = "agt_pg_sub_principal_a";
  const workerA = "agt_pg_sub_worker_a";
  const issuerA = "agt_pg_sub_issuer_a";
  const workerB = "agt_pg_sub_worker_b";
  const issuerB = "agt_pg_sub_issuer_b";

  let storeA = null;
  let storeB = null;
  try {
    storeA = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: false });
    const apiA = createApi({ store: storeA });

    await registerAgent(apiA, { tenantId: tenantA, agentId: principalA, capabilities: ["orchestration"] });
    await registerAgent(apiA, { tenantId: tenantA, agentId: workerA, capabilities: ["travel.booking"] });
    await registerAgent(apiA, { tenantId: tenantA, agentId: issuerA, capabilities: ["attestation.issue"] });
    await registerAgent(apiA, { tenantId: tenantB, agentId: workerB, capabilities: ["travel.booking"] });
    await registerAgent(apiA, { tenantId: tenantB, agentId: issuerB, capabilities: ["attestation.issue"] });

    const upsertCardA = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/agent-cards",
      headers: { "x-idempotency-key": "pg_sub_card_a_1" },
      body: {
        agentId: workerA,
        displayName: "PG Worker A",
        capabilities: ["travel.booking"],
        visibility: "public",
        host: { runtime: "openclaw", endpoint: "https://example.test/worker-a", protocols: ["mcp"] }
      }
    });
    assert.equal(upsertCardA.statusCode, 201, upsertCardA.body);

    const upsertCardB = await tenantRequest(apiA, {
      tenantId: tenantB,
      method: "POST",
      path: "/agent-cards",
      headers: { "x-idempotency-key": "pg_sub_card_b_1" },
      body: {
        agentId: workerB,
        displayName: "PG Worker B",
        capabilities: ["travel.booking"],
        visibility: "public",
        host: { runtime: "openclaw", endpoint: "https://example.test/worker-b", protocols: ["mcp"] }
      }
    });
    assert.equal(upsertCardB.statusCode, 201, upsertCardB.body);

    const issueGrant = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/delegation-grants",
      headers: { "x-idempotency-key": "pg_sub_grant_issue_1" },
      body: {
        grantId: "pg_sub_grant_1",
        delegatorAgentId: principalA,
        delegateeAgentId: workerA,
        scope: {
          allowedProviderIds: [workerA],
          allowedToolIds: ["travel_booking"],
          allowedRiskClasses: ["financial"],
          sideEffectingAllowed: true
        },
        spendLimit: {
          currency: "USD",
          maxPerCallCents: 50_000,
          maxTotalCents: 200_000
        },
        chainBinding: {
          depth: 0,
          maxDelegationDepth: 1
        },
        validity: {
          issuedAt: "2026-02-25T00:00:00.000Z",
          notBefore: "2026-02-25T00:00:00.000Z",
          expiresAt: "2027-02-25T00:00:00.000Z"
        }
      }
    });
    assert.equal(issueGrant.statusCode, 201, issueGrant.body);

    const issueAttestationA = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/capability-attestations",
      headers: { "x-idempotency-key": "pg_sub_attest_a_1" },
      body: {
        attestationId: "pg_sub_attest_a_1",
        subjectAgentId: workerA,
        capability: "travel.booking",
        level: "attested",
        issuerAgentId: issuerA,
        validity: {
          issuedAt: "2026-02-25T00:00:00.000Z",
          notBefore: "2026-02-25T00:00:00.000Z",
          expiresAt: "2027-02-25T00:00:00.000Z"
        },
        signature: { keyId: `key_${issuerA}`, signature: "sig_pg_sub_attest_a_1" }
      }
    });
    assert.equal(issueAttestationA.statusCode, 201, issueAttestationA.body);

    const issueAttestationB = await tenantRequest(apiA, {
      tenantId: tenantB,
      method: "POST",
      path: "/capability-attestations",
      headers: { "x-idempotency-key": "pg_sub_attest_b_1" },
      body: {
        attestationId: "pg_sub_attest_b_1",
        subjectAgentId: workerB,
        capability: "travel.booking",
        level: "attested",
        issuerAgentId: issuerB,
        validity: {
          issuedAt: "2026-02-25T00:00:00.000Z",
          notBefore: "2026-02-25T00:00:00.000Z",
          expiresAt: "2027-02-25T00:00:00.000Z"
        },
        signature: { keyId: `key_${issuerB}`, signature: "sig_pg_sub_attest_b_1" }
      }
    });
    assert.equal(issueAttestationB.statusCode, 201, issueAttestationB.body);

    const createWorkOrder = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/work-orders",
      headers: { "x-idempotency-key": "pg_sub_work_order_create_1" },
      body: {
        workOrderId: "pg_sub_work_order_1",
        principalAgentId: principalA,
        subAgentId: workerA,
        requiredCapability: "travel.booking",
        pricing: { amountCents: 1200, currency: "USD" },
        delegationGrantRef: "pg_sub_grant_1"
      }
    });
    assert.equal(createWorkOrder.statusCode, 201, createWorkOrder.body);

    const acceptWorkOrder = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/work-orders/pg_sub_work_order_1/accept",
      headers: { "x-idempotency-key": "pg_sub_work_order_accept_1" },
      body: { acceptedByAgentId: workerA, acceptedAt: "2026-02-25T00:10:00.000Z" }
    });
    assert.equal(acceptWorkOrder.statusCode, 200, acceptWorkOrder.body);

    const completeWorkOrder = await tenantRequest(apiA, {
      tenantId: tenantA,
      method: "POST",
      path: "/work-orders/pg_sub_work_order_1/complete",
      headers: { "x-idempotency-key": "pg_sub_work_order_complete_1" },
      body: {
        receiptId: "pg_sub_receipt_1",
        status: "success",
        outputs: { confirmationRef: "artifact://travel/booking/1" },
        evidenceRefs: ["artifact://travel/booking/1", "verification://travel/booking/1"],
        amountCents: 1200,
        currency: "USD",
        deliveredAt: "2026-02-25T00:20:00.000Z",
        completedAt: "2026-02-25T00:21:00.000Z"
      }
    });
    assert.equal(completeWorkOrder.statusCode, 200, completeWorkOrder.body);

    await storeA.close();
    storeA = null;

    storeB = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    const apiB = createApi({ store: storeB });

    const getCard = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: `/agent-cards/${encodeURIComponent(workerA)}`
    });
    assert.equal(getCard.statusCode, 200, getCard.body);
    assert.equal(getCard.json?.agentCard?.agentId, workerA);

    const listGrants = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: `/delegation-grants?delegatorAgentId=${encodeURIComponent(principalA)}`
    });
    assert.equal(listGrants.statusCode, 200, listGrants.body);
    assert.equal(listGrants.json?.grants?.some((row) => row.grantId === "pg_sub_grant_1"), true);

    const listAttestations = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: `/capability-attestations?subjectAgentId=${encodeURIComponent(workerA)}&capability=travel.booking`
    });
    assert.equal(listAttestations.statusCode, 200, listAttestations.body);
    assert.equal(listAttestations.json?.attestations?.some((row) => row?.capabilityAttestation?.attestationId === "pg_sub_attest_a_1"), true);

    const getWorkOrder = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: "/work-orders/pg_sub_work_order_1"
    });
    assert.equal(getWorkOrder.statusCode, 200, getWorkOrder.body);
    assert.equal(getWorkOrder.json?.workOrder?.status, "completed");

    const listReceipts = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path: "/work-orders/receipts?workOrderId=pg_sub_work_order_1&status=success"
    });
    assert.equal(listReceipts.statusCode, 200, listReceipts.body);
    assert.equal(listReceipts.json?.receipts?.some((row) => row.receiptId === "pg_sub_receipt_1"), true);

    const publicDiscover = await request(apiB, {
      method: "GET",
      path:
        "/public/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active" +
        "&includeReputation=false&limit=10&offset=0",
      auth: "none"
    });
    assert.equal(publicDiscover.statusCode, 200, publicDiscover.body);
    assert.equal(publicDiscover.json?.scope, "public");
    const publicIds = new Set((publicDiscover.json?.results ?? []).map((row) => String(row?.agentCard?.agentId ?? "")));
    assert.equal(publicIds.has(workerA), true);
    assert.equal(publicIds.has(workerB), true);

    const tenantDiscover = await tenantRequest(apiB, {
      tenantId: tenantA,
      method: "GET",
      path:
        "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active" +
        "&includeReputation=false&limit=10&offset=0"
    });
    assert.equal(tenantDiscover.statusCode, 200, tenantDiscover.body);
    const tenantIds = new Set((tenantDiscover.json?.results ?? []).map((row) => String(row?.agentCard?.agentId ?? "")));
    assert.equal(tenantIds.has(workerA), true);
    assert.equal(tenantIds.has(workerB), false);
  } finally {
    try {
      await storeB?.close?.();
    } catch {}
    try {
      await storeA?.close?.();
    } catch {}
  }
});
