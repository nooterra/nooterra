import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createApi } from "../src/api/app.js";
import { authKeyId, authKeySecret, hashAuthKeySecret } from "../src/core/auth.js";
import { listenOnEphemeralLoopback } from "./lib/listen.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function uniqueSuffix() {
  return `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

test("api-sdk: ACS substrate wrappers execute a live end-to-end collaboration flow", async (t) => {
  const api = createApi();
  const tenantId = `tenant_sdk_js_acs_${uniqueSuffix()}`;

  const keyId = authKeyId();
  const secret = authKeySecret();
  await api.store.putAuthKey({
    tenantId,
    authKey: {
      keyId,
      secretHash: hashAuthKeySecret(secret),
      scopes: ["ops_read", "ops_write", "finance_read", "finance_write", "audit_read"],
      status: "active",
      createdAt: typeof api.store.nowIso === "function" ? api.store.nowIso() : new Date().toISOString()
    }
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
      const child = spawn("node", [path.join(REPO_ROOT, "scripts", "examples", "sdk-acs-substrate-smoke.mjs")], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          SETTLD_BASE_URL: `http://127.0.0.1:${port}`,
          SETTLD_TENANT_ID: tenantId,
          SETTLD_API_KEY: `${keyId}.${secret}`
        }
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
      `js sdk ACS substrate smoke failed\n\nstdout:\n${run.stdout ?? ""}\n\nstderr:\n${run.stderr ?? ""}`
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
    assert.ok(typeof summary.sessionId === "string" && summary.sessionId.length > 0);
    assert.ok(Number(summary.sessionEventCount) >= 1);
    assert.ok(typeof summary.attestationId === "string" && summary.attestationId.length > 0);
    assert.equal(summary.attestationRuntimeStatus, "valid");
    assert.ok(Number(summary.attestationListCount) >= 1);
    assert.ok(typeof summary.delegationRevokedAt === "string" && summary.delegationRevokedAt.length > 0);
    assert.ok(typeof summary.authorityRevokedAt === "string" && summary.authorityRevokedAt.length > 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
