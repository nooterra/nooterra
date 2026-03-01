import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { createAjv2020 } from "./helpers/ajv-2020.js";
import { AGENT_LOCATOR_REASON_CODE, resolveAgentLocator } from "../src/core/agent-locator.js";

async function loadAgentLocatorSchema() {
  const schemaPath = path.resolve(process.cwd(), "docs/spec/schemas/AgentLocator.v1.schema.json");
  return JSON.parse(await fs.readFile(schemaPath, "utf8"));
}

test("AgentLocator.v1 schema validates resolved helper output", async () => {
  const ajv = createAjv2020();
  const schema = await loadAgentLocatorSchema();
  ajv.addSchema(schema, schema.$id);

  const validate = ajv.getSchema("https://nooterra.local/schemas/AgentLocator.v1.schema.json");
  assert.ok(validate);

  const resolved = resolveAgentLocator({
    agentRef: "agent://agt_loc_1",
    candidates: [
      {
        tenantId: "tenant_default",
        agentId: "agt_loc_1",
        displayName: "Locator One",
        executionCoordinatorDid: "did:web:locator.example",
        host: { endpoint: "https://locator.example/agent" }
      }
    ]
  });

  assert.equal(resolved.ok, true);
  assert.equal(validate(resolved.locator), true, JSON.stringify(validate.errors ?? [], null, 2));
});

test("AgentLocator resolver is deterministic under candidate input reordering", () => {
  const candidatesA = [
    {
      tenantId: "tenant_b",
      agentId: "agt_loc_1",
      displayName: "Locator One B",
      host: { endpoint: "https://locator-b.example/agent" }
    },
    {
      tenantId: "tenant_a",
      agentId: "agt_loc_1",
      displayName: "Locator One A",
      host: { endpoint: "https://locator-a.example/agent" }
    }
  ];
  const candidatesB = [candidatesA[1], candidatesA[0]];

  const resultA = resolveAgentLocator({ agentRef: "agt_loc_1", candidates: candidatesA });
  const resultB = resolveAgentLocator({ agentRef: "agt_loc_1", candidates: candidatesB });

  assert.equal(resultA.ok, false);
  assert.equal(resultB.ok, false);
  assert.equal(resultA.reasonCode, AGENT_LOCATOR_REASON_CODE.AMBIGUOUS);
  assert.equal(resultA.locator.deterministicHash, resultB.locator.deterministicHash);
  assert.deepEqual(resultA.locator.candidates, resultB.locator.candidates);
});

test("AgentLocator resolver emits fail-closed reason codes", () => {
  const malformed = resolveAgentLocator({ agentRef: "", candidates: [] });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.reasonCode, AGENT_LOCATOR_REASON_CODE.MALFORMED);

  const notFound = resolveAgentLocator({
    agentRef: "agt_missing",
    candidates: [{ tenantId: "tenant_default", agentId: "agt_other" }]
  });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.reasonCode, AGENT_LOCATOR_REASON_CODE.NOT_FOUND);

  const ambiguous = resolveAgentLocator({
    agentRef: "agt_dupe",
    candidates: [
      { tenantId: "tenant_a", agentId: "agt_dupe" },
      { tenantId: "tenant_b", agentId: "agt_dupe" }
    ]
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reasonCode, AGENT_LOCATOR_REASON_CODE.AMBIGUOUS);
});
