import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import Ajv from "ajv/dist/2020.js";

async function loadSchemas() {
  const base = path.resolve(process.cwd(), "docs/spec/schemas");
  const names = (await fs.readdir(base)).filter((name) => name.endsWith(".json")).sort();
  const out = [];
  for (const name of names) {
    const raw = await fs.readFile(path.join(base, name), "utf8");
    out.push(JSON.parse(raw));
  }
  return out;
}

test("AgentIdentity.v1 schema validates canonical shape", async () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") {
      ajv.addSchema(schema, schema.$id);
    }
  }

  const validate = ajv.getSchema("https://settld.local/schemas/AgentIdentity.v1.schema.json");
  assert.ok(validate);

  const valid = {
    schemaVersion: "AgentIdentity.v1",
    agentId: "agt_schema_test",
    tenantId: "tenant_default",
    displayName: "Schema Test Agent",
    status: "active",
    owner: { ownerType: "service", ownerId: "svc_schema_test" },
    keys: {
      keyId: "kid_schema_test",
      algorithm: "ed25519",
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END PUBLIC KEY-----"
    },
    capabilities: ["verify_bundle"],
    walletPolicy: {
      maxPerTransactionCents: 1000
    },
    metadata: { region: "us-east-1" },
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z"
  };

  assert.equal(validate(valid), true);

  const invalid = {
    ...valid,
    keys: { ...valid.keys }
  };
  delete invalid.keys.publicKeyPem;
  assert.equal(validate(invalid), false);
});
