import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { createAjv2020 } from "./helpers/ajv-2020.js";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";
import {
  DELEGATION_GRANT_RISK_CLASS,
  buildDelegationGrantV1,
  revokeDelegationGrantV1,
  validateDelegationGrantV1
} from "../src/core/delegation-grant.js";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
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
  return buildDelegationGrantV1({
    grantId: "dgrant_test_001",
    tenantId: "tenant_test",
    delegatorAgentId: "agt_delegator",
    delegateeAgentId: "agt_delegatee",
    scope: {
      allowedProviderIds: ["provider_a"],
      allowedToolIds: ["tool_1"],
      allowedRiskClasses: [DELEGATION_GRANT_RISK_CLASS.FINANCIAL, DELEGATION_GRANT_RISK_CLASS.ACTION],
      sideEffectingAllowed: true
    },
    spendLimit: {
      currency: "USD",
      maxPerCallCents: 500,
      maxTotalCents: 5000
    },
    chainBinding: {
      depth: 0,
      maxDelegationDepth: 2
    },
    validity: {
      issuedAt: "2026-02-23T00:00:00.000Z",
      notBefore: "2026-02-23T00:00:00.000Z",
      expiresAt: "2026-03-01T00:00:00.000Z"
    },
    revocation: {
      revocable: true,
      revokedAt: null,
      revocationReasonCode: null
    },
    createdAt: "2026-02-23T00:00:00.000Z"
  });
}

test("delegation grant schema validates constructed fixture", async () => {
  const ajv = createAjv2020();
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") {
      ajv.addSchema(schema, schema.$id);
    }
  }

  const validate = ajv.getSchema("https://settld.local/schemas/DelegationGrant.v1.schema.json");
  assert.ok(validate);

  const grant = buildFixtureGrant();
  assert.equal(validate(grant), true, JSON.stringify(validate.errors ?? [], null, 2));
  assert.equal(validateDelegationGrantV1(grant), true);
});

test("delegation grant canonical hash is deterministic independent of key insertion order", () => {
  const grant = buildFixtureGrant();
  const h1 = sha256Hex(canonicalJsonStringify(grant));
  const h2 = sha256Hex(canonicalJsonStringify(reverseObjectKeys(grant)));
  assert.equal(h1, h2);
});

test("revokeDelegationGrantV1 marks grant revoked and remains schema-valid", () => {
  const grant = buildFixtureGrant();
  const revoked = revokeDelegationGrantV1({
    grant,
    revokedAt: "2026-02-24T00:00:00.000Z",
    revocationReasonCode: "POLICY_VIOLATION"
  });
  assert.equal(typeof revoked.revocation?.revokedAt, "string");
  assert.equal(revoked.revocation?.revocationReasonCode, "POLICY_VIOLATION");
  assert.equal(revoked.grantHash === grant.grantHash, false);
  assert.equal(validateDelegationGrantV1(revoked), true);
});
