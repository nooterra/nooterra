import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createApi } from "../src/api/app.js";
import { authKeyId, authKeySecret, hashAuthKeySecret } from "../src/core/auth.js";
import { listenOnEphemeralLoopback } from "./lib/listen.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pythonAvailable() {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

test("api-sdk-python: ACS substrate wrappers execute a live end-to-end collaboration flow", { skip: !pythonAvailable() }, async (t) => {
  const api = createApi();
  const tenantId = `tenant_sdk_py_acs_${uniqueSuffix()}`;

  const keyId = authKeyId();
  const secret = authKeySecret();
  await api.store.putAuthKey({
    tenantId,
    authKey: {
      keyId,
      secretHash: hashAuthKeySecret(secret),
      scopes: ["ops_read", "ops_write", "finance_read", "finance_write", "audit_read"],
      status: "active",
      createdAt: typeof api.store.nowIso === "function" ? api.store.nowIso() : new Date().toISOString(),
    },
  });

  const server = http.createServer(api.handle);
  let port = null;
  try {
    ({ port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] }));
  } catch (err) {
    const cause = err?.cause ?? err;
    if (cause?.code === "EPERM" || cause?.code === "EACCES") {
      t.skip(`loopback listen not permitted (${cause.code})`);
      return;
    }
    throw err;
  }

  try {
    const run = await new Promise((resolve, reject) => {
      const child = spawn("python3", [path.join(REPO_ROOT, "scripts", "examples", "sdk-acs-substrate-smoke.py")], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: "1",
          NOOTERRA_BASE_URL: `http://127.0.0.1:${port}`,
          NOOTERRA_TENANT_ID: tenantId,
          NOOTERRA_API_KEY: `${keyId}.${secret}`,
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
    });
    assert.equal(
      run.status,
      0,
      `python sdk ACS substrate smoke failed\n\nstdout:\n${run.stdout ?? ""}\n\nstderr:\n${run.stderr ?? ""}`
    );

    const summary = JSON.parse(String(run.stdout ?? "{}"));
    assert.ok(typeof summary.principalAgentId === "string" && summary.principalAgentId.length > 0);
    assert.ok(typeof summary.workerAgentId === "string" && summary.workerAgentId.length > 0);
    assert.ok(typeof summary.delegationGrantId === "string" && summary.delegationGrantId.length > 0);
    assert.ok(typeof summary.authorityGrantId === "string" && summary.authorityGrantId.length > 0);
    assert.ok(typeof summary.workOrderId === "string" && summary.workOrderId.length > 0);
    assert.equal(summary.workOrderStatus, "completed");
    assert.equal(summary.completionStatus, "success");
    assert.ok(Number(summary.workOrderReceiptCount) >= 1);
    assert.ok(Number(summary.workOrderMeterCount) >= 1);
    assert.ok(typeof summary.workOrderMeterDigest === "string" && summary.workOrderMeterDigest.length === 64);
    assert.ok(typeof summary.sessionId === "string" && summary.sessionId.length > 0);
    assert.ok(Number(summary.sessionEventCount) >= 1);
    assert.ok(typeof summary.checkpointId === "string" && summary.checkpointId.length > 0);
    assert.ok(typeof summary.checkpointHash === "string" && summary.checkpointHash.length === 64);
    assert.ok(Number(summary.checkpointListCount) >= 1);
    assert.ok(typeof summary.checkpointDelegationGrantRef === "string" && summary.checkpointDelegationGrantRef.length > 0);
    assert.equal(summary.checkpointAuthorityGrantRef, summary.authorityGrantId);
    assert.ok(typeof summary.attestationId === "string" && summary.attestationId.length > 0);
    assert.equal(summary.attestationRuntimeStatus, "valid");
    assert.ok(Number(summary.attestationListCount) >= 1);
    assert.equal(summary.publicReputationSummaryAgentId, summary.workerAgentId);
    assert.ok(Number(summary.publicReputationRelationshipCount) >= 0);
    assert.ok(Number(summary.interactionGraphRelationshipCount) >= 0);
    assert.ok(Number(summary.relationshipsCount) >= 0);
    assert.ok(typeof summary.delegationRevokedAt === "string" && summary.delegationRevokedAt.length > 0);
    assert.ok(typeof summary.authorityRevokedAt === "string" && summary.authorityRevokedAt.length > 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
