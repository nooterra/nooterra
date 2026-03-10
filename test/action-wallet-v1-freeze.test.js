import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";
import { createAjv2020 } from "./helpers/ajv-2020.js";

const freeze = JSON.parse(fs.readFileSync(new URL("../docs/spec/action-wallet-v1-freeze.json", import.meta.url), "utf8"));
const freezeDoc = fs.readFileSync(new URL("../docs/spec/ACTION_WALLET_V1_FREEZE.md", import.meta.url), "utf8");
const objectModel = JSON.parse(fs.readFileSync(new URL("../docs/spec/action-wallet-v1-object-model.json", import.meta.url), "utf8"));
const objectModelDoc = fs.readFileSync(new URL("../docs/spec/ACTION_WALLET_OBJECT_MODEL.md", import.meta.url), "utf8");
const lifecycleDoc = fs.readFileSync(new URL("../docs/spec/ActionIntentLifecycle.v1.md", import.meta.url), "utf8");
const approvalLifecycleDoc = fs.readFileSync(new URL("../docs/spec/ApprovalRequestLifecycle.v1.md", import.meta.url), "utf8");
const executionGrantDoc = fs.readFileSync(new URL("../docs/spec/ExecutionGrant.v1.md", import.meta.url), "utf8");
const actionReceiptDoc = fs.readFileSync(new URL("../docs/spec/ActionReceipt.v1.md", import.meta.url), "utf8");
const disputeLifecycleDoc = fs.readFileSync(new URL("../docs/spec/DisputeCaseLifecycle.v1.md", import.meta.url), "utf8");
const idempotencyDoc = fs.readFileSync(new URL("../docs/spec/ActionWalletIdempotency.v1.md", import.meta.url), "utf8");
const eventTaxonomyDoc = fs.readFileSync(new URL("../docs/spec/ActionWalletEventTaxonomy.v1.md", import.meta.url), "utf8");
const semanticHashesDoc = fs.readFileSync(new URL("../docs/spec/ActionWalletSemanticHashes.v1.md", import.meta.url), "utf8");

function loadAllSchemas() {
  const schemaDir = new URL("../docs/spec/schemas/", import.meta.url);
  return fs
    .readdirSync(schemaDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(new URL(name, schemaDir), "utf8")));
}

test("action-wallet v1 freeze: scope is locked to two launch actions and two host channels", () => {
  assert.equal(freeze.schemaVersion, "ActionWalletV1Freeze.v1");
  assert.equal(
    freeze.scopeLock,
    "V1 lets external agent hosts create action intents for buy and cancel/recover flows, send users to Nooterra-hosted approval pages, receive scoped execution grants, submit evidence, finalize runs, issue receipts, and open disputes."
  );
  assert.deepEqual(freeze.launchActions, ["buy", "cancel/recover"]);
  assert.deepEqual(freeze.launchChannels, ["Claude MCP", "OpenClaw"]);
  assert.deepEqual(freeze.outOfScope, [
    "booking/rebooking",
    "Nooterra-owned last-mile execution",
    "certified execution adapters and strict-domain browser fallback",
    "ChatGPT app",
    "enterprise connectors and packaging",
    "A2A",
    "BYO payment rails",
    "open specialist publication and marketplace",
    "general consumer ask box and first-party assistant shell",
    "physical-world actions"
  ]);
});

test("action-wallet v1 freeze: object model, states, idempotency, and events are deterministic", () => {
  assert.deepEqual(
    freeze.objects.map((row) => row.name),
    [
      "Action Intent",
      "Approval Request",
      "Approval Decision",
      "Execution Grant",
      "Evidence Bundle",
      "Receipt",
      "Dispute Case",
      "Standing Rule",
      "Settlement Event"
    ]
  );
  assert.deepEqual(freeze.stateMachines.intent.states, [
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
  ]);
  assert.deepEqual(freeze.stateMachines.approval.states, ["pending", "approved", "denied", "expired", "revoked"]);
  assert.deepEqual(freeze.stateMachines.dispute.states, ["opened", "triaged", "awaiting_evidence", "refunded", "denied", "resolved"]);
  assert.deepEqual(freeze.hashSubjects, ["intent", "grant", "evidence_bundle", "receipt"]);
  assert.deepEqual(freeze.events, [
    "intent created",
    "approval opened",
    "approval decided",
    "grant issued",
    "evidence submitted",
    "finalize requested",
    "receipt issued",
    "dispute opened",
    "dispute resolved"
  ]);
  assert.deepEqual(freeze.idempotentEndpoints, [
    "POST /v1/action-intents",
    "POST /v1/action-intents/{actionIntentId}/approval-requests",
    "POST /v1/approval-requests/{requestId}/decisions",
    "POST /v1/execution-grants/{executionGrantId}/evidence",
    "POST /v1/execution-grants/{executionGrantId}/finalize",
    "POST /v1/disputes",
    "POST /v1/integrations/install"
  ]);
});

