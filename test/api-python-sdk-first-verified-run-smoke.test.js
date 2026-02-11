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

test("api-sdk-python: first_verified_run executes a full verified+settled run", { skip: !pythonAvailable() }, async (t) => {
  const api = createApi();
  const tenantId = `tenant_sdk_py_${uniqueSuffix()}`;

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
      const child = spawn("python3", [path.join(REPO_ROOT, "scripts", "examples", "sdk-first-verified-run.py")], {
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
      `python sdk example failed\n\nstdout:\n${run.stdout ?? ""}\n\nstderr:\n${run.stderr ?? ""}`
    );

    const summary = JSON.parse(String(run.stdout ?? "{}"));
    assert.equal(summary.runStatus, "completed");
    assert.equal(summary.verificationStatus, "green");
    assert.equal(summary.settlementStatus, "released");
    assert.ok(typeof summary.runId === "string" && summary.runId.length > 0);
    assert.ok(typeof summary.payeeAgentId === "string" && summary.payeeAgentId.length > 0);
    assert.ok(typeof summary.payerAgentId === "string" && summary.payerAgentId.length > 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
