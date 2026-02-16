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
const DEFAULT_TENANT_ID = "tenant_default";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reservePort() {
  const server = http.createServer((_, res) => {
    res.statusCode = 204;
    res.end();
  });
  const { port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] });
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function putAuthKey(api, { tenantId = DEFAULT_TENANT_ID } = {}) {
  const keyId = authKeyId();
  const secret = authKeySecret();
  const createdAt = typeof api.store?.nowIso === "function" ? api.store.nowIso() : new Date().toISOString();
  await api.store.putAuthKey({
    tenantId,
    authKey: {
      keyId,
      secretHash: hashAuthKeySecret(secret),
      scopes: ["ops_read", "ops_write", "finance_read", "finance_write", "audit_read"],
      status: "active",
      createdAt
    }
  });
  return `${keyId}.${secret}`;
}

async function waitForGatewayReady({ port, timeoutMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.status === 200) return;
    } catch {
      // retry until deadline
    }
    await sleep(100);
  }
  throw new Error("gateway did not become ready");
}

function onceProcessExit(child) {
  return new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

test("x402 gateway: retries with SettldPay token and returns verified response", async (t) => {
  const upstreamRequests = [];
  const upstream = http.createServer((req, res) => {
    const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    const hasSettldPay = authHeader.toLowerCase().startsWith("settldpay ");
    const paymentHeader = typeof req.headers["x-payment"] === "string" ? req.headers["x-payment"] : null;
    upstreamRequests.push({
      method: req.method,
      url: req.url,
      authorization: authHeader,
      xPayment: paymentHeader
    });
    if (!hasSettldPay) {
      res.writeHead(402, {
        "content-type": "application/json; charset=utf-8",
        "x-payment-required": "amountCents=500; currency=USD; address=mock:payee; network=mocknet"
      });
      res.end(JSON.stringify({ ok: false, code: "PAYMENT_REQUIRED" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, provider: "mock" }));
  });
  const upstreamBind = await listenOnEphemeralLoopback(upstream, { hosts: ["127.0.0.1"] });
  const upstreamBase = `http://127.0.0.1:${upstreamBind.port}`;

  const api = createApi();
  const apiServer = http.createServer(api.handle);
  const apiBind = await listenOnEphemeralLoopback(apiServer, { hosts: ["127.0.0.1"] });
  const apiBase = `http://127.0.0.1:${apiBind.port}`;
  const apiKey = await putAuthKey(api, { tenantId: DEFAULT_TENANT_ID });

  const gatewayPort = await reservePort();
  const gateway = spawn(process.execPath, ["services/x402-gateway/src/server.js"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(gatewayPort),
      BIND_HOST: "127.0.0.1",
      SETTLD_API_URL: apiBase,
      SETTLD_API_KEY: apiKey,
      UPSTREAM_URL: upstreamBase,
      X402_AUTOFUND: "1"
    }
  });

  let stderrBuf = "";
  gateway.stderr.setEncoding("utf8");
  gateway.stderr.on("data", (chunk) => {
    stderrBuf += String(chunk);
  });

  let stdoutBuf = "";
  gateway.stdout.setEncoding("utf8");
  gateway.stdout.on("data", (chunk) => {
    stdoutBuf += String(chunk);
  });

  t.after(async () => {
    if (!gateway.killed) gateway.kill("SIGTERM");
    const exited = await Promise.race([onceProcessExit(gateway), sleep(1_500).then(() => null)]);
    if (!exited && !gateway.killed) gateway.kill("SIGKILL");
    await new Promise((resolve) => upstream.close(resolve));
    await new Promise((resolve) => apiServer.close(resolve));
  });

  await waitForGatewayReady({ port: gatewayPort });
  const gatewayBase = `http://127.0.0.1:${gatewayPort}`;

  const first = await fetch(`${gatewayBase}/tools/search?q=dentist`);
  assert.equal(first.status, 402);
  const gateId = first.headers.get("x-settld-gate-id");
  assert.ok(gateId && gateId.trim() !== "");

  const second = await fetch(`${gatewayBase}/tools/search?q=dentist`, {
    headers: {
      "x-settld-gate-id": gateId
    }
  });
  const secondText = await second.text();
  assert.equal(second.status, 200, `unexpected second status=${second.status} body=${secondText} requests=${JSON.stringify(upstreamRequests)}`);
  const secondJson = JSON.parse(secondText);
  assert.equal(secondJson.ok, true);
  assert.equal(second.headers.get("x-settld-settlement-status"), "released");
  assert.equal(second.headers.get("x-settld-verification-status"), "green");

  assert.equal(upstreamRequests.length >= 2, true);
  const paidCall = upstreamRequests.find((row) => row.authorization.toLowerCase().startsWith("settldpay "));
  assert.ok(paidCall, `expected SettldPay retry; stdout=${stdoutBuf} stderr=${stderrBuf}`);
  assert.ok(typeof paidCall.xPayment === "string" && paidCall.xPayment.length > 0);
});
