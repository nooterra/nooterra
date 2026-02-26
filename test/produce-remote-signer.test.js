import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

async function readJson(fp) {
  return JSON.parse(await fs.readFile(fp, "utf8"));
}

async function runNode(args, { env } = {}) {
  const proc = spawn(process.execPath, args, { env: { ...process.env, ...(env ?? {}) }, stdio: ["ignore", "pipe", "pipe"] });
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

test("remote signer: trust init (remote-only) + produce jobproof + strict verify", async () => {
  const repoRoot = process.cwd();
  const keypairsPath = path.resolve(repoRoot, "test", "fixtures", "keys", "fixture_keypairs.json");
  const keypairs = JSON.parse(await fs.readFile(keypairsPath, "utf8"));
  const govKeyId = keypairs.govRoot.keyId;
  const serverKeyId = keypairs.serverA.keyId;

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-remote-signer-"));
  await test.after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const signerScript = path.resolve(repoRoot, "packages", "artifact-produce", "bin", "nooterra-signer-dev.js");
  const signerCommand = process.execPath;
  const signerArgsJson = JSON.stringify([signerScript, "--stdio", "--keys", keypairsPath]);

  const trustDir = path.join(tmp, "trust");
  const trustCli = path.resolve(repoRoot, "packages", "artifact-produce", "bin", "nooterra-trust.js");
  const trustRes = await runNode(
    [
      trustCli,
      "init",
      "--mode",
      "remote-only",
      "--out",
      trustDir,
      "--signer-command",
      signerCommand,
      "--signer-args-json",
      signerArgsJson,
      "--governance-root-key-id",
      govKeyId,
      "--format",
      "json",
      "--force"
    ],
    {}
  );
  assert.equal(trustRes.code, 0, trustRes.stderr || trustRes.stdout);
  const trustOut = JSON.parse(trustRes.stdout);
  assert.equal(trustOut.schemaVersion, "TrustInitOutput.v1");
  assert.equal(trustOut.mode, "remote-only");
  assert.equal(trustOut.keypairsPath, null);
  const trust = await readJson(trustOut.trustPath);
  assert.equal(typeof trust?.governanceRoots?.[govKeyId], "string");

  const bundleDir = path.join(tmp, "jobproof");
  const produceCli = path.resolve(repoRoot, "packages", "artifact-produce", "bin", "nooterra-produce.js");
  const prodRes = await runNode([
    produceCli,
    "jobproof",
    "--out",
    bundleDir,
    "--signer",
    "remote",
    "--signer-command",
    signerCommand,
    "--signer-args-json",
    signerArgsJson,
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
  const prodOut = JSON.parse(prodRes.stdout);
  assert.equal(prodOut.schemaVersion, "ProduceCliOutput.v1");
  assert.equal(prodOut.ok, true);

  const verifyCli = path.resolve(repoRoot, "packages", "artifact-verify", "bin", "nooterra-verify.js");
  const env = {
    NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust.governanceRoots ?? {}),
    NOOTERRA_TRUSTED_TIME_AUTHORITY_KEYS_JSON: JSON.stringify(trust.timeAuthorities ?? {})
  };
  const verifyRes = await runNode([verifyCli, "--format", "json", "--strict", "--job-proof", bundleDir], { env });
  assert.equal(verifyRes.code, 0, verifyRes.stderr || verifyRes.stdout);
  const verifyOut = JSON.parse(verifyRes.stdout);
  assert.equal(verifyOut.schemaVersion, "VerifyCliOutput.v1");
  assert.equal(verifyOut.ok, true, JSON.stringify(verifyOut, null, 2));
});
