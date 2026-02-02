import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";
import { createChainedEvent, appendChainedEvent } from "../src/core/event-chain.js";
import { buildJobProofBundleV1 } from "../src/core/proof-bundle.js";
import { GOVERNANCE_STREAM_ID } from "../src/core/governance.js";

import { verifyJobProofBundleDir } from "../packages/artifact-verify/src/job-proof-bundle.js";
import { writeFilesToDir } from "../scripts/proof-bundle/lib.mjs";
import { withEnv } from "./lib/with-env.js";

function buildPolicy({
  generatedAt,
  allowedVerificationReportKeyIds,
  allowedAttestationKeyIds
}) {
  return {
    schemaVersion: "GovernancePolicy.v2",
    policyId: "policy_test_v2",
    generatedAt,
    algorithms: ["ed25519"],
    verificationReportSigners: [
      {
        subjectType: "JobProofBundle.v1",
        allowedScopes: ["global"],
        allowedKeyIds: allowedVerificationReportKeyIds,
        requireGoverned: true,
        requiredPurpose: "server"
      }
    ],
    bundleHeadAttestationSigners: [
      {
        subjectType: "JobProofBundle.v1",
        allowedScopes: ["global"],
        allowedKeyIds: allowedAttestationKeyIds,
        requireGoverned: true,
        requiredPurpose: "server"
      }
    ],
    // Filled in by the bundler when it writes governance/revocations.json.
    revocationList: { path: "governance/revocations.json", sha256: "0".repeat(64) },
    signerKeyId: null,
    signedAt: null,
    policyHash: null,
    signature: null
  };
}

test("JobProofBundle.v1 strict verification enforces governance/policy.json allowlist for verification report signer", async () => {
  const tenantId = "tenant_default";
  const jobId = "job_policy_1";
  const generatedAt = "2026-01-01T00:00:03.000000Z";

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
    { SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify({ [govRootKeyId]: govRoot.publicKeyPem }) },
    async () => {
      let governanceEvents = [];
      governanceEvents = appendChainedEvent({
        events: governanceEvents,
        signer: signerA,
        event: createChainedEvent({
          streamId: GOVERNANCE_STREAM_ID,
          type: "SERVER_SIGNER_KEY_REGISTERED",
          at: "2026-01-01T00:00:00.000000Z",
          actor: { type: "ops", id: "bootstrap" },
          payload: { tenantId, keyId: keyAId, publicKeyPem: keyA.publicKeyPem, registeredAt: "2026-01-01T00:00:00.000000Z" }
        })
      });
      governanceEvents = appendChainedEvent({
        events: governanceEvents,
        signer: signerA,
        event: createChainedEvent({
          streamId: GOVERNANCE_STREAM_ID,
          type: "SERVER_SIGNER_KEY_REGISTERED",
          at: "2026-01-01T00:00:00.000001Z",
          actor: { type: "ops", id: "bootstrap" },
          payload: { tenantId, keyId: keyBId, publicKeyPem: keyB.publicKeyPem, registeredAt: "2026-01-01T00:00:00.000001Z" }
        })
      });

  let jobEvents = [];
  jobEvents = appendChainedEvent({
    events: jobEvents,
    signer: signerA,
    event: createChainedEvent({
      streamId: jobId,
      type: "JOB_CREATED",
      at: "2026-01-01T00:00:01.000000Z",
      actor: { type: "ops", id: "sys" },
      payload: { jobId }
    })
  });
  jobEvents = appendChainedEvent({
    events: jobEvents,
    signer: signerB,
    event: createChainedEvent({
      streamId: jobId,
      type: "QUOTE_PROPOSED",
      at: "2026-01-01T00:00:02.000000Z",
      actor: { type: "ops", id: "sys" },
      payload: { amountCents: 100 }
    })
  });

  const jobSnapshot = { id: jobId, lastChainHash: jobEvents[jobEvents.length - 1].chainHash, lastEventId: jobEvents[jobEvents.length - 1].id };
  const governanceSnapshot = {
    streamId: GOVERNANCE_STREAM_ID,
    lastChainHash: governanceEvents[governanceEvents.length - 1].chainHash,
    lastEventId: governanceEvents[governanceEvents.length - 1].id
  };
  const tenantGovernanceSnapshot = { streamId: GOVERNANCE_STREAM_ID, lastChainHash: null, lastEventId: null };

  const policy = buildPolicy({
    generatedAt,
    allowedVerificationReportKeyIds: [keyAId],
    allowedAttestationKeyIds: [keyAId]
  });

  const publicKeyByKeyId = new Map([
    [keyAId, keyA.publicKeyPem],
    [keyBId, keyB.publicKeyPem]
  ]);
  const signerKeys = [
    { tenantId, keyId: keyAId, publicKeyPem: keyA.publicKeyPem, status: "ACTIVE", purpose: "server" },
    { tenantId, keyId: keyBId, publicKeyPem: keyB.publicKeyPem, status: "ACTIVE", purpose: "server" }
  ];

  const { files } = buildJobProofBundleV1({
    tenantId,
    jobId,
    jobEvents,
    jobSnapshot,
    governanceEvents,
    governanceSnapshot,
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot,
    governancePolicy: policy,
    governancePolicySigner: govSigner,
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys,
    manifestSigner: signerA,
    verificationReportSigner: signerB,
    generatedAt
  });

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-job-proof-policy-"));
  const dir = path.join(tmp, "bundle");
  await writeFilesToDir({ files, outDir: dir });

      const res = await verifyJobProofBundleDir({ dir, strict: true });
      assert.equal(res.ok, false);
      assert.equal(res.error, "verification report invalid");
      assert.equal(res.detail?.error, "verification report signer not authorized");
    }
  );
});

