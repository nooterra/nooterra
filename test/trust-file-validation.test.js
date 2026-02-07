import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

async function runScript(args) {
  const proc = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
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

test("trust file validator accepts fixture trust.json", async () => {
  const script = path.resolve(process.cwd(), "scripts", "trust", "validate-trust-file.mjs");
  const trustPath = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "trust.json");
  const res = await runScript([script, trustPath]);
  assert.equal(res.code, 0, res.stderr || res.stdout);
  assert.match(res.stdout.trim(), /^ok governanceRoots=\d+ timeAuthorities=\d+$/);
});

test("trust file validator rejects invalid JSON", async () => {
  const script = path.resolve(process.cwd(), "scripts", "trust", "validate-trust-file.mjs");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-trust-"));
  await test.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const fp = path.join(tmp, "trust.json");
  await fs.writeFile(fp, "{ not json", "utf8");

  const res = await runScript([script, fp]);
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /invalid JSON/);
});

test("trust file validator rejects wrong shapes", async () => {
  const script = path.resolve(process.cwd(), "scripts", "trust", "validate-trust-file.mjs");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-trust-"));
  await test.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const fp = path.join(tmp, "trust.json");
  await fs.writeFile(fp, JSON.stringify({ governanceRoots: ["nope"] }), "utf8");

  const res = await runScript([script, fp]);
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /governanceRoots must be an object/);
});
