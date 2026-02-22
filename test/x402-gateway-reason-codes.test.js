import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { normalizeReasonCodes } from "../src/core/policy-decision.js";
import { listenOnEphemeralLoopback } from "./lib/listen.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function onceProcessExit(child) {
  return new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
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

async function waitForGatewayReady({ port, timeoutMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.status === 200) return;
    } catch {
      // retry until timeout
    }
    await sleep(100);
  }
  throw new Error("gateway did not become ready");
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return null;
  return JSON.parse(text);
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function setupGatewayFixture(t, { gateId, verifyResponse } = {}) {
  const resolvedGateId = typeof gateId === "string" && gateId.trim() !== "" ? gateId : "gate_reason_codes_1";
  const upstreamRequests = [];
  const settldApiRequests = [];

  const upstream = http.createServer((req, res) => {
    const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    const hasSettldPay = authHeader.toLowerCase().startsWith("settldpay ");
    upstreamRequests.push({
      method: req.method,
      url: req.url,
      authorization: authHeader
    });
    if (!hasSettldPay) {
      res.writeHead(402, {
        "content-type": "application/json; charset=utf-8",
        "x-payment-required": "amountCents=500; currency=USD; toolId=mock_search; address=mock:payee; network=mocknet"
      });
      res.end(JSON.stringify({ ok: false, code: "PAYMENT_REQUIRED" }));
      return;
    }
    writeJson(res, 200, { ok: true, provider: "mock" });
  });
  const upstreamBind = await listenOnEphemeralLoopback(upstream, { hosts: ["127.0.0.1"] });
  const upstreamBase = `http://127.0.0.1:${upstreamBind.port}`;

  const settldApi = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const body = req.method === "POST" ? await readJsonBody(req) : null;
    settldApiRequests.push({
      method: req.method,
      path: url.pathname,
      body
    });

    if (req.method === "POST" && url.pathname === "/x402/gate/create") {
      writeJson(res, 201, { gate: { gateId: resolvedGateId } });
      return;
    }
    if (req.method === "POST" && url.pathname === "/x402/gate/authorize-payment") {
      writeJson(res, 200, {
        gateId: resolvedGateId,
        authorizationRef: "authz_gateway_reason_1",
        token: "settldpay_gateway_reason_token_1"
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/x402/gate/verify") {
      writeJson(res, 200, verifyResponse ?? {});
      return;
    }
    writeJson(res, 404, { ok: false, error: "not_found" });
  });
  const apiBind = await listenOnEphemeralLoopback(settldApi, { hosts: ["127.0.0.1"] });
  const apiBase = `http://127.0.0.1:${apiBind.port}`;

  const gatewayPort = await reservePort();
  const gateway = spawn(process.execPath, ["services/x402-gateway/src/server.js"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(gatewayPort),
      BIND_HOST: "127.0.0.1",
      SETTLD_API_URL: apiBase,
      SETTLD_API_KEY: "sk_gateway_reason.secret",
      UPSTREAM_URL: upstreamBase,
      X402_AUTOFUND: "1"
    }
  });

  t.after(async () => {
    if (!gateway.killed) gateway.kill("SIGTERM");
    const exited = await Promise.race([onceProcessExit(gateway), sleep(1_500).then(() => null)]);
    if (!exited && !gateway.killed) gateway.kill("SIGKILL");
    await new Promise((resolve) => upstream.close(resolve));
    await new Promise((resolve) => settldApi.close(resolve));
  });

  await waitForGatewayReady({ port: gatewayPort });
  const gatewayBase = `http://127.0.0.1:${gatewayPort}`;

  return {
    gatewayBase,
    gateId: resolvedGateId,
    upstreamRequests,
    settldApiRequests
  };
}

async function runGatewayPaidFlow({ gatewayBase, query, gateId }) {
  const first = await fetch(`${gatewayBase}/tools/search?q=${encodeURIComponent(query)}`);
  assert.equal(first.status, 402);
  const returnedGateId = first.headers.get("x-settld-gate-id");
  assert.ok(returnedGateId && returnedGateId.trim() !== "");
  if (gateId) assert.equal(returnedGateId, gateId);

  const second = await fetch(`${gatewayBase}/tools/search?q=${encodeURIComponent(query)}`, {
    headers: {
      "x-settld-gate-id": returnedGateId
    }
  });
  const secondBody = await second.text();
  assert.equal(second.status, 200, secondBody);
  return { second, secondBody, gateId: returnedGateId };
}

