import test from "node:test";
import assert from "node:assert/strict";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import {
  listHighScaleSimulationTiers,
  runHighScaleSimulationHarness
} from "../src/services/simulation/high-scale-harness.js";

test("high-scale simulation harness: exposes deterministic tier list including 10k", () => {
  const tiersA = listHighScaleSimulationTiers();
  const tiersB = listHighScaleSimulationTiers();
  assert.deepEqual(tiersA, tiersB);
  assert.equal(tiersA.includes("scale_10000"), true);
});

test("high-scale simulation harness: smoke tier output is deterministic", () => {
  const runA = runHighScaleSimulationHarness({
    tier: "smoke_100",
    seed: "seed_noo263_1",
    startedAt: "2026-02-05T00:00:00.000Z"
  });
  const runB = runHighScaleSimulationHarness({
    tier: "smoke_100",
    seed: "seed_noo263_1",
    startedAt: "2026-02-05T00:00:00.000Z"
  });

  assert.equal(runA.ok, true);
  assert.equal(runA.harnessSha256, runB.harnessSha256);
  assert.equal(canonicalJsonStringify(runA), canonicalJsonStringify(runB));
});

test("high-scale simulation harness: scale_10000 tier runs with stable telemetry", () => {
  const run = runHighScaleSimulationHarness({
    tier: "scale_10000",
    seed: "seed_noo263_2",
    startedAt: "2026-02-05T00:00:00.000Z",
    limits: {
      maxAgents: 20_000,
      maxActions: 20_000,
      maxEstimatedMemoryBytes: 10_000_000
    }
  });

  assert.equal(run.ok, true);
  assert.equal(run.telemetry.agentCount, 10_000);
  assert.equal(run.telemetry.actionCount, 10_000);
  assert.equal(run.telemetry.blockedActions, 0);
});

test("high-scale simulation harness: resource limit failures emit explicit diagnostics", () => {
  const run = runHighScaleSimulationHarness({
    tier: "scale_1000",
    seed: "seed_noo263_3",
    startedAt: "2026-02-05T00:00:00.000Z",
    limits: {
      maxAgents: 500
    }
  });

  assert.equal(run.ok, false);
  assert.equal(
    run.diagnostics.some((diag) => diag.code === "SIM_RESOURCE_LIMIT_EXCEEDED"),
    true
  );
});

