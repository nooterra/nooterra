import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { createAjv2020 } from "./helpers/ajv-2020.js";

import { buildReputationEventV1, validateReputationEventV1 } from "../src/core/reputation-event.js";
import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";

async function loadSchemas() {
  const base = path.resolve(process.cwd(), "docs/spec/schemas");
  const names = (await fs.readdir(base)).filter((n) => n.endsWith(".json")).sort();
  const schemas = [];
  for (const name of names) {
    const raw = await fs.readFile(path.join(base, name), "utf8");
    schemas.push(JSON.parse(raw));
  }
  return schemas;
}

test("reputation event schema validates canonical example", async () => {
  const ajv = createAjv2020();
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") {
      ajv.addSchema(schema, schema.$id);
    }
  }

  const validate = ajv.getSchema("https://nooterra.local/schemas/ReputationEvent.v1.schema.json");
  assert.ok(validate);

  const example = buildReputationEventV1({
    eventId: "rep_vrd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    tenantId: "tenant_default",
    occurredAt: "2026-02-11T12:00:00.000Z",
    eventKind: "verdict_issued",
    subject: {
      agentId: "agt_payee_demo",
      toolId: "tool_call",
      counterpartyAgentId: "agt_payer_demo",
      role: "payee"
    },
    sourceRef: {
      kind: "arbitration_verdict",
      artifactId: "arbitration_verdict_avd_demo",
      caseId: "arb_case_tc_deadbeef",
      disputeId: "disp_tc_deadbeef",
      agreementHash: "1".repeat(64),
      verdictHash: "a".repeat(64)
    },
    facts: {
      verdictOutcome: "payee_win",
      releaseRatePct: 100,
      amountCents: 2000
    }
  });

  assert.equal(validate(example), true, JSON.stringify(validate.errors ?? [], null, 2));
  assert.equal(validateReputationEventV1(example), true);
});

test("reputation event canonical hash is stable under key reorder", () => {
  const event = buildReputationEventV1({
    eventId: "rep_dec_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    tenantId: "tenant_default",
    occurredAt: "2026-02-11T12:00:00.000Z",
    eventKind: "decision_approved",
    subject: {
      agentId: "agt_payee_demo",
      toolId: "tool_call",
      role: "payee"
    },
    sourceRef: {
      kind: "settlement_decision",
      decisionHash: "b".repeat(64)
    },
    facts: {
      amountSettledCents: 2500,
      latencyMs: 350
    }
  });
  const canonical = canonicalJsonStringify(event);
  const hashA = sha256Hex(canonical);
  const reordered = {
    tenantId: event.tenantId,
    eventHash: event.eventHash,
    occurredAt: event.occurredAt,
    artifactType: event.artifactType,
    schemaVersion: event.schemaVersion,
    subject: { ...event.subject },
    eventKind: event.eventKind,
    sourceRef: { ...event.sourceRef },
    facts: { ...event.facts },
    eventId: event.eventId,
    artifactId: event.artifactId
  };
  const hashB = sha256Hex(canonicalJsonStringify(reordered));
  assert.equal(hashB, hashA);
});

test("reputation event schema rejects invalid occurredAt date-time", async () => {
  const ajv = createAjv2020();
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") {
      ajv.addSchema(schema, schema.$id);
    }
  }

  const validate = ajv.getSchema("https://nooterra.local/schemas/ReputationEvent.v1.schema.json");
  assert.ok(validate);

  const invalid = buildReputationEventV1({
    eventId: "rep_vrd_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    tenantId: "tenant_default",
    occurredAt: "2026-02-11T12:00:00.000Z",
    eventKind: "decision_rejected",
    subject: {
      agentId: "agt_payee_demo",
      toolId: "tool_call",
      role: "payee"
    },
    sourceRef: {
      kind: "settlement_decision",
      decisionHash: "c".repeat(64)
    },
    facts: {
      amountRequestedCents: 1500
    }
  });
  invalid.occurredAt = "not-a-date";

  assert.equal(validate(invalid), false);
  assert.match(JSON.stringify(validate.errors ?? []), /"format":"date-time"/);
});

test("reputation event schema accepts sybil penalty event kind", async () => {
  const ajv = createAjv2020();
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") {
      ajv.addSchema(schema, schema.$id);
    }
  }

  const validate = ajv.getSchema("https://nooterra.local/schemas/ReputationEvent.v1.schema.json");
  assert.ok(validate);

  const event = buildReputationEventV1({
    eventId: "rep_pen_sybil_d1f4c4f3d8f49a3b934390d2f04d8c8f7419f44b85d1bc7f6b5f6b16f45a0001",
    tenantId: "tenant_default",
    occurredAt: "2026-02-13T11:00:00.000Z",
    eventKind: "penalty_sybil",
    subject: {
      agentId: "agt_sybil_subject",
      counterpartyAgentId: "agt_sybil_reporter",
      role: "system",
      toolId: "agent_card"
    },
    sourceRef: {
      kind: "agent_card_abuse_report",
      sourceId: "acabr_sybil_1"
    },
    facts: {
      reasonCode: "PENALTY_SYBIL",
      amountPenalizedCents: 300
    }
  });

  assert.equal(validate(event), true, JSON.stringify(validate.errors ?? [], null, 2));
  assert.equal(validateReputationEventV1(event), true);
});
