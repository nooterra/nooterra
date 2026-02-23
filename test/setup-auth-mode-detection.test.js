import assert from "node:assert/strict";
import test from "node:test";

import { detectDeploymentAuthMode } from "../scripts/setup/login.mjs";

test("auth mode detection: returns known mode from endpoint", async () => {
  const out = await detectDeploymentAuthMode({
    baseUrl: "https://api.settld.work",
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: true, authMode: "enterprise_preprovisioned", enterpriseProvisionedTenantsOnly: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });
  assert.equal(out.mode, "enterprise_preprovisioned");
  assert.equal(out.source, "endpoint");
  assert.equal(out.enterpriseProvisionedTenantsOnly, true);
});

test("auth mode detection: falls back to unknown on non-200", async () => {
  const out = await detectDeploymentAuthMode({
    baseUrl: "https://api.settld.work",
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: false }), {
        status: 404,
        headers: { "content-type": "application/json" }
      })
  });
  assert.equal(out.mode, "unknown");
  assert.equal(out.source, "http_404");
});
