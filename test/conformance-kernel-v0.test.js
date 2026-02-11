import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createApi } from "../src/api/app.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function uniqueSuffix() {
  return `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

async function listenEphemeral(server) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      server.off("error", onError);
    };
    server.on("error", onError);
    server.listen(0, "127.0.0.1", () => {
      cleanup();
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : null;
      resolve({ port });
    });
  });
}

test("conformance: kernel-v0 tool-call holdback disputes", async (t) => {
  const tenantId = `tenant_conf_kernel_${uniqueSuffix()}`;
  const opsToken = "tok_ops";
  const api = createApi({ opsTokens: `${opsToken}:ops_read,ops_write,finance_read,finance_write,audit_read` });
  const server = http.createServer(api.handle);

  let port = null;
  try {
    ({ port } = await listenEphemeral(server));
  } catch (err) {
    const code = err?.code ?? null;
    if (code === "EPERM" || code === "EACCES") {
      t.skip(`loopback listen not permitted (${code})`);
      return;
    }
    throw err;
  }

  try {
    const run = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          path.join(REPO_ROOT, "conformance", "kernel-v0", "run.mjs"),
          "--base-url",
          `http://127.0.0.1:${port}`,
          "--tenant-id",
          tenantId,
          "--protocol",
          "1.0",
          "--ops-token",
          opsToken
        ],
        { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } }
      );
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
      `kernel conformance failed\n\nstdout:\n${run.stdout ?? ""}\n\nstderr:\n${run.stderr ?? ""}`
    );

    assert.match(run.stdout, /PASS tool_call_holdback_release/);
    assert.match(run.stdout, /PASS tool_call_holdback_refund/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

