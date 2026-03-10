import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { createAjv2020 } from "./helpers/ajv-2020.js";
import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";
import {
  APPROVAL_DECISION_SCHEMA_VERSION,
  APPROVAL_REQUEST_SCHEMA_VERSION,
  AUTHORITY_ENVELOPE_REVERSIBILITY_CLASS,
  AUTHORITY_ENVELOPE_RISK_CLASS,
  AUTHORITY_ENVELOPE_SCHEMA_VERSION,
  LEGACY_HUMAN_APPROVAL_DECISION_SCHEMA_VERSION,
  approvalDecisionV1FromHumanApprovalDecision,
  approvalDecisionV1ToHumanApprovalDecision,
  buildApprovalDecisionV1,
  buildApprovalRequestV1,
  buildAuthorityEnvelopeV1,
  compileApprovalActionFromAuthorityEnvelopeV1,
  validateApprovalDecisionV1,
  validateApprovalRequestV1,
  validateAuthorityEnvelopeV1
} from "../src/core/authority-envelope.js";

function isPlainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map((item) => reverseObjectKeys(item));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).reverse()) out[key] = reverseObjectKeys(value[key]);
  return out;
}

async function loadSchemas() {
  const base = path.resolve(process.cwd(), "docs/spec/schemas");
  const names = (await fs.readdir(base)).filter((name) => name.endsWith(".json")).sort();
  const schemas = [];
  for (const name of names) {
    schemas.push(JSON.parse(await fs.readFile(path.join(base, name), "utf8")));
  }
  return schemas;
}

function buildFixtureAuthorityEnvelope() {
  return buildAuthorityEnvelopeV1({
    envelopeId: "aenv_test_001",
    actor: { agentId: "agt_worker" },
    principalRef: { principalType: "org", principalId: "org_test" },
    purpose: "Execute code review work order",
    capabilitiesRequested: ["capability://code.review"],
    dataClassesRequested: ["source_code"],
    sideEffectsRequested: ["external_side_effect"],
    spendEnvelope: {
      currency: "USD",
      maxPerCallCents: 125_000,
      maxTotalCents: 125_000
    },
    delegationRights: {
      mayDelegate: false,
      maxDepth: 0,
      allowedDelegateeAgentIds: []
    },
    duration: {
      maxDurationSeconds: 3600,
      deadlineAt: "2026-03-06T12:00:00.000Z"
    },
    downstreamRecipients: ["agt_worker"],
    reversibilityClass: AUTHORITY_ENVELOPE_REVERSIBILITY_CLASS.PARTIALLY_REVERSIBLE,
    riskClass: AUTHORITY_ENVELOPE_RISK_CLASS.HIGH,
    evidenceRequirements: ["approval_log", "receipt"],
    createdAt: "2026-03-06T11:00:00.000Z"
  });
}

test("authority envelope schema validates constructed fixture", async () => {
  const ajv = createAjv2020();
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") ajv.addSchema(schema, schema.$id);
  }
  const validate = ajv.getSchema("https://nooterra.local/schemas/AuthorityEnvelope.v1.schema.json");
  assert.ok(validate);

  const envelope = buildFixtureAuthorityEnvelope();
  assert.equal(envelope.schemaVersion, AUTHORITY_ENVELOPE_SCHEMA_VERSION);
  assert.equal(validate(envelope), true, JSON.stringify(validate.errors ?? [], null, 2));
  assert.equal(validateAuthorityEnvelopeV1(envelope), true);
});

test("authority envelope canonical hash is deterministic independent of key insertion order", () => {
  const envelope = buildFixtureAuthorityEnvelope();
  const h1 = sha256Hex(canonicalJsonStringify(envelope));
  const h2 = sha256Hex(canonicalJsonStringify(reverseObjectKeys(envelope)));
  assert.equal(h1, h2);
});

test("approval request binds deterministically to envelope and action", () => {
  const envelope = buildFixtureAuthorityEnvelope();
  const requestA = buildApprovalRequestV1({
    authorityEnvelope: envelope,
    requestedBy: "agt_principal",
    requestedAt: "2026-03-06T11:01:00.000Z",
    approvalPolicy: {
      requireApprovalAboveCents: 100_000,
      strictEvidenceRefs: true
    }
  });
  const requestB = buildApprovalRequestV1({
    authorityEnvelope: reverseObjectKeys(envelope),
    requestedBy: "agt_principal",
    requestedAt: "2026-03-06T11:01:00.000Z",
    approvalPolicy: {
      strictEvidenceRefs: true,
      requireApprovalAboveCents: 100_000
    }
  });
  assert.equal(requestA.schemaVersion, APPROVAL_REQUEST_SCHEMA_VERSION);
  assert.deepEqual(requestA, requestB);
  assert.equal(validateApprovalRequestV1(requestA), true);
});

test("approval decision converts cleanly to and from legacy human approval decision", () => {
  const envelope = buildFixtureAuthorityEnvelope();
  const request = buildApprovalRequestV1({
    authorityEnvelope: envelope,
    requestedBy: "agt_principal",
    requestedAt: "2026-03-06T11:01:00.000Z"
  });
  const action = compileApprovalActionFromAuthorityEnvelopeV1(envelope, { actionId: request.actionRef.actionId });
  const actionSha256 = sha256Hex(canonicalJsonStringify(action));

  const decision = buildApprovalDecisionV1({
    decisionId: "adec_test_001",
    requestId: request.requestId,
    envelopeHash: envelope.envelopeHash,
    actionId: request.actionRef.actionId,
    actionSha256,
    decidedBy: "human.ops",
    decidedAt: "2026-03-06T11:02:00.000Z",
    approved: true,
    evidenceRefs: ["ticket:NOO-209"],
    binding: {
      authorityGrantRef: "agrant_test_001"
    }
  });

  assert.equal(decision.schemaVersion, APPROVAL_DECISION_SCHEMA_VERSION);
  assert.equal(validateApprovalDecisionV1(decision), true);

  const legacy = approvalDecisionV1ToHumanApprovalDecision(decision);
  assert.equal(legacy.schemaVersion, LEGACY_HUMAN_APPROVAL_DECISION_SCHEMA_VERSION);

  const roundTrip = approvalDecisionV1FromHumanApprovalDecision({
    decision: legacy,
    requestId: request.requestId,
    envelopeHash: envelope.envelopeHash
  });
  assert.equal(validateApprovalDecisionV1(roundTrip), true);
  assert.equal(roundTrip.actionSha256, decision.actionSha256);
  assert.equal(roundTrip.requestId, decision.requestId);
  assert.equal(roundTrip.envelopeHash, decision.envelopeHash);
});
