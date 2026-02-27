import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { signX402ReversalCommandV1 } from "../src/core/x402-reversal-command.js";
import { createPgStore } from "../src/db/store-pg.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

function makeSchema() {
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function registerAgent(api, { agentId }) {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const created = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `pg_x402_rev_bind_reg_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_pg_x402_reversal_binding" },
      publicKeyPem
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  return { agentId, publicKeyPem, privateKeyPem };
}

async function creditWallet(api, { agentId, amountCents, idempotencyKey }) {
  const response = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-idempotency-key": idempotencyKey },
    body: { amountCents, currency: "USD" }
  });
  assert.equal(response.statusCode, 201, response.body);
}

function autoPolicy100() {
  return {
    mode: "automatic",
    rules: {
      autoReleaseOnGreen: true,
      greenReleaseRatePct: 100,
      autoReleaseOnAmber: false,
      amberReleaseRatePct: 0,
      autoReleaseOnRed: true,
      redReleaseRatePct: 0
    }
  };
}

async function loadReversalBindings(api, { gateId, payerAgentId }) {
  const gateRes = await request(api, {
    method: "GET",
    path: `/x402/gate/${encodeURIComponent(gateId)}`
  });
  assert.equal(gateRes.statusCode, 200, gateRes.body);
  const gate = gateRes.json?.gate ?? null;
  const settlement = gateRes.json?.settlement ?? null;
  const receiptId =
    typeof settlement?.decisionTrace?.settlementReceipt?.receiptId === "string" &&
    settlement.decisionTrace.settlementReceipt.receiptId.trim() !== ""
      ? settlement.decisionTrace.settlementReceipt.receiptId.trim()
      : typeof gate?.authorization?.authorizationRef === "string" && gate.authorization.authorizationRef.trim() !== ""
        ? gate.authorization.authorizationRef.trim()
        : `auth_${gateId}`;
  const quoteId =
    typeof settlement?.decisionTrace?.bindings?.quote?.quoteId === "string" &&
    settlement.decisionTrace.bindings.quote.quoteId.trim() !== ""
      ? settlement.decisionTrace.bindings.quote.quoteId.trim()
      : typeof gate?.quote?.quoteId === "string" && gate.quote.quoteId.trim() !== ""
        ? gate.quote.quoteId.trim()
        : null;
  const requestSha256 =
    typeof settlement?.decisionTrace?.bindings?.request?.sha256 === "string" &&
    /^[0-9a-f]{64}$/i.test(settlement.decisionTrace.bindings.request.sha256.trim())
      ? settlement.decisionTrace.bindings.request.sha256.trim().toLowerCase()
      : null;
  const sponsorRef =
    typeof settlement?.decisionTrace?.bindings?.spendAuthorization?.sponsorRef === "string" &&
    settlement.decisionTrace.bindings.spendAuthorization.sponsorRef.trim() !== ""
      ? settlement.decisionTrace.bindings.spendAuthorization.sponsorRef.trim()
      : typeof gate?.agentPassport?.sponsorRef === "string" && gate.agentPassport.sponsorRef.trim() !== ""
        ? gate.agentPassport.sponsorRef.trim()
        : payerAgentId;
  assert.ok(receiptId);
  return { receiptId, quoteId, requestSha256, sponsorRef };
}

function signReversalCommand({
  payer,
  gateId,
  receiptId,
  quoteId,
  requestSha256 = null,
  sponsorRef,
  action,
  commandId,
  idempotencyKey,
  nonce
}) {
  return signX402ReversalCommandV1({
    command: {
      commandId,
      sponsorRef,
      agentKeyId: payer.agentId,
      target: {
        gateId,
        receiptId,
        ...(quoteId ? { quoteId } : {}),
        ...(requestSha256 ? { requestSha256 } : {})
      },
      action,
      nonce,
      idempotencyKey,
      exp: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    },
    signedAt: new Date().toISOString(),
    publicKeyPem: payer.publicKeyPem,
    privateKeyPem: payer.privateKeyPem
  });
}

(databaseUrl ? test : test.skip)(
  "pg api e2e: x402 reversal fails closed when request-hash evidence is missing mismatched or conflicting",
  async () => {
    const schema = makeSchema();
    const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    try {
      const api = createApi({ store, opsToken: "tok_ops" });

      const payer = await registerAgent(api, { agentId: "agt_pg_x402_refund_binding_payer_1" });
      const payee = await registerAgent(api, { agentId: "agt_pg_x402_refund_binding_payee_1" });
      await creditWallet(api, {
        agentId: payer.agentId,
        amountCents: 5000,
        idempotencyKey: "pg_wallet_credit_x402_refund_binding_1"
      });

      const gateId = "x402gate_pg_refund_binding_1";
      const created = await request(api, {
        method: "POST",
        path: "/x402/gate/create",
        headers: { "x-idempotency-key": "pg_x402_gate_create_refund_binding_1" },
        body: {
          gateId,
          payerAgentId: payer.agentId,
          payeeAgentId: payee.agentId,
          amountCents: 600,
          currency: "USD",
          toolId: "mock_search",
          disputeWindowDays: 2
        }
      });
      assert.equal(created.statusCode, 201, created.body);

      const authorized = await request(api, {
        method: "POST",
        path: "/x402/gate/authorize-payment",
        headers: { "x-idempotency-key": "pg_x402_gate_authorize_refund_binding_1" },
        body: { gateId }
      });
      assert.equal(authorized.statusCode, 200, authorized.body);

      const verify = await request(api, {
        method: "POST",
        path: "/x402/gate/verify",
        headers: { "x-idempotency-key": "pg_x402_gate_verify_refund_binding_1" },
        body: {
          gateId,
          verificationStatus: "green",
          runStatus: "completed",
          policy: autoPolicy100(),
          verificationMethod: { mode: "deterministic", source: "http_status_v1" },
          evidenceRefs: [`http:request_sha256:${"c".repeat(64)}`, `http:response_sha256:${"d".repeat(64)}`]
        }
      });
      assert.equal(verify.statusCode, 200, verify.body);

      const bindings = await loadReversalBindings(api, { gateId, payerAgentId: payer.agentId });
      assert.ok(bindings.requestSha256);

      const missingEvidence = await request(api, {
        method: "POST",
        path: "/x402/gate/reversal",
        headers: { "x-idempotency-key": "pg_x402_gate_reversal_binding_missing_1" },
        body: {
          gateId,
          action: "request_refund",
          reason: "result_not_usable",
          evidenceRefs: ["provider:incident:missing_request_hash"],
          command: signReversalCommand({
            payer,
            gateId,
            receiptId: bindings.receiptId,
            quoteId: bindings.quoteId,
            requestSha256: bindings.requestSha256,
            sponsorRef: bindings.sponsorRef,
            action: "request_refund",
            commandId: "pg_cmd_refund_binding_missing_1",
            idempotencyKey: "pg_idem_refund_binding_missing_1",
            nonce: "pg_nonce_refund_binding_missing_1"
          })
        }
      });
      assert.equal(missingEvidence.statusCode, 409, missingEvidence.body);
      assert.equal(missingEvidence.json?.code, "X402_REVERSAL_BINDING_EVIDENCE_REQUIRED");

      const mismatchSha = "e".repeat(64);
      const mismatchEvidence = await request(api, {
        method: "POST",
        path: "/x402/gate/reversal",
        headers: { "x-idempotency-key": "pg_x402_gate_reversal_binding_mismatch_1" },
        body: {
          gateId,
          action: "request_refund",
          reason: "result_not_usable",
          evidenceRefs: [`http:request_sha256:${mismatchSha}`],
          command: signReversalCommand({
            payer,
            gateId,
            receiptId: bindings.receiptId,
            quoteId: bindings.quoteId,
            requestSha256: bindings.requestSha256,
            sponsorRef: bindings.sponsorRef,
            action: "request_refund",
            commandId: "pg_cmd_refund_binding_mismatch_1",
            idempotencyKey: "pg_idem_refund_binding_mismatch_1",
            nonce: "pg_nonce_refund_binding_mismatch_1"
          })
        }
      });
      assert.equal(mismatchEvidence.statusCode, 409, mismatchEvidence.body);
      assert.equal(mismatchEvidence.json?.code, "X402_REVERSAL_BINDING_EVIDENCE_MISMATCH");

      const conflictEvidence = await request(api, {
        method: "POST",
        path: "/x402/gate/reversal",
        headers: { "x-idempotency-key": "pg_x402_gate_reversal_binding_conflict_1" },
        body: {
          gateId,
          action: "request_refund",
          reason: "result_not_usable",
          evidenceRefs: [`http:request_sha256:${bindings.requestSha256}`, `http:request_sha256:${mismatchSha}`],
          command: signReversalCommand({
            payer,
            gateId,
            receiptId: bindings.receiptId,
            quoteId: bindings.quoteId,
            requestSha256: bindings.requestSha256,
            sponsorRef: bindings.sponsorRef,
            action: "request_refund",
            commandId: "pg_cmd_refund_binding_conflict_1",
            idempotencyKey: "pg_idem_refund_binding_conflict_1",
            nonce: "pg_nonce_refund_binding_conflict_1"
          })
        }
      });
      assert.equal(conflictEvidence.statusCode, 409, conflictEvidence.body);
      assert.equal(conflictEvidence.json?.code, "X402_REVERSAL_BINDING_EVIDENCE_MISMATCH");
      assert.deepEqual(conflictEvidence.json?.details?.requestSha256Values, [bindings.requestSha256, mismatchSha]);
    } finally {
      await store.close();
    }
  }
);
