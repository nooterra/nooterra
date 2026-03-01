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

const CAPABILITY_NAMESPACE_ERROR_PATTERN = Object.freeze({
  scheme: /(CAPABILITY_[A-Z0-9_]*SCHEME[A-Z0-9_]*|scheme)/i,
  format: /(CAPABILITY_[A-Z0-9_]*(FORMAT|NAMESPACE)[A-Z0-9_]*|format|lowercase|namespace)/i,
  reserved: /(CAPABILITY_[A-Z0-9_]*RESERVED[A-Z0-9_]*|reserved)/i,
  segmentLength: /(CAPABILITY_[A-Z0-9_]*(SEGMENT|LENGTH)[A-Z0-9_]*|segment|length)/i
});

function makeAttestationInput({ attestationId, capability }) {
  return {
    attestationId,
    tenantId: "tenant_default",
    subjectAgentId: "agt_subject_1",
    capability,
    level: CAPABILITY_ATTESTATION_LEVEL.ATTESTED,
    issuerAgentId: "agt_issuer_1",
    validity: {
      issuedAt: "2026-02-23T00:00:00.000Z",
      notBefore: "2026-02-23T00:00:00.000Z",
      expiresAt: "2027-02-23T00:00:00.000Z"
    },
    signature: {
      keyId: "key_agt_issuer_1",
      signature: "sig_namespace_1"
    },
    createdAt: "2026-02-23T00:00:00.000Z"
  };
}

function assertCapabilityNamespaceError(thunk, expectedPattern) {
  let err = null;
  try {
    thunk();
  } catch (candidate) {
    err = candidate;
  }
  assert.ok(err instanceof TypeError);
  assert.match(String(err.message ?? ""), expectedPattern);
  return err;
}

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

test("capability attestation: capability namespace accepts legacy + capability URI forms", () => {
  const legacy = buildCapabilityAttestationV1(
    makeAttestationInput({ attestationId: "catt_cap_ns_legacy_1", capability: "travel.booking" })
  );
  const uri = buildCapabilityAttestationV1(
    makeAttestationInput({ attestationId: "catt_cap_ns_uri_1", capability: "capability://travel.booking" })
  );
  const uriVersioned = buildCapabilityAttestationV1(
    makeAttestationInput({ attestationId: "catt_cap_ns_uri_v_1", capability: "capability://travel.booking@v2" })
  );

  assert.equal(legacy.capability, "travel.booking");
  assert.equal(uri.capability, "capability://travel.booking");
  assert.equal(uriVersioned.capability, "capability://travel.booking@v2");
  assert.equal(validateCapabilityAttestationV1(legacy), true);
  assert.equal(validateCapabilityAttestationV1(uri), true);
  assert.equal(validateCapabilityAttestationV1(uriVersioned), true);
});

test("capability attestation: capability namespace validation is deterministic and fail-closed", () => {
  const schemeOne = assertCapabilityNamespaceError(
    () => buildCapabilityAttestationV1(makeAttestationInput({ attestationId: "catt_cap_ns_scheme_1", capability: "https://travel.booking" })),
    CAPABILITY_NAMESPACE_ERROR_PATTERN.scheme
  );
  const schemeTwo = assertCapabilityNamespaceError(
    () => buildCapabilityAttestationV1(makeAttestationInput({ attestationId: "catt_cap_ns_scheme_2", capability: "https://travel.booking" })),
    CAPABILITY_NAMESPACE_ERROR_PATTERN.scheme
  );
  assert.equal(schemeOne.message, schemeTwo.message);

  const formatOne = assertCapabilityNamespaceError(
    () => buildCapabilityAttestationV1(makeAttestationInput({ attestationId: "catt_cap_ns_format_1", capability: "capability://Travel.booking" })),
    CAPABILITY_NAMESPACE_ERROR_PATTERN.format
  );
  const formatTwo = assertCapabilityNamespaceError(
    () => buildCapabilityAttestationV1(makeAttestationInput({ attestationId: "catt_cap_ns_format_2", capability: "capability://Travel.booking" })),
    CAPABILITY_NAMESPACE_ERROR_PATTERN.format
  );
  assert.equal(formatOne.message, formatTwo.message);

  const reservedCandidates = [
    "capability://reserved.audit",
    "capability://internal.audit",
    "capability://system.audit",
    "capability://nooterra.audit"
  ];
  let matchedReserved = false;
  for (const capability of reservedCandidates) {
    try {
      buildCapabilityAttestationV1(makeAttestationInput({ attestationId: `catt_cap_ns_reserved_${capability.length}`, capability }));
    } catch (err) {
      const message = String(err?.message ?? "");
      if (!CAPABILITY_NAMESPACE_ERROR_PATTERN.reserved.test(message)) continue;
      matchedReserved = true;
      const repeat = assertCapabilityNamespaceError(
        () => buildCapabilityAttestationV1(makeAttestationInput({ attestationId: `catt_cap_ns_reserved_repeat_${capability.length}`, capability })),
        CAPABILITY_NAMESPACE_ERROR_PATTERN.reserved
      );
      assert.equal(message, repeat.message);
      break;
    }
  }
  assert.equal(matchedReserved, true);

  const longSegmentCapability = `capability://travel.${"a".repeat(80)}`;
  const segmentOne = assertCapabilityNamespaceError(
    () => buildCapabilityAttestationV1(makeAttestationInput({ attestationId: "catt_cap_ns_segment_1", capability: longSegmentCapability })),
    CAPABILITY_NAMESPACE_ERROR_PATTERN.segmentLength
  );
  const segmentTwo = assertCapabilityNamespaceError(
    () => buildCapabilityAttestationV1(makeAttestationInput({ attestationId: "catt_cap_ns_segment_2", capability: longSegmentCapability })),
    CAPABILITY_NAMESPACE_ERROR_PATTERN.segmentLength
  );
  assert.equal(segmentOne.message, segmentTwo.message);
});
