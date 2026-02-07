import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";

async function runWizard(args) {
  const script = path.resolve(process.cwd(), "scripts", "trust-config", "wizard.mjs");
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
}

test("trust wizard CLI: list returns catalog json", async () => {
  const res = await runWizard(["list", "--format", "json"]);
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
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
});

test("trust wizard CLI: render output is deterministic for identical input", async () => {
  const args = [
    "render",
    "--template",
    "delivery_standard_v1",
    "--overrides-json",
    JSON.stringify({ metrics: { targetCompletionMinutes: 55 }, sla: { maxExecutionMs: 900000 } }),
    "--format",
    "json"
  ];
  const first = await runWizard(args);
  const second = await runWizard(args);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
});

test("trust wizard CLI: validate rejects invalid override payload", async () => {
  const res = await runWizard([
    "validate",
    "--template",
    "delivery_standard_v1",
    "--overrides-json",
    "{\"metrics\":{\"targetCompletionMinutes\":0}}"
  ]);
  assert.equal(res.code, 1);
  assert.match(res.stderr, /targetCompletionMinutes/);
});
