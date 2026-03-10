import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveStarterWorkerDraft,
  formatStarterWorkerCapabilities,
  formatStarterWorkerTags,
  starterWorkerProfiles,
  starterWorkerSetPresets
} from "../src/product/starter-worker-catalog.js";

test("starter worker catalog: profile ids are unique and sets only reference known profiles", () => {
  const ids = starterWorkerProfiles.map((profile) => profile.id);
  assert.equal(new Set(ids).size, ids.length);

  const knownProfileIds = new Set(ids);
  for (const preset of starterWorkerSetPresets) {
    assert.ok(Array.isArray(preset.profileIds));
    assert.ok(preset.profileIds.length > 0);
    for (const profileId of preset.profileIds) {
      assert.equal(knownProfileIds.has(profileId), true, `unknown starter profile ${profileId}`);
    }
  }
});

test("starter worker catalog: deriveStarterWorkerDraft is deterministic for a tenant", () => {
  const profile = starterWorkerProfiles[0];
  const draftA = deriveStarterWorkerDraft(profile, {
    tenantId: "Tenant Alpha",
    endpointBaseUrl: "https://workers.example.test/public"
  });
  const draftB = deriveStarterWorkerDraft(profile, {
    tenantId: "Tenant Alpha",
    endpointBaseUrl: "https://workers.example.test/public/"
  });

  assert.deepEqual(draftA, draftB);
  assert.equal(draftA.agentId, "agt_tenant_alpha_comparison_concierge");
  assert.equal(draftA.ownerId, "svc_tenant_alpha_comparison_concierge");
  assert.equal(draftA.endpoint, "https://workers.example.test/public/agt_tenant_alpha_comparison_concierge");
  assert.deepEqual(draftA.capabilities, profile.capabilities);
  assert.deepEqual(draftA.tags, profile.tags);
  assert.equal(draftA.metadata?.phase1ManagedNetwork?.profileId, profile.id);
  assert.ok(Array.isArray(draftA.metadata?.phase1ManagedNetwork?.families));
  assert.ok(draftA.metadata.phase1ManagedNetwork.families.length > 0);
});

test("starter worker catalog: format helpers expose profile text for studio forms", () => {
  const profile = starterWorkerProfiles[1];
  assert.equal(formatStarterWorkerCapabilities(profile), "capability://consumer.purchase.execute");
  assert.equal(formatStarterWorkerTags(profile), "phase1, purchase, consumer");
});
