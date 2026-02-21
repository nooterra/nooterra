import test from "node:test";
import assert from "node:assert/strict";

import { createStarterPolicyPack, listPolicyPackTemplates, POLICY_PACK_SCHEMA_VERSION } from "../src/core/policy-packs.js";

test("policy packs: exposes five starter templates", () => {
  const templates = listPolicyPackTemplates();
  assert.equal(templates.length, 5);
  assert.deepEqual(
    templates.map((row) => row.packId),
    ["engineering-spend", "procurement-enterprise", "data-api-buyer", "support-automation", "finance-controls"]
  );
});

test("policy packs: createStarterPolicyPack returns deterministic copy", () => {
  const policyPack = createStarterPolicyPack({ packId: "engineering-spend" });
  assert.equal(policyPack?.schemaVersion, POLICY_PACK_SCHEMA_VERSION);
  assert.equal(policyPack?.packId, "engineering-spend");
  assert.equal(policyPack?.metadata?.vertical, "engineering");
  assert.equal(Array.isArray(policyPack?.policy?.approvals), true);
  assert.equal(policyPack?.policy?.approvals?.[0]?.tierId, "auto");
});

test("policy packs: list results are deep-cloned", () => {
  const first = listPolicyPackTemplates();
  first[0].metadata.name = "tampered";
  first[0].policyDefaults.allowlists.providers.push("evil-provider");

  const second = listPolicyPackTemplates();
  assert.equal(second[0].metadata.name, "Engineering Spend Guardrails");
  assert.equal(second[0].policyDefaults.allowlists.providers.includes("evil-provider"), false);
});

test("policy packs: unknown starter returns null", () => {
  assert.equal(createStarterPolicyPack({ packId: "missing-pack" }), null);
});
