import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";

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

async function requestJson(url, { method = "GET", headers = {}, body = null } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body === null ? {} : { "content-type": "application/json" }),
      ...headers
    },
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok, statusCode: response.status, text, json };
}

function startApiServer({ port, opsToken }) {
  return spawn(process.execPath, ["src/api/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROXY_BIND_HOST: "127.0.0.1",
      BIND_HOST: "127.0.0.1",
      PORT: String(port),
      PROXY_OPS_TOKEN: opsToken,
      PROXY_OPS_TOKENS: `${opsToken}:ops_read,ops_write,finance_read,finance_write,audit_read`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function waitForHealthyApi({ baseUrl, child, timeoutMs = 15_000 }) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`API exited early (exitCode=${child.exitCode})`);
    }
    try {
      const health = await requestJson(new URL("/healthz", baseUrl).toString());
      if (health.ok) return;
    } catch {
      // The server may still be starting up.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`API failed health check within ${timeoutMs}ms`);
}

async function mintApiKey({ baseUrl, tenantId, opsToken }) {
  const response = await requestJson(new URL("/ops/api-keys", baseUrl).toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${opsToken}`,
      "x-proxy-ops-token": opsToken,
      "x-proxy-tenant-id": tenantId
    },
    body: {
      description: "openclaw-substrate-demo-test",
      scopes: ["ops_read", "ops_write", "finance_read", "finance_write", "audit_read"]
    }
  });

  if (!response.ok) {
    throw new Error(`failed to mint API key (HTTP ${response.statusCode}): ${response.text}`);
  }
  const keyId = String(response.json?.keyId ?? "").trim();
  const secret = String(response.json?.secret ?? "").trim();
  if (!keyId || !secret) {
    throw new Error("mint API key response missing keyId/secret");
  }
  return `${keyId}.${secret}`;
}

async function stopChildProcess(child) {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 3000))
  ]);
  if (!exited) {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
}

async function runDemo({ outPath, env = {}, timeoutMs = 90_000 }) {
  const child = spawn(process.execPath, ["scripts/demo/run-openclaw-substrate-demo.mjs", "--out", outPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const exit = await new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve({ code: null, timeout: true });
    }, timeoutMs);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, timeout: false });
    });
  });

  return { exit, stdout, stderr };
}

test("demo:openclaw-substrate settles with evidence binding and receipt hash", async () => {
  const apiPort = await reservePort();
  const tenantId = "tenant_default";
  const opsToken = `tok_ops_demo_${Date.now()}`;
  const baseUrl = `http://127.0.0.1:${apiPort}`;
  const outPath = path.join(process.cwd(), "artifacts", "demo", `openclaw-substrate-demo-test-${Date.now()}.json`);

  await rm(outPath, { force: true });

  const api = startApiServer({ port: apiPort, opsToken });
  try {
    await waitForHealthyApi({ baseUrl, child: api });
    const apiKey = await mintApiKey({ baseUrl, tenantId, opsToken });

    const { exit, stdout, stderr } = await runDemo({
      outPath,
      env: {
        SETTLD_BASE_URL: baseUrl,
        SETTLD_TENANT_ID: tenantId,
        SETTLD_API_KEY: apiKey
      }
    });

    if (exit.timeout) {
      assert.fail(`openclaw substrate demo timed out; stderr=${stderr}`);
    }
    assert.equal(exit.code, 0, `expected demo script to pass; stdout=${stdout}\nstderr=${stderr}`);

    const reportRaw = await readFile(outPath, "utf8");
    const report = JSON.parse(reportRaw);
    assert.equal(report.schemaVersion, "OpenClawSubstrateDemoReport.v1");
    assert.equal(report.ok, true, `demo report failed: ${reportRaw}`);
    assert.equal(report.summary?.settlementStatus, "released");
    assert.match(String(report.summary?.sessionTranscriptHash ?? ""), /^[a-f0-9]{64}$/);
    assert.ok(Number(report.summary?.sessionTranscriptEvents ?? 0) >= 1);

    const completeStep = report.transcript?.find((row) => row?.step === "settld.work_order_complete");
    assert.equal(Boolean(completeStep?.ok), true);

    const completionReceipt = completeStep?.result?.result?.completionReceipt;
    assert.match(String(completionReceipt?.receiptHash ?? ""), /^[a-f0-9]{64}$/);
    assert.ok(Array.isArray(completionReceipt?.evidenceRefs));
    assert.ok(completionReceipt.evidenceRefs.some((ref) => String(ref).startsWith("artifact://")));
    assert.ok(completionReceipt.evidenceRefs.some((ref) => String(ref).startsWith("sha256:")));
    assert.ok(completionReceipt.evidenceRefs.some((ref) => String(ref).startsWith("verification://")));

    const settleStep = report.transcript?.find((row) => row?.step === "settld.work_order_settle");
    assert.equal(Boolean(settleStep?.ok), true);
    assert.equal(settleStep?.result?.result?.workOrder?.settlement?.status, "released");
  } finally {
    await stopChildProcess(api);
  }
});
