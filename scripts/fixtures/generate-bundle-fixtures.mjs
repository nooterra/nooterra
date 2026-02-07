import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify } from "../../src/core/canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "../../src/core/crypto.js";
import { computeArtifactHash } from "../../src/core/artifacts.js";
import { createChainedEvent, appendChainedEvent } from "../../src/core/event-chain.js";
import { buildJobProofBundleV1, buildMonthProofBundleV1 } from "../../src/core/proof-bundle.js";
import { buildFinancePackBundleV1 } from "../../src/core/finance-pack-bundle.js";
import { buildInvoiceBundleV1 } from "../../src/core/invoice-bundle.js";
import { buildClosePackBundleV1 } from "../../src/core/close-pack-bundle.js";
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

async function prepareOutDir(outDir) {
  await fs.mkdir(outDir, { recursive: true });
  await ensureEmptyDir(path.join(outDir, "jobproof"));
  await ensureEmptyDir(path.join(outDir, "monthproof"));
  await ensureEmptyDir(path.join(outDir, "financepack"));
  await ensureEmptyDir(path.join(outDir, "invoicebundle"));
  await ensureEmptyDir(path.join(outDir, "closepack"));
  await fs.rm(path.join(outDir, "trust.json"), { force: true });
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
  toolVersion,
  toolCommit
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
    toolCommit: toolCommit ?? null,
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
  toolVersion,
  toolCommit
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
    toolCommit: toolCommit ?? null,
    requireHeadAttestation: true,
    generatedAt
  });

  return { files, bundle };
}

function buildFinancePackBase({ tenantId, period, createdAt, serverKeys, govSigner, monthProof, toolCommit }) {
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
    toolVersion: "0.0.0-fixture",
    toolCommit: toolCommit ?? null
  });

  return files;
}

