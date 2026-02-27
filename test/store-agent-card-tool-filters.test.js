import test from "node:test";
import assert from "node:assert/strict";

import { createStore } from "../src/api/store.js";
import { makeScopedKey } from "../src/core/tenancy.js";

function putCard(store, card) {
  const tenantId = String(card.tenantId ?? "tenant_default");
  const agentId = String(card.agentId ?? "");
  store.agentCards.set(makeScopedKey({ tenantId, id: agentId }), card);
}

test("store: listAgentCardsPublic applies tool descriptor filters", async () => {
  const store = createStore();

  putCard(store, {
    tenantId: "tenant_a",
    agentId: "agt_read_1",
    status: "active",
    visibility: "public",
    executionCoordinatorDid: "did:nooterra:coord_alpha",
    capabilities: ["travel.booking"],
    host: { runtime: "openclaw" },
    tools: [
      {
        toolId: "travel.search_flights",
        mcpToolName: "travel_search_flights",
        riskClass: "read",
        sideEffecting: false,
        pricing: { amountCents: 90 },
        requiresEvidenceKinds: ["artifact"]
      }
    ]
  });

  putCard(store, {
    tenantId: "tenant_b",
    agentId: "agt_action_1",
    status: "active",
    visibility: "public",
    executionCoordinatorDid: "did:nooterra:coord_bravo",
    capabilities: ["travel.booking"],
    host: { runtime: "openclaw" },
    tools: [
      {
        toolId: "travel.book_flight",
        mcpToolName: "travel_book_flight",
        riskClass: "action",
        sideEffecting: true,
        pricing: { amountCents: 500 },
        requiresEvidenceKinds: ["artifact", "hash"]
      }
    ]
  });

  const rows = await store.listAgentCardsPublic({
    status: "active",
    visibility: "public",
    capability: "travel.booking",
    executionCoordinatorDid: "did:nooterra:coord_alpha",
    runtime: "openclaw",
    toolMcpName: "TRAVEL_SEARCH_FLIGHTS",
    toolRiskClass: "read",
    toolSideEffecting: false,
    toolMaxPriceCents: 100,
    toolRequiresEvidenceKind: "artifact"
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.agentId, "agt_read_1");
});

test("store: listAgentCards applies tenant-scoped tool descriptor filters", async () => {
  const store = createStore();

  putCard(store, {
    tenantId: "tenant_a",
    agentId: "agt_action_ok",
    status: "active",
    visibility: "public",
    executionCoordinatorDid: "did:nooterra:coord_alpha",
    capabilities: ["travel.booking"],
    host: { runtime: "openclaw" },
    tools: [
      {
        toolId: "travel.book_flight",
        mcpToolName: "travel_book_flight",
        riskClass: "action",
        sideEffecting: true,
        pricing: { amountCents: 500 },
        requiresEvidenceKinds: ["artifact", "hash"]
      }
    ]
  });

  putCard(store, {
    tenantId: "tenant_a",
    agentId: "agt_action_expensive",
    status: "active",
    visibility: "public",
    executionCoordinatorDid: "did:nooterra:coord_alpha",
    capabilities: ["travel.booking"],
    host: { runtime: "openclaw" },
    tools: [
      {
        toolId: "travel.book_flight",
        mcpToolName: "travel_book_flight",
        riskClass: "action",
        sideEffecting: true,
        pricing: { amountCents: 5000 },
        requiresEvidenceKinds: ["artifact", "hash"]
      }
    ]
  });

  putCard(store, {
    tenantId: "tenant_b",
    agentId: "agt_other_tenant",
    status: "active",
    visibility: "public",
    executionCoordinatorDid: "did:nooterra:coord_bravo",
    capabilities: ["travel.booking"],
    host: { runtime: "openclaw" },
    tools: [
      {
        toolId: "travel.book_flight",
        mcpToolName: "travel_book_flight",
        riskClass: "action",
        sideEffecting: true,
        pricing: { amountCents: 300 },
        requiresEvidenceKinds: ["artifact", "hash"]
      }
    ]
  });

  const rows = await store.listAgentCards({
    tenantId: "tenant_a",
    status: "active",
    visibility: "public",
    capability: "travel.booking",
    executionCoordinatorDid: "did:nooterra:coord_alpha",
    runtime: "openclaw",
    toolId: "travel.book_flight",
    toolRiskClass: "action",
    toolSideEffecting: true,
    toolMaxPriceCents: 1000,
    toolRequiresEvidenceKind: "hash"
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.agentId, "agt_action_ok");
});

test("store: listAgentCardsPublic fails closed on invalid toolSideEffecting type", async () => {
  const store = createStore();
  await assert.rejects(
    () =>
      store.listAgentCardsPublic({
        toolSideEffecting: "yes"
      }),
    /toolSideEffecting must be boolean/
  );
});
