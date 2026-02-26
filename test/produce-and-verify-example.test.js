import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

test("example producer script: produce → verify (JobProof)", async () => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-produce-verify-"));
  await test.after(() => fs.rm(outDir, { recursive: true, force: true }));

  const script = path.resolve(process.cwd(), "scripts", "examples", "produce-and-verify-jobproof.mjs");
  const proc = spawn(process.execPath, [script, "--out", outDir], { stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  proc.stdout.on("data", (d) => stdout.push(d));
  proc.stderr.on("data", (d) => stderr.push(d));
  const code = await new Promise((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
  assert.equal(code, 0, Buffer.concat(stderr).toString("utf8") || Buffer.concat(stdout).toString("utf8"));

  const outPath = path.join(outDir, "nooterra-verify-output.json");
  const raw = await fs.readFile(outPath, "utf8");
  const json = JSON.parse(raw);
  assert.equal(json.schemaVersion, "VerifyCliOutput.v1");
  assert.equal(json.ok, true);
});
