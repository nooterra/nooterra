import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runSimulationHighScaleHarnessGate } from "../scripts/ci/run-simulation-high-scale-harness.mjs";

function buildInput({ tier = "smoke_100", limits = {} } = {}) {
  return {
    schemaVersion: "NooterraSimulationHighScaleHarnessInput.v1",
    tier,
    seed: "seed_noo263_gate_1",
    startedAt: "2026-02-05T00:00:00.000Z",
    limits
  };
}

test("high-scale harness gate: strict pass on smoke tier", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-sim-high-scale-pass-"));
  const inputPath = path.join(root, "input.json");
  const reportPath = path.join(root, "report.json");
  await fs.writeFile(inputPath, JSON.stringify(buildInput(), null, 2), "utf8");

  const report = await runSimulationHighScaleHarnessGate({
    inputPath,
    reportPath,
    now: "2026-02-05T00:00:00.000Z"
  });

  assert.equal(report.strictOk, true);
  assert.equal(report.run.ok, true);
});

test("high-scale harness gate: resource-limit failure is fail-closed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-sim-high-scale-fail-"));
  const inputPath = path.join(root, "input.json");
  const reportPath = path.join(root, "report.json");
  await fs.writeFile(
    inputPath,
    JSON.stringify(
      buildInput({
        tier: "scale_1000",
        limits: { maxAgents: 100 }
      }),
      null,
      2
    ),
    "utf8"
  );

  const report = await runSimulationHighScaleHarnessGate({
    inputPath,
    reportPath,
    now: "2026-02-05T00:00:00.000Z"
  });

  assert.equal(report.strictOk, false);
  assert.equal(report.run.ok, false);
  assert.equal(
    report.run.diagnostics.some((diag) => diag.code === "SIM_RESOURCE_LIMIT_EXCEEDED"),
    true
  );
});