test("action-wallet v1 freeze: anchor files exist for every frozen object", () => {
  for (const objectType of freeze.objects) {
    for (const anchor of objectType.anchors) {
      assert.equal(fs.existsSync(new URL(`../${anchor}`, import.meta.url)), true, `${objectType.name} missing anchor ${anchor}`);
    }
  }
});

test("action-wallet v1 freeze: every launch object has an explicit schema and persistence binding", () => {
  assert.equal(objectModel.schemaVersion, "ActionWalletObjectModel.v1");
  assert.equal(objectModel.freezeRef?.schemaVersion, "ActionWalletV1Freeze.v1");
  assert.deepEqual(
    objectModel.objects.map((row) => row.name),
    freeze.objects.map((row) => row.name)
  );

  for (const objectType of objectModel.objects) {
    assert.equal(Array.isArray(objectType.openQuestions), true, `${objectType.name} missing openQuestions`);
    assert.deepEqual(objectType.openQuestions, [], `${objectType.name} has unresolved field questions`);
    assert.equal(typeof objectType.schemaDoc, "string");
    assert.equal(typeof objectType.schemaJson, "string");
    assert.equal(fs.existsSync(new URL(`../${objectType.schemaDoc}`, import.meta.url)), true, `${objectType.name} missing schema doc`);
    assert.equal(fs.existsSync(new URL(`../${objectType.schemaJson}`, import.meta.url)), true, `${objectType.name} missing schema json`);
    assert.equal(Array.isArray(objectType.runtimeBindings), true, `${objectType.name} missing runtime bindings`);
    assert.ok(objectType.runtimeBindings.length > 0, `${objectType.name} missing runtime bindings`);
    assert.equal(typeof objectType.persistenceBinding, "object", `${objectType.name} missing persistence binding`);
    assert.equal(Array.isArray(objectType.persistenceBinding.inMemoryMaps), true, `${objectType.name} missing in-memory persistence map`);
    assert.ok(objectType.persistenceBinding.inMemoryMaps.length > 0, `${objectType.name} missing in-memory persistence map`);
    assert.equal(Array.isArray(objectType.persistenceBinding.pgSources), true, `${objectType.name} missing pg persistence source`);
    assert.ok(objectType.persistenceBinding.pgSources.length > 0, `${objectType.name} missing pg persistence source`);
  }
});

test("action-wallet v1 freeze: action-wallet schemas compile under Ajv", () => {
  const ajv = createAjv2020();
  for (const schema of loadAllSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") ajv.addSchema(schema, schema.$id);
  }
  for (const objectType of objectModel.objects) {
    const schema = JSON.parse(fs.readFileSync(new URL(`../${objectType.schemaJson}`, import.meta.url), "utf8"));
    assert.equal(schema.title, objectType.schemaVersion, `${objectType.name} schema title drift`);
    assert.equal(typeof ajv.getSchema(schema.$id), "function", `${objectType.name} schema did not compile`);
  }
});

