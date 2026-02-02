import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify } from "../../src/core/canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "../../src/core/crypto.js";
import { computeArtifactHash } from "../../src/core/artifacts.js";
import { createChainedEvent, appendChainedEvent } from "../../src/core/event-chain.js";
import { buildJobProofBundleV1, buildMonthProofBundleV1 } from "../../src/core/proof-bundle.js";
import { buildFinancePackBundleV1 } from "../../src/core/finance-pack-bundle.js";
import { GOVERNANCE_STREAM_ID } from "../../src/core/governance.js";
import { DEFAULT_TENANT_ID } from "../../src/core/tenancy.js";
import { buildGovernancePolicyV2Unsigned } from "../../src/core/governance-policy.js";
import { writeFilesToDir } from "../proof-bundle/lib.mjs";

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage: node scripts/fixtures/generate-bundle-fixtures.mjs [--out <dir>]");
  process.exit(2);
}

function bytes(text) {
  return new TextEncoder().encode(text);
}

async function ensureEmptyDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function readFixtureKeypairs() {
  const p = path.resolve(process.cwd(), "test", "fixtures", "keys", "fixture_keypairs.json");
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}

function stripVerificationReportSig(report) {
  const { reportHash: _h, signature: _sig, ...rest } = report ?? {};
  return rest;
}

function resignVerificationReport({ report, signer }) {
  const core = stripVerificationReportSig(report);
  const reportHash = sha256Hex(canonicalJsonStringify(core));
  const signature = signHashHexEd25519(reportHash, signer.privateKeyPem);
  return { ...core, reportHash, signature };
}

function buildGovernanceEvents({ tenantId, serverKeys }) {
  let governanceEvents = [];
  governanceEvents = appendChainedEvent({
    events: governanceEvents,
    signer: serverKeys.signerA,
    event: createChainedEvent({
      id: "evt_gov_serverA_registered",
      streamId: GOVERNANCE_STREAM_ID,
      type: "SERVER_SIGNER_KEY_REGISTERED",
      at: "2026-01-01T00:00:00.000Z",
      actor: { type: "system", id: "proxy" },
      payload: {
        tenantId: DEFAULT_TENANT_ID,
        keyId: serverKeys.serverA.keyId,
        publicKeyPem: serverKeys.serverA.publicKeyPem,
        registeredAt: "2026-01-01T00:00:00.000Z",
        reason: "fixture"
      }
    })
  });
  return governanceEvents;
}

function governanceSnapshotFor(events) {
  const last = events.at(-1) ?? null;
  return { streamId: GOVERNANCE_STREAM_ID, lastChainHash: last?.chainHash ?? null, lastEventId: last?.id ?? null };
}

function buildJobProofBase({
  tenantId,
  jobId,
  generatedAt,
  serverKeys,
  govSigner,
  timeSigner,
  governancePolicy,
  revocationList,
  includeTimestampProof,
  toolVersion
}) {
  const governanceEvents = buildGovernanceEvents({ tenantId, serverKeys });
  const governanceSnapshot = governanceSnapshotFor(governanceEvents);

  let jobEvents = [];
  jobEvents = appendChainedEvent({
    events: jobEvents,
    signer: serverKeys.signerA,
    event: createChainedEvent({
      id: "evt_job_created",
      streamId: jobId,
      type: "JOB_CREATED",
      at: generatedAt,
      actor: { type: "system", id: "proxy" },
      payload: { jobId }
    })
  });
  const jobSnapshot = { id: jobId, lastChainHash: jobEvents.at(-1)?.chainHash ?? null, lastEventId: jobEvents.at(-1)?.id ?? null };

  const publicKeyByKeyId = new Map([
    [serverKeys.serverA.keyId, serverKeys.serverA.publicKeyPem],
    [serverKeys.serverB.keyId, serverKeys.serverB.publicKeyPem]
  ]);

  const { files } = buildJobProofBundleV1({
    tenantId,
    jobId,
    jobEvents,
    jobSnapshot,
    governanceEvents,
    governanceSnapshot,
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: null, lastEventId: null },
    governancePolicy: governancePolicy ?? null,
    governancePolicySigner: govSigner,
    revocationList: revocationList ?? null,
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys: [],
    manifestSigner: serverKeys.signerA,
    verificationReportSigner: serverKeys.signerA,
    timestampAuthoritySigner: includeTimestampProof ? timeSigner : null,
    toolVersion: toolVersion ?? null,
    requireHeadAttestation: true,
    generatedAt
  });

  return files;
}

