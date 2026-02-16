import test from "node:test";
import assert from "node:assert/strict";

import { fetchWithSettldAutopay } from "../packages/api-sdk/src/index.js";

test("api-sdk x402 autopay: retries 402 with x-settld-gate-id", async () => {
  const calls = [];
  const fetchStub = async (_url, init = {}) => {
    const headers = new Headers(init?.headers ?? {});
    calls.push({ headers: Object.fromEntries(headers.entries()) });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ ok: false, code: "PAYMENT_REQUIRED" }), {
        status: 402,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-settld-gate-id": "gate_demo_1"
        }
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  };

  const res = await fetchWithSettldAutopay("https://gateway.settld.local/resource", { method: "GET" }, { fetch: fetchStub });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.headers?.["x-settld-gate-id"], "gate_demo_1");
});

test("api-sdk x402 autopay: returns first 402 when gate header is missing", async () => {
  let calls = 0;
  const fetchStub = async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: false, code: "PAYMENT_REQUIRED" }), {
      status: 402,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  };

  const res = await fetchWithSettldAutopay("https://gateway.settld.local/resource", { method: "GET" }, { fetch: fetchStub });
  assert.equal(res.status, 402);
  assert.equal(calls, 1);
});

test("api-sdk x402 autopay: throws for non-replayable request body", async () => {
  const fetchStub = async () =>
    new Response(JSON.stringify({ ok: false, code: "PAYMENT_REQUIRED" }), {
      status: 402,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-settld-gate-id": "gate_demo_2"
      }
    });

  await assert.rejects(
    async () =>
      await fetchWithSettldAutopay(
        "https://gateway.settld.local/resource",
        { method: "POST", body: new ReadableStream() },
        { fetch: fetchStub }
      ),
    (err) => err?.code === "SETTLD_AUTOPAY_BODY_NOT_REPLAYABLE"
  );
});