test("action-wallet v1 freeze: markdown freeze doc mirrors the locked scope", () => {
  assert.match(freezeDoc, /# Action Wallet V1 Freeze/);
  assert.match(
    freezeDoc,
    /V1 lets external agent hosts create action intents for buy and cancel\/recover flows, send users to Nooterra-hosted approval pages, receive scoped execution grants, submit evidence, finalize runs, issue receipts, and open disputes\./
  );
  assert.match(freezeDoc, /Machine-readable source of truth:/);
  assert.match(freezeDoc, /External hosts remain responsible for last-mile execution in v1\./);
});

test("action-wallet v1 freeze: object-model markdown explains the alias-to-substrate mapping", () => {
  assert.match(objectModelDoc, /# Action Wallet V1 Object Model/);
  assert.match(objectModelDoc, /machine-readable source of truth/i);
  assert.match(objectModelDoc, /public launch-language objects, but several of them are aliases or projections/i);
});

test("action-wallet v1 freeze: action intent lifecycle doc locks transitions and fail-closed behavior", () => {
  assert.match(lifecycleDoc, /# ActionIntentLifecycle\.v1/);
  assert.match(lifecycleDoc, /Invalid transitions fail closed with `TRANSITION_ILLEGAL`\./);
  assert.match(lifecycleDoc, /```mermaid/);
  assert.match(lifecycleDoc, /draft --> approval_required/);
  assert.match(lifecycleDoc, /approval_required --> approved/);
  assert.match(lifecycleDoc, /approved --> executing/);
  assert.match(lifecycleDoc, /evidence_submitted --> verifying/);
  assert.match(lifecycleDoc, /verifying --> completed/);
});

test("action-wallet v1 freeze: approval lifecycle doc locks timeout expiry and revocation projection", () => {
  assert.match(approvalLifecycleDoc, /# ApprovalRequestLifecycle\.v1/);
  assert.match(approvalLifecycleDoc, /Invalid transitions fail closed with `TRANSITION_ILLEGAL`\./);
  assert.match(approvalLifecycleDoc, /pending --> approved/);
  assert.match(approvalLifecycleDoc, /pending --> denied/);
  assert.match(approvalLifecycleDoc, /pending --> expired/);
  assert.match(approvalLifecycleDoc, /approved --> revoked/);
  assert.match(approvalLifecycleDoc, /top-level `approvalStatus`/);
});

test("action-wallet v1 freeze: execution grant doc locks launch semantics and deterministic nonce rules", () => {
  assert.match(executionGrantDoc, /# ExecutionGrant\.v1/);
  assert.match(executionGrantDoc, /surface the frozen launch semantics/i);
  assert.match(executionGrantDoc, /`principal` resolves from `authorityEnvelope\.principalRef`/);
  assert.match(executionGrantDoc, /`actionType` and `vendorOrDomainAllowlist` project from `authorityEnvelope\.metadata\.actionWallet\.\*`/);
  assert.match(executionGrantDoc, /`grantNonce` is deterministic and appears only after an approval decision has issued an executable grant/);
  assert.match(executionGrantDoc, /`delegationLineageRef` is a placeholder compatibility object/);
});

test("action-wallet v1 freeze: action receipt doc locks approval, grant, evidence, settlement, verifier, and dispute bindings", () => {
  assert.match(actionReceiptDoc, /# ActionReceipt\.v1/);
  assert.match(actionReceiptDoc, /originating approval/i);
  assert.match(actionReceiptDoc, /execution grant/i);
  assert.match(actionReceiptDoc, /evidence bundle/i);
  assert.match(actionReceiptDoc, /settlement state/i);
  assert.match(actionReceiptDoc, /verifier verdict/i);
  assert.match(actionReceiptDoc, /dispute state/i);
  assert.match(actionReceiptDoc, /This object is intentionally an alias in v1\./);
});

test("action-wallet v1 freeze: dispute lifecycle doc locks the public dispute-case projection", () => {
  assert.match(disputeLifecycleDoc, /# DisputeCaseLifecycle\.v1/);
  assert.match(disputeLifecycleDoc, /Action Wallet alias lifecycle/);
  assert.match(disputeLifecycleDoc, /opened --> triaged/);
  assert.match(disputeLifecycleDoc, /opened --> awaiting_evidence/);
  assert.match(disputeLifecycleDoc, /triaged --> denied/);
  assert.match(disputeLifecycleDoc, /triaged --> refunded/);
  assert.match(disputeLifecycleDoc, /triaged --> resolved/);
  assert.match(disputeLifecycleDoc, /awaiting_evidence --> triaged/);
});

test("action-wallet v1 freeze: idempotency doc locks replay scope, conflict behavior, and retention semantics", () => {
  assert.match(idempotencyDoc, /# ActionWalletIdempotency\.v1/);
  assert.match(idempotencyDoc, /supports idempotency on these endpoints/i);
  assert.match(idempotencyDoc, /The routes remain callable without `x-idempotency-key`/);
  assert.match(idempotencyDoc, /`\(\s*tenantId,\s*principalId,\s*endpoint,\s*x-idempotency-key\s*\)`/);
  assert.match(idempotencyDoc, /same scope key is reused with the same request hash, Nooterra returns the original status code and response body exactly/i);
  assert.match(idempotencyDoc, /same scope key is reused with a different request hash, Nooterra fails closed with `409` and `idempotency key conflict`/i);
  assert.match(idempotencyDoc, /does not define a protocol-level TTL or expiry window/i);
});

test("action-wallet v1 freeze: event-taxonomy doc locks the nine launch events, emit points, and metric bindings", () => {
  assert.match(eventTaxonomyDoc, /# ActionWalletEventTaxonomy\.v1/);
  assert.match(eventTaxonomyDoc, /Undocumented Action Wallet lifecycle event names are invalid/i);
  assert.match(eventTaxonomyDoc, /`intent\.created`/);
  assert.match(eventTaxonomyDoc, /`approval\.opened`/);
  assert.match(eventTaxonomyDoc, /`approval\.decided`/);
  assert.match(eventTaxonomyDoc, /`grant\.issued`/);
  assert.match(eventTaxonomyDoc, /`evidence\.submitted`/);
  assert.match(eventTaxonomyDoc, /`finalize\.requested`/);
  assert.match(eventTaxonomyDoc, /`receipt\.issued`/);
  assert.match(eventTaxonomyDoc, /`dispute\.opened`/);
  assert.match(eventTaxonomyDoc, /`dispute\.resolved`/);
  assert.match(eventTaxonomyDoc, /`POST \/v1\/action-intents`/);
  assert.match(eventTaxonomyDoc, /`POST \/runs\/\{runId\}\/dispute\/open`/);
  assert.match(eventTaxonomyDoc, /`POST \/runs\/\{runId\}\/dispute\/close`/);
  assert.match(eventTaxonomyDoc, /`approval completion rate`/);
  assert.match(eventTaxonomyDoc, /`grant validation failures`/);
  assert.match(eventTaxonomyDoc, /`receipt coverage`/);
  assert.match(eventTaxonomyDoc, /`dispute rate`/);
  assert.match(eventTaxonomyDoc, /`ACTION_WALLET_INTENT_TRANSITION`/);
});

test("action-wallet v1 freeze: semantic-hash doc locks the launch hash subjects and excluded operational fields", () => {
  assert.match(semanticHashesDoc, /# ActionWalletSemanticHashes\.v1/);
  assert.match(semanticHashesDoc, /`ActionIntent\.v1\.intentHash` is the semantic hash/i);
  assert.match(semanticHashesDoc, /resolves directly from `AuthorityEnvelope\.v1\.envelopeHash`/i);
  assert.match(semanticHashesDoc, /`ExecutionGrant\.v1\.grantHash` is the semantic hash/i);
  assert.match(semanticHashesDoc, /does not hash operational projection fields like `status`, `createdAt`, `continuation`, `workOrderId`/i);
  assert.match(semanticHashesDoc, /`EvidenceBundle\.v1\.evidenceBundleHash`/i);
  assert.match(semanticHashesDoc, /do not hash progress-only transport fields/i);
  assert.match(semanticHashesDoc, /`ActionReceipt\.v1\.receiptHash` is the semantic hash/i);
});

test("action-wallet v1 freeze: published alias routes remain available in OpenAPI", async () => {
  const api = createApi();
  const res = await request(api, {
    method: "GET",
    path: "/openapi.json",
    headers: { "x-nooterra-protocol": "1.0" }
  });
  assert.equal(res.statusCode, 200, res.body);
  for (const path of freeze.publishedApiAliases) {
    assert.ok(res.json?.paths?.[path], `missing published action-wallet alias ${path}`);
  }
});
