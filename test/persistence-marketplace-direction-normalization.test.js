import test from "node:test";
import assert from "node:assert/strict";

import { createStore } from "../src/api/store.js";
import { TX_LOG_VERSION, applyTxRecord } from "../src/api/persistence.js";
import { makeScopedKey } from "../src/core/tenancy.js";

test("persistence replay normalizes marketplace task/bid directions", () => {
  const store = createStore({ persistenceDir: null });
  const tenantId = "tenant_market_direction_replay";
  const taskId = "task_legacy_1";
  const bidId = "bid_legacy_1";
  const taskKey = makeScopedKey({ tenantId, id: taskId });

  applyTxRecord(store, {
    v: TX_LOG_VERSION,
    ops: [
      {
        kind: "MARKETPLACE_TASK_UPSERT",
        tenantId,
        task: {
          schemaVersion: "MarketplaceTask.v1",
          taskId,
          tenantId,
          title: "legacy task",
          status: "open",
          currency: "USD",
          fromType: "vendor",
          toType: "service",
          createdAt: new Date("2026-02-01T00:00:00.000Z").toISOString(),
          updatedAt: new Date("2026-02-01T00:00:00.000Z").toISOString()
        }
      }
    ]
  });

  const task = store.marketplaceTasks.get(taskKey);
  assert.ok(task);
  assert.equal(task.fromType, "agent");
  assert.equal(task.toType, "agent");

  applyTxRecord(store, {
    v: TX_LOG_VERSION,
    ops: [
      {
        kind: "MARKETPLACE_TASK_BIDS_SET",
        tenantId,
        taskId,
        bids: [
          {
            schemaVersion: "MarketplaceBid.v1",
            bidId,
            taskId,
            tenantId,
            bidderAgentId: "agt_bidder_legacy",
            amountCents: 1200,
            currency: "USD",
            status: "pending",
            fromType: "service",
            toType: "vendor",
            createdAt: new Date("2026-02-01T00:00:00.000Z").toISOString(),
            updatedAt: new Date("2026-02-01T00:00:00.000Z").toISOString()
          }
        ]
      }
    ]
  });

  const bids = store.marketplaceTaskBids.get(taskKey);
  assert.ok(Array.isArray(bids));
  assert.equal(bids.length, 1);
  assert.equal(bids[0].bidId, bidId);
  assert.equal(bids[0].fromType, "agent");
  assert.equal(bids[0].toType, "agent");
});
