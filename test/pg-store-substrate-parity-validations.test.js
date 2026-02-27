import test from "node:test";
import assert from "node:assert/strict";

import { createPgStore } from "../src/db/store-pg.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

function makeSchema() {
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

(databaseUrl ? test : test.skip)("pg: substrate list methods fail closed on invalid filter types", async () => {
  const store = await createPgStore({ databaseUrl, schema: makeSchema(), dropSchemaOnClose: true });
  try {
    await assert.rejects(
      () =>
        store.listDelegationGrants({
          tenantId: "tenant_pg_substrate_validation",
          grantId: 7
        }),
      /grantId must be null or a non-empty string/
    );

    await assert.rejects(
      () =>
        store.listDelegationGrants({
          tenantId: "tenant_pg_substrate_validation",
          includeRevoked: "false"
        }),
      /includeRevoked must be a boolean/
    );

    await assert.rejects(
      () =>
        store.listCapabilityAttestations({
          tenantId: "tenant_pg_substrate_validation",
          subjectAgentId: true
        }),
      /subjectAgentId must be null or a non-empty string/
    );

    await assert.rejects(
      () =>
        store.listSubAgentWorkOrders({
          tenantId: "tenant_pg_substrate_validation",
          status: 5
        }),
      /status must be null or a non-empty string/
    );

    await assert.rejects(
      () =>
        store.listSubAgentCompletionReceipts({
          tenantId: "tenant_pg_substrate_validation",
          receiptId: {}
        }),
      /receiptId must be null or a non-empty string/
    );
  } finally {
    await store.close();
  }
});

(databaseUrl ? test : test.skip)("pg: substrate list methods keep deterministic ordering and strict revoke filtering", async () => {
  const tenantId = "tenant_pg_substrate_ordering";
  const store = await createPgStore({ databaseUrl, schema: makeSchema(), dropSchemaOnClose: true });
  try {
    await store.commitTx({
      at: "2026-02-27T00:00:00.000Z",
      ops: [
        {
          kind: "DELEGATION_GRANT_UPSERT",
          tenantId,
          grantId: "grant_b",
          delegationGrant: {
            tenantId,
            grantId: "grant_b",
            delegatorAgentId: "agt_principal",
            delegateeAgentId: "agt_worker",
            revocation: { revokedAt: "2026-02-27T01:00:00.000Z" }
          }
        },
        {
          kind: "DELEGATION_GRANT_UPSERT",
          tenantId,
          grantId: "grant_c",
          delegationGrant: {
            tenantId,
            grantId: "grant_c",
            delegatorAgentId: "agt_principal",
            delegateeAgentId: "agt_worker"
          }
        },
        {
          kind: "DELEGATION_GRANT_UPSERT",
          tenantId,
          grantId: "grant_a",
          delegationGrant: {
            tenantId,
            grantId: "grant_a",
            delegatorAgentId: "agt_principal",
            delegateeAgentId: "agt_worker"
          }
        },
        {
          kind: "CAPABILITY_ATTESTATION_UPSERT",
          tenantId,
          attestationId: "attestation_c",
          capabilityAttestation: {
            tenantId,
            attestationId: "attestation_c",
            subjectAgentId: "agt_subject",
            issuerAgentId: "agt_issuer",
            capability: "cap.read"
          }
        },
        {
          kind: "CAPABILITY_ATTESTATION_UPSERT",
          tenantId,
          attestationId: "attestation_a",
          capabilityAttestation: {
            tenantId,
            attestationId: "attestation_a",
            subjectAgentId: "agt_subject",
            issuerAgentId: "agt_issuer",
            capability: "cap.read"
          }
        },
        {
          kind: "CAPABILITY_ATTESTATION_UPSERT",
          tenantId,
          attestationId: "attestation_b",
          capabilityAttestation: {
            tenantId,
            attestationId: "attestation_b",
            subjectAgentId: "agt_subject",
            issuerAgentId: "agt_issuer",
            capability: "cap.read"
          }
        },
        {
          kind: "SUB_AGENT_WORK_ORDER_UPSERT",
          tenantId,
          workOrderId: "work_order_c",
          workOrder: {
            tenantId,
            workOrderId: "work_order_c",
            principalAgentId: "agt_principal",
            subAgentId: "agt_sub",
            status: "created"
          }
        },
        {
          kind: "SUB_AGENT_WORK_ORDER_UPSERT",
          tenantId,
          workOrderId: "work_order_a",
          workOrder: {
            tenantId,
            workOrderId: "work_order_a",
            principalAgentId: "agt_principal",
            subAgentId: "agt_sub",
            status: "created"
          }
        },
        {
          kind: "SUB_AGENT_WORK_ORDER_UPSERT",
          tenantId,
          workOrderId: "work_order_b",
          workOrder: {
            tenantId,
            workOrderId: "work_order_b",
            principalAgentId: "agt_principal",
            subAgentId: "agt_sub",
            status: "created"
          }
        },
        {
          kind: "SUB_AGENT_COMPLETION_RECEIPT_UPSERT",
          tenantId,
          receiptId: "receipt_c",
          completionReceipt: {
            tenantId,
            receiptId: "receipt_c",
            workOrderId: "work_order_c",
            principalAgentId: "agt_principal",
            subAgentId: "agt_sub",
            status: "success"
          }
        },
        {
          kind: "SUB_AGENT_COMPLETION_RECEIPT_UPSERT",
          tenantId,
          receiptId: "receipt_a",
          completionReceipt: {
            tenantId,
            receiptId: "receipt_a",
            workOrderId: "work_order_a",
            principalAgentId: "agt_principal",
            subAgentId: "agt_sub",
            status: "success"
          }
        },
        {
          kind: "SUB_AGENT_COMPLETION_RECEIPT_UPSERT",
          tenantId,
          receiptId: "receipt_b",
          completionReceipt: {
            tenantId,
            receiptId: "receipt_b",
            workOrderId: "work_order_b",
            principalAgentId: "agt_principal",
            subAgentId: "agt_sub",
            status: "success"
          }
        }
      ]
    });

    const allGrants = await store.listDelegationGrants({ tenantId, includeRevoked: true, limit: 20, offset: 0 });
    assert.deepEqual(
      allGrants.map((row) => row.grantId),
      ["grant_a", "grant_b", "grant_c"]
    );

    const activeGrants = await store.listDelegationGrants({ tenantId, includeRevoked: false, limit: 20, offset: 0 });
    assert.deepEqual(
      activeGrants.map((row) => row.grantId),
      ["grant_a", "grant_c"]
    );

    const attestations = await store.listCapabilityAttestations({ tenantId, limit: 20, offset: 0 });
    assert.deepEqual(
      attestations.map((row) => row.attestationId),
      ["attestation_a", "attestation_b", "attestation_c"]
    );

    const workOrders = await store.listSubAgentWorkOrders({ tenantId, limit: 20, offset: 0 });
    assert.deepEqual(
      workOrders.map((row) => row.workOrderId),
      ["work_order_a", "work_order_b", "work_order_c"]
    );

    const receipts = await store.listSubAgentCompletionReceipts({ tenantId, limit: 20, offset: 0 });
    assert.deepEqual(
      receipts.map((row) => row.receiptId),
      ["receipt_a", "receipt_b", "receipt_c"]
    );
  } finally {
    await store.close();
  }
});
