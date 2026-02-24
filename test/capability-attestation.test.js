import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITY_ATTESTATION_LEVEL,
  CAPABILITY_ATTESTATION_RUNTIME_STATUS,
  buildCapabilityAttestationV1,
  evaluateCapabilityAttestationV1,
  revokeCapabilityAttestationV1,
  validateCapabilityAttestationV1
} from "../src/core/capability-attestation.js";

test("capability attestation: deterministic hash + validation", () => {
  const attestationA = buildCapabilityAttestationV1({
    attestationId: "catt_det_1",
    tenantId: "tenant_default",
    subjectAgentId: "agt_subject_1",
    capability: "travel.booking",
    level: CAPABILITY_ATTESTATION_LEVEL.ATTESTED,
    issuerAgentId: "agt_issuer_1",
    validity: {
      issuedAt: "2026-02-23T00:00:00.000Z",
      notBefore: "2026-02-23T00:00:00.000Z",
      expiresAt: "2027-02-23T00:00:00.000Z"
    },
    signature: {
      keyId: "key_agt_issuer_1",
      signature: "sig_1"
    },
    evidenceRefs: ["artifact://proof/1"],
    createdAt: "2026-02-23T00:00:00.000Z"
  });

  const attestationB = buildCapabilityAttestationV1({
    attestationId: "catt_det_1",
    tenantId: "tenant_default",
    subjectAgentId: "agt_subject_1",
    capability: "travel.booking",
    level: CAPABILITY_ATTESTATION_LEVEL.ATTESTED,
    issuerAgentId: "agt_issuer_1",
    validity: {
      issuedAt: "2026-02-23T00:00:00.000Z",
      notBefore: "2026-02-23T00:00:00.000Z",
      expiresAt: "2027-02-23T00:00:00.000Z"
    },
    signature: {
      keyId: "key_agt_issuer_1",
      signature: "sig_1"
    },
    evidenceRefs: ["artifact://proof/1"],
    createdAt: "2026-02-23T00:00:00.000Z"
  });

  assert.equal(attestationA.attestationHash, attestationB.attestationHash);
  assert.equal(attestationA.attestationHash.length, 64);
  assert.equal(validateCapabilityAttestationV1(attestationA), true);
});

test("capability attestation: runtime status valid/expired/not_active/revoked", () => {
  const attestation = buildCapabilityAttestationV1({
    attestationId: "catt_runtime_1",
    tenantId: "tenant_default",
    subjectAgentId: "agt_subject_1",
    capability: "travel.booking",
    level: CAPABILITY_ATTESTATION_LEVEL.CERTIFIED,
    issuerAgentId: "agt_issuer_1",
    validity: {
      issuedAt: "2026-02-23T00:00:00.000Z",
      notBefore: "2026-02-24T00:00:00.000Z",
      expiresAt: "2026-03-24T00:00:00.000Z"
    },
    signature: {
      keyId: "key_agt_issuer_1",
      signature: "sig_2"
    },
    createdAt: "2026-02-23T00:00:00.000Z"
  });

  const notActive = evaluateCapabilityAttestationV1(attestation, { at: "2026-02-23T12:00:00.000Z" });
  assert.equal(notActive.status, CAPABILITY_ATTESTATION_RUNTIME_STATUS.NOT_ACTIVE);
  assert.equal(notActive.isValid, false);

  const valid = evaluateCapabilityAttestationV1(attestation, { at: "2026-02-24T12:00:00.000Z" });
  assert.equal(valid.status, CAPABILITY_ATTESTATION_RUNTIME_STATUS.VALID);
  assert.equal(valid.isValid, true);

  const expired = evaluateCapabilityAttestationV1(attestation, { at: "2026-03-25T00:00:00.000Z" });
  assert.equal(expired.status, CAPABILITY_ATTESTATION_RUNTIME_STATUS.EXPIRED);
  assert.equal(expired.isValid, false);

  const revoked = revokeCapabilityAttestationV1({
    attestation,
    revokedAt: "2026-02-24T12:30:00.000Z",
    reasonCode: "MANUAL_REVOKE"
  });
  const revokedRuntime = evaluateCapabilityAttestationV1(revoked, { at: "2026-02-24T12:31:00.000Z" });
  assert.equal(revokedRuntime.status, CAPABILITY_ATTESTATION_RUNTIME_STATUS.REVOKED);
  assert.equal(revokedRuntime.isValid, false);
});
