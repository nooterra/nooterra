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

test("nooterra-produce --explain prints deterministic diagnostics to stderr without leaking secrets", async () => {
  const repoRoot = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-produce-explain-"));
  await test.after(async () => fs.rm(tmp, { recursive: true, force: true }));

  const token = "SENTINEL_TOKEN_DO_NOT_LEAK_EXPLAIN";
  const headerSecret = "SENTINEL_HEADER_DO_NOT_LEAK_EXPLAIN";

  const produceCli = path.resolve(repoRoot, "packages", "artifact-produce", "bin", "nooterra-produce.js");
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
    { env: { NOOTERRA_SIGNER_TOKEN: token } }
  );

  assert.notEqual(res.code, 0, res.stderr || res.stdout);
  const out = JSON.parse(res.stdout);
  assert.equal(out.schemaVersion, "ProduceCliOutput.v1");
  assert.equal(out.ok, false);

  assert.ok(res.stderr.includes("nooterra-produce explain"));
  assert.equal(res.stderr.includes(token), false);
  assert.equal(res.stderr.includes(headerSecret), false);
  assert.equal(res.stdout.includes(token), false);
  assert.equal(res.stdout.includes(headerSecret), false);
});