test("x402 gateway: reason-code headers match shared normalization with deterministic dedup+ordering", async (t) => {
  const fromGateDecision = ["  X402_PROVIDER_SIGNATURE_INVALID  ", "POLICY_ALLOW", "X402_PROVIDER_SIGNATURE_INVALID", "BETA"];
  const fromDecision = ["ALPHA", "POLICY_ALLOW", "ALPHA", "  ", "BETA"];
  const verifyResponse = {
    gate: {
      decision: {
        verificationStatus: "red",
        reasonCodes: fromGateDecision
      }
    },
    decision: {
      reasonCodes: fromDecision
    },
    settlement: {
      status: "refunded",
      releasedAmountCents: 0,
      refundedAmountCents: 500
    },
    decisionRecord: {
      decisionId: "dec_reason_codes_1",
      policyHashUsed: "a".repeat(64),
      bindings: {
        policyDecisionFingerprint: {
          policyVersion: 1,
          verificationMethodHash: "b".repeat(64),
          evaluationHash: "c".repeat(64)
        }
      }
    }
  };

  const fixture = await setupGatewayFixture(t, {
    gateId: "gate_reason_codes_norm_1",
    verifyResponse
  });
  const paid = await runGatewayPaidFlow({
    gatewayBase: fixture.gatewayBase,
    query: "reason-codes",
    gateId: fixture.gateId
  });
  assert.equal(JSON.parse(paid.secondBody)?.ok, true);

  const normalizedExpected = normalizeReasonCodes([...fromGateDecision, ...fromDecision]);
  const headerValue = String(paid.second.headers.get("x-settld-verification-codes") ?? "");
  assert.ok(headerValue.length > 0);
  const headerReasonCodes = headerValue
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  assert.deepEqual(headerReasonCodes, normalizedExpected);
  assert.equal(paid.second.headers.get("x-settld-reason-code"), normalizedExpected[0]);
  assert.equal(new Set(headerReasonCodes).size, headerReasonCodes.length);
  assert.deepEqual([...headerReasonCodes].sort((left, right) => left.localeCompare(right)), headerReasonCodes);
});

test("x402 gateway: policy fingerprint headers are emitted and match decisionRecord bindings", async (t) => {
  const fingerprint = {
    policyVersion: 9,
    verificationMethodHash: "B".repeat(64),
    evaluationHash: "C".repeat(64)
  };
  const verifyResponse = {
    gate: {
      decision: {
        verificationStatus: "green",
        reasonCodes: ["POLICY_ALLOW"]
      }
    },
    decision: {
      reasonCodes: ["POLICY_ALLOW"]
    },
    settlement: {
      status: "released",
      releasedAmountCents: 500,
      refundedAmountCents: 0
    },
    decisionRecord: {
      decisionId: "dec_policy_fingerprint_1",
      policyHashUsed: "A".repeat(64),
      bindings: {
        policyDecisionFingerprint: fingerprint
      }
    }
  };

  const fixture = await setupGatewayFixture(t, {
    gateId: "gate_policy_fingerprint_1",
    verifyResponse
  });
  const paid = await runGatewayPaidFlow({
    gatewayBase: fixture.gatewayBase,
    query: "policy-fingerprint",
    gateId: fixture.gateId
  });
  assert.equal(JSON.parse(paid.secondBody)?.ok, true);

  const expectedPolicyHash = String(verifyResponse.decisionRecord.policyHashUsed).toLowerCase();
  const expectedVerificationMethodHash = String(fingerprint.verificationMethodHash).toLowerCase();
  const expectedEvaluationHash = String(fingerprint.evaluationHash).toLowerCase();

  assert.equal(paid.second.headers.get("x-settld-decision-id"), verifyResponse.decisionRecord.decisionId);
  assert.equal(paid.second.headers.get("x-settld-policy-hash"), expectedPolicyHash);
  assert.equal(
    paid.second.headers.get("x-settld-policy-version"),
    String(verifyResponse.decisionRecord.bindings.policyDecisionFingerprint.policyVersion)
  );
  assert.equal(paid.second.headers.get("x-settld-policy-verification-method-hash"), expectedVerificationMethodHash);
  assert.equal(paid.second.headers.get("x-settld-policy-evaluation-hash"), expectedEvaluationHash);

  const verifyCalls = fixture.settldApiRequests.filter((row) => row.method === "POST" && row.path === "/x402/gate/verify");
  assert.equal(verifyCalls.length, 1);
  assert.equal(verifyCalls[0]?.body?.gateId, fixture.gateId);
});
