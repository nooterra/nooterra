import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";

function withEnv(key, value) {
  const prev = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
  if (value === undefined || value === null) delete process.env[key];
  else process.env[key] = String(value);
  return () => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
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

test("api federation proxy: fails closed when federation base URL is not configured", async () => {
  const restore = withEnv("FEDERATION_PROXY_BASE_URL", null);
  try {
    const api = createApi();
    const res = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: { op: "ping" },
      auth: "none"
    });

    assert.equal(res.statusCode, 503);
    assert.equal(res.json?.code, "FEDERATION_NOT_CONFIGURED");
  } finally {
    restore();
  }
});

test("api federation proxy: fails closed when fetch is unavailable", { concurrency: false }, async () => {
  const restoreEnv = withEnv("FEDERATION_PROXY_BASE_URL", "https://federation.nooterra.test");
  const prevFetch = globalThis.fetch;
  try {
    const api = createApi();
    globalThis.fetch = undefined;
    const res = await request(api, {
      method: "POST",
      path: "/v1/federation/result",
      body: { status: "ok" },
      auth: "none"
    });

    assert.equal(res.statusCode, 500);
    assert.equal(res.json?.code, "FEDERATION_FETCH_UNAVAILABLE");
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv();
  }
});

test("api federation proxy: forwards request semantics to configured local upstream", async () => {
  const calls = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      calls.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8")
      });
      res.statusCode = 201;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, upstream: "federation" }));
    });
  });

  const baseUrl = await listen(upstream);
  const restore = withEnv("FEDERATION_PROXY_BASE_URL", baseUrl);
  try {
    const api = createApi();
    const res = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke?trace=1",
      body: { taskId: "task_123", intent: "invoke" },
      headers: {
        "x-request-id": "req_fed_proxy_1",
        "x-federation-trace": "trace_abc"
      },
      auth: "none"
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.json?.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url, "/v1/federation/invoke?trace=1");
    assert.equal(calls[0].body, JSON.stringify({ taskId: "task_123", intent: "invoke" }));
    assert.equal(calls[0].headers["x-request-id"], "req_fed_proxy_1");
    assert.equal(calls[0].headers["x-federation-trace"], "trace_abc");
    assert.equal(calls[0].headers["content-type"], "application/json");
  } finally {
    restore();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
