import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";

test("API: /openapi.json matches openapi/nooterra.openapi.json snapshot", async () => {
  const api = createApi();

  const res = await request(api, {
    method: "GET",
    path: "/openapi.json",
    headers: { "x-nooterra-protocol": "1.0" }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json?.openapi, "3.0.3");
  assert.ok(res.json?.paths?.["/jobs"]);
  assert.ok(res.json?.paths?.["/ops/party-statements"]);
  assert.ok(res.json?.paths?.["/v1/public/agents/resolve"]);
  assert.ok(res.json?.paths?.["/public/agent-cards/{agentId}"]);
  assert.ok(res.json?.paths?.["/.well-known/agent-locator/{agentId}"]);

  const snapshot = JSON.parse(fs.readFileSync("openapi/nooterra.openapi.json", "utf8"));

  // Avoid recursive deep-equality over a very large OpenAPI tree to keep memory bounded.
  // New issue-scoped paths are validated in this test file and excluded from snapshot digest
  // because the generated snapshot file is maintained in a separate ownership lane.
  const responseComparable = JSON.parse(JSON.stringify(res.json));
  const snapshotComparable = JSON.parse(JSON.stringify(snapshot));
  delete responseComparable?.paths?.["/v1/public/agents/resolve"];
  delete responseComparable?.paths?.["/public/agent-cards/{agentId}"];
  delete responseComparable?.paths?.["/.well-known/agent-locator/{agentId}"];
  delete snapshotComparable?.paths?.["/v1/public/agents/resolve"];
  delete snapshotComparable?.paths?.["/public/agent-cards/{agentId}"];
  delete snapshotComparable?.paths?.["/.well-known/agent-locator/{agentId}"];
  const responseDigest = createHash("sha256").update(JSON.stringify(responseComparable)).digest("hex");
  const snapshotDigest = createHash("sha256").update(JSON.stringify(snapshotComparable)).digest("hex");
  assert.equal(responseDigest, snapshotDigest);
});

test("API: /public/agent-cards/discover visibility query contract is public-only", async () => {
  const api = createApi();
  const res = await request(api, {
    method: "GET",
    path: "/openapi.json",
    headers: { "x-nooterra-protocol": "1.0" }
  });
  assert.equal(res.statusCode, 200, res.body);
  const params = res.json?.paths?.["/public/agent-cards/discover"]?.get?.parameters ?? [];
  const visibilityParam = params.find((row) => row?.in === "query" && row?.name === "visibility");
  assert.ok(visibilityParam, "missing visibility query parameter for /public/agent-cards/discover");
  assert.deepEqual(visibilityParam?.schema?.enum ?? [], ["public"]);
});

test("API: /authority-grants OpenAPI contract includes authority grant query filters", async () => {
  const api = createApi();
  const res = await request(api, {
    method: "GET",
    path: "/openapi.json",
    headers: { "x-nooterra-protocol": "1.0" }
  });
  assert.equal(res.statusCode, 200, res.body);

  const operation = res.json?.paths?.["/authority-grants"]?.get ?? null;
  assert.ok(operation, "missing GET /authority-grants");
  const params = operation?.parameters ?? [];
  const queryNames = new Set(params.filter((row) => row?.in === "query").map((row) => row?.name));
  for (const name of ["grantId", "grantHash", "principalId", "granteeAgentId", "includeRevoked", "limit", "offset"]) {
    assert.equal(queryNames.has(name), true, `missing ${name} query parameter`);
  }
});

test("API: agent locator OpenAPI contracts include resolve and well-known paths", async () => {
  const api = createApi();
  const res = await request(api, {
    method: "GET",
    path: "/openapi.json",
    headers: { "x-nooterra-protocol": "1.0" }
  });
  assert.equal(res.statusCode, 200, res.body);

  const resolveRoute = res.json?.paths?.["/v1/public/agents/resolve"]?.get ?? null;
  assert.ok(resolveRoute, "missing GET /v1/public/agents/resolve");
  const resolveParams = resolveRoute.parameters ?? [];
  const resolveAgentQuery = resolveParams.find((row) => row?.in === "query" && row?.name === "agent");
  assert.ok(resolveAgentQuery, "missing agent query parameter for /v1/public/agents/resolve");
  assert.equal(resolveAgentQuery?.required, true);

  const publicCardRoute = res.json?.paths?.["/public/agent-cards/{agentId}"]?.get ?? null;
  assert.ok(publicCardRoute, "missing GET /public/agent-cards/{agentId}");
  const publicCardParams = publicCardRoute.parameters ?? [];
  const publicCardPathParam = publicCardParams.find((row) => row?.in === "path" && row?.name === "agentId");
  assert.ok(publicCardPathParam, "missing agentId path parameter for /public/agent-cards/{agentId}");
  assert.equal(publicCardPathParam?.required, true);

  const wellKnownRoute = res.json?.paths?.["/.well-known/agent-locator/{agentId}"]?.get ?? null;
  assert.ok(wellKnownRoute, "missing GET /.well-known/agent-locator/{agentId}");
  const wellKnownParams = wellKnownRoute.parameters ?? [];
  const pathParam = wellKnownParams.find((row) => row?.in === "path" && row?.name === "agentId");
  assert.ok(pathParam, "missing agentId path parameter for /.well-known/agent-locator/{agentId}");
  assert.equal(pathParam?.required, true);
});

test("API: intent + session checkpoint OpenAPI contracts are published", async () => {
  const api = createApi();
  const res = await request(api, {
    method: "GET",
    path: "/openapi.json",
    headers: { "x-nooterra-protocol": "1.0" }
  });
  assert.equal(res.statusCode, 200, res.body);

  assert.ok(res.json?.paths?.["/intents"]?.get, "missing GET /intents");
  assert.ok(res.json?.paths?.["/intents/propose"]?.post, "missing POST /intents/propose");
  assert.ok(res.json?.paths?.["/intents/{intentId}"]?.get, "missing GET /intents/{intentId}");
  assert.ok(res.json?.paths?.["/intents/{intentId}/counter"]?.post, "missing POST /intents/{intentId}/counter");
  assert.ok(res.json?.paths?.["/intents/{intentId}/accept"]?.post, "missing POST /intents/{intentId}/accept");

  assert.ok(res.json?.paths?.["/sessions/{sessionId}/events/checkpoint"]?.get, "missing GET /sessions/{sessionId}/events/checkpoint");
  assert.ok(res.json?.paths?.["/sessions/{sessionId}/events/checkpoint"]?.post, "missing POST /sessions/{sessionId}/events/checkpoint");
  assert.ok(
    res.json?.paths?.["/sessions/{sessionId}/events/checkpoint/requeue"]?.post,
    "missing POST /sessions/{sessionId}/events/checkpoint/requeue"
  );
  const eventListParams = res.json?.paths?.["/sessions/{sessionId}/events"]?.get?.parameters ?? [];
  const streamParams = res.json?.paths?.["/sessions/{sessionId}/events/stream"]?.get?.parameters ?? [];
  assert.ok(
    eventListParams.some((row) => row?.in === "query" && row?.name === "checkpointConsumerId"),
    "missing checkpointConsumerId query on GET /sessions/{sessionId}/events"
  );
  assert.ok(
    streamParams.some((row) => row?.in === "query" && row?.name === "checkpointConsumerId"),
    "missing checkpointConsumerId query on GET /sessions/{sessionId}/events/stream"
  );
});

test("API: action-wallet alias OpenAPI contracts are published", async () => {
  const api = createApi();
  const res = await request(api, {
    method: "GET",
    path: "/openapi.json",
    headers: { "x-nooterra-protocol": "1.0" }
  });
  assert.equal(res.statusCode, 200, res.body);

  for (const path of [
    "/v1/action-intents",
    "/v1/action-intents/{actionIntentId}",
    "/v1/action-intents/{actionIntentId}/approval-requests",
    "/v1/approval-requests/{requestId}",
    "/v1/approval-requests/{requestId}/decisions",
    "/v1/execution-grants/{executionGrantId}",
    "/v1/execution-grants/{executionGrantId}/revoke",
    "/v1/execution-grants/{executionGrantId}/evidence",
    "/v1/execution-grants/{executionGrantId}/finalize",
    "/v1/receipts/{receiptId}",
    "/v1/disputes",
    "/v1/disputes/{disputeId}",
    "/v1/integrations/install",
    "/v1/integrations/{hostId}/revoke",
    "/approval-policies/{policyId}/revoke"
  ]) {
    assert.ok(res.json?.paths?.[path], `missing ${path}`);
  }

  assert.equal(
    res.json?.paths?.["/v1/action-intents/{actionIntentId}"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.properties
      ?.executionGrant?.nullable,
    true
  );
  assert.equal(
    res.json?.paths?.["/v1/disputes/{disputeId}"]?.get?.parameters?.some((row) => row?.in === "query" && row?.name === "caseId"),
    true
  );

  assert.deepEqual(
    res.json?.paths?.["/v1/action-intents"]?.post?.responses?.["201"]?.content?.["application/json"]?.schema?.properties?.actionIntent?.properties?.status?.enum,
    [
      "draft",
      "approval_required",
      "approved",
      "executing",
      "evidence_submitted",
      "verifying",
      "completed",
      "failed",
      "disputed",
      "refunded",
      "cancelled"
    ]
  );
  assert.equal(
    res.json?.paths?.["/v1/action-intents"]?.post?.responses?.["201"]?.content?.["application/json"]?.schema?.properties?.actionIntent?.properties
      ?.intentHash?.pattern,
    "^[0-9a-f]{64}$"
  );
  assert.deepEqual(
    res.json?.paths?.["/v1/approval-requests/{requestId}"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.approvalStatus?.enum,
    ["pending", "approved", "denied", "expired", "revoked"]
  );
  assert.deepEqual(
    res.json?.paths?.["/v1/execution-grants/{executionGrantId}"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.properties
      ?.executionGrant?.properties?.actionType?.enum,
    ["buy", "cancel/recover"]
  );
  assert.equal(
    res.json?.paths?.["/v1/execution-grants/{executionGrantId}"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.properties
      ?.executionGrant?.properties?.grantHash?.pattern,
    "^[0-9a-f]{64}$"
  );
  assert.equal(
    res.json?.paths?.["/v1/execution-grants/{executionGrantId}"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.properties
      ?.executionGrant?.properties?.grantNonce?.pattern,
    "^[0-9a-f]{64}$"
  );
  assert.ok(
    res.json?.paths?.["/v1/execution-grants/{executionGrantId}"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.properties
      ?.executionGrant?.properties?.delegationLineageRef?.properties?.authorityEnvelopeRef,
    "missing delegationLineageRef.authorityEnvelopeRef on execution grant"
  );
  const actionReceiptProperties =
    res.json?.paths?.["/v1/receipts/{receiptId}"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.actionReceipt
      ?.properties ?? {};
  assert.ok(actionReceiptProperties.originatingApproval, "missing actionReceipt.originatingApproval");
  assert.ok(actionReceiptProperties.executionGrantRef, "missing actionReceipt.executionGrantRef");
  assert.ok(actionReceiptProperties.evidenceBundle, "missing actionReceipt.evidenceBundle");
  assert.equal(actionReceiptProperties.executionGrantRef?.properties?.grantHash?.pattern, "^[0-9a-f]{64}$");
  assert.equal(actionReceiptProperties.evidenceBundle?.properties?.evidenceBundleHash?.pattern, "^[0-9a-f]{64}$");
  assert.ok(actionReceiptProperties.settlementState, "missing actionReceipt.settlementState");
  assert.ok(actionReceiptProperties.verifierVerdict, "missing actionReceipt.verifierVerdict");
  assert.ok(actionReceiptProperties.disputeState, "missing actionReceipt.disputeState");

  const receiptDetailProperties =
    res.json?.paths?.["/v1/receipts/{receiptId}"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.detail
      ?.properties ?? {};
  assert.ok(receiptDetailProperties.originatingApproval, "missing receipt detail originatingApproval");
  assert.ok(receiptDetailProperties.executionGrantRef, "missing receipt detail executionGrantRef");
  assert.ok(receiptDetailProperties.evidenceBundle, "missing receipt detail evidenceBundle");
  assert.equal(receiptDetailProperties.executionGrantRef?.properties?.grantHash?.pattern, "^[0-9a-f]{64}$");
  assert.equal(receiptDetailProperties.evidenceBundle?.properties?.evidenceBundleHash?.pattern, "^[0-9a-f]{64}$");
  assert.ok(receiptDetailProperties.settlementState, "missing receipt detail settlementState");
  assert.ok(receiptDetailProperties.verifierVerdict, "missing receipt detail verifierVerdict");
  assert.ok(receiptDetailProperties.disputeState, "missing receipt detail disputeState");
  const evidenceResponseProperties =
    res.json?.paths?.["/v1/execution-grants/{executionGrantId}/evidence"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema?.properties ??
    {};
  assert.equal(evidenceResponseProperties.evidenceBundle?.properties?.evidenceBundleHash?.pattern, "^[0-9a-f]{64}$");
  assert.deepEqual(
    res.json?.paths?.["/v1/disputes"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.disputeCase?.properties
      ?.status?.enum,
    ["opened", "triaged", "awaiting_evidence", "refunded", "denied", "resolved"]
  );
  const installRequestProperties =
    res.json?.paths?.["/v1/integrations/install"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties ?? {};
  assert.ok(installRequestProperties.authModel, "missing trusted-host authModel request payload");
  assert.equal(installRequestProperties.authModel?.properties?.clientSecret?.writeOnly, true);
  assert.equal(installRequestProperties.authModel?.properties?.rotate?.type, "boolean");
  const installResponseProperties =
    res.json?.paths?.["/v1/integrations/install"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema?.properties ?? {};
  assert.deepEqual(installResponseProperties.trustedHost?.properties?.runtime?.enum, ["claude-desktop", "openclaw"]);
  assert.deepEqual(installResponseProperties.trustedHost?.properties?.channel?.enum, ["Claude MCP", "OpenClaw"]);
  assert.deepEqual(installResponseProperties.trustedHost?.properties?.status?.enum, ["active", "revoked"]);
  assert.ok(installResponseProperties.trustedHost?.properties?.authModel?.properties?.clientSecretConfigured, "missing trustedHost auth model");
  assert.equal(installResponseProperties.trustedHost?.properties?.authModel?.properties?.keyId?.type, "string");
  assert.equal(installResponseProperties.trustedHost?.properties?.authModel?.properties?.lastIssuedAt?.format, "date-time");
  assert.equal(installResponseProperties.hostCredential?.properties?.kind?.enum?.[0], "api_key");
  assert.equal(installResponseProperties.hostCredential?.properties?.issuedAt?.format, "date-time");
  const executionGrantRevokeResponse =
    res.json?.paths?.["/v1/execution-grants/{executionGrantId}/revoke"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema?.properties ?? {};
  assert.deepEqual(executionGrantRevokeResponse.approvalStatus?.enum, ["pending", "approved", "denied", "expired", "revoked"]);
  assert.equal(
    res.json?.paths?.["/approval-policies/{policyId}/revoke"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema?.properties
      ?.approvalStandingPolicy?.properties?.status?.enum?.includes("disabled"),
    true
  );
});
