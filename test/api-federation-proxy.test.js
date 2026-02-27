import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";

const FED_KEYS = [
  "FEDERATION_PROXY_BASE_URL",
  "PROXY_FEDERATION_BASE_URL",
  "COORDINATOR_DID",
  "PROXY_COORDINATOR_DID",
  "PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS",
  "PROXY_FEDERATION_NAMESPACE_ROUTES"
];

function withEnvMap(overrides = {}) {
  const prev = new Map();
  for (const key of FED_KEYS) {
    prev.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) delete process.env[key];
    else process.env[key] = String(value);
  }
  return () => {
    for (const key of FED_KEYS) {
      const value = prev.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address !== "object") throw new TypeError("failed to bind test server");
  return `http://127.0.0.1:${address.port}`;
}

function invokeEnvelope({ invocationId = "inv_1", originDid = "did:nooterra:coord_alpha", targetDid = "did:nooterra:coord_bravo" } = {}) {
  return {
    version: "1.0",
    type: "coordinatorInvoke",
    invocationId,
    originDid,
    targetDid,
    capabilityId: "capability.dispatch.v1",
    payload: { op: "ping" }
  };
}

function resultEnvelope({ invocationId = "inv_1", originDid = "did:nooterra:coord_bravo", targetDid = "did:nooterra:coord_alpha" } = {}) {
  return {
    version: "1.0",
    type: "coordinatorResult",
    invocationId,
    originDid,
    targetDid,
    status: "success",
    result: { ok: true }
  };
}

test("api federation proxy: fails closed when federation base URL is not configured", async () => {
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  try {
    const api = createApi();
    const res = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invokeEnvelope(),
      auth: "none"
    });

    assert.equal(res.statusCode, 503);
    assert.equal(res.json?.code, "FEDERATION_NOT_CONFIGURED");
  } finally {
    restore();
  }
});

test("api federation proxy: fails closed when fetch is unavailable", { concurrency: false }, async () => {
  const restoreEnv = withEnvMap({
    FEDERATION_PROXY_BASE_URL: "https://federation.nooterra.test",
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  const prevFetch = globalThis.fetch;
  try {
    const api = createApi();
    globalThis.fetch = undefined;
    const res = await request(api, {
      method: "POST",
      path: "/v1/federation/result",
      body: resultEnvelope(),
      auth: "none"
    });

    assert.equal(res.statusCode, 500);
    assert.equal(res.json?.code, "FEDERATION_FETCH_UNAVAILABLE");
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv();
  }
});

test("api federation proxy: fails closed when envelope is malformed", async () => {
  const restore = withEnvMap({
    FEDERATION_PROXY_BASE_URL: "https://federation.nooterra.test",
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  try {
    const api = createApi();
    const res = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: { not: "envelope" },
      auth: "none"
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.json?.code, "FEDERATION_PROTOCOL_VERSION_MISMATCH");
  } finally {
    restore();
  }
});

test("api federation proxy: fails closed when federation peer is untrusted", async () => {
  const restore = withEnvMap({
    FEDERATION_PROXY_BASE_URL: "https://federation.nooterra.test",
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_charlie"
  });
  try {
    const api = createApi();
    const res = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invokeEnvelope(),
      auth: "none"
    });

    assert.equal(res.statusCode, 403);
    assert.equal(res.json?.code, "FEDERATION_UNTRUSTED_COORDINATOR");
  } finally {
    restore();
  }
});

test("api federation proxy: routes by namespace DID with explicit route map", async () => {
  const callsA = [];
  const callsB = [];
  const upstreamA = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      callsA.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.statusCode = 201;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, route: "A" }));
    });
  });
  const upstreamB = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      callsB.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.statusCode = 202;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, route: "B" }));
    });
  });

  const baseUrlA = await listen(upstreamA);
  const baseUrlB = await listen(upstreamB);

  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo,did:nooterra:coord_charlie",
    PROXY_FEDERATION_NAMESPACE_ROUTES: JSON.stringify({
      "did:nooterra:coord_bravo": baseUrlA,
      "did:nooterra:coord_charlie": baseUrlB
    })
  });

  try {
    const api = createApi();

    const toBravo = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invokeEnvelope({ invocationId: "inv_route_1", targetDid: "did:nooterra:coord_bravo" }),
      auth: "none"
    });
    const toCharlie = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invokeEnvelope({ invocationId: "inv_route_2", targetDid: "did:nooterra:coord_charlie" }),
      auth: "none"
    });

    assert.equal(toBravo.statusCode, 201);
    assert.equal(toCharlie.statusCode, 202);
    assert.equal(callsA.length, 1);
    assert.equal(callsB.length, 1);
    assert.equal(callsA[0].headers["x-federation-namespace-did"], "did:nooterra:coord_bravo");
    assert.equal(callsB[0].headers["x-federation-namespace-did"], "did:nooterra:coord_charlie");
  } finally {
    restore();
    await new Promise((resolve) => upstreamA.close(resolve));
    await new Promise((resolve) => upstreamB.close(resolve));
  }
});

