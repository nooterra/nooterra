import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";

function readEnv(name, fallback = null) {
  const raw = process.env[name];
  if (raw === null || raw === undefined || String(raw).trim() === "") return fallback;
  return String(raw).trim();
}

function isEnabled(name) {
  const raw = readEnv(name, "");
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

async function reservePort() {
  const net = await import("node:net");
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("unexpected server address"));
        return;
      }
      const port = addr.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function parseLastJsonLine(stdout) {
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  if (!last) return null;
  try {
    return JSON.parse(last);
  } catch {
    return null;
  }
}

function runNode({ args, env = {}, timeoutMs = 180_000 }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve({ code: null, timeout: true, stdout, stderr });
    }, timeoutMs);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, timeout: false, stdout, stderr });
    });
  });
}

test(
  "circle sandbox e2e: demo batch settlement executes and rerun is idempotent",
  { skip: !isEnabled("CIRCLE_E2E") || !isEnabled("CIRCLE_BATCH_E2E") },
  async (t) => {
    const required = ["CIRCLE_API_KEY", "CIRCLE_WALLET_ID_SPEND", "CIRCLE_WALLET_ID_ESCROW", "CIRCLE_TOKEN_ID_USDC"];
    const missing = required.filter((name) => !readEnv(name));
    if (missing.length > 0) {
      t.skip(`missing required env: ${missing.join(", ")}`);
      return;
    }
    const hasEntityProvider =
      Boolean(readEnv("ENTITY_SECRET")) ||
      Boolean(readEnv("CIRCLE_ENTITY_SECRET_HEX")) ||
      Boolean(readEnv("CIRCLE_ENTITY_SECRET_CIPHERTEXT_TEMPLATE")) ||
      (Boolean(readEnv("CIRCLE_ENTITY_SECRET_CIPHERTEXT")) && isEnabled("CIRCLE_ALLOW_STATIC_ENTITY_SECRET"));
    if (!hasEntityProvider) {
      t.skip("set ENTITY_SECRET/CIRCLE_ENTITY_SECRET_HEX, CIRCLE_ENTITY_SECRET_CIPHERTEXT_TEMPLATE, or allow static ciphertext for sandbox e2e");
      return;
    }

    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "nooterra-circle-batch-e2e-"));
    const artifactDir = path.join(tmpRoot, "artifacts", "mcp-paid-exa", `run-${Date.now()}`);
    const apiPort = await reservePort();
    const upstreamPort = await reservePort();
    const gatewayPort = await reservePort();
    const providerWalletId = readEnv("NOOTERRA_DEMO_BATCH_PROVIDER_WALLET_ID", readEnv("CIRCLE_WALLET_ID_ESCROW", ""));
    const amountCents = readEnv("CIRCLE_BATCH_E2E_AMOUNT_CENTS", "100");

    const demo = await runNode({
      args: ["scripts/demo/mcp-paid-exa.mjs", "--circle=sandbox"],
      env: {
        NOOTERRA_DEMO_API_PORT: String(apiPort),
        NOOTERRA_DEMO_UPSTREAM_PORT: String(upstreamPort),
        NOOTERRA_DEMO_GATEWAY_PORT: String(gatewayPort),
        NOOTERRA_DEMO_KEEP_ALIVE: "0",
        NOOTERRA_DEMO_QUERY: readEnv("CIRCLE_BATCH_E2E_QUERY", "dentist near me chicago"),
        NOOTERRA_DEMO_NUM_RESULTS: readEnv("CIRCLE_BATCH_E2E_NUM_RESULTS", "1"),
        NOOTERRA_DEMO_ARTIFACT_DIR: artifactDir,
        NOOTERRA_DEMO_CIRCLE_MODE: "sandbox",
        NOOTERRA_DEMO_RUN_BATCH_SETTLEMENT: "1",
        NOOTERRA_DEMO_BATCH_PROVIDER_WALLET_ID: providerWalletId,
        NOOTERRA_PRICE_AMOUNT_CENTS: amountCents
      }
    });

    if (demo.timeout) {
      assert.fail(`demo timed out; stderr=${demo.stderr}`);
    }
    assert.equal(demo.code, 0, `demo failed; stdout=${demo.stdout}\nstderr=${demo.stderr}`);
    assert.match(demo.stdout, /PASS artifactDir=/);

    const summaryRaw = await readFile(path.join(artifactDir, "summary.json"), "utf8");
    const summary = JSON.parse(summaryRaw);
    assert.equal(summary.ok, true, `summary failed: ${summaryRaw}`);
    assert.equal(summary.circleMode, "sandbox");
    assert.equal(summary.passChecks?.batchSettlement, true);
    assert.equal(summary.batchSettlement?.enabled, true);
    assert.equal(summary.batchSettlement?.result?.executeCircle, true);
    assert.ok(summary.batchSettlement?.result?.payoutExecution?.submitted >= 1);

    const settlementRaw = await readFile(path.join(artifactDir, "batch-settlement.json"), "utf8");
    const settlement = JSON.parse(settlementRaw);
    assert.equal(settlement.enabled, true);
    assert.equal(settlement.ok, true);
    assert.equal(settlement.circleMode, "sandbox");
    assert.ok(typeof settlement.statePath === "string" && settlement.statePath.length > 0);
    assert.ok(typeof settlement.registryPath === "string" && settlement.registryPath.length > 0);
    assert.ok(typeof settlement.artifactRoot === "string" && settlement.artifactRoot.length > 0);

    const rerunOutDir = path.join(artifactDir, "batch-settlement-rerun");
    const rerun = await runNode({
      args: [
        "scripts/settlement/x402-batch-worker.mjs",
        "--artifact-root",
        settlement.artifactRoot,
        "--registry",
        settlement.registryPath,
        "--state",
        settlement.statePath,
        "--out-dir",
        rerunOutDir,
        "--execute-circle",
        "--circle-mode",
        "sandbox"
      ],
      env: {
        X402_BATCH_CIRCLE_MODE: "sandbox"
      }
    });

    if (rerun.timeout) {
      assert.fail(`batch rerun timed out; stderr=${rerun.stderr}`);
    }
    assert.equal(rerun.code, 0, `batch rerun failed; stdout=${rerun.stdout}\nstderr=${rerun.stderr}`);
    const rerunJson = parseLastJsonLine(rerun.stdout);
    assert.ok(rerunJson && typeof rerunJson === "object", `batch rerun returned non-json stdout: ${rerun.stdout}`);
    assert.equal(rerunJson.executeCircle, true);
    assert.equal(rerunJson.payoutExecution?.attempted, 0);
    assert.equal(rerunJson.payoutExecution?.submitted, 0);
    assert.ok(rerunJson.payoutExecution?.skipped >= 1);
  }
);
