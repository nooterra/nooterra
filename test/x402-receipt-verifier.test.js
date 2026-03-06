import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../src/core/canonical-json.js";
import { createEd25519Keypair, sha256Hex } from "../src/core/crypto.js";
import { verifyX402ReceiptRecord } from "../src/core/x402-receipt-verifier.js";
import { signX402ProviderRefundDecisionV1 } from "../src/core/x402-provider-refund-decision.js";
import { signX402ReversalCommandV1 } from "../src/core/x402-reversal-command.js";
import { buildX402ReceiptVerifierVector } from "./helpers/x402-receipt-vector.js";

function buildReversalEvent({
  eventId,
  gateId,
  receiptId,
  action,
  eventType,
  occurredAt,
  command,
  commandVerification,
  providerDecision = null,
  providerDecisionArtifact = null,
  providerDecisionVerification = null,
  evidenceRefs = null,
  prevEventHash = null
}) {
  const event = normalizeForCanonicalJson(
    {
      schemaVersion: "X402GateReversalEvent.v1",
      eventId,
      tenantId: "tenant_default",
      gateId,
      receiptId,
      action,
      eventType,
      occurredAt,
      ...(providerDecision ? { providerDecision } : {}),
      ...(Array.isArray(evidenceRefs) ? { evidenceRefs } : {}),
      ...(command ? { command } : {}),
      ...(commandVerification ? { commandVerification } : {}),
      ...(providerDecisionArtifact ? { providerDecisionArtifact } : {}),
      ...(providerDecisionVerification ? { providerDecisionVerification } : {}),
      ...(prevEventHash ? { prevEventHash } : {})
    },
    { path: "$" }
  );
  const eventHash = sha256Hex(canonicalJsonStringify(event));
  return normalizeForCanonicalJson(
    {
      ...event,
      eventHash
    },
    { path: "$" }
  );
}

function buildSignedCommandArtifact({ keypair, gateId, receiptId, quoteId, requestSha256, action, commandId, nonce, idempotencyKey }) {
  const command = signX402ReversalCommandV1({
    command: {
      commandId,
      sponsorRef: "sponsor_acme",
      agentKeyId: "agent_key_1",
      target: {
        gateId,
        receiptId,
        quoteId,
        requestSha256
      },
      action,
      nonce,
      idempotencyKey,
      exp: "2099-01-01T00:00:00.000Z"
    },
    signedAt: "2026-02-18T00:00:00.000Z",
    publicKeyPem: keypair.publicKeyPem,
    privateKeyPem: keypair.privateKeyPem
  });
  return {
    command,
    commandVerification: normalizeForCanonicalJson(
      {
        schemaVersion: "X402ReversalCommandVerification.v1",
        verified: true,
        keyId: command.signature.keyId,
        publicKeyPem: keypair.publicKeyPem,
        payloadHash: command.signature.payloadHash,
        checkedAt: "2026-02-18T00:00:01.000Z",
        code: null,
        error: null
      },
      { path: "$" }
    )
  };
}

test("x402 receipt verifier: valid vector passes with zero errors", () => {
  const receipt = buildX402ReceiptVerifierVector();
  assert.equal(receipt.decisionRecord?.profileHashUsed, receipt.bindings?.spendAuthorization?.policyFingerprint);
  const report = verifyX402ReceiptRecord({ receipt, strict: false });
  assert.equal(report.ok, true);
  assert.equal(report.errors.length, 0);
  const providerCheck = report.checks.find((row) => row.id === "provider_output_signature_crypto");
  const providerQuoteCheck = report.checks.find((row) => row.id === "provider_quote_signature_crypto");
  assert.equal(providerCheck?.ok, true);
  assert.equal(providerQuoteCheck?.ok, true);
});

test("x402 receipt verifier: provider signer revoked after signing remains verifiable with lifecycle warning", () => {
  const receipt = buildX402ReceiptVerifierVector();
  receipt.verificationContext.providerSigningKey = normalizeForCanonicalJson(
    {
      ...receipt.verificationContext.providerSigningKey,
      status: "revoked",
      revokedAt: "2026-02-18T00:00:03.000Z"
    },
    { path: "$" }
  );
  const report = verifyX402ReceiptRecord({ receipt, strict: false });
  assert.equal(report.ok, true);
  assert.ok(report.warnings.some((row) => row.code === "provider_signature_signer_key_currently_invalid"));
  const lifecycleCheck = report.checks.find((row) => row.id === "provider_output_signer_lifecycle_continuity");
  assert.equal(lifecycleCheck?.ok, true);
  assert.equal(lifecycleCheck?.detail?.validAt?.ok, true);
  assert.equal(lifecycleCheck?.detail?.validNow?.ok, false);
  assert.equal(lifecycleCheck?.detail?.validNow?.canonicalCode, "KEY_REVOKED");
});

