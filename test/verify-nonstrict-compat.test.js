import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createEd25519Keypair, keyIdFromPublicKeyPem, sha256Hex, signHashHexEd25519 } from "../src/core/crypto.js";
import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { createChainedEvent, appendChainedEvent } from "../src/core/event-chain.js";
import { buildDefaultGovernancePolicyV1 } from "../src/core/governance-policy.js";
import { buildJobProofBundleV1, buildMonthProofBundleV1, computeProofBundleManifestV1 } from "../src/core/proof-bundle.js";
import { buildFinancePackBundleV1 } from "../src/core/finance-pack-bundle.js";
import { GOVERNANCE_STREAM_ID } from "../src/core/governance.js";
import { DEFAULT_TENANT_ID } from "../src/core/tenancy.js";
import { computeArtifactHash } from "../src/core/artifacts.js";

import { verifyJobProofBundleDir, verifyMonthProofBundleDir } from "../packages/artifact-verify/src/job-proof-bundle.js";
import { verifyFinancePackBundleDir } from "../packages/artifact-verify/src/finance-pack-bundle.js";
import { VERIFICATION_WARNING_CODE } from "../packages/artifact-verify/src/verification-warnings.js";

import { writeFilesToDir } from "../scripts/proof-bundle/lib.mjs";
import { withEnv } from "./lib/with-env.js";

function bytes(text) {
  return new TextEncoder().encode(text);
}

function parseJson(bytesValue) {
  return JSON.parse(new TextDecoder().decode(bytesValue));
}

function warningCodes(out) {
  return new Set((out?.warnings ?? []).map((w) => w?.code).filter(Boolean));
}

test("non-strict: missing verify/verification_report.json is warned + accepted (JobProof + MonthProof)", async () => {
  const tenantId = "tenant_nonstrict_missing_report";
  const jobId = "job_nonstrict_missing_report_1";
  const period = "2026-01";
  const generatedAt = "2026-02-01T00:00:00.000Z";

  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(publicKeyPem);
  const signer = { keyId, privateKeyPem };
  const govRoot = createEd25519Keypair();
  const govRootKeyId = keyIdFromPublicKeyPem(govRoot.publicKeyPem);
  const govSigner = { keyId: govRootKeyId, privateKeyPem: govRoot.privateKeyPem };

  const publicKeyByKeyId = new Map([[keyId, publicKeyPem]]);

  const governanceEvents = [];
  governanceEvents.push(
    ...appendChainedEvent({
      events: governanceEvents,
      signer,
      event: createChainedEvent({
        streamId: GOVERNANCE_STREAM_ID,
        type: "SERVER_SIGNER_KEY_REGISTERED",
        at: "2026-01-01T00:00:00.000Z",
        actor: { type: "system", id: "proxy" },
        payload: { tenantId: DEFAULT_TENANT_ID, keyId, publicKeyPem, registeredAt: "2026-01-01T00:00:00.000Z" }
      })
    })
  );

  const jobEvents = [];
  jobEvents.push(
    ...appendChainedEvent({
      events: jobEvents,
      signer,
      event: createChainedEvent({
        streamId: jobId,
        type: "JOB_CREATED",
        at: generatedAt,
        actor: { type: "system", id: "proxy" },
        payload: { jobId }
      })
    })
  );
  const jobSnapshot = { id: jobId, lastChainHash: jobEvents[jobEvents.length - 1].chainHash, lastEventId: jobEvents[jobEvents.length - 1].id };

  const { files: jobFiles } = buildJobProofBundleV1({
    tenantId,
    jobId,
    jobEvents,
    jobSnapshot,
    governanceEvents,
    governanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: governanceEvents.at(-1)?.chainHash ?? null, lastEventId: governanceEvents.at(-1)?.id ?? null },
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: null, lastEventId: null },
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys: [{ tenantId: DEFAULT_TENANT_ID, keyId, publicKeyPem, validFrom: "2026-01-01T00:00:00.000Z", serverGoverned: true }],
    manifestSigner: signer,
    governancePolicySigner: govSigner,
    requireHeadAttestation: true,
    generatedAt
  });

  const monthEvents = [];
  monthEvents.push(
    ...appendChainedEvent({
      events: monthEvents,
      signer,
      event: createChainedEvent({
        streamId: `month_${period}`,
        type: "MONTH_CLOSE_REQUESTED",
        at: generatedAt,
        actor: { type: "system", id: "proxy" },
        payload: { period, basis: "settledAt" }
      })
    })
  );
  const { files: monthFiles } = buildMonthProofBundleV1({
    tenantId,
    period,
    basis: "settledAt",
    monthEvents,
    governanceEvents,
    governanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: governanceEvents.at(-1)?.chainHash ?? null, lastEventId: governanceEvents.at(-1)?.id ?? null },
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: null, lastEventId: null },
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys: [{ tenantId: DEFAULT_TENANT_ID, keyId, publicKeyPem, validFrom: "2026-01-01T00:00:00.000Z", serverGoverned: true }],
    manifestSigner: signer,
    governancePolicySigner: govSigner,
    requireHeadAttestation: true,
    generatedAt
  });

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-nonstrict-missing-report-"));

  const jobDir = path.join(tmp, "job");
  await writeFilesToDir({ files: jobFiles, outDir: jobDir });
  await fs.rm(path.join(jobDir, "verify", "verification_report.json"));

  const monthDir = path.join(tmp, "month");
  await writeFilesToDir({ files: monthFiles, outDir: monthDir });
  await fs.rm(path.join(monthDir, "verify", "verification_report.json"));

  const resJob = await verifyJobProofBundleDir({ dir: jobDir, strict: false });
  assert.equal(resJob.ok, true, JSON.stringify(resJob, null, 2));
  assert.equal(warningCodes(resJob).has(VERIFICATION_WARNING_CODE.VERIFICATION_REPORT_MISSING_LENIENT), true);

  const resMonth = await verifyMonthProofBundleDir({ dir: monthDir, strict: false });
  assert.equal(resMonth.ok, true, JSON.stringify(resMonth, null, 2));
  assert.equal(warningCodes(resMonth).has(VERIFICATION_WARNING_CODE.VERIFICATION_REPORT_MISSING_LENIENT), true);
});