function buildInvoiceBundleBase({
  tenantId,
  invoiceId,
  createdAt,
  serverKeys,
  govSigner,
  jobProofFiles,
  toolCommit,
  pricingMatrix,
  meteringReport,
  invoiceClaim,
  pricingMatrixSigners = null,
  pricingMatrixSignaturesOverride = undefined
}) {
  const jobManifest = JSON.parse(new TextDecoder().decode(jobProofFiles.get("manifest.json")));
  const jobAtt = JSON.parse(new TextDecoder().decode(jobProofFiles.get("attestation/bundle_head_attestation.json")));
  const jobProofBundle = { manifestHash: String(jobManifest?.manifestHash ?? "") };

  const { files } = buildInvoiceBundleV1({
    tenantId,
    invoiceId,
    protocol: "1.0",
    createdAt,
    governancePolicySigner: govSigner,
    pricingMatrixSigners,
    pricingMatrixSignaturesOverride,
    jobProofBundle,
    jobProofFiles,
    requireJobProofAttestation: true,
    requireHeadAttestation: true,
    manifestSigner: serverKeys.signerA,
    verificationReportSigner: serverKeys.signerA,
    toolVersion: "0.0.0-fixture",
    toolCommit: toolCommit ?? null,
    pricingMatrix,
    meteringReport,
    invoiceClaim:
      invoiceClaim ??
      null
  });

  // Ensure caller can construct binding objects without re-parsing.
  return { files, jobProof: { embeddedPath: "payload/job_proof_bundle", manifestHash: jobManifest.manifestHash, headAttestationHash: jobAtt.attestationHash } };
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

  await prepareOutDir(outDir);

  const tenantId = "tenant_fixture";
  const generatedAt = "2026-02-02T00:00:00.000Z";
  const toolVersion = "0.0.0-fixture";
  const toolCommit = "0123456789abcdef0123456789abcdef01234567";

  let jobProofStrictPass = null;

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
      toolVersion,
      toolCommit
    });
    jobProofStrictPass = base;
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
      toolVersion,
      toolCommit
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
      toolVersion,
      toolCommit
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
      toolVersion,
      toolCommit
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
    toolVersion,
    toolCommit
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

    const tamper = new Map(monthProof.files);
    const eventsRaw = new TextDecoder().decode(tamper.get("events/events.jsonl"));
    tamper.set("events/events.jsonl", bytes(`${eventsRaw}\n`));
    const dirTamper = path.join(outDir, "monthproof", "strict-fail-manifest-tamper");
    await ensureEmptyDir(dirTamper);
    writeFilesToDir({ files: tamper, outDir: dirTamper });

    const unauthorizedPolicy = buildGovernancePolicyV2Unsigned({
      policyId: "governance_policy_fixture_deny_month_serverA",
      generatedAt,
      revocationList: { path: "governance/revocations.json", sha256: "0".repeat(64) },
      verificationReportSigners: [
        {
          subjectType: "MonthProofBundle.v1",
          allowedScopes: ["global", "tenant"],
          allowedKeyIds: [keypairs.serverA.keyId],
          requireGoverned: true,
          requiredPurpose: "server"
        }
      ],
      bundleHeadAttestationSigners: [
        {
          subjectType: "MonthProofBundle.v1",
          allowedScopes: ["global", "tenant"],
          allowedKeyIds: [keypairs.serverB.keyId],
          requireGoverned: true,
          requiredPurpose: "server"
        }
      ]
    });
    const monthUnauthorized = buildMonthProofBase({
      tenantId,
      period: "2026-01",
      basis: "settledAt",
      generatedAt,
      serverKeys: { ...serverKeys, signerA: serverKeys.signerA, signerB: { keyId: keypairs.serverB.keyId, privateKeyPem: keypairs.serverB.privateKeyPem } },
      govSigner,
      timeSigner,
      governancePolicy: unauthorizedPolicy,
      includeTimestampProof: false,
      toolVersion,
      toolCommit
    });
    const dirUnauthorized = path.join(outDir, "monthproof", "strict-fail-unauthorized-signer");
    await ensureEmptyDir(dirUnauthorized);
    writeFilesToDir({ files: monthUnauthorized.files, outDir: dirUnauthorized });
  }

  // FinancePack fixtures (with embedded MonthProof)
  {
    const finance = buildFinancePackBase({ tenantId, period: "2026-01", createdAt: generatedAt, serverKeys, govSigner, monthProof, toolCommit });
    const dir = path.join(outDir, "financepack", "strict-pass");
    await ensureEmptyDir(dir);
    writeFilesToDir({ files: finance, outDir: dir });

    const missingReport = new Map(finance);
    missingReport.delete("verify/verification_report.json");
    const dirMissingStrict = path.join(outDir, "financepack", "strict-fail-missing-verification-report");
    await ensureEmptyDir(dirMissingStrict);
    writeFilesToDir({ files: missingReport, outDir: dirMissingStrict });

    const dirMissingNonStrict = path.join(outDir, "financepack", "nonstrict-pass-missing-verification-report");
    await ensureEmptyDir(dirMissingNonStrict);
    writeFilesToDir({ files: missingReport, outDir: dirMissingNonStrict });

    const tamper = new Map(finance);
    const reconcileRaw = new TextDecoder().decode(tamper.get("finance/reconcile.json"));
    tamper.set("finance/reconcile.json", bytes(`${reconcileRaw}\n`));
    const dirTamper = path.join(outDir, "financepack", "strict-fail-manifest-tamper");
    await ensureEmptyDir(dirTamper);
    writeFilesToDir({ files: tamper, outDir: dirTamper });

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

    const financeCommitUnknown = new Map(finance);
    const commitUnknownReport = JSON.parse(new TextDecoder().decode(financeCommitUnknown.get("verify/verification_report.json")));
    if (commitUnknownReport.tool && typeof commitUnknownReport.tool === "object") {
      // Optional fields should be omitted when absent.
      delete commitUnknownReport.tool.commit;
    }
    commitUnknownReport.warnings = Array.isArray(commitUnknownReport.warnings)
      ? [...commitUnknownReport.warnings, { code: "TOOL_COMMIT_UNKNOWN" }]
      : [{ code: "TOOL_COMMIT_UNKNOWN" }];
    const commitUnknownCore = (() => {
      const { reportHash: _h, signature: _sig, ...rest } = commitUnknownReport;
      return rest;
    })();
    const commitUnknownHash = sha256Hex(canonicalJsonStringify(commitUnknownCore));
    const commitUnknownSig = signHashHexEd25519(commitUnknownHash, serverKeys.serverA.privateKeyPem);
    financeCommitUnknown.set(
      "verify/verification_report.json",
      bytes(`${canonicalJsonStringify({ ...commitUnknownCore, reportHash: commitUnknownHash, signature: commitUnknownSig })}\n`)
    );
    const dirCommitUnknown = path.join(outDir, "financepack", "pass-with-tool-commit-unknown-warning");
    await ensureEmptyDir(dirCommitUnknown);
    writeFilesToDir({ files: financeCommitUnknown, outDir: dirCommitUnknown });
  }

  // InvoiceBundle fixtures (with embedded JobProof)
  {
    if (!(jobProofStrictPass instanceof Map)) throw new Error("jobProofStrictPass not captured");
    const invoiceId = "invoice_fixture_1";
    const pricingMatrix = {
      currency: "USD",
      prices: [{ code: "WORK_MINUTES", unitPriceCents: "150" }]
    };
    const evidenceSha = sha256Hex(jobProofStrictPass.get("job/snapshot.json"));
    const meteringReport = {
      generatedAt,
      items: [{ code: "WORK_MINUTES", quantity: "10" }],
      evidenceRefs: [{ path: "job/snapshot.json", sha256: evidenceSha }]
    };

    const pass = buildInvoiceBundleBase({
      tenantId,
      invoiceId,
      createdAt: generatedAt,
      serverKeys,
      govSigner,
      jobProofFiles: jobProofStrictPass,
      toolCommit,
      pricingMatrix,
      meteringReport
    });
    const dir = path.join(outDir, "invoicebundle", "strict-pass");
    await ensureEmptyDir(dir);
    writeFilesToDir({ files: pass.files, outDir: dir });

    const missingReport = new Map(pass.files);
    missingReport.delete("verify/verification_report.json");
    const dirMissingStrict = path.join(outDir, "invoicebundle", "strict-fail-missing-verification-report");
    await ensureEmptyDir(dirMissingStrict);
    writeFilesToDir({ files: missingReport, outDir: dirMissingStrict });
    const dirMissingNonStrict = path.join(outDir, "invoicebundle", "nonstrict-pass-missing-verification-report");
    await ensureEmptyDir(dirMissingNonStrict);
    writeFilesToDir({ files: missingReport, outDir: dirMissingNonStrict });

    const wrongTotal = buildInvoiceBundleBase({
      tenantId,
      invoiceId: "invoice_fixture_wrong_total",
      createdAt: generatedAt,
      serverKeys,
      govSigner,
      jobProofFiles: jobProofStrictPass,
      toolCommit,
      pricingMatrix,
      meteringReport,
      invoiceClaim: {
        schemaVersion: "InvoiceClaim.v1",
        tenantId,
        invoiceId: "invoice_fixture_wrong_total",
        createdAt: generatedAt,
        currency: "USD",
        jobProof: pass.jobProof,
        totalCents: "999999"
      }
    });
    const dirWrongTotal = path.join(outDir, "invoicebundle", "strict-fail-invoice-total-mismatch");
    await ensureEmptyDir(dirWrongTotal);
    writeFilesToDir({ files: wrongTotal.files, outDir: dirWrongTotal });

    const badEvidence = buildInvoiceBundleBase({
      tenantId,
      invoiceId: "invoice_fixture_bad_evidence",
      createdAt: generatedAt,
      serverKeys,
      govSigner,
      jobProofFiles: jobProofStrictPass,
      toolCommit,
      pricingMatrix,
      meteringReport: { ...meteringReport, evidenceRefs: [{ path: "job/snapshot.json", sha256: "0".repeat(64) }] }
    });
    const dirBadEvidence = path.join(outDir, "invoicebundle", "strict-fail-evidence-sha-mismatch");
    await ensureEmptyDir(dirBadEvidence);
    writeFilesToDir({ files: badEvidence.files, outDir: dirBadEvidence });

    const unknownPricing = buildInvoiceBundleBase({
      tenantId,
      invoiceId: "invoice_fixture_unknown_pricing",
      createdAt: generatedAt,
      serverKeys,
      govSigner,
      jobProofFiles: jobProofStrictPass,
      toolCommit,
      pricingMatrix,
      meteringReport: { ...meteringReport, items: [{ code: "UNKNOWN_CODE", quantity: "1" }] },
      invoiceClaim: {
        schemaVersion: "InvoiceClaim.v1",
        tenantId,
        invoiceId: "invoice_fixture_unknown_pricing",
        createdAt: generatedAt,
        currency: "USD",
        jobProof: pass.jobProof,
        totalCents: "0"
      }
    });
    const dirUnknownPricing = path.join(outDir, "invoicebundle", "strict-fail-pricing-code-unknown");
    await ensureEmptyDir(dirUnknownPricing);
    writeFilesToDir({ files: unknownPricing.files, outDir: dirUnknownPricing });

    const unsigned = buildInvoiceBundleBase({
      tenantId,
      invoiceId: "invoice_fixture_unsigned_matrix",
      createdAt: generatedAt,
      serverKeys,
      govSigner,
      jobProofFiles: jobProofStrictPass,
      toolCommit,
      pricingMatrix,
      meteringReport,
      pricingMatrixSigners: []
    });
    const dirUnsignedStrict = path.join(outDir, "invoicebundle", "strict-fail-missing-pricing-matrix-signature");
    await ensureEmptyDir(dirUnsignedStrict);
    writeFilesToDir({ files: unsigned.files, outDir: dirUnsignedStrict });
    const dirUnsignedNonStrict = path.join(outDir, "invoicebundle", "nonstrict-pass-unsigned-pricing-matrix-warning");
    await ensureEmptyDir(dirUnsignedNonStrict);
    writeFilesToDir({ files: unsigned.files, outDir: dirUnsignedNonStrict });

    const invalidSig = buildInvoiceBundleBase({
      tenantId,
      invoiceId: "invoice_fixture_invalid_matrix_sig",
      createdAt: generatedAt,
      serverKeys,
      govSigner,
      jobProofFiles: jobProofStrictPass,
      toolCommit,
      pricingMatrix,
      meteringReport,
      pricingMatrixSigners: [
        // Claim the buyer's keyId but sign with the wrong private key to force signature verification failure.
        { keyId: keypairs.govRoot.keyId, privateKeyPem: keypairs.serverA.privateKeyPem }
      ]
    });
    const dirInvalidSig = path.join(outDir, "invoicebundle", "strict-fail-invalid-pricing-matrix-signature");
    await ensureEmptyDir(dirInvalidSig);
    writeFilesToDir({ files: invalidSig.files, outDir: dirInvalidSig });

    // PricingMatrix signature payload mismatch (integrity-valid): pricing matrix altered but signature surface binds to the old canonical hash.
    const passPricingSig = JSON.parse(new TextDecoder().decode(pass.files.get("pricing/pricing_matrix_signatures.json")));
    const pricingAltered = buildInvoiceBundleBase({
      tenantId,
      invoiceId: "invoice_fixture_pricing_altered",
      createdAt: generatedAt,
      serverKeys,
      govSigner,
      jobProofFiles: jobProofStrictPass,
      toolCommit,
      pricingMatrix: { currency: "USD", prices: [{ code: "WORK_MINUTES", unitPriceCents: "151" }] },
      meteringReport,
      pricingMatrixSigners: [],
      pricingMatrixSignaturesOverride: passPricingSig
    });
    const dirPricingAltered = path.join(outDir, "invoicebundle", "strict-fail-pricing-altered");
    await ensureEmptyDir(dirPricingAltered);
    writeFilesToDir({ files: pricingAltered.files, outDir: dirPricingAltered });

    // ClosePack fixtures (wrap InvoiceBundle)
    {
      const invoiceManifest = JSON.parse(new TextDecoder().decode(pass.files.get("manifest.json")));
      const invoiceBundle = { manifestHash: String(invoiceManifest?.manifestHash ?? "") };
      const closePack = buildClosePackBundleV1({
        tenantId,
        invoiceId,
        protocol: "1.0",
        createdAt: generatedAt,
        governancePolicySigner: govSigner,
        invoiceBundle,
        invoiceBundleFiles: pass.files,
        requireInvoiceAttestation: true,
        requireHeadAttestation: true,
        manifestSigner: serverKeys.signerA,
        verificationReportSigner: serverKeys.signerA,
        toolVersion,
        toolCommit
      });

      const dirClosePass = path.join(outDir, "closepack", "strict-pass");
      await ensureEmptyDir(dirClosePass);
      writeFilesToDir({ files: closePack.files, outDir: dirClosePass });

      const evidenceJson = JSON.parse(new TextDecoder().decode(closePack.files.get("evidence/evidence_index.json")));
      const badEvidence = evidenceJson && typeof evidenceJson === "object" ? { ...evidenceJson } : { schemaVersion: "EvidenceIndex.v1", generatedAt, jobProof: {}, items: [] };
      badEvidence.items = Array.isArray(badEvidence.items) ? badEvidence.items.map((x) => x) : [];
      if (badEvidence.items.length) {
        const first = badEvidence.items[0];
        if (first && typeof first === "object") badEvidence.items[0] = { ...first, key: `${String(first.key ?? "")}_tampered` };
        else badEvidence.items[0] = { key: "tampered", source: "metering_evidence_ref" };
      } else {
        badEvidence.items = [{ key: "tampered", source: "metering_evidence_ref" }];
      }
      const closePackEvidenceMismatch = buildClosePackBundleV1({
        tenantId,
        invoiceId,
        protocol: "1.0",
        createdAt: generatedAt,
        governancePolicySigner: govSigner,
        invoiceBundle,
        invoiceBundleFiles: pass.files,
        requireInvoiceAttestation: true,
        requireHeadAttestation: true,
        manifestSigner: serverKeys.signerA,
        verificationReportSigner: serverKeys.signerA,
        toolVersion,
        toolCommit,
        evidenceIndexOverride: badEvidence
      });
      const dirEvidenceMismatch = path.join(outDir, "closepack", "strict-fail-evidence-index-mismatch");
      await ensureEmptyDir(dirEvidenceMismatch);
      writeFilesToDir({ files: closePackEvidenceMismatch.files, outDir: dirEvidenceMismatch });

      const invoiceFailManifest = JSON.parse(new TextDecoder().decode(wrongTotal.files.get("manifest.json")));
      const invoiceFailBundle = { manifestHash: String(invoiceFailManifest?.manifestHash ?? "") };
      const closeWithBadInvoice = buildClosePackBundleV1({
        tenantId,
        invoiceId: "invoice_fixture_wrong_total",
        protocol: "1.0",
        createdAt: generatedAt,
        governancePolicySigner: govSigner,
        invoiceBundle: invoiceFailBundle,
        invoiceBundleFiles: wrongTotal.files,
        requireInvoiceAttestation: true,
        requireHeadAttestation: true,
        manifestSigner: serverKeys.signerA,
        verificationReportSigner: serverKeys.signerA,
        toolVersion,
        toolCommit
      });
      const dirBadInvoice = path.join(outDir, "closepack", "strict-fail-embedded-invoice-fails");
      await ensureEmptyDir(dirBadInvoice);
      writeFilesToDir({ files: closeWithBadInvoice.files, outDir: dirBadInvoice });

      const closePackNoSlaAcceptance = buildClosePackBundleV1({
        tenantId,
        invoiceId,
        protocol: "1.0",
        createdAt: generatedAt,
        governancePolicySigner: govSigner,
        invoiceBundle,
        invoiceBundleFiles: pass.files,
        requireInvoiceAttestation: true,
        requireHeadAttestation: true,
        manifestSigner: serverKeys.signerA,
        verificationReportSigner: serverKeys.signerA,
        toolVersion,
        toolCommit,
        includeSlaSurfaces: false,
        includeAcceptanceSurfaces: false
      });
      const dirMissingSlaAcceptance = path.join(outDir, "closepack", "nonstrict-pass-missing-sla-acceptance");
      await ensureEmptyDir(dirMissingSlaAcceptance);
      writeFilesToDir({ files: closePackNoSlaAcceptance.files, outDir: dirMissingSlaAcceptance });
    }
  }

  // Trust anchors used by strict-mode fixture tests (out-of-band).
  const trust = {
    governanceRoots: { [keypairs.govRoot.keyId]: keypairs.govRoot.publicKeyPem },
    pricingSigners: { [keypairs.govRoot.keyId]: keypairs.govRoot.publicKeyPem },
    timeAuthorities: { [keypairs.timeAuthority.keyId]: keypairs.timeAuthority.publicKeyPem }
  };
  await fs.writeFile(path.join(outDir, "trust.json"), `${JSON.stringify(trust, null, 2)}\n`, "utf8");
}

await main();