function buildMonthProofBase({
  tenantId,
  period,
  basis,
  generatedAt,
  serverKeys,
  govSigner,
  timeSigner,
  governancePolicy,
  revocationList,
  includeTimestampProof,
  toolVersion
}) {
  const governanceEvents = buildGovernanceEvents({ tenantId, serverKeys });
  const governanceSnapshot = governanceSnapshotFor(governanceEvents);

  let monthEvents = [];
  monthEvents = appendChainedEvent({
    events: monthEvents,
    signer: serverKeys.signerA,
    event: createChainedEvent({
      id: "evt_month_close_requested",
      streamId: `month_${period}`,
      type: "MONTH_CLOSE_REQUESTED",
      at: generatedAt,
      actor: { type: "system", id: "proxy" },
      payload: { period, basis }
    })
  });

  const publicKeyByKeyId = new Map([
    [serverKeys.serverA.keyId, serverKeys.serverA.publicKeyPem],
    [serverKeys.serverB.keyId, serverKeys.serverB.publicKeyPem]
  ]);

  const { files, bundle } = buildMonthProofBundleV1({
    tenantId,
    period,
    basis,
    monthEvents,
    governanceEvents,
    governanceSnapshot,
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: null, lastEventId: null },
    governancePolicy: governancePolicy ?? null,
    governancePolicySigner: govSigner,
    revocationList: revocationList ?? null,
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys: [],
    manifestSigner: serverKeys.signerA,
    verificationReportSigner: serverKeys.signerA,
    timestampAuthoritySigner: includeTimestampProof ? timeSigner : null,
    toolVersion: toolVersion ?? null,
    requireHeadAttestation: true,
    generatedAt
  });

  return { files, bundle };
}

function buildFinancePackBase({ tenantId, period, createdAt, serverKeys, govSigner, monthProof }) {
  const glBatch = { artifactType: "GLBatch.v1", schemaVersion: "GLBatch.v1", artifactId: "gl_fixture", tenantId, period, basis: "settledAt", batch: { lines: [] } };
  glBatch.artifactHash = computeArtifactHash(glBatch);

  const csvText = "a,b\n1,2\n";
  const csvSha256 = sha256Hex(bytes(csvText));
  const journalCsv = {
    artifactType: "JournalCsv.v1",
    schemaVersion: "JournalCsv.v1",
    artifactId: "csv_fixture",
    tenantId,
    period,
    basis: "settledAt",
    accountMapHash: "h_map_fixture",
    csv: csvText,
    csvSha256
  };
  journalCsv.artifactHash = computeArtifactHash(journalCsv);

  const reconcile = { ok: true, period, basis: "settledAt", entryCount: 0, totalsKeys: 0 };
  const reconcileBytes = bytes(`${canonicalJsonStringify(reconcile)}\n`);

  const { files } = buildFinancePackBundleV1({
    tenantId,
    period,
    protocol: "1.0",
    createdAt,
    governancePolicySigner: govSigner,
    monthProofBundle: monthProof.bundle,
    monthProofFiles: monthProof.files,
    requireMonthProofAttestation: true,
    requireHeadAttestation: true,
    manifestSigner: serverKeys.signerA,
    verificationReportSigner: serverKeys.signerA,
    glBatchArtifact: glBatch,
    journalCsvArtifact: journalCsv,
    reconcileReport: reconcile,
    reconcileReportBytes: reconcileBytes,
    toolVersion: "0.0.0-fixture"
  });

  return files;
}

