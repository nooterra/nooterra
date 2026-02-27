import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentCardV1, buildNooterraAgentCard, validateAgentCardV1 } from "../src/core/agent-card.js";

test("agent card builder emits stable, minimal discovery payload", () => {
  const card = buildNooterraAgentCard({ baseUrl: "https://api.nooterra.example", version: "0.0.0-test" });
  assert.equal(card.url, "https://api.nooterra.example");
  assert.equal(card.version, "0.0.0-test");
  assert.equal(typeof card.name, "string");
  assert.ok(Array.isArray(card.skills));
  assert.ok(card.skills.some((s) => s && s.id === "create_agreement"));
  assert.ok(card.capabilities && card.capabilities.settlement);
});

test("AgentCard.v1 builder emits deterministic card bound to identity capabilities", () => {
  const nowAt = "2026-02-24T00:00:00.000Z";
  const card = buildAgentCardV1({
    tenantId: "tenant_default",
    nowAt,
    agentIdentity: {
      schemaVersion: "AgentIdentity.v1",
      agentId: "agt_card_1",
      tenantId: "tenant_default",
      displayName: "Agent One",
      status: "active",
      capabilities: ["travel.booking", "travel.search"],
      keys: { keyId: "key_1" }
    },
    cardInput: {
      displayName: "Travel Booker",
      capabilities: ["travel.booking"],
      visibility: "public",
      executionCoordinatorDid: "did:nooterra:coord_alpha",
      host: {
        runtime: "openclaw",
        endpoint: "https://example.test/agents/1",
        protocols: ["mcp", "http"]
      },
      priceHint: {
        amountCents: 250,
        currency: "USD",
        unit: "task"
      },
      attestations: [{ type: "self-claim", level: "self_claim" }],
      tools: [
        {
          schemaVersion: "ToolDescriptor.v1",
          toolId: "travel.book_flight",
          mcpToolName: "travel_book_flight",
          riskClass: "action",
          sideEffecting: true,
          pricing: { amountCents: 250, currency: "USD", unit: "booking" },
          requiresEvidenceKinds: ["artifact", "hash"]
        }
      ],
      tags: ["travel", "booking"]
    }
  });

  assert.equal(card.schemaVersion, "AgentCard.v1");
  assert.equal(card.agentId, "agt_card_1");
  assert.equal(card.status, "active");
  assert.equal(card.visibility, "public");
  assert.equal(card.executionCoordinatorDid, "did:nooterra:coord_alpha");
  assert.deepEqual(card.capabilities, ["travel.booking"]);
  assert.equal(card.createdAt, nowAt);
  assert.equal(card.updatedAt, nowAt);
  assert.equal(Array.isArray(card.tools), true);
  assert.equal(card.tools[0]?.toolId, "travel.book_flight");
  assert.equal(card.tools[0]?.riskClass, "action");
  assert.equal(card.tools[0]?.sideEffecting, true);
  assert.equal(validateAgentCardV1(card), true);
});

test("AgentCard.v1 rejects capabilities outside identity envelope", () => {
  assert.throws(
    () =>
      buildAgentCardV1({
        tenantId: "tenant_default",
        agentIdentity: {
          schemaVersion: "AgentIdentity.v1",
          agentId: "agt_card_2",
          tenantId: "tenant_default",
          displayName: "Agent Two",
          status: "active",
          capabilities: ["travel.booking"],
          keys: { keyId: "key_2" }
        },
        cardInput: {
          capabilities: ["finance.trading"]
        }
      }),
    /subset of agent identity capabilities/
  );
});

test("AgentCard.v1 rejects invalid tool descriptors", () => {
  assert.throws(
    () =>
      buildAgentCardV1({
        tenantId: "tenant_default",
        agentIdentity: {
          schemaVersion: "AgentIdentity.v1",
          agentId: "agt_card_3",
          tenantId: "tenant_default",
          displayName: "Agent Three",
          status: "active",
          capabilities: ["travel.booking"],
          keys: { keyId: "key_3" }
        },
        cardInput: {
          capabilities: ["travel.booking"],
          tools: [{ toolId: "travel.book", riskClass: "invalid-risk-class" }]
        }
      }),
    /riskClass must be read\|compute\|action\|financial/
  );
});

test("AgentCard.v1 rejects invalid executionCoordinatorDid format", () => {
  assert.throws(
    () =>
      buildAgentCardV1({
        tenantId: "tenant_default",
        agentIdentity: {
          schemaVersion: "AgentIdentity.v1",
          agentId: "agt_card_4",
          tenantId: "tenant_default",
          displayName: "Agent Four",
          status: "active",
          capabilities: ["travel.booking"],
          keys: { keyId: "key_4" }
        },
        cardInput: {
          capabilities: ["travel.booking"],
          executionCoordinatorDid: "coord_alpha"
        }
      }),
    /executionCoordinatorDid must be a DID-like identifier/
  );
});
