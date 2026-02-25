#!/usr/bin/env node
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { rm, mkdtemp, mkdir, writeFile } from "node:fs/promises";

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeBaseUrlForCompare(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function normalizeBaseUrlEndpointForCompare(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = String(url.hostname ?? "").trim().toLowerCase();
  const normalizedHost = host === "localhost" ? "127.0.0.1" : host;
  const port = url.port ? String(url.port).trim() : url.protocol === "https:" ? "443" : "80";
  const pathname = String(url.pathname ?? "/").replace(/\/+$/, "") || "/";
  return { protocol: String(url.protocol ?? "").toLowerCase(), host: normalizedHost, port, pathname };
}

function buildScopedOpsToken(token) {
  return `${String(token ?? "").trim()}:ops_read,ops_write,finance_read,finance_write,audit_read`;
}

function pickPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : null;
      server.close(() => {
        if (!Number.isInteger(port) || port <= 0) {
          reject(new Error("failed to allocate loopback port"));
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, fn, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const ok = await fn();
      if (ok) return;
    } catch (err) {
      lastErr = err;
    }
    await sleep(intervalMs);
  }
  if (lastErr) {
    const wrapped = new Error(`${label} timed out: ${lastErr.message}`);
    wrapped.cause = lastErr;
    throw wrapped;
  }
  throw new Error(`${label} timed out`);
}

function startNodeProc({ name, scriptPath, env }) {
  const logs = [];
  const child = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, ...(env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const push = (line) => {
    if (!line) return;
    logs.push(line);
    if (logs.length > 240) logs.shift();
  };
  child.stdout.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) push(`[${name}:stdout] ${line}`);
  });
  child.stderr.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) push(`[${name}:stderr] ${line}`);
  });
  return { child, logs };
}

async function stopProc(child) {
  if (!child || typeof child.kill !== "function") return;
  if (child.exitCode !== null && child.exitCode !== undefined) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(3000).then(() => false)
  ]);
  if (!exited) {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
}

async function requestJson({ baseUrl, method, route, headers = {}, body = undefined }) {
  const response = await requestJsonWithResponse({ baseUrl, method, route, headers, body });
  if (!response.ok) {
    const details = response.json && typeof response.json === "object" ? response.json : response.raw;
    const err = new Error(`HTTP ${response.status} ${method} ${route}`);
    err.details = details;
    throw err;
  }
  return response.json;
}

async function requestJsonWithResponse({ baseUrl, method, route, headers = {}, body = undefined }) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    raw,
    json
  };
}

async function requestJsonExpectError(
  { baseUrl, method, route, headers = {}, body = undefined },
  { expectedStatus, expectedCode, label }
) {
  const response = await requestJsonWithResponse({ baseUrl, method, route, headers, body });
  if (response.ok) {
    const err = new Error(`${label} unexpectedly succeeded`);
    err.details = response.json ?? response.raw ?? null;
    throw err;
  }
  if (response.status !== expectedStatus) {
    const err = new Error(`${label} returned status ${response.status} (expected ${expectedStatus})`);
    err.details = response.json ?? response.raw ?? null;
    throw err;
  }
  const observedCode = typeof response.json?.code === "string" ? response.json.code : null;
  if (expectedCode && observedCode !== expectedCode) {
    const err = new Error(`${label} returned code ${observedCode ?? "null"} (expected ${expectedCode})`);
    err.details = response.json ?? response.raw ?? null;
    throw err;
  }
  return response;
}

