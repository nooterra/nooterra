#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

function parseBoolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(value)) return true;
  if (["0", "false", "no", "n"].includes(value)) return false;
  throw new Error(`${name} must be boolean-like (true/false)`);
}

function runShell(command, { env = process.env } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("bash", ["-lc", command], { stdio: "inherit", env });
    child.on("error", rejectPromise);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
}

async function runCheck(check, env) {
  const startedAt = Date.now();
  const exitCode = await runShell(check.command, { env });
  return {
    id: check.id,
    ok: exitCode === 0,
    command: check.command,
    exitCode,
    durationMs: Date.now() - startedAt
  };
}

async function main() {
  const reportPath = resolve(
    process.cwd(),
    process.env.KERNEL_V0_SHIP_GATE_REPORT_PATH || "artifacts/gates/kernel-v0-ship-gate.json"
  );
  const runQuickstart = parseBoolEnv("RUN_KERNEL_V0_QUICKSTART_SMOKE", true);
  await mkdir(dirname(reportPath), { recursive: true });

  const checks = [
    {
      id: "kernel_v0_truth_launch_claims",
      command: "node scripts/ci/check-kernel-v0-launch-gate.mjs --mode prepublish"
    },
    {
      id: "x402_core_e2e_suite",
      command:
        "node --test test/api-e2e-x402-authorize-payment.test.js test/api-e2e-x402-receipts.test.js test/api-e2e-x402-gate-reversal.test.js test/api-e2e-x402-wallet-issuer.test.js test/api-e2e-x402-provider-signature.test.js test/x402-gateway-autopay.test.js test/x402-receipt-verifier.test.js test/x402-receipt-store.test.js test/x402-wallet-issuer-decision.test.js test/x402-provider-refund-decision.test.js test/x402-reversal-command.test.js"
    },
    {
      id: "api_sdk_contract_suite",
      command:
        "node --test test/api-r1-contract-freeze.test.js test/api-sdk-contract-freeze.test.js test/api-openapi.test.js"
    }
  ];

  if (runQuickstart) {
    checks.push({
      id: "x402_quickstart_smoke",
      command: "SETTLD_QUICKSTART_KEEP_ALIVE=0 npm run -s quickstart:x402"
    });
  }

  const startedAt = Date.now();
  const results = [];
  for (const check of checks) {
    const result = await runCheck(check, process.env);
    results.push(result);
    if (!result.ok) break;
  }

  const passedChecks = results.filter((row) => row.ok).length;
  const allPassed = passedChecks === checks.length;
  const report = {
    schemaVersion: "KernelV0ShipGateReport.v1",
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    checks: results,
    verdict: {
      ok: allPassed,
      requiredChecks: checks.length,
      passedChecks
    }
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stdout.write(`wrote kernel v0 ship gate report: ${reportPath}\n`);
  if (!allPassed) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
  process.exit(1);
});
