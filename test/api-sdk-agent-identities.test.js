import test from "node:test";
import assert from "node:assert/strict";

import { NooterraClient } from "../packages/api-sdk/src/index.js";

function makeJsonResponse(body, { status = 200, requestId = "req_test_1" } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId
    }
  });
}

test("api-sdk: agent identity methods call expected endpoints", async () => {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/agents/register")) {
      return makeJsonResponse({ agentIdentity: { schemaVersion: "AgentIdentity.v1", agentId: "agt_demo" }, keyId: "kid_demo" }, { status: 201 });
    }
    if (String(url).includes("/agents?")) {
      return makeJsonResponse({ agents: [], limit: 10, offset: 0 });
    }
    if (String(url).endsWith("/agents/agt_demo")) {
      return makeJsonResponse({ agentIdentity: { schemaVersion: "AgentIdentity.v1", agentId: "agt_demo" } });
    }
    return makeJsonResponse({});
  };

  const client = new NooterraClient({ baseUrl: "https://api.nooterra.local", tenantId: "tenant_sdk", fetch: fetchStub });

  const registered = await client.registerAgent({ publicKeyPem: "-----BEGIN PUBLIC KEY-----demo-----END PUBLIC KEY-----", agentId: "agt_demo" });
  assert.equal(registered.status, 201);
  assert.equal(calls[0].url, "https://api.nooterra.local/agents/register");
  assert.equal(calls[0].init?.method, "POST");

  await client.listAgents({ status: "active", limit: 10, offset: 0 });
  assert.equal(calls[1].url, "https://api.nooterra.local/agents?status=active&limit=10&offset=0");
  assert.equal(calls[1].init?.method, "GET");

  await client.getAgent("agt_demo");
  assert.equal(calls[2].url, "https://api.nooterra.local/agents/agt_demo");
  assert.equal(calls[2].init?.method, "GET");
});
