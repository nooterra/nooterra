import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(REPO_ROOT, "test", "fixtures", "profile", "cli-contract", "v1");

function runSettld(args) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "bin", "settld.js"), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1_048_576
  });
  return {
    status: result.status ?? (result.error?.code === "ETIMEDOUT" ? 124 : 1),
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

async function readFixture(name) {
  return JSON.parse(await fs.readFile(path.join(FIXTURE_DIR, name), "utf8"));
}

test("profile CLI contract fixtures: init/validate/simulate outputs match committed snapshots", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-profile-contract-"));
  const profilePath = path.join(tmpDir, "engineering.profile.json");
  const scenarioPath = path.join(REPO_ROOT, "test", "fixtures", "profile", "scenario-allow.json");
  try {
    const initRun = runSettld(["profile", "init", "engineering-spend", "--out", profilePath, "--force", "--format", "json"]);
    assert.equal(initRun.status, 0, `stdout:\n${initRun.stdout}\n\nstderr:\n${initRun.stderr}`);
    const initActual = JSON.parse(initRun.stdout);
    initActual.outPath = "__PROFILE_PATH__";

    const validateRun = runSettld(["profile", "validate", profilePath, "--format", "json"]);
    assert.equal(validateRun.status, 0, `stdout:\n${validateRun.stdout}\n\nstderr:\n${validateRun.stderr}`);
    const validateActual = JSON.parse(validateRun.stdout);

    const simulateRun = runSettld(["profile", "simulate", profilePath, "--scenario", scenarioPath, "--format", "json"]);
    assert.equal(simulateRun.status, 0, `stdout:\n${simulateRun.stdout}\n\nstderr:\n${simulateRun.stderr}`);
    const simulateActual = JSON.parse(simulateRun.stdout);

    assert.deepEqual(initActual, await readFixture("profile-init.engineering-spend.output.json"));
    assert.deepEqual(validateActual, await readFixture("profile-validate.engineering-spend.output.json"));
    assert.deepEqual(simulateActual, await readFixture("profile-simulate.allow.output.json"));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
