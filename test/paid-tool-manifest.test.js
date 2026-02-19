import test from "node:test";
import assert from "node:assert/strict";

import {
  computePaidToolManifestHashV1,
  normalizePaidToolManifestV1,
  validatePaidToolManifestV1
} from "../src/core/paid-tool-manifest.js";

test("paid tool manifest: v2 normalizes tool class/risk/security fields", () => {
  const manifest = normalizePaidToolManifestV1({
    schemaVersion: "PaidToolManifest.v2",
    providerId: "prov_manifest_v2",
    upstreamBaseUrl: "https://provider.example",
    publishProofJwksUrl: "https://provider.example/.well-known/provider-publish-jwks.json",
    capabilityTags: ["Search", "MCP", "search"],
    defaults: {
      amountCents: 500,
      currency: "usd",
      idempotency: "idempotent",
      signatureMode: "required",
      toolClass: "read",
      riskLevel: "low",
      requiredSignatures: ["output"],
      requestBinding: "recommended"
    },
    tools: [
      {
        toolId: "bridge.search",
        mcpToolName: "bridge.search",
        description: "search",
        method: "GET",
        upstreamPath: "/search",
        paidPath: "/tool/search",
        pricing: { amountCents: 500, currency: "usd" },
        auth: { mode: "none" },
        tool_class: "compute",
        risk_level: "med",
        capability_tags: ["web", "search", "web"],
        security: {
          required_signatures: ["quote", "output"],
          request_binding: "strict"
        }
      }
    ]
  });

  assert.equal(manifest.schemaVersion, "PaidToolManifest.v2");
  assert.deepEqual(manifest.capabilityTags, ["search", "mcp"]);
  assert.equal(manifest.tools[0].toolClass, "compute");
  assert.equal(manifest.tools[0].riskLevel, "medium");
  assert.deepEqual(manifest.tools[0].capabilityTags, ["web", "search"]);
  assert.deepEqual(manifest.tools[0].security.requiredSignatures, ["quote", "output"]);
  assert.equal(manifest.tools[0].security.requestBinding, "strict");
  assert.match(computePaidToolManifestHashV1(manifest), /^[0-9a-f]{64}$/);
});

test("paid tool manifest: v2 rejects invalid tool class", () => {
  const result = validatePaidToolManifestV1({
    schemaVersion: "PaidToolManifest.v2",
    providerId: "prov_manifest_v2_bad",
    upstreamBaseUrl: "https://provider.example",
    publishProofJwksUrl: "https://provider.example/.well-known/provider-publish-jwks.json",
    defaults: {
      amountCents: 500,
      currency: "USD",
      idempotency: "idempotent",
      signatureMode: "required"
    },
    tools: [
      {
        toolId: "bridge.search",
        method: "GET",
        paidPath: "/tool/search",
        pricing: { amountCents: 500, currency: "USD" },
        auth: { mode: "none" },
        toolClass: "invalid"
      }
    ]
  });
  assert.equal(result.ok, false);
  assert.match(String(result.message ?? ""), /toolClass/);
});

test("paid tool manifest: v1 remains backward compatible", () => {
  const manifest = normalizePaidToolManifestV1({
    schemaVersion: "PaidToolManifest.v1",
    providerId: "prov_manifest_v1",
    upstreamBaseUrl: "https://provider.example",
    publishProofJwksUrl: "https://provider.example/.well-known/provider-publish-jwks.json",
    defaults: {
      amountCents: 500,
      currency: "USD",
      idempotency: "idempotent",
      signatureMode: "required"
    },
    tools: [
      {
        toolId: "bridge.search",
        method: "GET",
        paidPath: "/tool/search",
        pricing: { amountCents: 500, currency: "USD" },
        auth: { mode: "none" },
        toolClass: "action",
        riskLevel: "high"
      }
    ]
  });

  assert.equal(manifest.schemaVersion, "PaidToolManifest.v1");
  assert.equal(Object.hasOwn(manifest.tools[0], "toolClass"), false);
  assert.equal(Object.hasOwn(manifest.tools[0], "riskLevel"), false);
});