async function main() {
  const argv = process.argv.slice(2);
  let outDir = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1");
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--out") {
      outDir = path.resolve(process.cwd(), String(argv[i + 1] ?? ""));
      if (!outDir) usage();
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    usage();
  }

  const keypairs = await readFixtureKeypairs();
  const govSigner = { keyId: keypairs.govRoot.keyId, privateKeyPem: keypairs.govRoot.privateKeyPem };
  const timeSigner = { keyId: keypairs.timeAuthority.keyId, privateKeyPem: keypairs.timeAuthority.privateKeyPem };
  const serverKeys = {
    serverA: keypairs.serverA,
    serverB: keypairs.serverB,
    signerA: { keyId: keypairs.serverA.keyId, privateKeyPem: keypairs.serverA.privateKeyPem }
  };

  await ensureEmptyDir(outDir);

  const tenantId = "tenant_fixture";
  const generatedAt = "2026-02-02T00:00:00.000Z";
  const toolVersion = "0.0.0-fixture";

  // JobProof fixtures
  {
    const base = buildJobProofBase({
      tenantId,
      jobId: "job_fixture_1",
      generatedAt,
      serverKeys: { ...serverKeys, signerA: serverKeys.signerA, signerB: { keyId: keypairs.serverB.keyId, privateKeyPem: keypairs.serverB.privateKeyPem } },
      govSigner,
      timeSigner,
      includeTimestampProof: false,
      toolVersion
    });
    const dir = path.join(outDir, "jobproof", "strict-pass");
    await ensureEmptyDir(dir);
    writeFilesToDir({ files: base, outDir: dir });

    const missingReport = new Map(base);
    missingReport.delete("verify/verification_report.json");
    const dirMissingStrict = path.join(outDir, "jobproof", "strict-fail-missing-verification-report");
    await ensureEmptyDir(dirMissingStrict);
    writeFilesToDir({ files: missingReport, outDir: dirMissingStrict });

    const dirMissingNonStrict = path.join(outDir, "jobproof", "nonstrict-pass-missing-verification-report");
    await ensureEmptyDir(dirMissingNonStrict);
    writeFilesToDir({ files: missingReport, outDir: dirMissingNonStrict });

    const tamper = new Map(base);
    const snap = new TextDecoder().decode(tamper.get("job/snapshot.json"));
    tamper.set("job/snapshot.json", bytes(snap.replace("\"id\":\"job_fixture_1\"", "\"id\":\"job_fixture_1_tampered\"")));
    const dirTamper = path.join(outDir, "jobproof", "strict-fail-manifest-tamper");
    await ensureEmptyDir(dirTamper);
    writeFilesToDir({ files: tamper, outDir: dirTamper });

    const bindingMismatch = new Map(base);
    const report = JSON.parse(new TextDecoder().decode(bindingMismatch.get("verify/verification_report.json")));
    report.bundleHeadAttestation = { ...(report.bundleHeadAttestation ?? {}), attestationHash: "0".repeat(64) };
    const resigned = resignVerificationReport({ report, signer: serverKeys.signerA });
    bindingMismatch.set("verify/verification_report.json", bytes(`${canonicalJsonStringify(resigned)}\n`));
    const dirBinding = path.join(outDir, "jobproof", "strict-fail-verification-report-binding-mismatch");
    await ensureEmptyDir(dirBinding);
    writeFilesToDir({ files: bindingMismatch, outDir: dirBinding });

    const unauthorizedPolicy = buildGovernancePolicyV2Unsigned({
      policyId: "governance_policy_fixture_deny_serverA",
      generatedAt,
      revocationList: { path: "governance/revocations.json", sha256: "0".repeat(64) },
      verificationReportSigners: [
        {
          subjectType: "JobProofBundle.v1",
          allowedScopes: ["global", "tenant"],
          allowedKeyIds: [keypairs.serverA.keyId],
          requireGoverned: true,
          requiredPurpose: "server"
        }
      ],
      bundleHeadAttestationSigners: [
        {
          subjectType: "JobProofBundle.v1",
          allowedScopes: ["global", "tenant"],
          allowedKeyIds: [keypairs.serverB.keyId],
          requireGoverned: true,
          requiredPurpose: "server"
        }
      ]
    });
    const unauthorized = buildJobProofBase({
      tenantId,
      jobId: "job_fixture_unauthorized",
      generatedAt,
      serverKeys: { ...serverKeys, signerA: serverKeys.signerA, signerB: { keyId: keypairs.serverB.keyId, privateKeyPem: keypairs.serverB.privateKeyPem } },
      govSigner,
      timeSigner,
      governancePolicy: unauthorizedPolicy,
      includeTimestampProof: false,
      toolVersion
    });
    const dirUnauthorized = path.join(outDir, "jobproof", "strict-fail-unauthorized-signer");
    await ensureEmptyDir(dirUnauthorized);
    writeFilesToDir({ files: unauthorized, outDir: dirUnauthorized });

    const revokedAt = "2026-02-02T00:00:00.000Z";
    const revokedList = {
      schemaVersion: "RevocationList.v1",
      listId: "revocations_fixture_v1",
      generatedAt,
      rotations: [],
      revocations: [{ keyId: keypairs.serverA.keyId, revokedAt, reason: "fixture", scope: null }],
      signerKeyId: null,
      signedAt: null,
      listHash: null,
      signature: null
    };
    const revokedAfter = buildJobProofBase({
      tenantId,
      jobId: "job_fixture_revoked_after",
      generatedAt: revokedAt,
      serverKeys: { ...serverKeys, signerA: serverKeys.signerA, signerB: { keyId: keypairs.serverB.keyId, privateKeyPem: keypairs.serverB.privateKeyPem } },
      govSigner,
      timeSigner,
      revocationList: revokedList,
      includeTimestampProof: true,
      toolVersion
    });
    const dirRevokedAfter = path.join(outDir, "jobproof", "strict-fail-revoked-at-or-after-with-timeproof");
    await ensureEmptyDir(dirRevokedAfter);
    writeFilesToDir({ files: revokedAfter, outDir: dirRevokedAfter });

    const revokedBeforeList = {
      ...revokedList,
      revocations: [{ keyId: keypairs.serverA.keyId, revokedAt: "2026-02-02T00:00:10.000Z", reason: "fixture", scope: null }]
    };
    const revokedNoProof = buildJobProofBase({
      tenantId,
      jobId: "job_fixture_revoked_before_noproof",
      generatedAt: "2026-02-02T00:00:01.000Z",
      serverKeys: { ...serverKeys, signerA: serverKeys.signerA, signerB: { keyId: keypairs.serverB.keyId, privateKeyPem: keypairs.serverB.privateKeyPem } },
      govSigner,
      timeSigner,
      revocationList: revokedBeforeList,
      includeTimestampProof: false,
      toolVersion
    });
    const dirRevokedNoProof = path.join(outDir, "jobproof", "strict-fail-revoked-before-without-timeproof");
    await ensureEmptyDir(dirRevokedNoProof);
    writeFilesToDir({ files: revokedNoProof, outDir: dirRevokedNoProof });
  }

  // MonthProof fixtures (standalone)
  const monthProof = buildMonthProofBase({
    tenantId,
    period: "2026-01",
    basis: "settledAt",
    generatedAt,
    serverKeys: { ...serverKeys, signerA: serverKeys.signerA, signerB: { keyId: keypairs.serverB.keyId, privateKeyPem: keypairs.serverB.privateKeyPem } },
    govSigner,
    timeSigner,
    includeTimestampProof: false,
    toolVersion
  });
  {
    const dir = path.join(outDir, "monthproof", "strict-pass");
    await ensureEmptyDir(dir);
    writeFilesToDir({ files: monthProof.files, outDir: dir });

    const missingReport = new Map(monthProof.files);
    missingReport.delete("verify/verification_report.json");
    const dirMissingStrict = path.join(outDir, "monthproof", "strict-fail-missing-verification-report");
    await ensureEmptyDir(dirMissingStrict);
    writeFilesToDir({ files: missingReport, outDir: dirMissingStrict });

    const dirMissingNonStrict = path.join(outDir, "monthproof", "nonstrict-pass-missing-verification-report");
    await ensureEmptyDir(dirMissingNonStrict);
    writeFilesToDir({ files: missingReport, outDir: dirMissingNonStrict });
  }

  // FinancePack fixtures (with embedded MonthProof)
  {
    const finance = buildFinancePackBase({ tenantId, period: "2026-01", createdAt: generatedAt, serverKeys, govSigner, monthProof });
    const dir = path.join(outDir, "financepack", "strict-pass");
    await ensureEmptyDir(dir);
    writeFilesToDir({ files: finance, outDir: dir });

    const missingReport = new Map(finance);
    missingReport.delete("verify/verification_report.json");
    const dirMissingNonStrict = path.join(outDir, "financepack", "nonstrict-pass-missing-verification-report");
    await ensureEmptyDir(dirMissingNonStrict);
    writeFilesToDir({ files: missingReport, outDir: dirMissingNonStrict });

    const financeToolUnknown = new Map(finance);
    const report = JSON.parse(new TextDecoder().decode(financeToolUnknown.get("verify/verification_report.json")));
    report.tool = { ...(report.tool ?? {}), version: null };
    // Recompute hash/signature as if the producer couldn't resolve a version.
    report.warnings = Array.isArray(report.warnings) ? [...report.warnings, { code: "TOOL_VERSION_UNKNOWN" }] : [{ code: "TOOL_VERSION_UNKNOWN" }];
    const core = (() => {
      const { reportHash: _h, signature: _sig, ...rest } = report;
      return rest;
    })();
    const reportHash = sha256Hex(canonicalJsonStringify(core));
    const signature = signHashHexEd25519(reportHash, serverKeys.serverA.privateKeyPem);
    financeToolUnknown.set("verify/verification_report.json", bytes(`${canonicalJsonStringify({ ...core, reportHash, signature })}\n`));
    const dirToolUnknown = path.join(outDir, "financepack", "pass-with-tool-version-unknown-warning");
    await ensureEmptyDir(dirToolUnknown);
    writeFilesToDir({ files: financeToolUnknown, outDir: dirToolUnknown });
  }

  // Trust anchors used by strict-mode fixture tests (out-of-band).
  const trust = {
    governanceRoots: { [keypairs.govRoot.keyId]: keypairs.govRoot.publicKeyPem },
    timeAuthorities: { [keypairs.timeAuthority.keyId]: keypairs.timeAuthority.publicKeyPem }
  };
  await fs.writeFile(path.join(outDir, "trust.json"), `${JSON.stringify(trust, null, 2)}\n`, "utf8");
}

await main();
