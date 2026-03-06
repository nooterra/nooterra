import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("seed-public-workers script: dry run emits machine-readable starter plan", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/setup/seed-public-workers.mjs", "--profile-set", "shipping_lane", "--dry-run"],
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
    ["code_worker", "qa_worker", "docs_worker"]
  );
  assert.equal(output.results[0].agentId, "agt_tenant_demo_code_worker");
  assert.equal(output.results[0].endpoint, "https://workers.nooterra.example/agents/agt_tenant_demo_code_worker");
});
