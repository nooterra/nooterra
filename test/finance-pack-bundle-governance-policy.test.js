import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resetDeterministicIds } from "../src/core/ids.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem, sha256Hex } from "../src/core/crypto.js";
import { createChainedEvent, appendChainedEvent } from "../src/core/event-chain.js";
import { buildMonthProofBundleV1 } from "../src/core/proof-bundle.js";
import { buildFinancePackBundleV1 } from "../src/core/finance-pack-bundle.js";
import { GOVERNANCE_STREAM_ID } from "../src/core/governance.js";
import { computeArtifactHash } from "../src/core/artifacts.js";
import { canonicalJsonStringify } from "../src/core/canonical-json.js";

import { verifyFinancePackBundleDir } from "../packages/artifact-verify/src/finance-pack-bundle.js";
import { writeFilesToDir } from "../scripts/proof-bundle/lib.mjs";
import { withEnv } from "./lib/with-env.js";

function bytes(text) {
  return new TextEncoder().encode(text);
}

function buildFinancePolicy({ createdAt, allowedVerificationReportKeyIds, allowedAttestationKeyIds }) {
  return {
    schemaVersion: "GovernancePolicy.v2",
    policyId: "policy_finance_test_v2",
    generatedAt: createdAt,
    algorithms: ["ed25519"],
    verificationReportSigners: [
      {
        subjectType: "FinancePackBundle.v1",
        allowedScopes: ["global"],
        allowedKeyIds: allowedVerificationReportKeyIds,
        requireGoverned: true,
        requiredPurpose: "server"
      }
    ],
    bundleHeadAttestationSigners: [
      {
        subjectType: "FinancePackBundle.v1",
        allowedScopes: ["global"],
        allowedKeyIds: allowedAttestationKeyIds,
        requireGoverned: true,
        requiredPurpose: "server"
      }
    ],
    revocationList: { path: "governance/revocations.json", sha256: "0".repeat(64) },
    signerKeyId: null,
    signedAt: null,
    policyHash: null,
    signature: null
  };
}