function runNodeScript(scriptPath, args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...(args ?? [])], {
      env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} failed (code=${code ?? "null"} signal=${signal ?? "null"})`));
    });
  });
}

function runNodeScriptCapture(scriptPath, args, { env = process.env, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...(args ?? [])], {
      env,
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
    child.on("error", reject);
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      const err = new Error(`${path.basename(scriptPath)} timed out after ${timeoutMs}ms`);
      err.details = { stdout, stderr };
      reject(err);
    }, timeoutMs);
    timer.unref?.();
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function startPolicyBypassProbeServer({ port }) {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount += 1;
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/weather/current") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      // Deliberately omit x-settld-* headers to prove paid MCP tools fail closed.
      res.end(JSON.stringify({ ok: true, forecast: "sunny" }));
      return;
    }
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, code: "NOT_FOUND" }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve({
        server,
        getRequestCount: () => requestCount
      });
    });
  });
}

function stopServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function main() {
  const reportPath = path.resolve(process.cwd(), process.env.MCP_HOST_SMOKE_REPORT_PATH || "artifacts/ops/mcp-host-smoke.json");
  const opsToken = randomId("ops");
  const scopedOpsToken = buildScopedOpsToken(opsToken);
  const magicLinkApiKey = randomId("ml_admin");
  const tenantId = randomId("tenant");

  const apiPort = await pickPort();
  const magicLinkPort = await pickPort();
  const baseApiUrl = `http://127.0.0.1:${apiPort}`;
  const baseMagicLinkUrl = `http://127.0.0.1:${magicLinkPort}`;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "settld-ci-mcp-host-smoke-"));
  let policyBypassProbe = null;

  const api = startNodeProc({
    name: "api",
    scriptPath: "src/api/server.js",
    env: {
      PORT: String(apiPort),
      PROXY_BIND_HOST: "127.0.0.1",
      PROXY_OPS_TOKENS: scopedOpsToken,
      PROXY_OPS_TOKEN: opsToken,
      PROXY_AUTOTICK_INTERVAL_MS: "200"
    }
  });

  const magicLink = startNodeProc({
    name: "magic-link",
    scriptPath: "services/magic-link/src/server.js",
    env: {
      MAGIC_LINK_HOST: "127.0.0.1",
      MAGIC_LINK_PORT: String(magicLinkPort),
      MAGIC_LINK_API_KEY: magicLinkApiKey,
      MAGIC_LINK_DATA_DIR: dataDir,
      MAGIC_LINK_ARCHIVE_EXPORT_ENABLED: "0",
      MAGIC_LINK_SETTLD_API_BASE_URL: baseApiUrl,
      MAGIC_LINK_SETTLD_OPS_TOKEN: opsToken
    }
  });

  const report = {
    schemaVersion: "McpHostSmokeReport.v1",
    generatedAt: new Date().toISOString(),
    ok: false,
    tenantId,
    apiBaseUrl: baseApiUrl,
    magicLinkBaseUrl: baseMagicLinkUrl,
    checks: [],
    error: null
  };

  try {
    await waitFor("api /healthz", async () => {
      if (api.child.exitCode !== null) throw new Error(`api exited early (${api.child.exitCode})`);
      const res = await fetch(`${baseApiUrl}/healthz`).catch(() => null);
      return Boolean(res && res.ok);
    });
    report.checks.push({ id: "api_healthz", ok: true });

    await waitFor("magic-link /health", async () => {
      if (magicLink.child.exitCode !== null) throw new Error(`magic-link exited early (${magicLink.child.exitCode})`);
      const res = await fetch(`${baseMagicLinkUrl}/health`).catch(() => null);
      return Boolean(res && res.ok);
    });
    report.checks.push({ id: "magic_link_health", ok: true });

    await requestJson({
      baseUrl: baseMagicLinkUrl,
      method: "POST",
      route: "/v1/tenants",
      headers: { "x-api-key": magicLinkApiKey },
      body: {
        tenantId,
        name: "CI MCP Host Smoke Tenant",
        contactEmail: "ci@settld.work",
        billingEmail: "ci-billing@settld.work"
      }
    });

    const runtimeBootstrap = await requestJson({
      baseUrl: baseMagicLinkUrl,
      method: "POST",
      route: `/v1/tenants/${encodeURIComponent(tenantId)}/onboarding/runtime-bootstrap`,
      headers: { "x-api-key": magicLinkApiKey },
      body: {}
    });

    const mcpEnv = runtimeBootstrap?.mcp?.env ?? null;
    if (!mcpEnv || typeof mcpEnv !== "object") {
      throw new Error("runtime bootstrap did not return mcp.env");
    }
    if (typeof mcpEnv.SETTLD_API_KEY !== "string" || !mcpEnv.SETTLD_API_KEY.trim()) {
      throw new Error("runtime bootstrap did not return SETTLD_API_KEY");
    }
    report.checks.push({ id: "runtime_bootstrap", ok: true });
    if (typeof mcpEnv.SETTLD_BASE_URL !== "string" || !mcpEnv.SETTLD_BASE_URL.trim()) {
      throw new Error("runtime bootstrap did not return SETTLD_BASE_URL");
    }
    const projectedBaseUrl = normalizeBaseUrlForCompare(mcpEnv.SETTLD_BASE_URL);
    const expectedBaseUrl = normalizeBaseUrlForCompare(baseApiUrl);
    const projectedEndpoint = normalizeBaseUrlEndpointForCompare(mcpEnv.SETTLD_BASE_URL);
    const expectedEndpoint = normalizeBaseUrlEndpointForCompare(baseApiUrl);
    if (!projectedEndpoint || !expectedEndpoint) {
      throw new Error("runtime bootstrap SETTLD_BASE_URL is not a valid URL");
    }
    const sameEndpoint =
      projectedEndpoint.host === expectedEndpoint.host &&
      projectedEndpoint.port === expectedEndpoint.port &&
      projectedEndpoint.pathname === expectedEndpoint.pathname;
    if (!sameEndpoint) {
      throw new Error(
        `runtime bootstrap returned SETTLD_BASE_URL mismatch (expected ${expectedBaseUrl}, got ${projectedBaseUrl || "<empty>"})`
      );
    }
    report.checks.push({
      id: "runtime_bootstrap_base_url_matches_local_api",
      ok: true,
      expectedBaseUrl,
      observedBaseUrl: projectedBaseUrl,
      expectedEndpoint,
      observedEndpoint: projectedEndpoint
    });
    if (mcpEnv.SETTLD_TENANT_ID !== tenantId) {
      throw new Error("runtime bootstrap returned SETTLD_TENANT_ID mismatch");
    }
    const mcpConfigEnv = runtimeBootstrap?.mcpConfigJson?.mcpServers?.settld?.env ?? null;
    if (!mcpConfigEnv || typeof mcpConfigEnv !== "object") {
      throw new Error("runtime bootstrap did not return mcpConfigJson.mcpServers.settld.env");
    }
    const requiredRuntimeKeys = ["SETTLD_BASE_URL", "SETTLD_TENANT_ID", "SETTLD_API_KEY"];
    for (const key of requiredRuntimeKeys) {
      if (typeof mcpConfigEnv[key] !== "string" || !mcpConfigEnv[key].trim()) {
        throw new Error(`runtime bootstrap mcpConfigJson missing ${key}`);
      }
      if (mcpConfigEnv[key] !== mcpEnv[key]) {
        throw new Error(`runtime bootstrap mcpConfigJson env mismatch for ${key}`);
      }
    }
    report.checks.push({ id: "runtime_bootstrap_metadata_projection", ok: true, requiredRuntimeKeys });

    const runtimeMcpEnv = {
      ...mcpEnv,
      SETTLD_BASE_URL: baseApiUrl,
      SETTLD_TENANT_ID: tenantId
    };

    const mismatchTenantEnv = {
      ...mcpEnv,
      SETTLD_TENANT_ID: `${tenantId}_mismatch`
    };
    const mismatchResponse = await requestJsonExpectError(
      {
        baseUrl: baseMagicLinkUrl,
        method: "POST",
        route: `/v1/tenants/${encodeURIComponent(tenantId)}/onboarding/runtime-bootstrap/smoke-test`,
        headers: { "x-api-key": magicLinkApiKey },
        body: { env: mismatchTenantEnv }
      },
      {
        expectedStatus: 400,
        expectedCode: "ENV_INVALID",
        label: "runtime bootstrap smoke test tenant mismatch"
      }
    );
    report.checks.push({
      id: "runtime_smoke_test_rejects_tenant_mismatch",
      ok: true,
      status: mismatchResponse.status,
      code: mismatchResponse.json?.code ?? null
    });

    await requestJson({
      baseUrl: baseMagicLinkUrl,
      method: "POST",
      route: `/v1/tenants/${encodeURIComponent(tenantId)}/onboarding/runtime-bootstrap/smoke-test`,
      headers: { "x-api-key": magicLinkApiKey },
      body: { env: mcpEnv }
    });
    report.checks.push({ id: "runtime_smoke_test", ok: true });

    // verify initialize/tools list + tool invocation from an MCP host perspective
    await runNodeScript(
      "scripts/mcp/probe.mjs",
      [
        "--call",
        "settld.about",
        "{}",
        "--require-tool",
        "settld.relationships_list",
        "--require-tool",
        "settld.public_reputation_summary_get",
        "--require-tool",
        "settld.interaction_graph_pack_get"
      ],
      {
        env: { ...process.env, ...runtimeMcpEnv, MCP_PROBE_TIMEOUT_MS: "30000" }
      }
    );
    report.checks.push({ id: "mcp_initialize_tools_list", ok: true });
    report.checks.push({ id: "mcp_tool_call_settld_about", ok: true });

    await runNodeScript("scripts/mcp/probe.mjs", ["--interaction-graph-smoke"], {
      env: { ...process.env, ...runtimeMcpEnv, MCP_PROBE_TIMEOUT_MS: "30000" }
    });
    report.checks.push({ id: "mcp_interaction_graph_signed_smoke", ok: true });

    const paidToolsPort = await pickPort();
    policyBypassProbe = await startPolicyBypassProbeServer({ port: paidToolsPort });
    const paidToolProbe = await runNodeScriptCapture(
      "scripts/mcp/probe.mjs",
      ["--call", "settld.weather_current_paid", '{"city":"Austin","unit":"f"}'],
      {
        env: {
          ...process.env,
          ...runtimeMcpEnv,
          SETTLD_PAID_TOOLS_BASE_URL: `http://127.0.0.1:${paidToolsPort}`,
          MCP_PROBE_TIMEOUT_MS: "30000"
        },
        timeoutMs: 45_000
      }
    );
    if (paidToolProbe.code !== 0) {
      const err = new Error("paid tool policy-metadata probe failed unexpectedly");
      err.details = {
        code: paidToolProbe.code,
        signal: paidToolProbe.signal,
        stderr: paidToolProbe.stderr
      };
      throw err;
    }
    const sawProbeRequest = policyBypassProbe.getRequestCount() > 0;
    const sawToolError = paidToolProbe.stdout.includes('"isError": true');
    const sawPolicyMetadataError = paidToolProbe.stdout.includes(
      "settld.weather_current_paid response missing settld policy runtime metadata"
    );
    if (!sawProbeRequest || !sawToolError || !sawPolicyMetadataError) {
      const err = new Error("paid MCP tool did not fail closed when policy runtime metadata was absent");
      err.details = {
        sawProbeRequest,
        sawToolError,
        sawPolicyMetadataError
      };
      throw err;
    }
    report.checks.push({
      id: "mcp_paid_tool_runtime_policy_metadata_fail_closed",
      ok: true,
      requestCount: policyBypassProbe.getRequestCount(),
      expectedError: "settld.weather_current_paid response missing settld policy runtime metadata"
    });

    report.ok = true;

    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } catch (err) {
    report.ok = false;
    report.error = {
      message: err?.message ?? String(err),
      details: err?.details ?? null
    };
    const apiLogs = api.logs.join("\n");
    const magicLogs = magicLink.logs.join("\n");
    const details = err?.details ? `\nDetails: ${JSON.stringify(err.details)}` : "";
    process.stderr.write(
      `${err?.stack ?? err?.message ?? String(err)}${details}\n--- api logs ---\n${apiLogs}\n--- magic-link logs ---\n${magicLogs}\n`
    );
    process.exitCode = 1;
  } finally {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    process.stdout.write(`wrote mcp host smoke report: ${reportPath}\n`);
    await stopServer(policyBypassProbe?.server);
    await stopProc(magicLink.child);
    await stopProc(api.child);
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
  process.exit(1);
});
