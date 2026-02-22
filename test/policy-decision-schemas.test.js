import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import Ajv from "ajv/dist/2020.js";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";
import { buildPolicyDecisionV1, validatePolicyDecisionV1 } from "../src/core/policy-decision.js";

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

test("PolicyDecision.v1 schema validates canonical decision artifact", async () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") {
      ajv.addSchema(schema, schema.$id);
    }
  }

  const validate = ajv.getSchema("https://settld.local/schemas/PolicyDecision.v1.schema.json");
  assert.ok(validate);

  const policyDecision = buildPolicyDecisionV1({
    decisionId: "pdec_schema_0001",
    tenantId: "tenant_default",
    runId: "run_schema_demo",
    settlementId: "setl_run_schema_demo",
    gateId: "gate_schema_demo",
    policyInput: { policyId: "policy_schema_demo", policyVersion: 1 },
    policyHashUsed: "3".repeat(64),
    verificationMethodHashUsed: "4".repeat(64),
    policyDecision: {
      decisionMode: "automatic",
      verificationStatus: "green",
      runStatus: "completed",
      shouldAutoResolve: true,
      settlementStatus: "released",
      releaseRatePct: 100,
      releaseAmountCents: 1250,
      refundAmountCents: 0,
      reasonCodes: []
    },
    createdAt: "2026-02-11T00:00:00.000Z"
  });

  assert.equal(validate(policyDecision), true, JSON.stringify(validate.errors ?? [], null, 2));
  assert.equal(validatePolicyDecisionV1(policyDecision), true);
});

test("PolicyDecision.v1 canonical hash is stable under key reorder", () => {
  const policyDecision = buildPolicyDecisionV1({
    decisionId: "pdec_schema_0002",
    tenantId: "tenant_default",
    runId: "run_schema_demo",
    settlementId: "setl_run_schema_demo",
    gateId: "gate_schema_demo",
    policyInput: { policyId: "policy_schema_demo", policyVersion: 1 },
    policyHashUsed: "3".repeat(64),
    verificationMethodHashUsed: "4".repeat(64),
    policyDecision: {
      decisionMode: "automatic",
      verificationStatus: "green",
      runStatus: "completed",
      shouldAutoResolve: true,
      settlementStatus: "released",
      releaseRatePct: 100,
      releaseAmountCents: 1250,
      refundAmountCents: 0,
      reasonCodes: []
    },
    createdAt: "2026-02-11T00:00:00.000Z"
  });
  const hashA = sha256Hex(canonicalJsonStringify(policyDecision));
  const reordered = {
    policyDecisionHash: policyDecision.policyDecisionHash,
    evaluationHash: policyDecision.evaluationHash,
    releaseAmountCents: policyDecision.releaseAmountCents,
    releaseRatePct: policyDecision.releaseRatePct,
    refundAmountCents: policyDecision.refundAmountCents,
    shouldAutoResolve: policyDecision.shouldAutoResolve,
    verificationStatus: policyDecision.verificationStatus,
    runStatus: policyDecision.runStatus,
    settlementStatus: policyDecision.settlementStatus,
    reasonCodes: policyDecision.reasonCodes,
    createdAt: policyDecision.createdAt,
    policyRef: policyDecision.policyRef,
    schemaVersion: policyDecision.schemaVersion,
    decisionId: policyDecision.decisionId,
    tenantId: policyDecision.tenantId,
    runId: policyDecision.runId,
    settlementId: policyDecision.settlementId,
    gateId: policyDecision.gateId,
    decisionMode: policyDecision.decisionMode
  };
  const hashB = sha256Hex(canonicalJsonStringify(reordered));
  assert.equal(hashB, hashA);
});
