import { SettldClient } from "../../packages/api-sdk/src/index.js";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { createEd25519Keypair, sha256Hex, signHashHexEd25519 } from "../../src/core/crypto.js";

function uniqueSuffix() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateAgentRegistration({ agentId, displayName, capability }) {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  return {
    agent: {
      agentId,
      displayName,
      owner: { ownerType: "service", ownerId: "svc_demo" },
      capabilities: capability ? [capability] : [],
      publicKeyPem
    },
    privateKeyPem
  };
}

function buildSignedArbitrationVerdictV1({
  tenantId,
  runId,
  settlementId,
  disputeId,
  caseId,
  arbiterAgentId,
  signerKeyId,
  signerPrivateKeyPem,
  outcome,
  releaseRatePct,
  rationale,
  evidenceRefs = [],
  issuedAt = new Date().toISOString()
}) {
  const core = normalizeForCanonicalJson(
    {
      schemaVersion: "ArbitrationVerdict.v1",
      verdictId: `avd_${sha256Hex(`demo:verdict:${caseId}:${issuedAt}`).slice(0, 16)}`,
      caseId,
      tenantId,
      runId,
      settlementId,
      disputeId,
      arbiterAgentId,
      outcome,
      releaseRatePct,
      rationale,
      evidenceRefs,
      issuedAt,
      appealRef: null
    },
    { path: "$" }
  );
  const verdictHash = sha256Hex(canonicalJsonStringify(core));
  const signature = signHashHexEd25519(verdictHash, signerPrivateKeyPem);
  return { ...core, signerKeyId, signature };
}

async function main() {
  const baseUrl = process.env.SETTLD_BASE_URL ?? "http://127.0.0.1:3000";
  const tenantId = process.env.SETTLD_TENANT_ID ?? "tenant_default";
  const apiKey = process.env.SETTLD_API_KEY ?? "";

  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.error("SETTLD_API_KEY is not set; this demo will only work if API auth is disabled.");
  }

  const client = new SettldClient({
    baseUrl,
    tenantId,
    apiKey: apiKey || undefined
  });

  const suffix = uniqueSuffix();
  const payerAgentId = `agt_demo_payer_${suffix}`;
  const payeeAgentId = `agt_demo_payee_${suffix}`;
  const arbiterAgentId = `agt_demo_arbiter_${suffix}`;

  // Tool-call holdback + dispute loop demo.
  // Note: agreementHash/receiptHash are modeled as sha256 hex bindings; this demo computes them deterministically from local strings.
  const agreementHash = sha256Hex(`demo:tool_call:agreement:${suffix}`);
  const receiptHash = sha256Hex(`demo:tool_call:receipt:${suffix}`);

  const payerReg = generateAgentRegistration({ agentId: payerAgentId, displayName: "Demo Payer", capability: "buyer" });
  const payeeReg = generateAgentRegistration({ agentId: payeeAgentId, displayName: "Demo Payee", capability: "seller" });
  const arbiterReg = generateAgentRegistration({ agentId: arbiterAgentId, displayName: "Demo Arbiter", capability: "arbiter" });

  const payerIdentity = await client.registerAgent(payerReg.agent, { idempotencyKey: `demo_${suffix}_register_payer` });
  const payeeIdentity = await client.registerAgent(payeeReg.agent, { idempotencyKey: `demo_${suffix}_register_payee` });
  const arbiterIdentity = await client.registerAgent(arbiterReg.agent, { idempotencyKey: `demo_${suffix}_register_arbiter` });
  const arbiterSignerKeyId = arbiterIdentity?.body?.keyId ?? arbiterIdentity?.body?.agentIdentity?.keys?.keyId ?? null;

  await client.creditAgentWallet(payerAgentId, { amountCents: 50_000, currency: "USD" }, { idempotencyKey: `demo_${suffix}_fund_payer` });

  const holdLock = await client.opsLockToolCallHold(
    {
      agreementHash,
      receiptHash,
      payerAgentId,
      payeeAgentId,
      amountCents: 10_000,
      currency: "USD",
      holdbackBps: 2_000,
      challengeWindowMs: 2_000
    },
    { idempotencyKey: `demo_${suffix}_hold_lock` }
  );

  const hold = holdLock?.body?.hold ?? null;
  const holdHash = hold?.holdHash ?? null;
  if (!holdHash) throw new Error("hold lock response missing hold.holdHash");

  const open = await client.toolCallOpenArbitration(
    {
      agreementHash,
      receiptHash,
      holdHash,
      openedByAgentId: payerAgentId,
      arbiterAgentId,
      summary: "Dispute: output does not meet acceptance criteria",
      evidenceRefs: []
    },
    { idempotencyKey: `demo_${suffix}_tc_open` }
  );

  const arbitrationCase = open?.body?.arbitrationCase ?? null;
  const caseId = arbitrationCase?.caseId ?? null;
  const disputeId = arbitrationCase?.disputeId ?? null;
  const settlementId = arbitrationCase?.settlementId ?? null;
  const runId = arbitrationCase?.runId ?? null;
  if (!caseId || !disputeId || !settlementId || !runId) throw new Error("open arbitration response missing required fields");

  // Let the dispute window elapse, then demonstrate that the holdback tick refuses to auto-release while a case is open.
  await sleep(2500);
  const blockedTick = await client.opsRunToolCallHoldbackMaintenance({ dryRun: true, limit: 50 }, { requestId: `demo_${suffix}_tick_blocked` });

  if (!arbiterSignerKeyId) throw new Error("arbiter registration did not return a keyId for signing verdicts");

  const signedVerdict = buildSignedArbitrationVerdictV1({
    tenantId,
    runId,
    settlementId,
    disputeId,
    caseId,
    arbiterAgentId,
    signerKeyId: arbiterSignerKeyId,
    signerPrivateKeyPem: arbiterReg.privateKeyPem,
    outcome: "accepted",
    releaseRatePct: 100,
    rationale: "Payee delivered acceptable work; release holdback."
  });

  const verdict = await client.toolCallSubmitArbitrationVerdict(
    { caseId, arbitrationVerdict: signedVerdict },
    { idempotencyKey: `demo_${suffix}_tc_verdict` }
  );

  const adjustmentId = `sadj_agmt_${agreementHash}_holdback`;
  const adjustment = await client.opsGetSettlementAdjustment(adjustmentId, { requestId: `demo_${suffix}_get_adj` });

  const summary = {
    demo: "tool_call_holdback_dispute_loop",
    ids: {
      tenantId,
      agreementHash,
      receiptHash,
      holdHash,
      caseId,
      disputeId,
      runId,
      settlementId,
      adjustmentId
    },
    agents: {
      payerAgentId,
      payeeAgentId,
      arbiterAgentId
    },
    notes: {
      kernelExplorer: `/ops/kernel/workspace?tenantId=${encodeURIComponent(tenantId)}&agreementHash=${encodeURIComponent(agreementHash)}`,
      blockedTick: blockedTick?.body ?? null,
      verdict: verdict?.body ?? null,
      adjustment: adjustment?.body ?? null,
      payerIdentity: payerIdentity?.body?.agentIdentity ?? null,
      payeeIdentity: payeeIdentity?.body?.agentIdentity ?? null
    }
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();

