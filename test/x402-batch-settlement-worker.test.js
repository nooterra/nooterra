import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runNode({ args, cwd }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function buildRunArtifacts({ gateId, providerId, releasedAmountCents, artifactDir }) {
  const settledAt = "2026-02-16T10:00:00.000Z";
  return {
    summary: {
      ok: true,
      gateId,
      circleReserveId: `circle_transfer_${gateId}`
    },
    gateState: {
      gate: {
        gateId,
        runId: `x402_${gateId}`,
        payeeAgentId: providerId,
        status: "resolved",
        resolvedAt: settledAt,
        terms: { amountCents: releasedAmountCents, currency: "USD" },
        decision: {
          releasedAmountCents,
          refundedAmountCents: 0
        },
        authorization: {
          reserve: {
            reserveId: `circle_transfer_${gateId}`,
            status: "settled",
            settledAt
          }
        }
      },
      settlement: {
        runId: `x402_${gateId}`,
        status: "released",
        releasedAmountCents,
        refundedAmountCents: 0,
        amountCents: releasedAmountCents,
        currency: "USD",
        resolvedAt: settledAt
      },
      artifactDir
    }
  };
}

test("x402 batch settlement worker is idempotent across reruns", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "settld-x402-batch-worker-"));
  const artifactRoot = path.join(tmpRoot, "artifacts", "mcp-paid-exa");
  const registryPath = path.join(tmpRoot, "registry.json");
  const statePath = path.join(tmpRoot, "state.json");

  const runs = [
    { id: "run1", gateId: "gate_1", providerId: "prov_a", releasedAmountCents: 500 },
    { id: "run2", gateId: "gate_2", providerId: "prov_a", releasedAmountCents: 300 },
    { id: "run3", gateId: "gate_3", providerId: "prov_b", releasedAmountCents: 200 }
  ];

  for (const run of runs) {
    const dir = path.join(artifactRoot, run.id);
    const payload = buildRunArtifacts({
      gateId: run.gateId,
      providerId: run.providerId,
      releasedAmountCents: run.releasedAmountCents,
      artifactDir: dir
    });
    await writeJson(path.join(dir, "summary.json"), payload.summary);
    await writeJson(path.join(dir, "gate-state.json"), payload.gateState);
  }

  await writeJson(registryPath, {
    schemaVersion: "X402ProviderPayoutRegistry.v1",
    providers: [
      {
        providerId: "prov_a",
        destination: {
          type: "circle_wallet",
          walletId: "wallet_a",
          blockchain: "BASE-SEPOLIA",
          token: "USDC"
        }
      }
    ]
  });

  const outDir1 = path.join(tmpRoot, "out-1");
  const first = await runNode({
    cwd: REPO_ROOT,
    args: [
      "scripts/settlement/x402-batch-worker.mjs",
      "--artifact-root",
      artifactRoot,
      "--registry",
      registryPath,
      "--state",
      statePath,
      "--out-dir",
      outDir1
    ]
  });
  assert.equal(first.code, 0, `stderr=${first.stderr}`);
  const firstResult = JSON.parse(first.stdout.trim());
  assert.equal(firstResult.batchCount, 1);
  assert.equal(firstResult.processedGateCount, 2);
  assert.equal(firstResult.skippedProviderCount, 1);

  const stateAfterFirst = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(stateAfterFirst.schemaVersion, "X402BatchWorkerState.v1");
  assert.equal(typeof stateAfterFirst.processedGateIds?.gate_1, "object");
  assert.equal(typeof stateAfterFirst.processedGateIds?.gate_2, "object");
  assert.equal(stateAfterFirst.processedGateIds?.gate_3, undefined);
  assert.equal(Array.isArray(stateAfterFirst.batches), true);
  assert.equal(stateAfterFirst.batches.length, 1);
  assert.equal(stateAfterFirst.batches[0]?.totalAmountCents, 800);

  const outDir2 = path.join(tmpRoot, "out-2");
  const second = await runNode({
    cwd: REPO_ROOT,
    args: [
      "scripts/settlement/x402-batch-worker.mjs",
      "--artifact-root",
      artifactRoot,
      "--registry",
      registryPath,
      "--state",
      statePath,
      "--out-dir",
      outDir2
    ]
  });
  assert.equal(second.code, 0, `stderr=${second.stderr}`);
  const secondResult = JSON.parse(second.stdout.trim());
  assert.equal(secondResult.batchCount, 0);
  assert.equal(secondResult.processedGateCount, 0);
  assert.equal(secondResult.skippedProviderCount, 1);

  const stateAfterSecond = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(stateAfterSecond.batches.length, 1);
  assert.equal(typeof stateAfterSecond.processedGateIds?.gate_1, "object");
  assert.equal(typeof stateAfterSecond.processedGateIds?.gate_2, "object");
  assert.equal(stateAfterSecond.processedGateIds?.gate_3, undefined);
});