test("JobProofBundle.v1 strict verification passes when governance/policy.json allowlist includes the report signer", async () => {
  const tenantId = "tenant_default";
  const jobId = "job_policy_2";
  const generatedAt = "2026-01-01T00:00:03.000000Z";

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
    { SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify({ [govRootKeyId]: govRoot.publicKeyPem }) },
    async () => {
      let governanceEvents = [];
      governanceEvents = appendChainedEvent({
        events: governanceEvents,
        signer: signerA,
        event: createChainedEvent({
          streamId: GOVERNANCE_STREAM_ID,
          type: "SERVER_SIGNER_KEY_REGISTERED",
          at: "2026-01-01T00:00:00.000000Z",
          actor: { type: "ops", id: "bootstrap" },
          payload: { tenantId, keyId: keyAId, publicKeyPem: keyA.publicKeyPem, registeredAt: "2026-01-01T00:00:00.000000Z" }
        })
      });
      governanceEvents = appendChainedEvent({
        events: governanceEvents,
        signer: signerA,
        event: createChainedEvent({
          streamId: GOVERNANCE_STREAM_ID,
          type: "SERVER_SIGNER_KEY_REGISTERED",
          at: "2026-01-01T00:00:00.000001Z",
          actor: { type: "ops", id: "bootstrap" },
          payload: { tenantId, keyId: keyBId, publicKeyPem: keyB.publicKeyPem, registeredAt: "2026-01-01T00:00:00.000001Z" }
        })
      });

  let jobEvents = [];
  jobEvents = appendChainedEvent({
    events: jobEvents,
    signer: signerA,
    event: createChainedEvent({
      streamId: jobId,
      type: "JOB_CREATED",
      at: "2026-01-01T00:00:01.000000Z",
      actor: { type: "ops", id: "sys" },
      payload: { jobId }
    })
  });
  jobEvents = appendChainedEvent({
    events: jobEvents,
    signer: signerB,
    event: createChainedEvent({
      streamId: jobId,
      type: "QUOTE_PROPOSED",
      at: "2026-01-01T00:00:02.000000Z",
      actor: { type: "ops", id: "sys" },
      payload: { amountCents: 100 }
    })
  });

  const jobSnapshot = { id: jobId, lastChainHash: jobEvents[jobEvents.length - 1].chainHash, lastEventId: jobEvents[jobEvents.length - 1].id };
  const governanceSnapshot = {
    streamId: GOVERNANCE_STREAM_ID,
    lastChainHash: governanceEvents[governanceEvents.length - 1].chainHash,
    lastEventId: governanceEvents[governanceEvents.length - 1].id
  };
  const tenantGovernanceSnapshot = { streamId: GOVERNANCE_STREAM_ID, lastChainHash: null, lastEventId: null };

  const policy = buildPolicy({
    generatedAt,
    allowedVerificationReportKeyIds: [keyBId],
    allowedAttestationKeyIds: [keyAId]
  });

  const publicKeyByKeyId = new Map([
    [keyAId, keyA.publicKeyPem],
    [keyBId, keyB.publicKeyPem]
  ]);
  const signerKeys = [
    { tenantId, keyId: keyAId, publicKeyPem: keyA.publicKeyPem, status: "ACTIVE", purpose: "server" },
    { tenantId, keyId: keyBId, publicKeyPem: keyB.publicKeyPem, status: "ACTIVE", purpose: "server" }
  ];

  const { files } = buildJobProofBundleV1({
    tenantId,
    jobId,
    jobEvents,
    jobSnapshot,
    governanceEvents,
    governanceSnapshot,
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot,
    governancePolicy: policy,
    governancePolicySigner: govSigner,
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys,
    manifestSigner: signerA,
    verificationReportSigner: signerB,
    generatedAt
  });

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-job-proof-policy-"));
  const dir = path.join(tmp, "bundle");
  await writeFilesToDir({ files, outDir: dir });

      const res = await verifyJobProofBundleDir({ dir, strict: true });
      assert.equal(res.ok, true);
    }
  );
});