test("non-strict: missing verify/verification_report.json is warned + accepted (FinancePack)", async () => {
  const tenantId = "tenant_nonstrict_missing_report_finance";
  const period = "2026-01";
  const createdAt = "2026-02-01T00:00:00.000Z";

  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(publicKeyPem);
  const signer = { keyId, privateKeyPem };
  const govRoot = createEd25519Keypair();
  const govRootKeyId = keyIdFromPublicKeyPem(govRoot.publicKeyPem);
  const govSigner = { keyId: govRootKeyId, privateKeyPem: govRoot.privateKeyPem };
  const publicKeyByKeyId = new Map([[keyId, publicKeyPem]]);

  const governanceEvents = [];
  governanceEvents.push(
    ...appendChainedEvent({
      events: governanceEvents,
      signer,
      event: createChainedEvent({
        streamId: GOVERNANCE_STREAM_ID,
        type: "SERVER_SIGNER_KEY_REGISTERED",
        at: "2026-01-01T00:00:00.000Z",
        actor: { type: "system", id: "proxy" },
        payload: { tenantId: DEFAULT_TENANT_ID, keyId, publicKeyPem, registeredAt: "2026-01-01T00:00:00.000Z" }
      })
    })
  );

  const monthEvents = [];
  monthEvents.push(
    ...appendChainedEvent({
      events: monthEvents,
      signer,
      event: createChainedEvent({
        streamId: `month_${period}`,
        type: "MONTH_CLOSE_REQUESTED",
        at: createdAt,
        actor: { type: "system", id: "proxy" },
        payload: { period, basis: "settledAt" }
      })
    })
  );

  const { files: monthFiles, bundle: monthBundle } = buildMonthProofBundleV1({
    tenantId,
    period,
    basis: "settledAt",
    monthEvents,
    governanceEvents,
    governanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: governanceEvents.at(-1)?.chainHash ?? null, lastEventId: governanceEvents.at(-1)?.id ?? null },
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: null, lastEventId: null },
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys: [{ tenantId: DEFAULT_TENANT_ID, keyId, publicKeyPem, validFrom: "2026-01-01T00:00:00.000Z", serverGoverned: true }],
    manifestSigner: signer,
    governancePolicySigner: govSigner,
    requireHeadAttestation: true,
    generatedAt: createdAt
  });

  const glBatch = { artifactType: "GLBatch.v1", schemaVersion: "GLBatch.v1", artifactId: "gl_1", tenantId, period, basis: "settledAt", batch: { lines: [] } };
  glBatch.artifactHash = computeArtifactHash(glBatch);
  const csv = "a,b\n1,2\n";
  const journalCsv = {
    artifactType: "JournalCsv.v1",
    schemaVersion: "JournalCsv.v1",
    artifactId: "csv_1",
    tenantId,
    period,
    basis: "settledAt",
    accountMapHash: "h_map",
    csv,
    csvSha256: sha256Hex(bytes(csv))
  };
  journalCsv.artifactHash = computeArtifactHash(journalCsv);
  const reconcile = { ok: true, period, basis: "settledAt", entryCount: 0, totalsKeys: 0 };
  const reconcileBytes = bytes(`${canonicalJsonStringify(reconcile)}\n`);

  const built = buildFinancePackBundleV1({
    tenantId,
    period,
    protocol: "1.0",
    createdAt,
    governancePolicySigner: govSigner,
    monthProofBundle: monthBundle,
    monthProofFiles: monthFiles,
    requireMonthProofAttestation: true,
    requireHeadAttestation: true,
    manifestSigner: signer,
    verificationReportSigner: signer,
    glBatchArtifact: glBatch,
    journalCsvArtifact: journalCsv,
    reconcileReport: reconcile,
    reconcileReportBytes: reconcileBytes
  });

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-nonstrict-missing-report-finance-"));
  const dir = path.join(tmp, "bundle");
  await writeFilesToDir({ files: built.files, outDir: dir });
  await fs.rm(path.join(dir, "verify", "verification_report.json"));

  const res = await verifyFinancePackBundleDir({ dir, strict: false });
  assert.equal(res.ok, true, JSON.stringify(res, null, 2));
  assert.equal(warningCodes(res).has(VERIFICATION_WARNING_CODE.VERIFICATION_REPORT_MISSING_LENIENT), true);
});