test("FinancePackBundle.v1 strict verification enforces governance/policy.json allowlist for verification report signer", async () => {
  process.env.PROXY_DETERMINISTIC_IDS = "1";
  resetDeterministicIds();

  const tenantId = "tenant_default";
  const period = "2026-01";
  const createdAt = "2026-02-01T00:00:00.000Z";

  const keyA = createEd25519Keypair();
  const keyB = createEd25519Keypair();
  const keyAId = keyIdFromPublicKeyPem(keyA.publicKeyPem);
  const keyBId = keyIdFromPublicKeyPem(keyB.publicKeyPem);
  const signerA = { keyId: keyAId, privateKeyPem: keyA.privateKeyPem };
  const signerB = { keyId: keyBId, privateKeyPem: keyB.privateKeyPem };
  const govRoot = createEd25519Keypair();
  const govRootKeyId = keyIdFromPublicKeyPem(govRoot.publicKeyPem);
  const govSigner = { keyId: govRootKeyId, privateKeyPem: govRoot.privateKeyPem };
  await withEnv(
    { NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify({ [govRootKeyId]: govRoot.publicKeyPem }) },
    async () => {
      const publicKeyByKeyId = new Map([
        [keyAId, keyA.publicKeyPem],
        [keyBId, keyB.publicKeyPem]
      ]);

  let governanceEvents = [];
  governanceEvents = appendChainedEvent({
    events: governanceEvents,
    signer: signerA,
    event: createChainedEvent({
      streamId: GOVERNANCE_STREAM_ID,
      type: "SERVER_SIGNER_KEY_REGISTERED",
      at: "2026-01-01T00:00:00.000Z",
      actor: { type: "system", id: "proxy" },
      payload: { tenantId, keyId: keyAId, publicKeyPem: keyA.publicKeyPem, registeredAt: "2026-01-01T00:00:00.000Z" }
    })
  });
  governanceEvents = appendChainedEvent({
    events: governanceEvents,
    signer: signerA,
    event: createChainedEvent({
      streamId: GOVERNANCE_STREAM_ID,
      type: "SERVER_SIGNER_KEY_REGISTERED",
      at: "2026-01-01T00:00:00.000001Z",
      actor: { type: "system", id: "proxy" },
      payload: { tenantId, keyId: keyBId, publicKeyPem: keyB.publicKeyPem, registeredAt: "2026-01-01T00:00:00.000001Z" }
    })
  });

  const signerKeys = [
    { tenantId, keyId: keyAId, publicKeyPem: keyA.publicKeyPem, validFrom: "2026-01-01T00:00:00.000Z", serverGoverned: true, purpose: "server" },
    { tenantId, keyId: keyBId, publicKeyPem: keyB.publicKeyPem, validFrom: "2026-01-01T00:00:00.000001Z", serverGoverned: true, purpose: "server" }
  ];

  let monthEvents = [];
  monthEvents = appendChainedEvent({
    events: monthEvents,
    signer: signerA,
    event: createChainedEvent({
      streamId: `month_${period}`,
      type: "MONTH_CLOSE_REQUESTED",
      at: "2026-02-01T00:00:00.000Z",
      actor: { type: "system", id: "proxy" },
      payload: { period, basis: "settledAt" }
    })
  });
  monthEvents = appendChainedEvent({
    events: monthEvents,
    signer: signerB,
    event: createChainedEvent({
      streamId: `month_${period}`,
      type: "MONTH_CLOSED",
      at: "2026-02-01T00:00:01.000Z",
      actor: { type: "system", id: "proxy" },
      payload: { period, basis: "settledAt" }
    })
  });

  const month = buildMonthProofBundleV1({
    tenantId,
    period,
    basis: "settledAt",
    monthEvents,
    governanceEvents,
    governanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: governanceEvents[governanceEvents.length - 1].chainHash, lastEventId: governanceEvents[governanceEvents.length - 1].id },
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: null, lastEventId: null },
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys,
    manifestSigner: signerA,
    governancePolicySigner: govSigner,
    requireHeadAttestation: true,
    generatedAt: createdAt
  });

  const glBatch = { artifactType: "GLBatch.v1", schemaVersion: "GLBatch.v1", artifactId: "gl_policy", tenantId, period, basis: "settledAt", batch: { lines: [] } };
  glBatch.artifactHash = computeArtifactHash(glBatch);
  const csv = "a,b\n1,2\n";
  const journalCsv = {
    artifactType: "JournalCsv.v1",
    schemaVersion: "JournalCsv.v1",
    artifactId: "csv_policy",
    tenantId,
    period,
    basis: "settledAt",
    accountMapHash: "h_map",
    csv,
    csvSha256: sha256Hex(bytes(csv))
  };
  journalCsv.artifactHash = computeArtifactHash(journalCsv);
  const reconcileReport = { ok: true, period, basis: "settledAt", entryCount: 0, totalsKeys: 0 };
  const reconcileBytes = bytes(`${canonicalJsonStringify(reconcileReport)}\n`);

  const policy = buildFinancePolicy({ createdAt, allowedVerificationReportKeyIds: [keyAId], allowedAttestationKeyIds: [keyAId] });

  const finance = buildFinancePackBundleV1({
    tenantId,
    period,
    protocol: "1.0",
    createdAt,
    governancePolicy: policy,
    governancePolicySigner: govSigner,
    monthProofBundle: month.bundle,
    monthProofFiles: month.files,
    requireMonthProofAttestation: true,
    requireHeadAttestation: true,
    manifestSigner: signerA,
    verificationReportSigner: signerB,
    toolVersion: "0.0.0-policy-test",
    glBatchArtifact: glBatch,
    journalCsvArtifact: journalCsv,
    reconcileReport,
    reconcileReportBytes: reconcileBytes
  });

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-finance-policy-"));
  const dir = path.join(tmp, "bundle");
  await writeFilesToDir({ files: finance.files, outDir: dir });

      const res = await verifyFinancePackBundleDir({ dir, strict: true });
      assert.equal(res.ok, false);
      assert.equal(res.error, "verification report invalid");
      assert.equal(res.detail?.error, "verification report signer not authorized");
    }
  );
});