test("api federation proxy: deterministic replay returns stored response without second upstream call", async () => {
  const calls = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      calls.push({ url: req.url, body: Buffer.concat(chunks).toString("utf8") });
      res.statusCode = 201;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, upstream: "federation", call: calls.length }));
    });
  });

  const baseUrl = await listen(upstream);
  const restore = withEnvMap({
    FEDERATION_PROXY_BASE_URL: baseUrl,
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });

  try {
    const api = createApi();
    const payload = invokeEnvelope({ invocationId: "inv_replay_1" });

    const first = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: payload,
      auth: "none"
    });
    const second = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: payload,
      auth: "none"
    });

    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.equal(second.json?.call, 1);
    assert.equal(second.headers?.get?.("x-federation-replay"), "duplicate");
    assert.equal(calls.length, 1);
  } finally {
    restore();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("api federation proxy: conflict on same invocation identity with different payload hash", async () => {
  const calls = [];
  const upstream = http.createServer((req, res) => {
    req.resume();
    calls.push(req.url);
    res.statusCode = 201;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
  });

  const baseUrl = await listen(upstream);
  const restore = withEnvMap({
    FEDERATION_PROXY_BASE_URL: baseUrl,
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });

  try {
    const api = createApi();

    const first = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invokeEnvelope({ invocationId: "inv_conflict_1", capabilityId: "capability.dispatch.v1" }),
      auth: "none"
    });

    const second = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: {
        ...invokeEnvelope({ invocationId: "inv_conflict_1", capabilityId: "capability.dispatch.v1" }),
        payload: { op: "different" }
      },
      auth: "none"
    });

    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 409);
    assert.equal(second.json?.code, "FEDERATION_ENVELOPE_CONFLICT");
    assert.equal(Array.isArray(second.json?.details?.requestSha256Values), true);
    assert.equal(second.json.details.requestSha256Values.length, 2);
    assert.equal(calls.length, 1);
  } finally {
    restore();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("api federation proxy: fails closed when upstream attempts redirect", async () => {
  let redirectedHitCount = 0;
  const redirectedTarget = http.createServer((req, res) => {
    redirectedHitCount += 1;
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, source: "redirect-target" }));
  });
  const redirectingUpstream = http.createServer((req, res) => {
    res.statusCode = 307;
    res.setHeader("location", `${redirectedTargetBaseUrl}/capture`);
    res.end();
  });

  const redirectedTargetBaseUrl = await listen(redirectedTarget);
  const redirectingBaseUrl = await listen(redirectingUpstream);
  const restore = withEnvMap({
    FEDERATION_PROXY_BASE_URL: redirectingBaseUrl,
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  try {
    const api = createApi();
    const res = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invokeEnvelope({ invocationId: "inv_redirect_1" }),
      auth: "none"
    });

    assert.equal(res.statusCode, 502);
    assert.equal(res.json?.code, "FEDERATION_UPSTREAM_UNREACHABLE");
    assert.equal(redirectedHitCount, 0);
  } finally {
    restore();
    await new Promise((resolve) => redirectingUpstream.close(resolve));
    await new Promise((resolve) => redirectedTarget.close(resolve));
  }
});
