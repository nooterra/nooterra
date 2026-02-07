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

function parseExplain(stderr) {
  const out = {};
  for (const line of String(stderr ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "settld-verify explain v1") continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const k = trimmed.slice(0, idx);
    const v = trimmed.slice(idx + 1);
    out[k] = v;
  }
  return out;
}

test("settld-verify --explain prints deterministic diagnostics to stderr without breaking JSON stdout", async () => {
  const trustPath = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "trust.json");
  const trust = JSON.parse(await fs.readFile(trustPath, "utf8"));
  const env = { SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust.governanceRoots ?? {}) };

  const target = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "jobproof", "strict-pass");
  const res = await runCli(["--format", "json", "--strict", "--explain", "--job-proof", target], { env });
  assert.equal(res.code, 0, res.stderr || res.stdout);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.schemaVersion, "VerifyCliOutput.v1");
  assert.equal(parsed.ok, true);

  assert.ok(res.stderr.includes("settld-verify explain v1"));
  const explain = parseExplain(res.stderr);
  assert.equal(explain["target.kind"], "job-proof");
  assert.equal(explain["mode.strict"], "true");
  assert.equal(explain["result.ok"], "true");
  assert.ok(typeof explain["result.manifestHash"] === "string");
  assert.ok(explain["result.manifestHash"].length > 0);
});

test("settld-verify --explain includes the primary strict failure reason for a fixture", async () => {
  const trustPath = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "trust.json");
  const trust = JSON.parse(await fs.readFile(trustPath, "utf8"));
  const env = { SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust.governanceRoots ?? {}) };

  const target = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "jobproof", "strict-fail-missing-verification-report");
  const res = await runCli(["--format", "json", "--strict", "--explain", "--job-proof", target], { env });
  assert.equal(res.code, 1);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errors.some((e) => e.code === "missing verify/verification_report.json"), true);

  const explain = parseExplain(res.stderr);
  assert.equal(explain["mode.strict"], "true");
  assert.equal(explain["result.ok"], "false");
  assert.equal(explain["result.error"], "missing verify/verification_report.json");
});