test("x402 receipt verifier: provider quote signer rotated after signing remains verifiable with lifecycle warning", () => {
  const receipt = buildX402ReceiptVerifierVector();
  receipt.verificationContext.providerQuoteSigningKey = normalizeForCanonicalJson(
    {
      ...receipt.verificationContext.providerQuoteSigningKey,
      status: "rotated",
      rotatedAt: "2026-02-18T00:00:02.000Z"
    },
    { path: "$" }
  );
  const report = verifyX402ReceiptRecord({ receipt, strict: false });
  assert.equal(report.ok, true);
  assert.ok(report.warnings.some((row) => row.code === "provider_quote_signature_signer_key_currently_invalid"));
  const lifecycleCheck = report.checks.find((row) => row.id === "provider_quote_signer_lifecycle_continuity");
  assert.equal(lifecycleCheck?.ok, true);
  assert.equal(lifecycleCheck?.detail?.validAt?.ok, true);
  assert.equal(lifecycleCheck?.detail?.validNow?.ok, false);
  assert.equal(lifecycleCheck?.detail?.validNow?.canonicalCode, "KEY_ROTATED");
});

test("x402 receipt verifier: provider signer revoked before signing fails closed", () => {
  const receipt = buildX402ReceiptVerifierVector();
  receipt.verificationContext.providerSigningKey = normalizeForCanonicalJson(
    {
      ...receipt.verificationContext.providerSigningKey,
      status: "revoked",
      revokedAt: "2026-02-18T00:00:01.000Z"
    },
    { path: "$" }
  );
  const report = verifyX402ReceiptRecord({ receipt, strict: false });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((row) => row.code === "provider_signature_signer_key_invalid_at_signing"));
  const lifecycleCheck = report.checks.find((row) => row.id === "provider_output_signer_lifecycle_continuity");
  assert.equal(lifecycleCheck?.ok, false);
  assert.equal(lifecycleCheck?.detail?.validAt?.ok, false);
  assert.equal(lifecycleCheck?.detail?.validAt?.canonicalCode, "KEY_REVOKED");
});

test("x402 receipt verifier: tampered response binding fails", () => {
  const receipt = buildX402ReceiptVerifierVector();
  receipt.bindings.response.sha256 = "9".repeat(64);
  const report = verifyX402ReceiptRecord({ receipt, strict: false });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((row) => row.code === "response_hash_binding_mismatch"));
  assert.ok(report.errors.some((row) => row.code === "provider_signature_response_hash_mismatch"));
});

test("x402 receipt verifier: strict mode escalates missing quote signature material", () => {
  const receipt = buildX402ReceiptVerifierVector();
  delete receipt.providerQuotePayload;
  delete receipt.providerQuoteSignature;
  const nonStrict = verifyX402ReceiptRecord({ receipt, strict: false });
  assert.equal(nonStrict.ok, true);
  assert.ok(nonStrict.warnings.some((row) => row.code === "provider_quote_signature_material_missing"));

  const strict = verifyX402ReceiptRecord({ receipt, strict: true });
  assert.equal(strict.ok, false);
  assert.ok(strict.errors.some((row) => row.code === "strict_provider_quote_signature_material_missing"));
});

