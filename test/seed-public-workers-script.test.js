import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("seed-public-workers script: dry run emits machine-readable starter plan", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/setup/seed-public-workers.mjs", "--profile-set", "shopping_lane", "--dry-run"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NOOTERRA_BASE_URL: "https://api.nooterra.example",
        NOOTERRA_API_KEY: "sk_test_seed_demo",
        NOOTERRA_TENANT_ID: "tenant_demo",
        NOOTERRA_STARTER_ENDPOINT_BASE_URL: "https://workers.nooterra.example/agents"
      },
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schemaVersion, "StarterWorkerSeedResult.v1");
  assert.equal(output.dryRun, true);
  assert.equal(output.seededCount, 3);
  assert.deepEqual(
    output.results.map((row) => row.profileId),
    ["comparison_concierge", "purchase_runner", "support_followup"]
  );
  assert.equal(output.results[0].agentId, "agt_tenant_demo_comparison_concierge");
  assert.equal(output.results[0].endpoint, "https://workers.nooterra.example/agents/agt_tenant_demo_comparison_concierge");
  assert.equal(output.results[1].metadata?.phase1ManagedNetwork?.profileId, "purchase_runner");
  assert.ok(Array.isArray(output.results[2].metadata?.phase1ManagedNetwork?.proofCoverage));
});

test("seed-public-workers script: dry run can include starter provider publication plan", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/setup/seed-public-workers.mjs", "--profile", "purchase_runner", "--include-providers", "--dry-run"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NOOTERRA_BASE_URL: "https://api.nooterra.example",
        NOOTERRA_API_KEY: "sk_test_seed_demo",
        NOOTERRA_TENANT_ID: "tenant_demo",
        NOOTERRA_STARTER_ENDPOINT_BASE_URL: "https://workers.nooterra.example/agents",
        NOOTERRA_STARTER_PROVIDER_BASE_URL: "https://workers.nooterra.example",
        NOOTERRA_PROVIDER_PUBLISH_PROOF_JWKS_URL: "https://workers.nooterra.example/.well-known/provider-publish-jwks.json"
      },
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schemaVersion, "StarterWorkerSeedResult.v1");
  assert.equal(output.seededCount, 1);
  assert.equal(output.results[0]?.profileId, "purchase_runner");
  assert.equal(output.results[0]?.provider?.providerId, "provider_tenant_demo_purchase_runner");
  assert.equal(output.results[0]?.provider?.toolId, "tool_purchase_runner");
  assert.equal(
    output.results[0]?.provider?.manifest?.tools?.[0]?.metadata?.phase1ManagedNetwork?.executionAdapter?.adapterId,
    "delegated_account_session_checkout"
  );
  assert.equal(
    output.results[0]?.provider?.manifest?.tools?.[0]?.metadata?.phase1ManagedNetwork?.executionAdapter?.delegatedBrowserRuntime?.runtime,
    "playwright_delegated_browser_session"
  );
});
