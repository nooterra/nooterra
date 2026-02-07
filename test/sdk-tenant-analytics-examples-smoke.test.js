import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

function pythonAvailable() {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

function monthKeyUtcNow() {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function previousMonthKey(monthKey) {
  const m = /^([0-9]{4})-([0-9]{2})$/.exec(String(monthKey ?? "").trim());
  if (!m) return monthKeyUtcNow();
  const year = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const d = new Date(Date.UTC(year, month - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${mm}`;
}

async function requestJson(baseUrl, { method, pathname, headers = {}, body = null }) {
  const payload = body === null ? undefined : JSON.stringify(body);
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(payload ? { "content-type": "application/json" } : null),
      ...headers
    },
    body: payload
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, text, json };
}

async function runProcess(cmd, args, { env } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env
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
}

test("scripts/examples: sdk tenant analytics run end-to-end against magic-link", { timeout: 120_000 }, async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-magic-link-analytics-example-"));
  const month = monthKeyUtcNow();
  const baseMonth = previousMonthKey(month);
  const tenantId = "tenant_sdk_analytics_example";

  process.env.MAGIC_LINK_DISABLE_LISTEN = "1";
  process.env.MAGIC_LINK_PORT = "0";
  process.env.MAGIC_LINK_HOST = "127.0.0.1";
  process.env.MAGIC_LINK_API_KEY = "test_key";
  process.env.MAGIC_LINK_DATA_DIR = dataDir;
  process.env.MAGIC_LINK_VERIFY_TIMEOUT_MS = "60000";
  process.env.MAGIC_LINK_WEBHOOK_DELIVERY_MODE = "record";
  process.env.MAGIC_LINK_PAYMENT_TRIGGER_RETRY_INTERVAL_MS = "600000";
  process.env.MAGIC_LINK_WEBHOOK_RETRY_INTERVAL_MS = "600000";
  process.env.MAGIC_LINK_ARCHIVE_EXPORT_ENABLED = "0";

  const { magicLinkHandler } = await import("../services/magic-link/src/server.js");
  const server = http.createServer(magicLinkHandler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : null;
  assert.ok(Number.isInteger(port) && Number(port) > 0, "magic-link test server should listen on an ephemeral port");
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const created = await requestJson(baseUrl, {
    method: "POST",
    pathname: "/v1/tenants",
    headers: { "x-api-key": "test_key" },
    body: {
      tenantId,
      name: "SDK Analytics Example Tenant",
      contactEmail: "ops@example.com",
      billingEmail: "billing@example.com"
    }
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json?.ok, true, created.text);

  const sampleUpload = await requestJson(baseUrl, {
    method: "POST",
    pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/samples/closepack/known-good/upload`,
    headers: { "x-api-key": "test_key" },
    body: {}
  });
  assert.equal(sampleUpload.status, 200, sampleUpload.text);
  assert.equal(sampleUpload.json?.ok, true, sampleUpload.text);
  assert.match(String(sampleUpload.json?.token ?? ""), /^ml_[0-9a-f]{48}$/);

  const commonEnv = {
    ...process.env,
    SETTLD_BASE_URL: baseUrl,
    SETTLD_TENANT_ID: tenantId,
    SETTLD_X_API_KEY: "test_key",
    SETTLD_MONTH: month,
    SETTLD_BASE_MONTH: baseMonth
  };

  await t.test("javascript analytics example script", async () => {
    const run = await runProcess("node", ["scripts/examples/sdk-tenant-analytics.mjs"], { env: commonEnv });
    assert.equal(
      run.status,
      0,
      `js analytics example failed\n\nstdout:\n${run.stdout ?? ""}\n\nstderr:\n${run.stderr ?? ""}`
    );
    const summary = JSON.parse(String(run.stdout ?? "{}"));
    assert.equal(summary.tenantId, tenantId);
    assert.equal(summary.month, month);
    assert.equal(summary.baseMonth, baseMonth);
    assert.equal(summary.snapshots?.createdMonth, month);
    assert.ok(Number.isInteger(summary.analytics?.runs) && summary.analytics.runs >= 1);
    assert.ok(Number.isInteger(summary.trustGraph?.nodes) && summary.trustGraph.nodes >= 1);
    assert.ok(Number.isInteger(summary.trustGraph?.runs) && summary.trustGraph.runs >= 1);
    assert.notEqual(summary.diff?.nodeChanges, null);
    assert.notEqual(summary.diff?.edgeChanges, null);
  });

  await t.test("python analytics example script", { skip: !pythonAvailable() }, async () => {
    const run = await runProcess("python3", ["scripts/examples/sdk-tenant-analytics.py"], {
      env: { ...commonEnv, PYTHONDONTWRITEBYTECODE: "1" }
    });
    assert.equal(
      run.status,
      0,
      `python analytics example failed\n\nstdout:\n${run.stdout ?? ""}\n\nstderr:\n${run.stderr ?? ""}`
    );
    const summary = JSON.parse(String(run.stdout ?? "{}"));
    assert.equal(summary.tenantId, tenantId);
    assert.equal(summary.month, month);
    assert.equal(summary.baseMonth, baseMonth);
    assert.equal(summary.snapshots?.createdMonth, month);
    assert.ok(Number.isInteger(summary.analytics?.runs) && summary.analytics.runs >= 1);
    assert.ok(Number.isInteger(summary.trustGraph?.nodes) && summary.trustGraph.nodes >= 1);
    assert.ok(Number.isInteger(summary.trustGraph?.runs) && summary.trustGraph.runs >= 1);
    assert.notEqual(summary.diff?.nodeChanges, null);
    assert.notEqual(summary.diff?.edgeChanges, null);
  });
});
