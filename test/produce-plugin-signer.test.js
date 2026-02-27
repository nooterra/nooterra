import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

async function runNode(args, { env } = {}) {
  const proc = spawn(process.execPath, args, { env: { ...process.env, ...(env ?? {}) }, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  proc.stdout.on("data", (d) => stdout.push(d));
  proc.stderr.on("data", (d) => stderr.push(d));
  const code = await new Promise((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (c) => resolve(c ?? 1));
  });
  return { code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
}

test("plugin signer: produce jobproof + strict verify", async () => {
  const repoRoot = process.cwd();
  const keypairsPath = path.resolve(repoRoot, "test", "fixtures", "keys", "fixture_keypairs.json");
  const keypairs = JSON.parse(await fs.readFile(keypairsPath, "utf8"));
  const govKeyId = keypairs.govRoot.keyId;
  const serverKeyId = keypairs.serverA.keyId;

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-plugin-signer-"));
  await test.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const cfgPath = path.join(tmp, "plugin-config.json");
  await fs.writeFile(cfgPath, JSON.stringify({ keypairsPath }, null, 2), "utf8");

  const bundleDir = path.join(tmp, "jobproof");
  const produceCli = path.resolve(repoRoot, "packages", "artifact-produce", "bin", "nooterra-produce.js");
  const pluginPath = path.resolve(repoRoot, "test", "fixtures", "signer-plugins", "inmemory-signer.mjs");

  const prodRes = await runNode([
    produceCli,
    "jobproof",
    "--out",
    bundleDir,
    "--signer",
    "plugin",
    "--signer-plugin",
    pluginPath,
    "--signer-plugin-config",
    cfgPath,
    "--gov-key-id",
    govKeyId,
    "--server-key-id",
    serverKeyId,
    "--format",
    "json",
    "--deterministic",
    "--force"
  ]);
  assert.equal(prodRes.code, 0, prodRes.stderr || prodRes.stdout);

  const trustPath = path.resolve(repoRoot, "test", "fixtures", "bundles", "v1", "trust.json");
  const trust = JSON.parse(await fs.readFile(trustPath, "utf8"));
  const env = {
    NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust.governanceRoots ?? {}),
    NOOTERRA_TRUSTED_TIME_AUTHORITY_KEYS_JSON: JSON.stringify(trust.timeAuthorities ?? {})
  };

  const verifyCli = path.resolve(repoRoot, "packages", "artifact-verify", "bin", "nooterra-verify.js");
  const verifyRes = await runNode([verifyCli, "--format", "json", "--strict", "--job-proof", bundleDir], { env });
  assert.equal(verifyRes.code, 0, verifyRes.stderr || verifyRes.stdout);
  const verifyOut = JSON.parse(verifyRes.stdout);
  assert.equal(verifyOut.schemaVersion, "VerifyCliOutput.v1");
  assert.equal(verifyOut.ok, true, JSON.stringify(verifyOut, null, 2));
});

