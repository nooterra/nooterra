import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";

test("API e2e: simulation harness run and read endpoints persist deterministic run artifacts", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const runRes = await request(api, {
    method: "POST",
    path: "/simulation/harness/runs",
    headers: { "x-idempotency-key": "sim_harness_run_1", "x-nooterra-protocol": "1.0" },
    body: {
      scenarioId: "sim_api_s8_1",
      seed: "sim-api-seed-1",
      startedAt: "2026-02-01T00:00:00.000Z",
      actions: [
        {
          actionId: "act_low_1",
          actorId: "agent.calendar",
          managerId: "manager.alex",
          ecosystemId: "ecosystem.default",
          actionType: "calendar_sync",
          riskTier: "low",
          amountCents: 0
        },
        {
          actionId: "act_high_1",
          actorId: "agent.wallet",
          managerId: "manager.alex",
          ecosystemId: "ecosystem.default",
          actionType: "funds_transfer",
          riskTier: "high",
          amountCents: 250000
        }
      ]
    }
  });

  assert.equal(runRes.statusCode, 201, runRes.body);
  assert.equal(runRes.json?.ok, true);
  assert.match(String(runRes.json?.runSha256 ?? ""), /^[0-9a-f]{64}$/);
  assert.equal(runRes.json?.artifact?.schemaVersion, "SimulationHarnessRunArtifact.v1");
  assert.equal(runRes.json?.artifact?.run?.summary?.blockedActions, 1);

  const getRes = await request(api, {
    method: "GET",
    path: `/simulation/harness/runs/${encodeURIComponent(runRes.json.runSha256)}`
  });

  assert.equal(getRes.statusCode, 200, getRes.body);
  assert.equal(getRes.json?.ok, true);
  assert.equal(getRes.json?.artifact?.runSha256, runRes.json?.runSha256);
  assert.deepEqual(getRes.json?.artifact, runRes.json?.artifact);
});
