import test from "node:test";
import assert from "node:assert/strict";

import { buildAuditLineageV1, verifyAuditLineageV1 } from "../src/core/audit-lineage.js";

function buildFixtureLineage() {
  return buildAuditLineageV1({
    tenantId: "tenant_default",
    filters: {
      traceId: "trace_audit_lineage_fixture_1",
      includeSessionEvents: true
    },
    records: [
      {
        kind: "TASK_QUOTE",
        recordId: "quote_fixture_1",
        at: "2026-02-25T01:05:00.000Z",
        status: "open",
        traceIds: ["trace_audit_lineage_fixture_1"],
        agentIds: ["agt_principal", "agt_worker"],
        refs: { quoteId: "quote_fixture_1", quoteHash: "a".repeat(64) }
      },
      {
        kind: "SESSION_EVENT",
        recordId: "evt_fixture_1",
        at: "2026-02-25T01:10:00.000Z",
        status: null,
        traceIds: ["trace_audit_lineage_fixture_1"],
        agentIds: ["agt_principal"],
        refs: {
          sessionId: "sess_fixture_1",
          eventType: "TASK_REQUESTED",
          chainHash: "b".repeat(64),
          prevChainHash: null,
          payloadHash: "c".repeat(64)
        }
      }
    ],
    limit: 100,
    offset: 0
  });
}

test("AuditLineage.v1 verification succeeds for deterministic lineage pack", () => {
  const lineage = buildFixtureLineage();
  const verified = verifyAuditLineageV1({ lineage });
  assert.equal(verified.ok, true);
  assert.equal(verified.code, null);
  assert.equal(verified.lineageHash, lineage.lineageHash);
  assert.equal(verified.recordCount, 2);
});

test("AuditLineage.v1 verification fails closed on lineage hash mismatch", () => {
  const lineage = buildFixtureLineage();
  const tampered = {
    ...lineage,
    records: [
      ...lineage.records.slice(0, 1),
      {
        ...lineage.records[1],
        status: "tampered"
      }
    ]
  };
  const verified = verifyAuditLineageV1({ lineage: tampered });
  assert.equal(verified.ok, false);
  assert.equal(verified.code, "AUDIT_LINEAGE_HASH_MISMATCH");
});

test("AuditLineage.v1 verification fails closed on non-deterministic record order", () => {
  const lineage = buildFixtureLineage();
  const reversed = {
    ...lineage,
    records: [...lineage.records].reverse()
  };
  const verified = verifyAuditLineageV1({ lineage: reversed });
  assert.equal(verified.ok, false);
  assert.equal(verified.code, "AUDIT_LINEAGE_RECORD_ORDER_INVALID");
});

