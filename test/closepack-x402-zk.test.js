import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildDeterministicZipStore } from "../src/core/deterministic-zip.js";
import { buildFundingHoldV1 } from "../src/core/funding-hold.js";
import { verifyToolCallClosepackZip } from "../scripts/closepack/lib.mjs";

function makeInvalidGroth16Proof() {
  return {
    pi_a: ["1", "2", "1"],
    pi_b: [
      ["1", "2"],
      ["3", "4"],
      ["1", "0"]
    ],
    pi_c: ["1", "2", "1"],
    protocol: "groth16"
  };
}

function encodeJson(obj) {
  return Buffer.from(`${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

function makeBaseClosepack({ agreementHash, holdHash, receiptHash, required }) {
  return {
    schemaVersion: "KernelToolCallClosePack.v0",
    closepackVersion: "v0",
    createdAt: "2026-02-20T00:00:00.000Z",
    root: {
      kind: "tool_call",
      agreementHash,
      runId: `tc_${agreementHash}`
    },
    subject: {
      agreementHash,
      receiptHash,
      holdHash,
      x402ReceiptId: "rcpt_closepack_zk_1",
      caseId: null,
      adjustmentId: null
    },
    files: {
      hold: "state/funding_hold.json",
      x402Receipt: "state/x402_receipt.json",
      x402ZkProof: "evidence/zk/proof.json",
      x402ZkPublicSignals: "evidence/zk/public.json",
      x402ZkVerificationKey: "evidence/zk/verification_key.json",
      arbitrationCase: null,
      settlementAdjustment: null,
      reputationEvents: null,
      replay: "reports/replay.json"
    },
    artifactRefs: [],
    reputation: {
      agentId: "agt_payee_closepack_1",
      toolId: "tool_call",
      eventCount: 0,
      eventIds: []
    },
    identityRefs: [],
    graph: [],
    exportIssues: [],
    _required: required
  };
}

async function buildClosepackZip({ required }) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-closepack-zk-"));
  const zipPath = path.join(tmpDir, "closepack.zip");
  const agreementHash = "1".repeat(64);
  const requestSha = "a".repeat(64);
  const responseSha = "b".repeat(64);
  const quoteSha = "c".repeat(64);
  const hold = buildFundingHoldV1({
    tenantId: "tenant_default",
    agreementHash,
    receiptHash: "d".repeat(64),
    payerAgentId: "agt_payer_closepack_1",
    payeeAgentId: "agt_payee_closepack_1",
    amountCents: 1000,
    heldAmountCents: 250,
    currency: "USD",
    holdbackBps: 2500,
    challengeWindowMs: 86_400_000,
    createdAt: "2026-02-20T00:00:00.000Z"
  });

  const closepackBase = makeBaseClosepack({
    agreementHash,
    holdHash: hold.holdHash,
    receiptHash: hold.receiptHash,
    required
  });
  const { _required: _ignoredRequired, ...closepack } = closepackBase;

  const x402Receipt = {
    schemaVersion: "X402ReceiptRecord.v1",
    receiptId: "rcpt_closepack_zk_1",
    runId: "run_closepack_zk_1",
    bindings: {
      request: { sha256: requestSha },
      response: { sha256: responseSha },
      quote: { quoteSha256: quoteSha }
    },
    zkProof: {
      schemaVersion: "X402ReceiptZkProofEvidence.v1",
      required: required === true,
      present: true,
      protocol: "groth16",
      verificationKeyRef: "vkey_closepack_1",
      statementHashSha256: quoteSha,
      inputDigestSha256: requestSha,
      outputDigestSha256: responseSha
    }
  };

  const replayReport = {
    comparisons: {
      chainConsistent: true
    }
  };

  const files = new Map();
  files.set("closepack.json", encodeJson(closepack));
  files.set("state/funding_hold.json", encodeJson(hold));
  files.set("state/x402_receipt.json", encodeJson(x402Receipt));
  files.set(
    "evidence/zk/proof.json",
    encodeJson({
      schemaVersion: "X402ExecutionProofData.v1",
      protocol: "groth16",
      proofData: makeInvalidGroth16Proof()
    })
  );
  files.set(
    "evidence/zk/public.json",
    encodeJson({
      schemaVersion: "X402ExecutionProofPublicSignals.v1",
      protocol: "groth16",
      publicSignals: ["1"]
    })
  );
  files.set(
    "evidence/zk/verification_key.json",
    encodeJson({
      schemaVersion: "X402ExecutionProofVerificationKey.v1",
      protocol: "groth16",
      verificationKey: {
        curve: "bn128",
        vk_alpha_1: ["1", "2"],
        vk_beta_2: [
          ["3", "4"],
          ["5", "6"]
        ]
      }
    })
  );
  files.set("reports/replay.json", encodeJson(replayReport));

  const zipBytes = buildDeterministicZipStore({ files, mtime: new Date("2000-01-01T00:00:00.000Z") });
  await fs.writeFile(zipPath, Buffer.from(zipBytes));
  return { tmpDir, zipPath };
}

test("closepack verify: required x402 zk proof invalid marks archive not enforceable", async () => {
  const { tmpDir, zipPath } = await buildClosepackZip({ required: true });
  try {
    const report = await verifyToolCallClosepackZip({ zipPath });
    assert.equal(report.ok, false);
    assert.ok(Array.isArray(report.issues));
    assert.ok(report.issues.some((row) => row?.code === "CLOSEPACK_X402_ZK_PROOF_INVALID"));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("closepack verify: optional x402 zk proof invalid emits warning but remains enforceable", async () => {
  const { tmpDir, zipPath } = await buildClosepackZip({ required: false });
  try {
    const report = await verifyToolCallClosepackZip({ zipPath });
    assert.equal(report.ok, true);
    assert.ok(Array.isArray(report.issues));
    assert.ok(report.issues.some((row) => row?.code === "CLOSEPACK_X402_ZK_PROOF_OPTIONAL_UNVERIFIED"));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
