import test from "node:test";
import assert from "node:assert/strict";

import { starterWorkerProfiles } from "../src/product/starter-worker-catalog.js";
import { buildStarterProviderManifest, deriveStarterProviderDraft } from "../src/product/starter-provider-catalog.js";

test("starter provider catalog: purchase runner draft carries delegated session contract", () => {
  const profile = starterWorkerProfiles.find((entry) => entry.id === "purchase_runner");
  assert.ok(profile);
  const draft = deriveStarterProviderDraft(profile, {
    tenantId: "tenant_demo",
    baseUrl: "https://workers.nooterra.example"
  });
  assert.equal(draft.providerId, "provider_tenant_demo_purchase_runner");
  assert.equal(draft.toolClass, "action");
  assert.equal(draft.riskLevel, "high");
  assert.equal(draft.requestBinding, "strict");
  assert.equal(draft.idempotency, "side_effecting");
  assert.match(String(draft.executionAdapterSummary ?? ""), /Delegated account sessions/);
  assert.equal(draft.phase1ManagedMetadata?.executionAdapter?.adapterId, "delegated_account_session_checkout");
  assert.equal(draft.delegatedBrowserRuntime?.runtime, "playwright_delegated_browser_session");
  assert.equal(draft.delegatedBrowserRuntime?.requiresBrowserProfile, true);
});

test("starter provider catalog: manifest includes managed execution adapter metadata", () => {
  const profile = starterWorkerProfiles.find((entry) => entry.id === "account_admin");
  assert.ok(profile);
  const draft = deriveStarterProviderDraft(profile, {
    tenantId: "tenant_demo",
    baseUrl: "https://workers.nooterra.example"
  });
  const manifest = buildStarterProviderManifest({
    profile,
    providerDraft: draft,
    publishProofJwksUrl: "https://workers.nooterra.example/.well-known/provider-publish-jwks.json",
    contactUrl: "https://nooterra.ai/contact",
    termsUrl: "https://nooterra.ai/terms"
  });
  assert.equal(manifest.schemaVersion, "PaidToolManifest.v2");
  assert.equal(manifest.providerId, "provider_tenant_demo_account_admin");
  assert.equal(manifest.tools[0]?.metadata?.phase1ManagedNetwork?.profileId, "account_admin");
  assert.equal(
    manifest.tools[0]?.metadata?.phase1ManagedNetwork?.executionAdapter?.adapterId,
    "delegated_account_session_account_admin"
  );
  assert.equal(
    manifest.tools[0]?.metadata?.phase1ManagedNetwork?.executionAdapter?.delegatedBrowserRuntime?.runtime,
    "playwright_delegated_browser_session"
  );
  assert.equal(manifest.tools[0]?.security?.requestBinding, "strict");
});
