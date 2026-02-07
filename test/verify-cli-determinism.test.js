import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

async function runCli(args, { env } = {}) {
  const bin = path.resolve(process.cwd(), "packages", "artifact-verify", "bin", "settld-verify.js");
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

test("settld-verify --format json output is byte-stable across runs (with concurrency)", async () => {
  const trustPath = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "trust.json");
  const trust = JSON.parse(await fs.readFile(trustPath, "utf8"));
  const env = { SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust.governanceRoots ?? {}) };

  const target = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "jobproof", "strict-pass");
  const args = ["--format", "json", "--strict", "--hash-concurrency", "8", "--job-proof", target];

  const a = await runCli(args, { env: { ...env, LANG: "C", LC_ALL: "C" } });
  const b = await runCli(args, { env: { ...env, LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8" } });
  const c = await runCli(args, { env: { ...env, LANG: "C", LC_ALL: "C" } });
  assert.equal(a.code, 0, a.stderr || a.stdout);
  assert.equal(b.code, 0, b.stderr || b.stdout);
  assert.equal(c.code, 0, c.stderr || c.stdout);
  assert.equal(a.stdout, b.stdout);
  assert.equal(a.stdout, c.stdout);
});

test("settld-verify rejects invalid --hash-concurrency", async () => {
  const target = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "jobproof", "strict-pass");
  const res = await runCli(["--format", "json", "--hash-concurrency", "0", "--job-proof", target], { env: {} });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /invalid --hash-concurrency/);
});
