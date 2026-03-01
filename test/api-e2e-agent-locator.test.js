import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { tenantId = null, agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: {
      "x-idempotency-key": `agent_locator_register_${tenantId ?? "default"}_${agentId}`,
      ...(tenantId ? { "x-proxy-tenant-id": tenantId } : {})
    },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_agent_locator" },
      publicKeyPem,
      capabilities: ["travel.booking"]
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function upsertPublicAgentCard(api, { tenantId = null, agentId, displayName }) {
  const response = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: {
      "x-idempotency-key": `agent_locator_card_${tenantId ?? "default"}_${agentId}`,
      ...(tenantId ? { "x-proxy-tenant-id": tenantId } : {})
    },
    body: {
      agentId,
      displayName,
      capabilities: ["travel.booking"],
      visibility: "public",
      host: {
        runtime: "openclaw",
        endpoint: `https://${tenantId ?? "tenant_default"}.example/agents/${agentId}`,
        protocols: ["mcp"]
      }
    }
  });
  assert.ok(response.statusCode === 200 || response.statusCode === 201, response.body);
}

test("API e2e: /v1/public/agents/resolve and /.well-known/agent-locator/:agentId resolve deterministically", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  await registerAgent(api, { agentId: "agt_loc_ok" });
  await upsertPublicAgentCard(api, { agentId: "agt_loc_ok", displayName: "Locator Agent" });

  const resolved = await request(api, {
    method: "GET",
    path: "/v1/public/agents/resolve?agent=agent%3A%2F%2Fagt_loc_ok"
  });
  assert.equal(resolved.statusCode, 200, resolved.body);
  assert.equal(resolved.json?.ok, true);
  assert.equal(resolved.json?.locator?.schemaVersion, "AgentLocator.v1");
  assert.equal(resolved.json?.locator?.status, "resolved");
  assert.equal(resolved.json?.locator?.resolved?.agentId, "agt_loc_ok");
  assert.equal(typeof resolved.json?.locator?.deterministicHash, "string");

  const resolvedAgain = await request(api, {
    method: "GET",
    path: "/v1/public/agents/resolve?agent=agent%3A%2F%2Fagt_loc_ok"
  });
  assert.equal(resolvedAgain.statusCode, 200, resolvedAgain.body);
  assert.equal(resolvedAgain.json?.locator?.deterministicHash, resolved.json?.locator?.deterministicHash);

  const wellKnown = await request(api, {
    method: "GET",
    path: "/.well-known/agent-locator/agt_loc_ok"
  });
  assert.equal(wellKnown.statusCode, 200, wellKnown.body);
  assert.equal(wellKnown.json?.schemaVersion, "AgentLocator.v1");
  assert.equal(wellKnown.json?.status, "resolved");
  assert.equal(wellKnown.json?.resolved?.agentId, "agt_loc_ok");
  assert.deepEqual(wellKnown.json?.resolved, resolved.json?.locator?.resolved);
});

test("API e2e: agent locator fails closed with malformed/not-found/ambiguous reason codes", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  await registerAgent(api, { tenantId: "tenant_a", agentId: "agt_loc_dupe" });
  await registerAgent(api, { tenantId: "tenant_b", agentId: "agt_loc_dupe" });
  await upsertPublicAgentCard(api, { tenantId: "tenant_a", agentId: "agt_loc_dupe", displayName: "Tenant A Agent" });
  await upsertPublicAgentCard(api, { tenantId: "tenant_b", agentId: "agt_loc_dupe", displayName: "Tenant B Agent" });

  const malformed = await request(api, {
    method: "GET",
    path: "/v1/public/agents/resolve?agent="
  });
  assert.equal(malformed.statusCode, 400, malformed.body);
  assert.equal(malformed.json?.code, "AGENT_LOCATOR_MALFORMED_REF");

  const notFound = await request(api, {
    method: "GET",
    path: "/v1/public/agents/resolve?agent=agt_missing"
  });
  assert.equal(notFound.statusCode, 404, notFound.body);
  assert.equal(notFound.json?.code, "AGENT_LOCATOR_NOT_FOUND");
  assert.equal(notFound.json?.details?.locator?.status, "not_found");

  const ambiguousA = await request(api, {
    method: "GET",
    path: "/v1/public/agents/resolve?agent=agt_loc_dupe"
  });
  assert.equal(ambiguousA.statusCode, 409, ambiguousA.body);
  assert.equal(ambiguousA.json?.code, "AGENT_LOCATOR_AMBIGUOUS");
  assert.equal(ambiguousA.json?.details?.locator?.status, "ambiguous");
  assert.equal(ambiguousA.json?.details?.locator?.matchCount, 2);

  const ambiguousB = await request(api, {
    method: "GET",
    path: "/v1/public/agents/resolve?agent=agt_loc_dupe"
  });
  assert.equal(ambiguousB.statusCode, 409, ambiguousB.body);
  assert.equal(ambiguousB.json?.details?.locator?.deterministicHash, ambiguousA.json?.details?.locator?.deterministicHash);
  assert.deepEqual(ambiguousB.json?.details?.locator?.candidates, ambiguousA.json?.details?.locator?.candidates);

  const ambiguousWellKnown = await request(api, {
    method: "GET",
    path: "/.well-known/agent-locator/agt_loc_dupe"
  });
  assert.equal(ambiguousWellKnown.statusCode, 409, ambiguousWellKnown.body);
  assert.equal(ambiguousWellKnown.json?.code, "AGENT_LOCATOR_AMBIGUOUS");
});
