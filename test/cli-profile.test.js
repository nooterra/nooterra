import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runSettld(args) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "bin", "settld.js"), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

test("CLI: settld profile init + validate + simulate", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-profile-cli-"));
  const profilePath = path.join(tmpDir, "engineering.profile.json");
  const scenarioPath = path.join(REPO_ROOT, "test", "fixtures", "profile", "scenario-allow.json");

  try {
    const initRun = runSettld(["profile", "init", "engineering-spend", "--out", profilePath, "--format", "json"]);
    assert.equal(initRun.status, 0, `stdout:\n${initRun.stdout}\n\nstderr:\n${initRun.stderr}`);
    const initBody = JSON.parse(initRun.stdout);
    assert.equal(initBody.ok, true);
    assert.equal(initBody.profileId, "engineering-spend");
    const profileDoc = JSON.parse(await fs.readFile(profilePath, "utf8"));
    assert.equal(profileDoc.schemaVersion, "SettldProfile.v1");
    assert.equal(profileDoc.profileId, "engineering-spend");

    const validateRun = runSettld(["profile", "validate", profilePath, "--format", "json"]);
    assert.equal(validateRun.status, 0, `stdout:\n${validateRun.stdout}\n\nstderr:\n${validateRun.stderr}`);
    const validateBody = JSON.parse(validateRun.stdout);
    assert.equal(validateBody.schemaVersion, "SettldProfileValidationReport.v1");
    assert.equal(validateBody.ok, true);
    assert.deepEqual(validateBody.errors, []);

    const simulateRunA = runSettld(["profile", "simulate", profilePath, "--scenario", scenarioPath, "--format", "json"]);
    assert.equal(simulateRunA.status, 0, `stdout:\n${simulateRunA.stdout}\n\nstderr:\n${simulateRunA.stderr}`);
    const simulateBodyA = JSON.parse(simulateRunA.stdout);
    assert.equal(simulateBodyA.schemaVersion, "SettldProfileSimulationReport.v1");
    assert.equal(simulateBodyA.ok, true);
    assert.equal(simulateBodyA.decision, "allow");
    assert.equal(simulateBodyA.requiredApprovers, 1);

    const simulateRunChallenge = runSettld([
      "profile",
      "simulate",
      profilePath,
      "--scenario-json",
      JSON.stringify({
        providerId: "openai",
        toolId: "llm.inference",
        amountUsdCents: 120000,
        monthToDateSpendUsdCents: 200000,
        approvalsProvided: 0,
        receiptSigned: true,
        toolManifestHashPresent: true
      }),
      "--format",
      "json"
    ]);
    assert.equal(simulateRunChallenge.status, 0, `stdout:\n${simulateRunChallenge.stdout}\n\nstderr:\n${simulateRunChallenge.stderr}`);
    const simulateBodyChallenge = JSON.parse(simulateRunChallenge.stdout);
    assert.equal(simulateBodyChallenge.decision, "challenge");
    assert.equal(simulateBodyChallenge.requiredApprovers, 1);

    const simulateRunB = runSettld(["profile", "simulate", profilePath, "--scenario", scenarioPath, "--format", "json"]);
    assert.equal(simulateRunB.status, 0, `stdout:\n${simulateRunB.stdout}\n\nstderr:\n${simulateRunB.stderr}`);
    assert.equal(simulateRunA.stdout, simulateRunB.stdout, "simulate output should be deterministic for identical inputs");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
