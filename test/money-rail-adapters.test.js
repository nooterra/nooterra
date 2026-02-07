import test from "node:test";
import assert from "node:assert/strict";

import {
  MONEY_RAIL_PROVIDER_EVENT_TYPE,
  MONEY_RAIL_OPERATION_STATE,
  createInMemoryMoneyRailAdapter,
  createMoneyRailAdapterRegistry
} from "../src/core/money-rail-adapters.js";

test("money rail adapter: create/status/cancel lifecycle is deterministic", async () => {
  const adapter = createInMemoryMoneyRailAdapter({ now: () => "2026-02-07T00:00:00.000Z" });

  const created = await adapter.create({
    tenantId: "tenant_s0",
    operationId: "op_0001",
    direction: "payout",
    idempotencyKey: "idem_0001",
    amountCents: 1250,
    currency: "USD",
    counterpartyRef: "acct_ext_001"
  });
  assert.equal(created.idempotentReplay, false);
  assert.equal(created.operation.state, MONEY_RAIL_OPERATION_STATE.INITIATED);

  const status = await adapter.status({ tenantId: "tenant_s0", operationId: "op_0001" });
  assert.ok(status);
  assert.equal(status.state, MONEY_RAIL_OPERATION_STATE.INITIATED);

  const cancelled = await adapter.cancel({
    tenantId: "tenant_s0",
    operationId: "op_0001",
    reasonCode: "manual_abort",
    at: "2026-02-07T00:01:00.000Z"
  });
  assert.equal(cancelled.applied, true);
  assert.equal(cancelled.operation.state, MONEY_RAIL_OPERATION_STATE.CANCELLED);
  assert.equal(cancelled.operation.reasonCode, "manual_abort");

  const cancelReplay = await adapter.cancel({
    tenantId: "tenant_s0",
    operationId: "op_0001",
    reasonCode: "manual_abort",
    at: "2026-02-07T00:02:00.000Z"
  });
  assert.equal(cancelReplay.applied, false);
  assert.equal(cancelReplay.operation.state, MONEY_RAIL_OPERATION_STATE.CANCELLED);
  assert.equal(cancelReplay.operation.cancelledAt, "2026-02-07T00:01:00.000Z");
});

test("money rail adapter: duplicate create with same idempotency key returns stable response", async () => {
  const adapter = createInMemoryMoneyRailAdapter({ now: () => "2026-02-07T00:00:00.000Z" });

  const first = await adapter.create({
    tenantId: "tenant_s0",
    operationId: "op_0002",
    direction: "collection",
    idempotencyKey: "idem_0002",
    amountCents: 900,
    currency: "USD",
    counterpartyRef: "bank_src_001",
    metadata: { transferType: "ach" }
  });
  const second = await adapter.create({
    tenantId: "tenant_s0",
    operationId: "op_0002",
    direction: "collection",
    idempotencyKey: "idem_0002",
    amountCents: 900,
    currency: "USD",
    counterpartyRef: "bank_src_001",
    metadata: { transferType: "ach" }
  });
  assert.equal(second.idempotentReplay, true);
  assert.deepEqual(second.operation, first.operation);

  await assert.rejects(
    () =>
      adapter.create({
        tenantId: "tenant_s0",
        operationId: "op_9999",
        direction: "collection",
        idempotencyKey: "idem_0002",
        amountCents: 901,
        currency: "USD",
        counterpartyRef: "bank_src_001"
      }),
    (err) => err?.code === "MONEY_RAIL_IDEMPOTENCY_CONFLICT"
  );
});

test("money rail adapter registry: provider-agnostic lookup by providerId", () => {
  const adapter = createInMemoryMoneyRailAdapter({ providerId: "stub_payments" });
  const registry = createMoneyRailAdapterRegistry({ adapters: [adapter] });

  assert.deepEqual(registry.list(), ["stub_payments"]);
  assert.equal(registry.get("stub_payments"), adapter);
  assert.equal(registry.get("missing_provider"), null);
});

test("money rail adapter: provider event ingestion transitions states deterministically", async () => {
  const adapter = createInMemoryMoneyRailAdapter({ now: () => "2026-02-07T00:00:00.000Z" });

  await adapter.create({
    tenantId: "tenant_s0",
    operationId: "op_ingest_1",
    direction: "payout",
    idempotencyKey: "idem_ingest_1",
    amountCents: 2200,
    currency: "USD",
    counterpartyRef: "acct_ext_ingest_1"
  });

  const submitted = await adapter.ingestProviderEvent({
    tenantId: "tenant_s0",
    operationId: "op_ingest_1",
    eventType: MONEY_RAIL_PROVIDER_EVENT_TYPE.SUBMITTED,
    providerRef: "prov_evt_1",
    eventId: "evt_submit_1",
    at: "2026-02-07T00:01:00.000Z"
  });
  assert.equal(submitted.applied, true);
  assert.equal(submitted.operation.state, MONEY_RAIL_OPERATION_STATE.SUBMITTED);
  assert.equal(submitted.operation.providerRef, "prov_evt_1");

  const confirmed = await adapter.ingestProviderEvent({
    tenantId: "tenant_s0",
    operationId: "op_ingest_1",
    eventType: MONEY_RAIL_PROVIDER_EVENT_TYPE.CONFIRMED,
    eventId: "evt_confirm_1",
    at: "2026-02-07T00:02:00.000Z"
  });
  assert.equal(confirmed.applied, true);
  assert.equal(confirmed.operation.state, MONEY_RAIL_OPERATION_STATE.CONFIRMED);
  assert.equal(confirmed.operation.confirmedAt, "2026-02-07T00:02:00.000Z");

  const confirmReplay = await adapter.ingestProviderEvent({
    tenantId: "tenant_s0",
    operationId: "op_ingest_1",
    eventType: MONEY_RAIL_PROVIDER_EVENT_TYPE.CONFIRMED,
    eventId: "evt_confirm_1",
    at: "2026-02-07T00:03:00.000Z"
  });
  assert.equal(confirmReplay.applied, false);
  assert.equal(confirmReplay.operation.state, MONEY_RAIL_OPERATION_STATE.CONFIRMED);
});

test("money rail adapter: invalid provider event transition is rejected", async () => {
  const adapter = createInMemoryMoneyRailAdapter({ now: () => "2026-02-07T00:00:00.000Z" });

  await adapter.create({
    tenantId: "tenant_s0",
    operationId: "op_ingest_2",
    direction: "collection",
    idempotencyKey: "idem_ingest_2",
    amountCents: 1500,
    currency: "USD",
    counterpartyRef: "acct_ext_ingest_2"
  });

  await assert.rejects(
    () =>
      adapter.ingestProviderEvent({
        tenantId: "tenant_s0",
        operationId: "op_ingest_2",
        eventType: MONEY_RAIL_PROVIDER_EVENT_TYPE.CONFIRMED,
        eventId: "evt_confirm_early_1",
        at: "2026-02-07T00:01:00.000Z"
      }),
    (err) => err?.code === "MONEY_RAIL_INVALID_TRANSITION"
  );
});
