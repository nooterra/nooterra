import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { buildSubAgentWorkOrderV1 } from "../src/core/subagent-work-order.js";
import { buildTaskAcceptanceV1, buildTaskOfferV1, buildTaskQuoteV1 } from "../src/core/task-negotiation.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `audit_lineage_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_test" },
      publicKeyPem,
      capabilities: ["orchestration"]
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

test("API e2e: /ops/audit/lineage returns deterministic trace-filtered records across substrate families", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const principalAgentId = "agt_audit_lineage_principal_1";
  const workerAgentId = "agt_audit_lineage_worker_1";
  const traceId = "trace_audit_lineage_1";

  await registerAgent(api, { agentId: principalAgentId });
  await registerAgent(api, { agentId: workerAgentId });

  const sessionCreate = await request(api, {
    method: "POST",
    path: "/sessions",
    headers: {
      "x-idempotency-key": "audit_lineage_session_create_1",
      "x-proxy-principal-id": principalAgentId
    },
    body: {
      sessionId: "sess_audit_lineage_1",
      visibility: "tenant",
      participants: [principalAgentId, workerAgentId]
    }
  });
  assert.equal(sessionCreate.statusCode, 201, sessionCreate.body);

  const sessionEvent = await request(api, {
    method: "POST",
    path: "/sessions/sess_audit_lineage_1/events",
    headers: {
      "x-idempotency-key": "audit_lineage_session_event_1",
      "x-proxy-expected-prev-chain-hash": "null",
      "x-proxy-principal-id": principalAgentId
    },
    body: {
      eventType: "TASK_REQUESTED",
      traceId,
      payload: {
        taskId: "task_audit_lineage_1",
        capability: "capability://code.generation.frontend.react"
      }
    }
  });
  assert.equal(sessionEvent.statusCode, 201, sessionEvent.body);

  const taskQuote = buildTaskQuoteV1({
    quoteId: "quote_audit_lineage_1",
    tenantId: "tenant_default",
    buyerAgentId: principalAgentId,
    sellerAgentId: workerAgentId,
    requiredCapability: "capability://code.generation.frontend.react",
    pricing: { model: "fixed", amountCents: 250, currency: "USD" },
    metadata: { traceId },
    createdAt: "2026-02-25T01:00:00.000Z"
  });
  await api.store.putTaskQuote({ tenantId: "tenant_default", taskQuote });

  const taskOffer = buildTaskOfferV1({
    offerId: "offer_audit_lineage_1",
    tenantId: "tenant_default",
    buyerAgentId: principalAgentId,
    sellerAgentId: workerAgentId,
    quoteRef: { quoteId: taskQuote.quoteId, quoteHash: taskQuote.quoteHash },
    pricing: { model: "fixed", amountCents: 240, currency: "USD" },
    metadata: { traceId },
    createdAt: "2026-02-25T01:10:00.000Z"
  });
  await api.store.putTaskOffer({ tenantId: "tenant_default", taskOffer });

  const taskAcceptance = buildTaskAcceptanceV1({
    acceptanceId: "acceptance_audit_lineage_1",
    tenantId: "tenant_default",
    buyerAgentId: principalAgentId,
    sellerAgentId: workerAgentId,
    quoteRef: { quoteId: taskQuote.quoteId, quoteHash: taskQuote.quoteHash },
    offerRef: { offerId: taskOffer.offerId, offerHash: taskOffer.offerHash },
    acceptedByAgentId: principalAgentId,
    metadata: { traceId },
    createdAt: "2026-02-25T01:20:00.000Z"
  });
  await api.store.putTaskAcceptance({ tenantId: "tenant_default", taskAcceptance });

  const workOrder = buildSubAgentWorkOrderV1({
    workOrderId: "wo_audit_lineage_1",
    tenantId: "tenant_default",
    principalAgentId,
    subAgentId: workerAgentId,
    requiredCapability: "capability://code.generation.frontend.react",
    specification: { objective: "build component" },
    pricing: { model: "fixed", amountCents: 240, currency: "USD" },
    metadata: { traceId },
    createdAt: "2026-02-25T01:30:00.000Z"
  });
  await api.store.putSubAgentWorkOrder({ tenantId: "tenant_default", workOrder });

  const lineageA = await request(api, {
    method: "GET",
    path: `/ops/audit/lineage?traceId=${encodeURIComponent(traceId)}&includeSessionEvents=true&limit=100`
  });
  assert.equal(lineageA.statusCode, 200, lineageA.body);
  assert.equal(lineageA.json?.lineage?.schemaVersion, "AuditLineage.v1");
  assert.match(String(lineageA.json?.lineage?.lineageHash ?? ""), /^[0-9a-f]{64}$/);
  assert.equal(lineageA.json?.lineage?.filters?.traceId, traceId);
  assert.equal(lineageA.json?.lineage?.summary?.totalRecords >= 5, true);

  const kinds = new Set((lineageA.json?.lineage?.records ?? []).map((row) => row?.kind));
  assert.equal(kinds.has("SESSION_EVENT"), true);
  assert.equal(kinds.has("TASK_QUOTE"), true);
  assert.equal(kinds.has("TASK_OFFER"), true);
  assert.equal(kinds.has("TASK_ACCEPTANCE"), true);
  assert.equal(kinds.has("WORK_ORDER"), true);
  for (const row of lineageA.json?.lineage?.records ?? []) {
    assert.equal(Array.isArray(row?.traceIds), true);
    assert.equal(row.traceIds.includes(traceId), true);
  }

  const lineageB = await request(api, {
    method: "GET",
    path: `/ops/audit/lineage?traceId=${encodeURIComponent(traceId)}&includeSessionEvents=true&limit=100`
  });
  assert.equal(lineageB.statusCode, 200, lineageB.body);
  assert.equal(lineageB.json?.lineage?.lineageHash, lineageA.json?.lineage?.lineageHash);
  assert.deepEqual(lineageB.json?.lineage?.records, lineageA.json?.lineage?.records);
});

test("API e2e: /ops/audit/lineage requires read scope and rejects invalid filter values", async () => {
  const api = createApi({
    opsTokens: ["tok_audit:audit_read"].join(";")
  });

  const forbidden = await request(api, {
    method: "GET",
    path: "/ops/audit/lineage",
    auth: "none"
  });
  assert.equal(forbidden.statusCode, 403, forbidden.body);

  const allowed = await request(api, {
    method: "GET",
    path: "/ops/audit/lineage?limit=10",
    headers: { "x-proxy-ops-token": "tok_audit" }
  });
  assert.equal(allowed.statusCode, 200, allowed.body);
  assert.equal(allowed.json?.lineage?.summary?.limit, 10);

  const invalid = await request(api, {
    method: "GET",
    path: "/ops/audit/lineage?agentId=",
    headers: { "x-proxy-ops-token": "tok_audit" }
  });
  assert.equal(invalid.statusCode, 400, invalid.body);
  assert.equal(invalid.json?.code, "SCHEMA_INVALID");
});