test("x402 receipt verifier: valid reversal event chain passes", () => {
  const receipt = buildX402ReceiptVerifierVector();
  const gateId = receipt.gateId;
  const receiptId = receipt.receiptId;
  const quoteId = receipt.bindings.quote.quoteId;
  const requestSha256 = receipt.bindings.request.sha256;

  const commandKey = createEd25519Keypair();
  const providerDecisionKey = createEd25519Keypair();
  const requestedCommand = buildSignedCommandArtifact({
    keypair: commandKey,
    gateId,
    receiptId,
    quoteId,
    requestSha256,
    action: "request_refund",
    commandId: "cmd_req_1",
    nonce: "nonce_req_1",
    idempotencyKey: "idem_req_1"
  });
  const resolvedCommand = buildSignedCommandArtifact({
    keypair: commandKey,
    gateId,
    receiptId,
    quoteId,
    requestSha256,
    action: "resolve_refund",
    commandId: "cmd_res_1",
    nonce: "nonce_res_1",
    idempotencyKey: "idem_res_1"
  });
  const providerDecisionArtifact = signX402ProviderRefundDecisionV1({
    decision: {
      decisionId: "dec_1",
      receiptId,
      gateId,
      quoteId,
      requestSha256,
      decision: "accepted",
      reason: "provider_acknowledged",
      decidedAt: "2026-02-18T00:02:00.000Z"
    },
    signedAt: "2026-02-18T00:02:00.000Z",
    publicKeyPem: providerDecisionKey.publicKeyPem,
    privateKeyPem: providerDecisionKey.privateKeyPem
  });
  const providerDecisionVerification = normalizeForCanonicalJson(
    {
      schemaVersion: "X402ProviderRefundDecisionVerification.v1",
      verified: true,
      keyId: providerDecisionArtifact.signature.keyId,
      publicKeyPem: providerDecisionKey.publicKeyPem,
      payloadHash: providerDecisionArtifact.signature.payloadHash,
      checkedAt: "2026-02-18T00:02:01.000Z",
      code: null,
      error: null
    },
    { path: "$" }
  );

  const requestedEvent = buildReversalEvent({
    eventId: "x402rev_1",
    gateId,
    receiptId,
    action: "request_refund",
    eventType: "refund_requested",
    occurredAt: "2026-02-18T00:01:00.000Z",
    evidenceRefs: [`http:request_sha256:${requestSha256}`],
    command: requestedCommand.command,
    commandVerification: requestedCommand.commandVerification
  });
  const resolvedEvent = buildReversalEvent({
    eventId: "x402rev_2",
    gateId,
    receiptId,
    action: "resolve_refund",
    eventType: "refund_resolved",
    occurredAt: "2026-02-18T00:02:00.000Z",
    evidenceRefs: [`http:request_sha256:${requestSha256}`],
    command: resolvedCommand.command,
    commandVerification: resolvedCommand.commandVerification,
    providerDecision: "accepted",
    providerDecisionArtifact,
    providerDecisionVerification,
    prevEventHash: requestedEvent.eventHash
  });
  receipt.reversalEvents = [requestedEvent, resolvedEvent];

  const report = verifyX402ReceiptRecord({ receipt, strict: false });
  assert.equal(report.ok, true);
  const chainCheck = report.checks.find((row) => row.id === "reversal_event_chain");
  assert.equal(chainCheck?.ok, true);
});

test("x402 receipt verifier: tampered reversal event hash fails", () => {
  const receipt = buildX402ReceiptVerifierVector();
  const event = buildReversalEvent({
    eventId: "x402rev_bad_1",
    gateId: receipt.gateId,
    receiptId: receipt.receiptId,
    action: "request_refund",
    eventType: "refund_requested",
    occurredAt: "2026-02-18T00:01:00.000Z",
    command: null,
    commandVerification: null
  });
  event.eventHash = "9".repeat(64);
  receipt.reversalEvents = [event];

  const report = verifyX402ReceiptRecord({ receipt, strict: false });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((row) => row.code === "reversal_event_hash_mismatch"));
});

test("x402 receipt verifier: reversal event request-hash evidence must match command target", () => {
  const receipt = buildX402ReceiptVerifierVector();
  const { command, commandVerification } = buildSignedCommandArtifact({
    keypair: createEd25519Keypair(),
    gateId: receipt.gateId,
    receiptId: receipt.receiptId,
    quoteId: receipt.bindings.quote.quoteId,
    requestSha256: receipt.bindings.request.sha256,
    action: "request_refund",
    commandId: "cmd_req_binding_1",
    nonce: "nonce_req_binding_1",
    idempotencyKey: "idem_req_binding_1"
  });
  receipt.reversalEvents = [
    buildReversalEvent({
      eventId: "x402rev_binding_1",
      gateId: receipt.gateId,
      receiptId: receipt.receiptId,
      action: "request_refund",
      eventType: "refund_requested",
      occurredAt: "2026-02-18T00:01:00.000Z",
      command,
      commandVerification,
      evidenceRefs: [`http:request_sha256:${"9".repeat(64)}`]
    })
  ];

  const report = verifyX402ReceiptRecord({ receipt, strict: false });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((row) => row.code === "reversal_event_request_hash_evidence_mismatch"));
});

test("x402 receipt verifier: golden vector manifest", async () => {
  const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "x402-receipt-verifier");
  const manifest = JSON.parse(await fs.readFile(path.join(fixtureDir, "vectors.manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, "X402ReceiptVerifierVectors.v1");
  for (const vector of manifest.vectors) {
    const receipt = JSON.parse(await fs.readFile(path.join(fixtureDir, vector.file), "utf8"));
    const report = verifyX402ReceiptRecord({ receipt, strict: vector.strict === true });
    assert.equal(report.ok, vector.expectOk, `vector ${vector.id}`);
    for (const code of vector.expectErrorCodes) {
      assert.ok(report.errors.some((row) => row.code === code), `vector ${vector.id} missing error code ${code}`);
    }
    for (const code of vector.expectWarningCodes) {
      assert.ok(report.warnings.some((row) => row.code === code), `vector ${vector.id} missing warning code ${code}`);
    }
  }
});
