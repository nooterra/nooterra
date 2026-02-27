import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

async function runCli(args, { env } = {}) {
  const bin = path.resolve(process.cwd(), "packages", "artifact-verify", "bin", "nooterra-verify.js");
  const proc = spawn(process.execPath, [bin, ...args], {
    env: { ...process.env, ...(env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stdout = [];
  const stderr = [];
  proc.stdout.on("data", (d) => stdout.push(d));
  proc.stderr.on("data", (d) => stderr.push(d));
  const code = await new Promise((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
  return { code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
}

test("nooterra-verify --format sarif emits SARIF JSON with ruleIds", async () => {
  const trustPath = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "trust.json");
  const trust = JSON.parse(await fs.readFile(trustPath, "utf8"));
  const env = { NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust.governanceRoots ?? {}) };

  const target = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "jobproof", "strict-fail-missing-verification-report");
  const res = await runCli(["--format", "sarif", "--strict", "--job-proof", target], { env });
  assert.equal(res.code, 1);
  const sarif = JSON.parse(res.stdout);
  assert.equal(sarif.version, "2.1.0");
  const results = sarif?.runs?.[0]?.results ?? [];
  assert.equal(Array.isArray(results), true);
  assert.equal(results.length > 0, true);
  assert.equal(typeof results[0]?.ruleId, "string");
});
