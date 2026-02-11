import test from "node:test";
import assert from "node:assert/strict";

import { createStore } from "../src/api/store.js";
import { TX_LOG_VERSION, applyTxRecord } from "../src/api/persistence.js";
import { makeScopedKey } from "../src/core/tenancy.js";

test("persistence replay normalizes marketplace rfq/bid directions", () => {
  const store = createStore({ persistenceDir: null });
  const tenantId = "tenant_market_direction_replay";
  const rfqId = "rfq_legacy_1";
  const bidId = "bid_legacy_1";
  const rfqKey = makeScopedKey({ tenantId, id: rfqId });

  applyTxRecord(store, {
    v: TX_LOG_VERSION,
    ops: [
      {
        kind: "MARKETPLACE_RFQ_UPSERT",
        tenantId,
        rfq: {
          schemaVersion: "MarketplaceRfq.v1",
          rfqId,
          tenantId,
          title: "legacy rfq",
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

  const rfq = store.marketplaceRfqs.get(rfqKey);
  assert.ok(rfq);
  assert.equal(rfq.fromType, "agent");
  assert.equal(rfq.toType, "agent");

  applyTxRecord(store, {
    v: TX_LOG_VERSION,
    ops: [
      {
        kind: "MARKETPLACE_RFQ_BIDS_SET",
        tenantId,
        rfqId,
        bids: [
          {
            schemaVersion: "MarketplaceBid.v1",
            bidId,
            rfqId,
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

  const bids = store.marketplaceRfqBids.get(rfqKey);
  assert.ok(Array.isArray(bids));
  assert.equal(bids.length, 1);
  assert.equal(bids[0].bidId, bidId);
  assert.equal(bids[0].fromType, "agent");
  assert.equal(bids[0].toType, "agent");
});
