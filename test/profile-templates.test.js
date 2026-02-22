import test from "node:test";
import assert from "node:assert/strict";

import { createStarterProfile, listProfileTemplates, PROFILE_SCHEMA_VERSION } from "../src/core/profile-templates.js";

test("profile templates: exposes six starter templates", () => {
  const templates = listProfileTemplates();
  assert.equal(templates.length, 6);
  assert.deepEqual(
    templates.map((row) => row.profileId),
    ["engineering-spend", "procurement", "data-api-buyer", "support-automation", "finance-controls", "growth-marketing"]
  );
});

test("profile templates: createStarterProfile returns deterministic copy", () => {
  const profile = createStarterProfile({ profileId: "engineering-spend" });
  assert.equal(profile?.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(profile?.profileId, "engineering-spend");
  assert.equal(profile?.metadata?.vertical, "engineering");
  assert.equal(Array.isArray(profile?.policy?.approvalTiers), true);
  assert.equal(profile?.policy?.approvalTiers?.[0]?.tierId, "auto");
});

test("profile templates: list results are deep-cloned", () => {
  const first = listProfileTemplates();
  first[0].metadata.name = "tampered";
  first[0].policyDefaults.allowlists.providers.push("evil-provider");

  const second = listProfileTemplates();
  assert.equal(second[0].metadata.name, "Engineering Spend");
  assert.equal(second[0].policyDefaults.allowlists.providers.includes("evil-provider"), false);
});

test("profile templates: unknown starter returns null", () => {
  assert.equal(createStarterProfile({ profileId: "missing-profile" }), null);
});