test("strict vs non-strict: GovernancePolicy.v1 accepted only non-strict (JobProof)", async () => {
  const tenantId = "tenant_nonstrict_policy_v1";
  const jobId = "job_nonstrict_policy_v1";
  const generatedAt = "2026-02-01T00:00:00.000Z";

  const serverKeys = createEd25519Keypair();
  const serverKeyId = keyIdFromPublicKeyPem(serverKeys.publicKeyPem);
  const serverSigner = { keyId: serverKeyId, privateKeyPem: serverKeys.privateKeyPem };

  const govRoot = createEd25519Keypair();
  const govRootKeyId = keyIdFromPublicKeyPem(govRoot.publicKeyPem);
  const govSigner = { keyId: govRootKeyId, privateKeyPem: govRoot.privateKeyPem };

  const publicKeyByKeyId = new Map([
    [serverKeyId, serverKeys.publicKeyPem],
    [govRootKeyId, govRoot.publicKeyPem]
  ]);

  const governanceEvents = [];
  governanceEvents.push(
    ...appendChainedEvent({
      events: governanceEvents,
      signer: serverSigner,
      event: createChainedEvent({
        streamId: GOVERNANCE_STREAM_ID,
        type: "SERVER_SIGNER_KEY_REGISTERED",
        at: "2026-01-01T00:00:00.000Z",
        actor: { type: "system", id: "proxy" },
        payload: { tenantId, keyId: serverKeyId, publicKeyPem: serverKeys.publicKeyPem, registeredAt: "2026-01-01T00:00:00.000Z" }
      })
    })
  );

  const jobEvents = [];
  jobEvents.push(
    ...appendChainedEvent({
      events: jobEvents,
      signer: serverSigner,
      event: createChainedEvent({
        streamId: jobId,
        type: "JOB_CREATED",
        at: generatedAt,
        actor: { type: "system", id: "proxy" },
        payload: { jobId }
      })
    })
  );
  const jobSnapshot = { id: jobId, lastChainHash: jobEvents.at(-1)?.chainHash ?? null, lastEventId: jobEvents.at(-1)?.id ?? null };

  const { files } = buildJobProofBundleV1({
    tenantId,
    jobId,
    jobEvents,
    jobSnapshot,
    governanceEvents,
    governanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: governanceEvents.at(-1)?.chainHash ?? null, lastEventId: governanceEvents.at(-1)?.id ?? null },
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: null, lastEventId: null },
    revocationList: { schemaVersion: "RevocationList.v1", listId: "revocations", generatedAt, rotations: [], revocations: [], signerKeyId: null, signedAt: null, listHash: null, signature: null },
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys: [{ tenantId, keyId: serverKeyId, publicKeyPem: serverKeys.publicKeyPem, validFrom: "2026-01-01T00:00:00.000Z", serverGoverned: true }],
    manifestSigner: serverSigner,
    governancePolicySigner: govSigner,
    requireHeadAttestation: true,
    generatedAt
  });

  // Downgrade governance/policy.json to GovernancePolicy.v1 but keep the bundle otherwise well-formed by
  // recomputing manifest + head attestation + verification report bindings.
  {
    const policyV1 = buildDefaultGovernancePolicyV1({ generatedAt });
    files.set("governance/policy.json", bytes(`${canonicalJsonStringify(policyV1)}\n`));

    const filesForManifest = new Map(files);
    filesForManifest.delete("manifest.json");
    filesForManifest.delete("attestation/bundle_head_attestation.json");
    const { manifest, manifestHash } = computeProofBundleManifestV1({
      files: filesForManifest,
      generatedAt,
      kind: "JobProofBundle.v1",
      tenantId,
      scope: { jobId }
    });
    files.set("manifest.json", bytes(`${canonicalJsonStringify({ ...manifest, manifestHash })}\n`));

    const att = parseJson(files.get("attestation/bundle_head_attestation.json"));
    const { attestationHash: _ah, signature: _asig, ...attCore } = att;
    attCore.manifestHash = manifestHash;
    const newAttHash = sha256Hex(canonicalJsonStringify(attCore));
    const newAtt = { ...attCore, attestationHash: newAttHash, signature: signHashHexEd25519(newAttHash, serverSigner.privateKeyPem) };
    files.set("attestation/bundle_head_attestation.json", bytes(`${canonicalJsonStringify(newAtt)}\n`));

    const rep = parseJson(files.get("verify/verification_report.json"));
    const { reportHash: _rh, signature: _rsig, ...repCore } = rep;
    repCore.subject = repCore.subject ?? {};
    repCore.subject.manifestHash = manifestHash;
    repCore.bundleHeadAttestation = repCore.bundleHeadAttestation ?? {};
    repCore.bundleHeadAttestation.attestationHash = newAttHash;
    repCore.bundleHeadAttestation.manifestHash = manifestHash;
    const newReportHash = sha256Hex(canonicalJsonStringify(repCore));
    const newRep = { ...repCore, reportHash: newReportHash, signature: signHashHexEd25519(newReportHash, serverSigner.privateKeyPem) };
    files.set("verify/verification_report.json", bytes(`${canonicalJsonStringify(newRep)}\n`));
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-nonstrict-policy-v1-"));
  const dir = path.join(tmp, "bundle");
  await writeFilesToDir({ files, outDir: dir });

  const strictRes = await withEnv(
    { NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify({ [govRootKeyId]: govRoot.publicKeyPem }) },
    async () => verifyJobProofBundleDir({ dir, strict: true })
  );
  assert.equal(strictRes.ok, false);
  assert.equal(strictRes.error, "strict requires GovernancePolicy.v2");

  const lenientRes = await verifyJobProofBundleDir({ dir, strict: false });
  assert.equal(lenientRes.ok, true, JSON.stringify(lenientRes, null, 2));
  assert.equal(warningCodes(lenientRes).has(VERIFICATION_WARNING_CODE.GOVERNANCE_POLICY_V1_ACCEPTED_LENIENT), true);
});
