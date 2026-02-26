import test from "node:test";
import assert from "node:assert/strict";

import {
  METER_SCHEMA_VERSION,
  METER_SOURCE_TYPE,
  METER_TYPE,
  buildMeterV1FromBillableUsageEvent,
  validateMeterV1
} from "../src/core/meter.js";

function buildFixture() {
  return {
    schemaVersion: "BillableUsageEvent.v1",
    eventKey: "work_order_topup:workord_meter_1:topup_1",
    eventType: "settled_volume",
    sourceType: "work_order_meter_topup",
    sourceId: "workord_meter_1",
    sourceEventId: "topup_1",
    quantity: 1,
    amountCents: 275,
    currency: "usd",
    period: "2026-02",
    occurredAt: "2026-02-26T00:00:00.000Z",
    createdAt: "2026-02-26T00:00:05.000Z",
    eventHash: "a".repeat(64),
    audit: {
      ingestedBy: "auth:sk_test_meter_1",
      route: "/work-orders/workord_meter_1/topup"
    }
  };
}

test("Meter.v1 builder canonicalizes billable usage event deterministically", () => {
  const meterA = buildMeterV1FromBillableUsageEvent({
    event: buildFixture(),
    expectedWorkOrderId: "workord_meter_1"
  });
  const meterB = buildMeterV1FromBillableUsageEvent({
    event: buildFixture(),
    expectedWorkOrderId: "workord_meter_1"
  });
  assert.deepEqual(meterA, meterB);
  assert.equal(meterA.schemaVersion, METER_SCHEMA_VERSION);
  assert.equal(meterA.meterType, METER_TYPE.TOPUP);
  assert.equal(meterA.sourceType, METER_SOURCE_TYPE.WORK_ORDER_TOPUP);
  assert.equal(meterA.currency, "USD");
  assert.match(meterA.meterHash, /^[0-9a-f]{64}$/);
  validateMeterV1(meterA);
});

test("Meter.v1 builder fails closed on unsupported sourceType", () => {
  assert.throws(
    () =>
      buildMeterV1FromBillableUsageEvent({
        event: {
          ...buildFixture(),
          sourceType: "ops_ingest"
        },
        expectedWorkOrderId: "workord_meter_1"
      }),
    /sourceType must be one of/i
  );
});

test("Meter.v1 builder fails closed on work-order mismatch", () => {
  assert.throws(
    () =>
      buildMeterV1FromBillableUsageEvent({
        event: buildFixture(),
        expectedWorkOrderId: "workord_other"
      }),
    /does not match expectedWorkOrderId/i
  );
});

test("Meter.v1 validation fails closed on meterHash mismatch", () => {
  const meter = buildMeterV1FromBillableUsageEvent({
    event: buildFixture(),
    expectedWorkOrderId: "workord_meter_1"
  });
  assert.throws(
    () =>
      validateMeterV1({
        ...meter,
        amountCents: meter.amountCents + 1
      }),
    /meterHash mismatch/i
  );
});
