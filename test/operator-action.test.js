import test from "node:test";
import assert from "node:assert/strict";

import { createEd25519Keypair } from "../src/core/crypto.js";
import { SIGNER_KIND, requiredSignerKindForEventType } from "../src/core/event-policy.js";
import {
  OPERATOR_ACTION_SCHEMA_VERSION,
  OPERATOR_ACTION_SIGNATURE_SCHEMA_VERSION,
  computeOperatorActionHashV1,
  signOperatorActionV1,
  verifyOperatorActionV1
} from "../src/core/operator-action.js";

function buildBaseAction() {
  return {
    schemaVersion: OPERATOR_ACTION_SCHEMA_VERSION,
    actionId: "opact_0001",
    caseRef: {
      kind: "dispute",
      caseId: "dsp_0001"
    },
    action: "OVERRIDE_ALLOW",
    justificationCode: "OPS_OVERRIDE_APPROVED",
    justification: "evidence supports override",
    actor: {
      operatorId: "op_0001",
      role: "incident_commander",
      tenantId: "tenant_default",
      sessionId: "ops_session_01",
      metadata: {
        source: "ops-console",
        ticketId: "INC-55"
      }
    },
    actedAt: "2026-02-21T00:00:00.000Z",
    metadata: {
      severity: "critical",
      checklist: ["evidence-reviewed", "lead-approved"]
    }
  };
}

test("operator action: canonical hash is stable under key reorder", () => {
  const base = buildBaseAction();
  const hashA = computeOperatorActionHashV1({ action: base });
  const reordered = {
    actedAt: base.actedAt,
    metadata: {
      checklist: ["evidence-reviewed", "lead-approved"],
      severity: "critical"
    },
    actionId: base.actionId,
    schemaVersion: base.schemaVersion,
    actor: {
      sessionId: base.actor.sessionId,
      metadata: {
        ticketId: "INC-55",
        source: "ops-console"
      },
      role: base.actor.role,
      operatorId: base.actor.operatorId,
      tenantId: base.actor.tenantId
    },
    justification: base.justification,
    action: base.action,
    caseRef: {
      caseId: base.caseRef.caseId,
      kind: base.caseRef.kind
    },
    justificationCode: base.justificationCode
  };
  const hashB = computeOperatorActionHashV1({ action: reordered });
  assert.equal(hashB, hashA);
});

test("operator action: sign + verify succeeds", () => {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const signed = signOperatorActionV1({
    action: buildBaseAction(),
    signedAt: "2026-02-21T00:00:01.000Z",
    publicKeyPem,
    privateKeyPem
  });
  assert.equal(signed.signature.schemaVersion, OPERATOR_ACTION_SIGNATURE_SCHEMA_VERSION);
  const verified = verifyOperatorActionV1({ action: signed, publicKeyPem });
  assert.equal(verified.ok, true);
  assert.equal(verified.code, null);
  assert.equal(verified.actionHash, signed.signature.actionHash);
  assert.equal(verified.signedAction?.signature?.actionHash, signed.signature.actionHash);
});

test("operator action: verify returns normalized signed artifact only", () => {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const signed = signOperatorActionV1({
    action: buildBaseAction(),
    signedAt: "2026-02-21T00:00:01.000Z",
    publicKeyPem,
    privateKeyPem
  });
  const noisy = {
    ...signed,
    unsignedNoise: "drop-me",
    signature: {
      ...signed.signature,
      unsignedSignatureNoise: "drop-me-too"
    }
  };
  const verified = verifyOperatorActionV1({ action: noisy, publicKeyPem });
  assert.equal(verified.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(verified.signedAction, "unsignedNoise"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(verified.signedAction.signature, "unsignedSignatureNoise"), false);
});

test("operator action: invalid signature is rejected with stable code", () => {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const signed = signOperatorActionV1({
    action: buildBaseAction(),
    signedAt: "2026-02-21T00:00:01.000Z",
    publicKeyPem,
    privateKeyPem
  });
  const tampered = JSON.parse(JSON.stringify(signed));
  tampered.signature.signatureBase64 = `${tampered.signature.signatureBase64.slice(0, -2)}ab`;
  const verified = verifyOperatorActionV1({ action: tampered, publicKeyPem });
  assert.equal(verified.ok, false);
  assert.equal(verified.code, "OPERATOR_ACTION_SIGNATURE_INVALID");
  assert.equal(verified.error, "signature invalid");
});

test("operator action: schema mismatches return stable verification codes", () => {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const signed = signOperatorActionV1({
    action: buildBaseAction(),
    signedAt: "2026-02-21T00:00:01.000Z",
    publicKeyPem,
    privateKeyPem
  });

  const schemaMismatch = JSON.parse(JSON.stringify(signed));
  schemaMismatch.schemaVersion = "OperatorAction.v2";
  const schemaResult = verifyOperatorActionV1({ action: schemaMismatch, publicKeyPem });
  assert.equal(schemaResult.ok, false);
  assert.equal(schemaResult.code, "OPERATOR_ACTION_SCHEMA_MISMATCH");
  assert.equal(schemaResult.error, "action.schemaVersion must be OperatorAction.v1");

  const signatureSchemaMismatch = JSON.parse(JSON.stringify(signed));
  signatureSchemaMismatch.signature.schemaVersion = "OperatorActionSignature.v2";
  const signatureSchemaResult = verifyOperatorActionV1({ action: signatureSchemaMismatch, publicKeyPem });
  assert.equal(signatureSchemaResult.ok, false);
  assert.equal(signatureSchemaResult.code, "OPERATOR_ACTION_SIGNATURE_SCHEMA_MISMATCH");
  assert.equal(signatureSchemaResult.error, "action.signature.schemaVersion must be OperatorActionSignature.v1");
});

test("event policy: operator emergency event types require operator signatures", () => {
  assert.equal(requiredSignerKindForEventType("OPERATOR_EMERGENCY_PAUSE"), SIGNER_KIND.OPERATOR);
  assert.equal(requiredSignerKindForEventType("OPERATOR_EMERGENCY_REVOKE"), SIGNER_KIND.OPERATOR);
  assert.equal(requiredSignerKindForEventType("OPERATOR_EMERGENCY_RESUME"), SIGNER_KIND.OPERATOR);
  assert.equal(requiredSignerKindForEventType("OPERATOR_EMERGENCY_CUSTOM"), SIGNER_KIND.OPERATOR);
});

test("operator action: actedAt must be ISO date-time", () => {
  const invalidAction = {
    ...buildBaseAction(),
    actedAt: "2026-02-21"
  };
  assert.throws(
    () => computeOperatorActionHashV1({ action: invalidAction }),
    /action\.actedAt must be an ISO date-time/
  );
});
