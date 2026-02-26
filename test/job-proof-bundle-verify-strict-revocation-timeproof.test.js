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

async function buildStrictJobBundleDir({
  tenantId,
  jobId,
  generatedAt,
  revokedAt,
  includeTimestampProof
}) {
  const serverKeys = createEd25519Keypair();
  const serverKeyId = keyIdFromPublicKeyPem(serverKeys.publicKeyPem);
  const serverSigner = { keyId: serverKeyId, privateKeyPem: serverKeys.privateKeyPem };

  const govRoot = createEd25519Keypair();
  const govRootKeyId = keyIdFromPublicKeyPem(govRoot.publicKeyPem);
  const govSigner = { keyId: govRootKeyId, privateKeyPem: govRoot.privateKeyPem };

  const timeAuthority = createEd25519Keypair();
  const timeAuthorityKeyId = keyIdFromPublicKeyPem(timeAuthority.publicKeyPem);
  const timeSigner = { keyId: timeAuthorityKeyId, privateKeyPem: timeAuthority.privateKeyPem };

  let governanceEvents = [];
  governanceEvents = appendChainedEvent({
    events: governanceEvents,
    signer: serverSigner,
    event: createChainedEvent({
      streamId: GOVERNANCE_STREAM_ID,
      type: "SERVER_SIGNER_KEY_REGISTERED",
      at: "2026-01-01T00:00:00.000Z",
      actor: { type: "system", id: "proxy" },
      payload: { tenantId, keyId: serverKeyId, publicKeyPem: serverKeys.publicKeyPem, registeredAt: "2026-01-01T00:00:00.000Z" }
    })
  });

  let jobEvents = [];
  jobEvents = appendChainedEvent({
    events: jobEvents,
    signer: serverSigner,
    event: createChainedEvent({
      streamId: jobId,
      type: "JOB_CREATED",
      at: generatedAt,
      actor: { type: "system", id: "proxy" },
      payload: { jobId }
    })
  });

  const jobSnapshot = { id: jobId, lastChainHash: jobEvents[jobEvents.length - 1].chainHash, lastEventId: jobEvents[jobEvents.length - 1].id };
  const governanceSnapshot = {
    streamId: GOVERNANCE_STREAM_ID,
    lastChainHash: governanceEvents[governanceEvents.length - 1].chainHash,
    lastEventId: governanceEvents[governanceEvents.length - 1].id
  };

  const publicKeyByKeyId = new Map([[serverKeyId, serverKeys.publicKeyPem]]);
  const signerKeys = [{ tenantId, keyId: serverKeyId, publicKeyPem: serverKeys.publicKeyPem, validFrom: "2026-01-01T00:00:00.000Z", serverGoverned: true }];

  const revocationList = {
    schemaVersion: "RevocationList.v1",
    listId: "revocations_test_v1",
    generatedAt,
    rotations: [],
    revocations: [{ keyId: serverKeyId, revokedAt, reason: "compromised", scope: null }],
    signerKeyId: null,
    signedAt: null,
    listHash: null,
    signature: null
  };

  const { files } = buildJobProofBundleV1({
    tenantId,
    jobId,
    jobEvents,
    jobSnapshot,
    governanceEvents,
    governanceSnapshot,
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: null, lastEventId: null },
    revocationList,
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys,
    manifestSigner: serverSigner,
    governancePolicySigner: govSigner,
    timestampAuthoritySigner: includeTimestampProof ? timeSigner : null,
    requireHeadAttestation: true,
    generatedAt
  });

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-job-proof-revocation-timeproof-"));
  const dir = path.join(tmp, "bundle");
  await writeFilesToDir({ files, outDir: dir });

  return {
    dir,
    trustedEnv: {
      NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify({ [govRootKeyId]: govRoot.publicKeyPem }),
      NOOTERRA_TRUSTED_TIME_AUTHORITY_KEYS_JSON: JSON.stringify({ [timeAuthorityKeyId]: timeAuthority.publicKeyPem })
    }
  };
}

