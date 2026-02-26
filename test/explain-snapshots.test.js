import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

async function runCli({ cmd, args, env, cwd }) {
  const proc = spawn(cmd, args, { cwd, env: { ...process.env, ...(env ?? {}) }, stdio: ["ignore", "pipe", "pipe"] });
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

function normalizeText(s, replacements) {
  let out = String(s ?? "");
  out = out.replaceAll("\\", "/");
  for (const [from, to] of replacements) {
    out = out.split(from).join(to);
  }
  return out;
}

async function readFixture(rel) {
  const fp = path.resolve(process.cwd(), "test", "fixtures", "explain", rel);
  return fs.readFile(fp, "utf8");
}

test("nooterra-verify --explain output matches snapshots (deterministic + safe)", async () => {
  const trustPath = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "trust.json");
  const trust = JSON.parse(await fs.readFile(trustPath, "utf8"));
  const env = { NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust.governanceRoots ?? {}) };

  const bin = path.resolve(process.cwd(), "packages", "artifact-verify", "bin", "nooterra-verify.js");
  const repoRoot = process.cwd().replaceAll("\\", "/");

  {
    const res = await runCli({
      cmd: process.execPath,
      args: [bin, "--format", "json", "--strict", "--explain", "--job-proof", "test/fixtures/bundles/v1/jobproof/strict-pass"],
      env
    });
    assert.equal(res.code, 0, res.stderr || res.stdout);
    const actual = normalizeText(res.stderr, [[repoRoot, "<REPO>"]]);
    const expected = await readFixture("verify_jobproof_strict_pass.txt");
    assert.equal(actual, expected);
  }

  {
    const res = await runCli({
      cmd: process.execPath,
      args: [bin, "--format", "json", "--strict", "--explain", "--job-proof", "test/fixtures/bundles/v1/jobproof/strict-fail-missing-verification-report"],
      env
    });
    assert.equal(res.code, 1);
    const actual = normalizeText(res.stderr, [[repoRoot, "<REPO>"]]);
    const expected = await readFixture("verify_jobproof_strict_fail_missing_verification_report.txt");
    assert.equal(actual, expected);
  }
});

test("nooterra-produce --explain output matches snapshot (deterministic + no secrets)", async () => {
  const repoRoot = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-produce-explain-snap-"));
  await test.after(async () => fs.rm(tmp, { recursive: true, force: true }));

  const headerSecret = "SENTINEL_HEADER_DO_NOT_LEAK_EXPLAIN_SNAPSHOT";

  const produceCli = path.resolve(repoRoot, "packages", "artifact-produce", "bin", "nooterra-produce.js");
  const outDir = path.join(tmp, "jobproof");
  const res = await runCli({
    cmd: process.execPath,
    args: [
      produceCli,
      "jobproof",
      "--out",
      outDir,
      "--signer",
      "remote",
      "--signer-url",
      "http://127.0.0.1:9",
      "--signer-auth",
      "bearer",
      "--signer-token-env",
      "NOOTERRA_SIGNER_TOKEN",
      "--signer-header",
      `X-Secret: ${headerSecret}`,
      "--gov-key-id",
      "key_gov",
      "--server-key-id",
      "key_server",
      "--format",
      "json",
      "--deterministic",
      "--force",
      "--explain"
    ],
    env: {}
  });

  assert.equal(res.code, 1);
  assert.equal(res.stderr.includes(headerSecret), false);
  assert.equal(res.stdout.includes(headerSecret), false);

  const actual = normalizeText(res.stderr, [[tmp.replaceAll("\\", "/"), "<TMP>"]]);
  const expected = await readFixture("produce_remote_auth_missing.txt");
  assert.equal(actual, expected);
});

