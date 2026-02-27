import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { createAjv2020 } from "./helpers/ajv-2020.js";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";
import {
  AUTHORITY_GRANT_RISK_CLASS,
  AUTHORITY_GRANT_TRUST_REASON_CODE,
  buildAuthorityGrantV1,
  evaluateAuthorityGrantTrustV1,
  revokeAuthorityGrantV1,
  validateAuthorityGrantV1
} from "../src/core/authority-grant.js";

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
  for (const key of Object.keys(value).reverse()) {
    out[key] = reverseObjectKeys(value[key]);
  }
  return out;
}

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

function buildFixtureGrant() {
  return buildAuthorityGrantV1({
    grantId: "agrant_test_001",
    tenantId: "tenant_test",
    principalRef: {
      principalType: "org",
      principalId: "org_test"
    },
    granteeAgentId: "agt_delegatee",
    scope: {
      allowedProviderIds: ["provider_a"],
      allowedToolIds: ["tool_1"],
      allowedRiskClasses: [AUTHORITY_GRANT_RISK_CLASS.FINANCIAL, AUTHORITY_GRANT_RISK_CLASS.ACTION],
      sideEffectingAllowed: true
    },
    spendEnvelope: {
      currency: "USD",
      maxPerCallCents: 500,
      maxTotalCents: 5000
    },
    chainBinding: {
      depth: 0,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-25T00:00:00.000Z",
      notBefore: "2026-02-25T00:00:00.000Z",
      expiresAt: "2026-03-01T00:00:00.000Z"
    },
    revocation: {
      revocable: true,
      revokedAt: null,
      revocationReasonCode: null
    },
    createdAt: "2026-02-25T00:00:00.000Z"
  });
}

test("authority grant schema validates constructed fixture", async () => {
  const ajv = createAjv2020();
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") {
      ajv.addSchema(schema, schema.$id);
    }
  }

  const validate = ajv.getSchema("https://nooterra.local/schemas/AuthorityGrant.v1.schema.json");
  assert.ok(validate);

  const grant = buildFixtureGrant();
  assert.equal(validate(grant), true, JSON.stringify(validate.errors ?? [], null, 2));
  assert.equal(validateAuthorityGrantV1(grant), true);
});

test("authority grant canonical hash is deterministic independent of key insertion order", () => {
  const grant = buildFixtureGrant();
  const h1 = sha256Hex(canonicalJsonStringify(grant));
  const h2 = sha256Hex(canonicalJsonStringify(reverseObjectKeys(grant)));
  assert.equal(h1, h2);
});

test("revokeAuthorityGrantV1 marks grant revoked and remains schema-valid", () => {
  const grant = buildFixtureGrant();
  const revoked = revokeAuthorityGrantV1({
    grant,
    revokedAt: "2026-02-26T00:00:00.000Z",
    revocationReasonCode: "POLICY_VIOLATION"
  });
  assert.equal(typeof revoked.revocation?.revokedAt, "string");
  assert.equal(revoked.revocation?.revocationReasonCode, "POLICY_VIOLATION");
  assert.equal(revoked.grantHash === grant.grantHash, false);
  assert.equal(validateAuthorityGrantV1(revoked), true);
});

test("authority grant revocation requires explicit reason metadata", () => {
  assert.throws(
    () =>
      buildAuthorityGrantV1({
        ...buildFixtureGrant(),
        revocation: {
          revocable: true,
          revokedAt: "2026-02-26T00:00:00.000Z",
          revocationReasonCode: null
        }
      }),
    /revocation\.revocationReasonCode is required/
  );
});

test("revokeAuthorityGrantV1 defaults reason metadata when caller omits reason", () => {
  const grant = buildFixtureGrant();
  const revoked = revokeAuthorityGrantV1({
    grant,
    revokedAt: "2026-02-26T00:00:00.000Z"
  });
  assert.equal(revoked.revocation?.revocationReasonCode, "AUTHORITY_GRANT_REVOKED_UNSPECIFIED");
  assert.equal(validateAuthorityGrantV1(revoked), true);
});

test("evaluateAuthorityGrantTrustV1 preserves historical reads but blocks unsafe writes", () => {
  const grant = buildFixtureGrant();
  const revoked = revokeAuthorityGrantV1({
    grant,
    revokedAt: "2026-02-26T00:00:00.000Z",
    revocationReasonCode: "MANUAL_REVOKE"
  });

  const writeAfterRevoke = evaluateAuthorityGrantTrustV1({
    grant: revoked,
    at: "2026-02-26T00:00:01.000Z",
    operation: "write"
  });
  assert.equal(writeAfterRevoke.allowed, false);
  assert.equal(writeAfterRevoke.reasonCode, AUTHORITY_GRANT_TRUST_REASON_CODE.REVOKED);

  const readHistorical = evaluateAuthorityGrantTrustV1({
    grant: revoked,
    at: "2026-02-26T00:00:01.000Z",
    operation: "read",
    evidenceAt: "2026-02-25T12:00:00.000Z"
  });
  assert.equal(readHistorical.allowed, true);
  assert.equal(readHistorical.historicalVerificationOnly, true);
  assert.equal(readHistorical.reasonCode, AUTHORITY_GRANT_TRUST_REASON_CODE.HISTORICAL_READ_ALLOWED);

  const readWithoutEvidence = evaluateAuthorityGrantTrustV1({
    grant: revoked,
    at: "2026-02-26T00:00:01.000Z",
    operation: "read"
  });
  assert.equal(readWithoutEvidence.allowed, false);
  assert.equal(
    readWithoutEvidence.reasonCode,
    AUTHORITY_GRANT_TRUST_REASON_CODE.HISTORICAL_READ_EVIDENCE_REQUIRED
  );
});
