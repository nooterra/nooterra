import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  NooterraClient,
  NooterraHttpParityAdapter,
  NooterraMcpParityAdapter,
  canonicalJsonStringifyDeterministic,
  computeCanonicalSha256,
  buildCanonicalEnvelope
} from "../packages/api-sdk/src/index.js";

function readFile(relativePath) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("api-sdk contract freeze: manual-review + dispute lifecycle methods and types remain published", () => {
  const client = new NooterraClient({
    baseUrl: "https://api.nooterra.local",
    tenantId: "tenant_sdk_freeze",
    fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
  });

  assert.equal(typeof client.getRunSettlementPolicyReplay, "function");
  assert.equal(typeof client.resolveRunSettlement, "function");
  assert.equal(typeof client.x402GateAuthorizePayment, "function");
  assert.equal(typeof client.openRunDispute, "function");
  assert.equal(typeof client.submitRunDisputeEvidence, "function");
  assert.equal(typeof client.escalateRunDispute, "function");
  assert.equal(typeof client.closeRunDispute, "function");
  assert.equal(typeof client.createAgreement, "function");
  assert.equal(typeof client.signEvidence, "function");
  assert.equal(typeof client.createHold, "function");
  assert.equal(typeof client.settle, "function");
  assert.equal(typeof client.buildDisputeOpenEnvelope, "function");
  assert.equal(typeof client.openDispute, "function");
  assert.equal(typeof client.opsGetToolCallReplayEvaluate, "function");
  assert.equal(typeof client.opsGetReputationFacts, "function");
  assert.equal(typeof client.getArtifact, "function");
  assert.equal(typeof client.getArtifacts, "function");
  assert.equal(typeof client.createDelegationGrant, "function");
  assert.equal(typeof client.issueDelegationGrant, "function");
  assert.equal(typeof client.listDelegationGrants, "function");
  assert.equal(typeof client.getDelegationGrant, "function");
  assert.equal(typeof client.revokeDelegationGrant, "function");
  assert.equal(typeof client.createWorkOrder, "function");
  assert.equal(typeof client.listWorkOrders, "function");
  assert.equal(typeof client.getWorkOrder, "function");
  assert.equal(typeof client.acceptWorkOrder, "function");
  assert.equal(typeof client.progressWorkOrder, "function");
  assert.equal(typeof client.topUpWorkOrder, "function");
  assert.equal(typeof client.getWorkOrderMetering, "function");
  assert.equal(typeof client.completeWorkOrder, "function");
  assert.equal(typeof client.settleWorkOrder, "function");
  assert.equal(typeof client.listWorkOrderReceipts, "function");
  assert.equal(typeof client.getWorkOrderReceipt, "function");
  assert.equal(typeof client.getSessionTranscript, "function");
  assert.equal(typeof client.createCapabilityAttestation, "function");
  assert.equal(typeof client.listCapabilityAttestations, "function");
  assert.equal(typeof client.getCapabilityAttestation, "function");
  assert.equal(typeof client.revokeCapabilityAttestation, "function");
  assert.equal(typeof client.createHttpParityAdapter, "function");
  assert.equal(typeof client.createMcpParityAdapter, "function");
  assert.equal(typeof NooterraHttpParityAdapter, "function");
  assert.equal(typeof NooterraMcpParityAdapter, "function");

  const parityHttp = client.createHttpParityAdapter();
  const parityMcp = client.createMcpParityAdapter({ callTool: async () => ({ ok: true, status: 200, body: {} }) });
  assert.equal(typeof parityHttp.invoke, "function");
  assert.equal(typeof parityMcp.invoke, "function");
  assert.equal(typeof canonicalJsonStringifyDeterministic, "function");
  assert.equal(typeof computeCanonicalSha256, "function");
  assert.equal(typeof buildCanonicalEnvelope, "function");

  const deterministicCanonical = canonicalJsonStringifyDeterministic({ b: 2, a: 1 });
  assert.equal(deterministicCanonical, "{\"a\":1,\"b\":2}");
  assert.equal(computeCanonicalSha256({ b: 2, a: 1 }), computeCanonicalSha256({ a: 1, b: 2 }));
  assert.equal(buildCanonicalEnvelope({ b: 2, a: 1 }).canonicalJson, deterministicCanonical);

  const dts = readFile("packages/api-sdk/src/index.d.ts");
  assert.match(dts, /manual_review_required/);
  assert.match(dts, /manual_resolved/);
  assert.match(dts, /x402GateAuthorizePayment\(/);
  assert.match(dts, /X402ExecutionIntentErrorCode/);
  assert.match(dts, /X402_EXECUTION_INTENT_REQUIRED/);
  assert.match(dts, /X402_EXECUTION_INTENT_IDEMPOTENCY_MISMATCH/);
  assert.match(dts, /X402_EXECUTION_INTENT_CONFLICT/);
  assert.match(dts, /disputeWindowDays\?: number/);
  assert.match(dts, /disputeWindowEndsAt\?: string \| null/);
  assert.match(dts, /openRunDispute\(/);
  assert.match(dts, /submitRunDisputeEvidence\(/);
  assert.match(dts, /escalateRunDispute\(/);
  assert.match(dts, /closeRunDispute\(/);
  assert.match(dts, /createAgreement\(/);
  assert.match(dts, /signEvidence\(/);
  assert.match(dts, /createHold\(/);
  assert.match(dts, /settle\(/);
  assert.match(dts, /buildDisputeOpenEnvelope\(/);
  assert.match(dts, /openDispute\(/);
  assert.match(dts, /opsGetToolCallReplayEvaluate\(/);
  assert.match(dts, /opsGetReputationFacts\(/);
  assert.match(dts, /getArtifact\(/);
  assert.match(dts, /getArtifacts\(/);
  assert.match(dts, /createDelegationGrant\(/);
  assert.match(dts, /issueDelegationGrant\(/);
  assert.match(dts, /listDelegationGrants\(/);
  assert.match(dts, /getDelegationGrant\(/);
  assert.match(dts, /revokeDelegationGrant\(/);
  assert.match(dts, /createWorkOrder\(/);
  assert.match(dts, /listWorkOrders\(/);
  assert.match(dts, /getWorkOrder\(/);
  assert.match(dts, /acceptWorkOrder\(/);
  assert.match(dts, /progressWorkOrder\(/);
  assert.match(dts, /topUpWorkOrder\(/);
  assert.match(dts, /getWorkOrderMetering\(/);
  assert.match(dts, /completeWorkOrder\(/);
  assert.match(dts, /settleWorkOrder\(/);
  assert.match(dts, /listWorkOrderReceipts\(/);
  assert.match(dts, /getWorkOrderReceipt\(/);
  assert.match(dts, /getSessionTranscript\(/);
  assert.match(dts, /createCapabilityAttestation\(/);
  assert.match(dts, /listCapabilityAttestations\(/);
  assert.match(dts, /getCapabilityAttestation\(/);
  assert.match(dts, /revokeCapabilityAttestation\(/);
  assert.match(dts, /NooterraHttpParityAdapter/);
  assert.match(dts, /NooterraMcpParityAdapter/);
  assert.match(dts, /createHttpParityAdapter\(/);
  assert.match(dts, /createMcpParityAdapter\(/);
  assert.match(dts, /PARITY_IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(dts, /NooterraParityReasonCode/);
  assert.match(dts, /NooterraMcpCallTool/);
  assert.match(dts, /canonicalJsonStringifyDeterministic/);
  assert.match(dts, /computeCanonicalSha256/);
  assert.match(dts, /buildCanonicalEnvelope/);
  assert.match(dts, /type SessionV1/);
  assert.match(dts, /type SessionEventV1/);
  assert.match(dts, /type SessionReplayPackV1/);
  assert.match(dts, /type DelegationGrantV1/);
  assert.match(dts, /type AuthorityGrantV1/);
  assert.match(dts, /type SubAgentWorkOrderV1/);
  assert.match(dts, /type SubAgentCompletionReceiptV1/);

  const jsClient = readFile("packages/api-sdk/src/client.js");
  assert.match(jsClient, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/settlement\/policy-replay/);
  assert.match(jsClient, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/settlement\/resolve/);
  assert.match(jsClient, /\/x402\/gate\/authorize-payment/);
  assert.match(jsClient, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/dispute\/open/);
  assert.match(jsClient, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/dispute\/evidence/);
  assert.match(jsClient, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/dispute\/escalate/);
  assert.match(jsClient, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/dispute\/close/);
  assert.match(jsClient, /\/ops\/tool-calls\/holds\/lock/);
  assert.match(jsClient, /\/ops\/tool-calls\/replay-evaluate\?agreementHash=/);
  assert.match(jsClient, /\/ops\/reputation\/facts\?/);
  assert.match(jsClient, /\/tool-calls\/arbitration\/open/);
  assert.match(jsClient, /\/artifacts\/\$\{encodeURIComponent\(artifactId\)\}/);
  assert.match(jsClient, /\/delegation-grants/);
  assert.match(jsClient, /\/work-orders/);
  assert.match(jsClient, /\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/transcript/);
  assert.match(jsClient, /\/capability-attestations/);
  assert.match(jsClient, /class NooterraHttpParityAdapter/);
  assert.match(jsClient, /class NooterraMcpParityAdapter/);
  assert.match(jsClient, /PARITY_IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(jsClient, /PARITY_EXPECTED_PREV_CHAIN_HASH_REQUIRED/);
  assert.match(jsClient, /retryStatusCodes/);
  assert.match(jsClient, /export function canonicalJsonStringifyDeterministic/);
  assert.match(jsClient, /export function computeCanonicalSha256/);
  assert.match(jsClient, /export function buildCanonicalEnvelope/);

  const readme = readFile("packages/api-sdk/README.md");
  assert.match(readme, /Transport Parity Adapters \(HTTP \+ MCP\)/);
  assert.match(readme, /createHttpParityAdapter/);
  assert.match(readme, /createMcpParityAdapter/);
  assert.match(readme, /PARITY_\*/);
  assert.match(readme, /idempotencyRequired/);
});
