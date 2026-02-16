import test from "node:test";
import assert from "node:assert/strict";

import { CIRCLE_RESERVE_STATUS, createCircleReserveAdapter } from "../src/core/circle-reserve-adapter.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function makeQueuedFetch(responses) {
  const queue = Array.isArray(responses) ? [...responses] : [];
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: String(init?.method ?? "GET"),
      headers: { ...(init?.headers ?? {}) },
      body: init?.body ?? null
    });
    if (queue.length === 0) throw new Error("unexpected fetch call (queue empty)");
    const next = queue.shift();
    if (typeof next === "function") return next({ url: String(url), init });
    return next;
  };
  return { fetchFn, calls };
}

function baseSandboxConfig() {
  return {
    apiKey: "circle_test_key",
    baseUrl: "https://api-sandbox.circle.com",
    blockchain: "BASE-SEPOLIA",
    spendWalletId: "wallet_spend",
    escrowWalletId: "wallet_escrow",
    spendAddress: "0x1111111111111111111111111111111111111111",
    escrowAddress: "0x2222222222222222222222222222222222222222",
    tokenId: "token_usdc",
    entitySecretCiphertextProvider: () => `cipher_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  };
}

test("circle reserve adapter: stub mode returns deterministic reserve ids", async () => {
  const adapter = createCircleReserveAdapter({
    mode: "stub",
    now: () => "2026-02-16T00:00:00.000Z"
  });

  const a = await adapter.reserve({
    tenantId: "tenant_default",
    gateId: "gate_1",
    amountCents: 500,
    currency: "USD",
    idempotencyKey: "idem_gate_1"
  });
  const b = await adapter.reserve({
    tenantId: "tenant_default",
    gateId: "gate_1",
    amountCents: 500,
    currency: "USD",
    idempotencyKey: "idem_gate_1"
  });

  assert.equal(a.status, CIRCLE_RESERVE_STATUS.RESERVED);
  assert.equal(b.status, CIRCLE_RESERVE_STATUS.RESERVED);
  assert.equal(a.reserveId, b.reserveId);
});

test("circle reserve adapter: sandbox reserve maps INITIATED to reserved and sends UUID idempotency", async () => {
  const { fetchFn, calls } = makeQueuedFetch([jsonResponse(200, { data: { id: "tx_1", state: "INITIATED" } })]);
  const adapter = createCircleReserveAdapter({
    mode: "sandbox",
    fetchFn,
    now: () => "2026-02-16T00:00:00.000Z",
    config: baseSandboxConfig()
  });

  const reserve = await adapter.reserve({
    tenantId: "tenant_default",
    gateId: "gate_alpha",
    amountCents: 500,
    currency: "USD",
    idempotencyKey: "gate_alpha_non_uuid"
  });

  assert.equal(reserve.status, CIRCLE_RESERVE_STATUS.RESERVED);
  assert.equal(reserve.reserveId, "tx_1");
  assert.match(reserve.metadata.circleIdempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.ok(calls[0].url.endsWith("/v1/w3s/developer/transactions/transfer"));

  const requestBody = JSON.parse(String(calls[0].body ?? "{}"));
  assert.equal(requestBody.walletId, "wallet_spend");
  assert.equal(requestBody.destinationAddress, "0x2222222222222222222222222222222222222222");
  assert.equal(requestBody.blockchain, "BASE-SEPOLIA");
  assert.equal(requestBody.tokenId, "token_usdc");
  assert.deepEqual(requestBody.amounts, ["5.00"]);
});

test("circle reserve adapter: sandbox reserve rejects DENIED state", async () => {
  const { fetchFn } = makeQueuedFetch([jsonResponse(200, { data: { id: "tx_denied", state: "DENIED" } })]);
  const adapter = createCircleReserveAdapter({
    mode: "sandbox",
    fetchFn,
    config: baseSandboxConfig()
  });

  await assert.rejects(
    () =>
      adapter.reserve({
        tenantId: "tenant_default",
        gateId: "gate_denied",
        amountCents: 100,
        currency: "USD",
        idempotencyKey: "gate_denied"
      }),
    (err) => err?.code === "CIRCLE_RESERVE_FAILED"
  );
});

test("circle reserve adapter: void cancels pending reserves when transaction is cancellable", async () => {
  const { fetchFn } = makeQueuedFetch([
    jsonResponse(200, { data: { id: "tx_pending", state: "INITIATED" } }),
    jsonResponse(200, { data: { id: "tx_pending", state: "CANCELLED" } })
  ]);
  const adapter = createCircleReserveAdapter({
    mode: "sandbox",
    fetchFn,
    now: () => "2026-02-16T00:00:00.000Z",
    config: baseSandboxConfig()
  });

  const out = await adapter.void({
    reserveId: "tx_pending",
    amountCents: 500,
    currency: "USD"
  });
  assert.equal(out.status, CIRCLE_RESERVE_STATUS.VOIDED);
  assert.equal(out.method, "cancel");
});

test("circle reserve adapter: void compensates when reserve is already confirmed", async () => {
  const { fetchFn } = makeQueuedFetch([
    jsonResponse(200, { data: { id: "tx_confirmed", state: "CONFIRMED" } }),
    jsonResponse(200, { data: { id: "tx_comp_1", state: "INITIATED" } })
  ]);
  const adapter = createCircleReserveAdapter({
    mode: "sandbox",
    fetchFn,
    now: () => "2026-02-16T00:00:00.000Z",
    config: baseSandboxConfig()
  });

  const out = await adapter.void({
    reserveId: "tx_confirmed",
    amountCents: 500,
    currency: "USD",
    idempotencyKey: "tx_confirmed_void"
  });
  assert.equal(out.status, CIRCLE_RESERVE_STATUS.VOIDED);
  assert.equal(out.method, "compensate");
  assert.equal(out.compensationReserveId, "tx_comp_1");
});
