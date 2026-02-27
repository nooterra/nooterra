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
    headers: { "x-idempotency-key": `pg_workord_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: `svc_${tenantId}` },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

(databaseUrl ? test : test.skip)(
  "pg api e2e: work-order settlement evidence binding blocks missing/mismatched evidence and allows valid release",
  async () => {
    const schema = makeSchema();
    const tenantId = "tenant_pg_workord_evidence_1";
    const principalAgentId = "agt_pg_workord_evidence_principal_1";
    const subAgentId = "agt_pg_workord_evidence_worker_1";

    const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    try {
      const api = createApi({ store });

      await registerAgent(api, { tenantId, agentId: principalAgentId, capabilities: ["code.generation", "orchestration"] });
      await registerAgent(api, { tenantId, agentId: subAgentId, capabilities: ["code.generation"] });

      const created = await tenantRequest(api, {
        tenantId,
        method: "POST",
        path: "/work-orders",
        headers: { "x-idempotency-key": "pg_workord_create_evidence_1" },
        body: {
          workOrderId: "pg_workord_evidence_1",
          principalAgentId,
          subAgentId,
          requiredCapability: "code.generation",
          pricing: { amountCents: 900, currency: "USD" }
        }
      });
      assert.equal(created.statusCode, 201, created.body);
      assert.equal(created.json?.workOrder?.evidencePolicy?.schemaVersion, "WorkOrderSettlementEvidencePolicy.v1");
      assert.equal(created.json?.workOrder?.evidencePolicy?.release?.requiredKinds?.includes("verification_report"), true);

      const accepted = await tenantRequest(api, {
        tenantId,
        method: "POST",
        path: "/work-orders/pg_workord_evidence_1/accept",
        headers: { "x-idempotency-key": "pg_workord_accept_evidence_1" },
        body: {
          acceptedByAgentId: subAgentId,
          acceptedAt: "2026-02-23T02:10:00.000Z"
        }
      });
      assert.equal(accepted.statusCode, 200, accepted.body);

      const completedMissingEvidence = await tenantRequest(api, {
        tenantId,
        method: "POST",
        path: "/work-orders/pg_workord_evidence_1/complete",
        headers: { "x-idempotency-key": "pg_workord_complete_evidence_missing_1" },
        body: {
          receiptId: "pg_worec_evidence_missing_1",
          status: "success",
          outputs: { artifactRef: "artifact://code/evidence/missing" },
          evidenceRefs: ["artifact://code/evidence/missing"],
          amountCents: 900,
          currency: "USD",
          deliveredAt: "2026-02-23T02:20:00.000Z",
          completedAt: "2026-02-23T02:21:00.000Z"
        }
      });
      assert.equal(completedMissingEvidence.statusCode, 200, completedMissingEvidence.body);

      const settleMissingEvidenceBlocked = await tenantRequest(api, {
        tenantId,
        method: "POST",
        path: "/work-orders/pg_workord_evidence_1/settle",
        headers: { "x-idempotency-key": "pg_workord_settle_evidence_missing_block_1" },
        body: {
          completionReceiptId: "pg_worec_evidence_missing_1",
          completionReceiptHash: completedMissingEvidence.json?.completionReceipt?.receiptHash,
          status: "released",
          x402GateId: "x402gate_pg_workord_evidence_missing_1",
          x402RunId: "run_pg_workord_evidence_missing_1",
          x402SettlementStatus: "released",
          x402ReceiptId: "x402rcpt_pg_workord_evidence_missing_1",
          settledAt: "2026-02-23T02:30:00.000Z"
        }
      });
      assert.equal(settleMissingEvidenceBlocked.statusCode, 409, settleMissingEvidenceBlocked.body);
      assert.equal(settleMissingEvidenceBlocked.json?.code, "WORK_ORDER_EVIDENCE_BINDING_BLOCKED");
      assert.equal(settleMissingEvidenceBlocked.json?.details?.reasonCode, "WORK_ORDER_EVIDENCE_MISSING");

      const created2 = await tenantRequest(api, {
        tenantId,
        method: "POST",
        path: "/work-orders",
        headers: { "x-idempotency-key": "pg_workord_create_evidence_2" },
        body: {
          workOrderId: "pg_workord_evidence_2",
          principalAgentId,
          subAgentId,
          requiredCapability: "code.generation",
          pricing: { amountCents: 910, currency: "USD" }
        }
      });
      assert.equal(created2.statusCode, 201, created2.body);

      const accepted2 = await tenantRequest(api, {
        tenantId,
        method: "POST",
        path: "/work-orders/pg_workord_evidence_2/accept",
        headers: { "x-idempotency-key": "pg_workord_accept_evidence_2" },
        body: {
          acceptedByAgentId: subAgentId,
          acceptedAt: "2026-02-23T03:10:00.000Z"
        }
      });
      assert.equal(accepted2.statusCode, 200, accepted2.body);

      const completedValidEvidence = await tenantRequest(api, {
        tenantId,
        method: "POST",
        path: "/work-orders/pg_workord_evidence_2/complete",
        headers: { "x-idempotency-key": "pg_workord_complete_evidence_valid_2" },
        body: {
          receiptId: "pg_worec_evidence_valid_2",
          status: "success",
          outputs: { artifactRef: "artifact://code/evidence/valid" },
          evidenceRefs: ["artifact://code/evidence/valid", "report://verification/evidence/valid"],
          amountCents: 910,
          currency: "USD",
          deliveredAt: "2026-02-23T03:20:00.000Z",
          completedAt: "2026-02-23T03:21:00.000Z"
        }
      });
      assert.equal(completedValidEvidence.statusCode, 200, completedValidEvidence.body);

      const settleMismatchBlocked = await tenantRequest(api, {
        tenantId,
        method: "POST",
        path: "/work-orders/pg_workord_evidence_2/settle",
        headers: { "x-idempotency-key": "pg_workord_settle_evidence_mismatch_block_2" },
        body: {
          completionReceiptId: "pg_worec_evidence_valid_2",
          completionReceiptHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          status: "released",
          x402GateId: "x402gate_pg_workord_evidence_mismatch_2",
          x402RunId: "run_pg_workord_evidence_mismatch_2",
          x402SettlementStatus: "released",
          x402ReceiptId: "x402rcpt_pg_workord_evidence_mismatch_2",
          settledAt: "2026-02-23T03:30:00.000Z"
        }
      });
      assert.equal(settleMismatchBlocked.statusCode, 409, settleMismatchBlocked.body);
      assert.equal(settleMismatchBlocked.json?.code, "WORK_ORDER_EVIDENCE_BINDING_BLOCKED");
      assert.equal(settleMismatchBlocked.json?.details?.reasonCode, "WORK_ORDER_RECEIPT_HASH_MISMATCH");

      const settleValid = await tenantRequest(api, {
        tenantId,
        method: "POST",
        path: "/work-orders/pg_workord_evidence_2/settle",
        headers: { "x-idempotency-key": "pg_workord_settle_evidence_valid_2" },
        body: {
          completionReceiptId: "pg_worec_evidence_valid_2",
          completionReceiptHash: completedValidEvidence.json?.completionReceipt?.receiptHash,
          status: "released",
          x402GateId: "x402gate_pg_workord_evidence_valid_2",
          x402RunId: "run_pg_workord_evidence_valid_2",
          x402SettlementStatus: "released",
          x402ReceiptId: "x402rcpt_pg_workord_evidence_valid_2",
          settledAt: "2026-02-23T03:31:00.000Z"
        }
      });
      assert.equal(settleValid.statusCode, 200, settleValid.body);
      assert.equal(settleValid.json?.workOrder?.status, "settled");
      assert.equal(settleValid.json?.workOrder?.settlement?.status, "released");
    } finally {
      await store.close();
    }
  }
);
