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

test("trust rotation drill: overlap trust roots is safe; removing old root breaks strict verification", async () => {
  const trustPath = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "trust.json");
  const trust = JSON.parse(await fs.readFile(trustPath, "utf8"));
  const keypairsPath = path.resolve(process.cwd(), "test", "fixtures", "keys", "fixture_keypairs.json");
  const keypairs = JSON.parse(await fs.readFile(keypairsPath, "utf8"));

  const gov = { ...(trust.governanceRoots ?? {}) };
  const extraKeyId = keypairs.serverA?.keyId ?? "key_extra";
  const extraPem = keypairs.serverA?.publicKeyPem ?? "-----BEGIN PUBLIC KEY-----\\nINVALID\\n-----END PUBLIC KEY-----\\n";

  const target = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "jobproof", "strict-pass");

  // Overlap trust: include the real root and an additional future root key.
  {
    const env = { SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify({ ...gov, [extraKeyId]: extraPem }) };
    const res = await runCli(["--format", "json", "--strict", "--job-proof", target], { env });
    assert.equal(res.code, 0, res.stderr || res.stdout);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ok, true);
  }

  // Wrong trust: remove the real root and keep only an unrelated key.
  {
    const env = { SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify({ [extraKeyId]: extraPem }) };
    const res = await runCli(["--format", "json", "--strict", "--job-proof", target], { env });
    assert.equal(res.code, 1);
    const out = JSON.parse(res.stdout);
    const codes = Array.isArray(out.errors) ? out.errors.map((e) => e.code) : [];
    assert.equal(codes.includes("governance policy signerKeyId not trusted"), true);
  }
});

