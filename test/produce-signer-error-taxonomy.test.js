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
    proc.on("close", (code) => resolve(code ?? 1));
  });
  return { code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
}

function parseJsonOrThrow(s, label) {
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(`${label} was not JSON: ${e?.message ?? String(e)}\n${s}`);
  }
}

test("settld-produce maps remote signer auth missing to SIGNER_AUTH_MISSING", async () => {
  const repoRoot = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-produce-taxonomy-"));
  await test.after(async () => fs.rm(tmp, { recursive: true, force: true }));

  const produceCli = path.resolve(repoRoot, "packages", "artifact-produce", "bin", "settld-produce.js");
  const res = await runNode([
    produceCli,
    "jobproof",
    "--out",
    path.join(tmp, "jobproof"),
    "--signer",
    "remote",
    "--signer-url",
    "http://127.0.0.1:9",
    "--signer-auth",
    "bearer",
    "--signer-token-env",
    "SETTLD_SIGNER_TOKEN",
    "--gov-key-id",
    "key_gov",
    "--server-key-id",
    "key_server",
    "--format",
    "json",
    "--deterministic",
    "--force"
  ]);
  assert.notEqual(res.code, 0, res.stderr || res.stdout);
  const out = parseJsonOrThrow(res.stdout, "stdout");
  assert.equal(out.schemaVersion, "ProduceCliOutput.v1");
  assert.equal(out.ok, false);
  assert.deepEqual(out.errors.map((e) => e.code), ["SIGNER_AUTH_MISSING"], JSON.stringify(out, null, 2));
  assert.equal(out.errors[0].causeKind, "signer");
  assert.equal(out.errors[0].causeCode, "REMOTE_SIGNER_AUTH_MISSING");
  assert.equal(out.errors[0].message, "remote signer auth configured but token missing");
});

test("settld-produce maps remote signer command bad response to SIGNER_BAD_RESPONSE", async () => {
  const repoRoot = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-produce-taxonomy-"));
  await test.after(async () => fs.rm(tmp, { recursive: true, force: true }));

  const produceCli = path.resolve(repoRoot, "packages", "artifact-produce", "bin", "settld-produce.js");
  const argsJson = JSON.stringify(["-e", ""]);
  const res = await runNode([
    produceCli,
    "jobproof",
    "--out",
    path.join(tmp, "jobproof"),
    "--signer",
    "remote",
    "--signer-command",
    process.execPath,
    "--signer-args-json",
    argsJson,
    "--gov-key-id",
    "key_gov",
    "--server-key-id",
    "key_server",
    "--format",
    "json",
    "--deterministic",
    "--force"
  ]);
  assert.notEqual(res.code, 0, res.stderr || res.stdout);
  const out = parseJsonOrThrow(res.stdout, "stdout");
  assert.equal(out.schemaVersion, "ProduceCliOutput.v1");
  assert.equal(out.ok, false);
  assert.deepEqual(out.errors.map((e) => e.code), ["SIGNER_BAD_RESPONSE"], JSON.stringify(out, null, 2));
  assert.equal(out.errors[0].causeKind, "signer");
  assert.equal(out.errors[0].causeCode, "REMOTE_SIGNER_KEY_MISMATCH");
});

test("settld-produce maps plugin load failure to SIGNER_PLUGIN_LOAD_FAILED", async () => {
  const repoRoot = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-produce-taxonomy-"));
  await test.after(async () => fs.rm(tmp, { recursive: true, force: true }));

  const produceCli = path.resolve(repoRoot, "packages", "artifact-produce", "bin", "settld-produce.js");
  const res = await runNode([
    produceCli,
    "jobproof",
    "--out",
    path.join(tmp, "jobproof"),
    "--signer",
    "plugin",
    "--signer-plugin",
    "./does-not-exist.mjs",
    "--gov-key-id",
    "key_gov",
    "--server-key-id",
    "key_server",
    "--format",
    "json",
    "--deterministic",
    "--force"
  ]);
  assert.notEqual(res.code, 0, res.stderr || res.stdout);
  const out = parseJsonOrThrow(res.stdout, "stdout");
  assert.equal(out.schemaVersion, "ProduceCliOutput.v1");
  assert.equal(out.ok, false);
  assert.deepEqual(out.errors.map((e) => e.code), ["SIGNER_PLUGIN_LOAD_FAILED"], JSON.stringify(out, null, 2));
  assert.equal(out.errors[0].causeKind, "plugin");
  assert.equal(out.errors[0].causeCode, "SIGNER_PLUGIN_LOAD_FAILED");
});

test("settld-produce never leaks bearer tokens or header values in stdout/stderr on signer failure", async () => {
  const repoRoot = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-produce-taxonomy-"));
  await test.after(async () => fs.rm(tmp, { recursive: true, force: true }));

  const token = "SENTINEL_TOKEN_DO_NOT_LEAK";
  const headerSecret = "SENTINEL_HEADER_DO_NOT_LEAK";
  const produceCli = path.resolve(repoRoot, "packages", "artifact-produce", "bin", "settld-produce.js");
  const res = await runNode(
    [
      produceCli,
      "jobproof",
      "--out",
      path.join(tmp, "jobproof"),
      "--signer",
      "remote",
      "--signer-url",
      "http://127.0.0.1:9",
      "--signer-auth",
      "bearer",
      "--signer-token-env",
      "SETTLD_SIGNER_TOKEN",
      "--signer-header",
      `X-Secret: ${headerSecret}`,
      "--gov-key-id",
      "key_gov",
      "--server-key-id",
      "key_server",
      "--format",
      "json",
      "--deterministic",
      "--force"
    ],
    { env: { SETTLD_SIGNER_TOKEN: token } }
  );

  assert.notEqual(res.code, 0, res.stderr || res.stdout);
  assert.equal(res.stdout.includes(token), false);
  assert.equal(res.stderr.includes(token), false);
  assert.equal(res.stdout.includes(headerSecret), false);
  assert.equal(res.stderr.includes(headerSecret), false);
});

test("settld-produce --format json does not emit arbitrary exception messages", async () => {
  const repoRoot = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-produce-taxonomy-"));
  await test.after(async () => fs.rm(tmp, { recursive: true, force: true }));

  const keypairsPath = path.resolve(repoRoot, "test", "fixtures", "keys", "fixture_keypairs.json");
  const produceCli = path.resolve(repoRoot, "packages", "artifact-produce", "bin", "settld-produce.js");
  const res = await runNode([
    produceCli,
    "jobproof",
    "--out",
    path.join(tmp, "jobproof"),
    "--keys",
    keypairsPath,
    "--verify-after",
    "--format",
    "json",
    "--deterministic",
    "--force"
  ]);
  assert.notEqual(res.code, 0, res.stderr || res.stdout);
  const out = parseJsonOrThrow(res.stdout, "stdout");
  assert.equal(out.schemaVersion, "ProduceCliOutput.v1");
  assert.equal(out.ok, false);
  const msg = String(out.errors?.[0]?.message ?? "");
  assert.equal(msg, "produce failed");
  assert.equal(res.stdout.includes("--verify-after requires --trust-file"), false);
});
