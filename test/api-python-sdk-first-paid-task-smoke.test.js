import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";

import { createApi } from "../src/api/app.js";
import { authKeyId, authKeySecret, hashAuthKeySecret } from "../src/core/auth.js";

function pythonAvailable() {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

test("api-sdk-python: first_paid_task executes task->bid->accept->run->settlement", { skip: !pythonAvailable() }, async () => {
  const api = createApi();
  const tenantId = `tenant_sdk_py_paid_${uniqueSuffix()}`;

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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : null;
  assert.ok(Number.isInteger(port) && port > 0);

  try {
    const run = await new Promise((resolve, reject) => {
      const child = spawn("python3", ["scripts/examples/sdk-first-paid-task.py"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: "1",
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
      `python sdk paid-task example failed\n\nstdout:\n${run.stdout ?? ""}\n\nstderr:\n${run.stderr ?? ""}`
    );

    const summary = JSON.parse(String(run.stdout ?? "{}"));
    assert.ok(typeof summary.taskId === "string" && summary.taskId.length > 0);
    assert.ok(typeof summary.runId === "string" && summary.runId.length > 0);
    assert.ok(typeof summary.posterAgentId === "string" && summary.posterAgentId.length > 0);
    assert.ok(typeof summary.bidderAgentId === "string" && summary.bidderAgentId.length > 0);
    assert.equal(summary.verificationStatus, "green");
    assert.equal(summary.settlementStatus, "released");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
