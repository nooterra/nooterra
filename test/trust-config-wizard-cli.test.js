import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function runWizard(args) {
  const script = path.resolve(REPO_ROOT, "scripts", "trust-config", "wizard.mjs");
  // Full-suite runs can temporarily hit process/spawn limits (EAGAIN/EMFILE). Retry a few times.
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const proc = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
      const stdout = [];
      const stderr = [];
      proc.stdout.on("data", (chunk) => stdout.push(chunk));
      proc.stderr.on("data", (chunk) => stderr.push(chunk));
      const code = await new Promise((resolve, reject) => {
        proc.on("error", reject);
        proc.on("close", (statusCode) => resolve(statusCode ?? 1));
      });
      return {
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };
    } catch (err) {
      const code = err?.code ?? null;
      if ((code === "EAGAIN" || code === "EMFILE") && attempt < maxAttempts) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 50 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

test("trust wizard CLI: list returns catalog json", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-trust-wizard-test-"));
  try {
    const outPath = path.join(tmpDir, "catalog.json");
    const res = await runWizard(["list", "--format", "json", "--out", outPath]);
    assert.equal(res.code, 0);
    const out = JSON.parse(await fs.readFile(outPath, "utf8"));

    assert.equal(out.schemaVersion, "SlaPolicyTemplateCatalog.v1");
    assert.deepEqual(
      out.templates.map((item) => item.templateId),
      [
        "delivery_standard_v1",
        "delivery_priority_v1",
        "delivery_bulk_route_v1",
        "delivery_cold_chain_v1",
        "security_patrol_strict_v1",
        "security_patrol_compliance_v1",
        "security_perimeter_watch_v1"
      ]
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("trust wizard CLI: render output is deterministic for identical input", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-trust-wizard-test-"));
  const args = [
    "render",
    "--template",
    "delivery_standard_v1",
    "--overrides-json",
    JSON.stringify({ metrics: { targetCompletionMinutes: 55 }, sla: { maxExecutionMs: 900000 } }),
    "--format",
    "json"
  ];
  try {
    const out1 = path.join(tmpDir, "render1.json");
    const out2 = path.join(tmpDir, "render2.json");
    const first = await runWizard([...args, "--out", out1]);
    const second = await runWizard([...args, "--out", out2]);
    assert.equal(first.code, 0);
    assert.equal(second.code, 0);
    const body1 = await fs.readFile(out1, "utf8");
    const body2 = await fs.readFile(out2, "utf8");
    assert.equal(body1, body2);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("trust wizard CLI: validate rejects invalid override payload", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-trust-wizard-test-"));
  try {
    const outPath = path.join(tmpDir, "validate.json");
    const res = await runWizard([
      "validate",
      "--template",
      "delivery_standard_v1",
      "--overrides-json",
      "{\"metrics\":{\"targetCompletionMinutes\":0}}",
      "--format",
      "json",
      "--out",
      outPath
    ]);
    assert.equal(res.code, 1);
    await assert.rejects(async () => await fs.readFile(outPath, "utf8"));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
