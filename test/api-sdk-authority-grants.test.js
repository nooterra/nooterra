import test from "node:test";
import assert from "node:assert/strict";

import { NooterraClient } from "../packages/api-sdk/src/index.js";

function makeJsonResponse(body, { status = 200, requestId = "req_test_authority_1" } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId
    }
  });
}

test("api-sdk: authority grant methods call expected endpoints", async () => {
  const calls = [];
  const grantId = "agrant_sdk_1";

  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/authority-grants") && String(init?.method) === "POST") {
      return makeJsonResponse({
        authorityGrant: {
          schemaVersion: "AuthorityGrant.v1",
          grantId
        }
      }, { status: 201 });
    }
    if (String(url).includes("/authority-grants?") && String(init?.method) === "GET") {
      return makeJsonResponse({ grants: [{ grantId }], limit: 20, offset: 0 });
    }
    if (String(url).endsWith(`/authority-grants/${grantId}`) && String(init?.method) === "GET") {
      return makeJsonResponse({ authorityGrant: { grantId } });
    }
    if (String(url).endsWith(`/authority-grants/${grantId}/revoke`) && String(init?.method) === "POST") {
      return makeJsonResponse({ authorityGrant: { grantId, revocation: { revocationReasonCode: "MANUAL_REVOKE" } } });
    }
    return makeJsonResponse({}, { status: 404 });
  };

  const client = new NooterraClient({
    baseUrl: "https://api.nooterra.local",
    tenantId: "tenant_sdk",
    fetch: fetchStub
  });

  const issued = await client.createAuthorityGrant({
    grantId,
    principalRef: {
      principalType: "org",
      principalId: "org_acme"
    },
    granteeAgentId: "agt_worker",
    scope: {
      allowedRiskClasses: ["financial"],
      sideEffectingAllowed: true
    },
    spendEnvelope: {
      currency: "USD",
      maxPerCallCents: 100,
      maxTotalCents: 500
    }
  });
  assert.equal(issued.status, 201);
  assert.equal(calls[0].url, "https://api.nooterra.local/authority-grants");
  assert.equal(calls[0].init?.method, "POST");

  await client.listAuthorityGrants({ granteeAgentId: "agt_worker", includeRevoked: false, limit: 20, offset: 0 });
  assert.equal(calls[1].url, "https://api.nooterra.local/authority-grants?granteeAgentId=agt_worker&includeRevoked=false&limit=20&offset=0");
  assert.equal(calls[1].init?.method, "GET");

  await client.getAuthorityGrant(grantId);
  assert.equal(calls[2].url, `https://api.nooterra.local/authority-grants/${grantId}`);
  assert.equal(calls[2].init?.method, "GET");

  await client.revokeAuthorityGrant(grantId, { revocationReasonCode: "MANUAL_REVOKE" });
  assert.equal(calls[3].url, `https://api.nooterra.local/authority-grants/${grantId}/revoke`);
  assert.equal(calls[3].init?.method, "POST");
});