async function buildStrictJobBundleDirWithRotation({
  tenantId,
  jobId,
  eventAt,
  bundleGeneratedAt,
  rotatedAt,
  manifestSignerKey // "A" | "B"
}) {
  const keyA = createEd25519Keypair();
  const keyB = createEd25519Keypair();
  const keyAId = keyIdFromPublicKeyPem(keyA.publicKeyPem);
  const keyBId = keyIdFromPublicKeyPem(keyB.publicKeyPem);
  const signerA = { keyId: keyAId, privateKeyPem: keyA.privateKeyPem };
  const signerB = { keyId: keyBId, privateKeyPem: keyB.privateKeyPem };

  const govRoot = createEd25519Keypair();
  const govRootKeyId = keyIdFromPublicKeyPem(govRoot.publicKeyPem);
  const govSigner = { keyId: govRootKeyId, privateKeyPem: govRoot.privateKeyPem };

  let governanceEvents = [];
  governanceEvents = appendChainedEvent({
    events: governanceEvents,
    signer: signerA,
    event: createChainedEvent({
      streamId: GOVERNANCE_STREAM_ID,
      type: "SERVER_SIGNER_KEY_ROTATED",
      at: rotatedAt,
      actor: { type: "system", id: "proxy" },
      payload: { tenantId, oldKeyId: keyAId, newKeyId: keyBId, rotatedAt }
    })
  });

  const eventSigner = manifestSignerKey === "B" ? signerB : signerA;
  let jobEvents = [];
  jobEvents = appendChainedEvent({
    events: jobEvents,
    signer: eventSigner,
    event: createChainedEvent({
      streamId: jobId,
      type: "JOB_CREATED",
      at: eventAt,
      actor: { type: "system", id: "proxy" },
      payload: { jobId }
    })
  });

  const jobSnapshot = { id: jobId, lastChainHash: jobEvents[jobEvents.length - 1].chainHash, lastEventId: jobEvents[jobEvents.length - 1].id };
  const governanceSnapshot = {
    streamId: GOVERNANCE_STREAM_ID,
    lastChainHash: governanceEvents[governanceEvents.length - 1].chainHash,
    lastEventId: governanceEvents[governanceEvents.length - 1].id
  };

  const publicKeyByKeyId = new Map([
    [keyAId, keyA.publicKeyPem],
    [keyBId, keyB.publicKeyPem]
  ]);
  const signerKeys = [
    { tenantId, keyId: keyAId, publicKeyPem: keyA.publicKeyPem, validFrom: "2026-01-01T00:00:00.000Z", serverGoverned: true },
    { tenantId, keyId: keyBId, publicKeyPem: keyB.publicKeyPem, validFrom: "2026-01-01T00:00:00.000Z", serverGoverned: true }
  ];

  const revocationList = {
    schemaVersion: "RevocationList.v1",
    listId: "rotations_test_v1",
    generatedAt: bundleGeneratedAt,
    rotations: [{ oldKeyId: keyAId, newKeyId: keyBId, rotatedAt, reason: "planned", scope: null }],
    revocations: [],
    signerKeyId: null,
    signedAt: null,
    listHash: null,
    signature: null
  };

  const manifestSigner = manifestSignerKey === "B" ? signerB : signerA;

  const { files } = buildJobProofBundleV1({
    tenantId,
    jobId,
    jobEvents,
    jobSnapshot,
    governanceEvents,
    governanceSnapshot,
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: null, lastEventId: null },
    revocationList,
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys,
    manifestSigner,
    governancePolicySigner: govSigner,
    requireHeadAttestation: true,
    generatedAt: bundleGeneratedAt
  });

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-job-proof-rotation-"));
  const dir = path.join(tmp, "bundle");
  await writeFilesToDir({ files, outDir: dir });

  return {
    dir,
    trustedEnv: {
      NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify({ [govRootKeyId]: govRoot.publicKeyPem })
    }
  };
}

test("strict: revoked key signed before T passes only with timestampProof", async () => {
  const { dir, trustedEnv } = await buildStrictJobBundleDir({
    tenantId: "tenant_default",
    jobId: "job_revocation_timeproof_ok",
    generatedAt: "2026-01-01T00:00:01.000Z",
    revokedAt: "2026-01-01T00:00:10.000Z",
    includeTimestampProof: true
  });

  await withEnv(trustedEnv, async () => {
    const res = await verifyJobProofBundleDir({ dir, strict: true });
    assert.equal(res.ok, true, JSON.stringify(res, null, 2));
  });
});

test("strict: revoked key signed at/after T fails even with timestampProof", async () => {
  const { dir, trustedEnv } = await buildStrictJobBundleDir({
    tenantId: "tenant_default",
    jobId: "job_revocation_timeproof_fail_after",
    generatedAt: "2026-01-01T00:00:10.000Z",
    revokedAt: "2026-01-01T00:00:10.000Z",
    includeTimestampProof: true
  });

  await withEnv(trustedEnv, async () => {
    const res = await verifyJobProofBundleDir({ dir, strict: true });
    assert.equal(res.ok, false);
    assert.equal(res.error, "bundle head attestation invalid");
    assert.equal(res.detail?.error, "SIGNER_REVOKED");
  });
});

test("strict: revoked key signed before T fails without timestampProof (SIGNING_TIME_UNPROVABLE)", async () => {
  const { dir, trustedEnv } = await buildStrictJobBundleDir({
    tenantId: "tenant_default",
    jobId: "job_revocation_timeproof_missing",
    generatedAt: "2026-01-01T00:00:01.000Z",
    revokedAt: "2026-01-01T00:00:10.000Z",
    includeTimestampProof: false
  });

  await withEnv(trustedEnv, async () => {
    const res = await verifyJobProofBundleDir({ dir, strict: true });
    assert.equal(res.ok, false);
    assert.equal(res.error, "bundle head attestation invalid");
    assert.equal(res.detail?.error, "SIGNING_TIME_UNPROVABLE");
  });
});

test("strict: rotated key signed at/after rotatedAt fails (SIGNER_ROTATED)", async () => {
  const { dir, trustedEnv } = await buildStrictJobBundleDirWithRotation({
    tenantId: "tenant_default",
    jobId: "job_rotation_fail_old_key",
    eventAt: "2026-01-01T00:00:01.000Z",
    bundleGeneratedAt: "2026-01-01T00:00:20.000Z",
    rotatedAt: "2026-01-01T00:00:10.000Z",
    manifestSignerKey: "A"
  });

  await withEnv(trustedEnv, async () => {
    const res = await verifyJobProofBundleDir({ dir, strict: true });
    assert.equal(res.ok, false);
    assert.equal(res.error, "bundle head attestation invalid");
    assert.equal(res.detail?.error, "SIGNER_ROTATED");
  });
});

test("strict: new key after rotation verifies", async () => {
  const { dir, trustedEnv } = await buildStrictJobBundleDirWithRotation({
    tenantId: "tenant_default",
    jobId: "job_rotation_ok_new_key",
    eventAt: "2026-01-01T00:00:20.000Z",
    bundleGeneratedAt: "2026-01-01T00:00:20.000Z",
    rotatedAt: "2026-01-01T00:00:10.000Z",
    manifestSignerKey: "B"
  });

  await withEnv(trustedEnv, async () => {
    const res = await verifyJobProofBundleDir({ dir, strict: true });
    assert.equal(res.ok, true, JSON.stringify(res, null, 2));
  });
});
