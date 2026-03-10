import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTION_WALLET_EVENT_TAXONOMY_V1,
  ACTION_WALLET_EVENT_TYPE,
  getActionWalletEventTaxonomyEntry,
  listActionWalletEventTypes,
  normalizeActionWalletEventType
} from "../src/core/action-wallet-event-taxonomy.js";

test("action-wallet event taxonomy: the launch event set is closed and complete", () => {
  assert.deepEqual(listActionWalletEventTypes(), [
    "intent.created",
    "approval.opened",
    "approval.decided",
    "grant.issued",
    "evidence.submitted",
    "finalize.requested",
    "receipt.issued",
    "dispute.opened",
    "dispute.resolved"
  ]);
  assert.deepEqual(
    ACTION_WALLET_EVENT_TAXONOMY_V1.map((entry) => entry.displayName),
    [
      "intent created",
      "approval opened",
      "approval decided",
      "grant issued",
      "evidence submitted",
      "finalize requested",
      "receipt issued",
      "dispute opened",
      "dispute resolved"
    ]
  );
});

test("action-wallet event taxonomy: each launch event has emit points, payload keys, and metric bindings", () => {
  for (const entry of ACTION_WALLET_EVENT_TAXONOMY_V1) {
    assert.ok(typeof entry.eventType === "string" && entry.eventType !== "");
    assert.ok(typeof entry.displayName === "string" && entry.displayName !== "");
    assert.ok(Array.isArray(entry.emitPoints) && entry.emitPoints.length > 0, `${entry.eventType} missing emitPoints`);
    assert.ok(Array.isArray(entry.payloadKeys) && entry.payloadKeys.length > 0, `${entry.eventType} missing payloadKeys`);
    assert.ok(Array.isArray(entry.metrics) && entry.metrics.length > 0, `${entry.eventType} missing metrics`);
    assert.equal(Object.isFrozen(entry.emitPoints), true, `${entry.eventType} emitPoints must be frozen`);
    assert.equal(Object.isFrozen(entry.payloadKeys), true, `${entry.eventType} payloadKeys must be frozen`);
    assert.equal(Object.isFrozen(entry.metrics), true, `${entry.eventType} metrics must be frozen`);
  }
});

test("action-wallet event taxonomy: normalization is case-insensitive and fails closed on unknown events", () => {
  assert.equal(normalizeActionWalletEventType(" Dispute.Resolved "), ACTION_WALLET_EVENT_TYPE.DISPUTE_RESOLVED);
  assert.equal(getActionWalletEventTaxonomyEntry("receipt.issued")?.displayName, "receipt issued");
  assert.throws(
    () => normalizeActionWalletEventType("settlement.resolved"),
    /eventType must be one of/
  );
});
