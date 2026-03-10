import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { deriveStarterProviderDraft } from "../src/product/starter-provider-catalog.js";
import { starterWorkerProfiles } from "../src/product/starter-worker-catalog.js";
import { request } from "./api-test-harness.js";

function findProfile(profileId) {
  return starterWorkerProfiles.find((row) => row?.id === profileId) ?? null;
}

test("API e2e: ops managed specialists status reports publication gaps and certified readiness", async () => {
  const api = createApi({ opsTokens: "tok_ops_supply:ops_read" });
  const tenantId = "tenant_ops_supply";

  const purchaseProfile = findProfile("purchase_runner");
  const bookingProfile = findProfile("booking_concierge");
  assert.ok(purchaseProfile);
  assert.ok(bookingProfile);

  const purchaseDraft = deriveStarterProviderDraft(purchaseProfile, { tenantId, baseUrl: "https://managed.example.com" });
  api.store.marketplaceProviderPublications.set("test_publication_purchase_runner", {
    schemaVersion: "MarketplaceProviderPublication.v1",
    publicationId: "pub_purchase_runner",
    tenantId,
    providerId: purchaseDraft.providerId,
    providerRef: "jwk:test_purchase_runner",
    status: "certified",
    certified: true,
    baseUrl: purchaseDraft.baseUrl,
    manifest: {
      schemaVersion: "PaidToolManifest.v2",
      tools: [
        {
          toolId: purchaseDraft.toolId,
          paidPath: purchaseDraft.paidPath,
          toolClass: "action",
          riskLevel: "high",
          metadata: {
            phase1ManagedNetwork: purchaseDraft.phase1ManagedMetadata
          }
        }
      ]
    },
    providerSigning: {
      keyId: "kid_purchase_runner",
      algorithm: "ed25519",
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIB-test\n-----END PUBLIC KEY-----\n"
    },
    conformanceReport: {
      schemaVersion: "ProviderPublishConformance.v1",
      generatedAt: "2026-03-07T12:00:00.000Z",
      verdict: { ok: true }
    },
    publishedAt: "2026-03-07T12:00:00.000Z",
    certifiedAt: "2026-03-07T12:01:00.000Z",
    updatedAt: "2026-03-07T12:01:00.000Z"
  });

  const response = await request(api, {
    method: "GET",
    path: "/ops/network/managed-specialists",
    headers: {
      authorization: "Bearer tok_ops_supply",
      "x-proxy-tenant-id": tenantId
    }
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json?.ok, true);
  assert.equal(response.json?.managedSpecialists?.schemaVersion, "OpsManagedSpecialistsStatus.v1");

  const specialists = Array.isArray(response.json?.managedSpecialists?.specialists)
    ? response.json.managedSpecialists.specialists
    : [];
  assert.ok(specialists.length >= 2);

  const purchaseRow = specialists.find((row) => row?.profileId === "purchase_runner");
  const bookingRow = specialists.find((row) => row?.profileId === "booking_concierge");
  assert.ok(purchaseRow);
  assert.ok(bookingRow);

  assert.equal(purchaseRow.expectedProviderId, purchaseDraft.providerId);
  assert.equal(purchaseRow.expectedToolId, purchaseDraft.toolId);
  assert.equal(purchaseRow.readiness?.published, true);
  assert.equal(purchaseRow.readiness?.certified, true);
  assert.equal(purchaseRow.readiness?.invocationReady, true);
  assert.deepEqual(purchaseRow.readiness?.gaps ?? [], []);

  assert.equal(bookingRow.readiness?.publicationStatus, "missing");
  assert.equal(bookingRow.readiness?.published, false);
  assert.equal(bookingRow.readiness?.invocationReady, false);
  assert.ok((bookingRow.readiness?.gaps ?? []).some((gap) => gap?.code === "NOT_PUBLISHED"));

  assert.equal(Number(response.json?.managedSpecialists?.summary?.publishedCount ?? 0), 1);
  assert.equal(Number(response.json?.managedSpecialists?.summary?.certifiedCount ?? 0), 1);
  assert.equal(Number(response.json?.managedSpecialists?.summary?.invocationReadyCount ?? 0), 1);
});
