import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { createChainedEvent, appendChainedEvent } from "./core/event-chain.js";
import { buildJobProofBundleV1, buildMonthProofBundleV1, buildBundleHeadAttestationV1Unsigned, buildVerificationReportV1ForProofBundle } from "./core/proof-bundle.js";
import { buildFinancePackBundleV1, buildBundleHeadAttestationV1Unsigned as buildFinancePackHeadAttestationUnsigned, buildVerificationReportV1 as buildFinancePackVerificationReportV1 } from "./core/finance-pack-bundle.js";
import { buildInvoiceBundleV1, buildBundleHeadAttestationV1Unsigned as buildInvoiceHeadAttestationUnsigned, buildVerificationReportV1 as buildInvoiceVerificationReportV1 } from "./core/invoice-bundle.js";
import { buildClosePackBundleV1, buildClosePackHeadAttestationV1Unsigned as buildClosePackHeadAttestationUnsigned, buildClosePackVerificationReportV1 as buildClosePackVerificationReportV1 } from "./core/close-pack-bundle.js";
import { canonicalJsonStringify } from "./core/canonical-json.js";
import { computeArtifactHash } from "./core/artifacts.js";
import { sha256Hex } from "./core/crypto.js";
import { buildGovernancePolicyV2Unsigned, validateGovernancePolicyV2 } from "./core/governance-policy.js";
import { buildRevocationListV1Core, validateRevocationListV1 } from "./core/revocation-list.js";

import { readToolCommitBestEffort, normalizeCommitSha } from "./tool-provenance.js";
import { createSigner } from "./signer/provider.js";
import { createLocalSignerProvider, loadKeypairsJsonFromFile } from "./signer/local.js";
import { SIGNING_PURPOSE } from "./signer/purposes.js";
import { createRemoteSignerClient } from "./signer/remote-client.js";
import { loadSignerPlugin } from "./signer/plugin-loader.js";

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

async function readJsonFile(fp) {
  const raw = await fs.readFile(fp, "utf8");
  return JSON.parse(raw);
}

export async function readKeypairsFile(keysPath) {
  assertNonEmptyString(keysPath, "keysPath");
  const abs = path.resolve(process.cwd(), keysPath);
  const json = await readJsonFile(abs);
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new TypeError("keys file must be a JSON object");
  return json;
}

async function ensureEmptyDir({ dir, force }) {
  const abs = path.resolve(process.cwd(), dir);
  try {
    const st = await fs.stat(abs);
    if (!st.isDirectory()) throw new Error(`${dir} exists and is not a directory`);
    const entries = await fs.readdir(abs);
    if (entries.length === 0) return abs;
    if (!force) throw new Error(`${dir} is not empty (use --force to overwrite)`);
    await fs.rm(abs, { recursive: true, force: true });
  } catch {
    // doesn't exist
  }
  await fs.mkdir(abs, { recursive: true });
  return abs;
}

async function writeFilesToDirSorted({ files, outDir }) {
  const entries = Array.from(files.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [name, content] of entries) {
    const fp = path.join(outDir, name);
    // eslint-disable-next-line no-await-in-loop
    await fs.mkdir(path.dirname(fp), { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(fp, content);
  }
}

function signerFromKeypair(keypair, label) {
  if (!keypair || typeof keypair !== "object") throw new TypeError(`${label} keypair is required`);
  const keyId = typeof keypair.keyId === "string" && keypair.keyId.trim() ? keypair.keyId : null;
  const privateKeyPem = typeof keypair.privateKeyPem === "string" && keypair.privateKeyPem.trim() ? keypair.privateKeyPem : null;
  const publicKeyPem = typeof keypair.publicKeyPem === "string" && keypair.publicKeyPem.trim() ? keypair.publicKeyPem : null;
  if (!keyId || !privateKeyPem || !publicKeyPem) throw new TypeError(`${label} keypair must include keyId/publicKeyPem/privateKeyPem`);
  return { keyId, privateKeyPem, publicKeyPem };
}

function keyIdFromKeypairsJson(keypairsJson, label) {
  const kp = keypairsJson?.[label] ?? null;
  const keyId = typeof kp?.keyId === "string" && kp.keyId.trim() ? kp.keyId : null;
  if (!keyId) {
    const err = new Error(`missing ${label}.keyId in keypairs.json`);
    err.code = "KEYPAIRS_MISSING_KEY";
    throw err;
  }
  return keyId;
}

function buildMinimalGovernanceEvents({ tenantId, serverSigner, now }) {
  // Minimal governance stream: register server signer key so GovernancePolicy.v2 can require it as "governed".
  let governanceEvents = [];
  governanceEvents = appendChainedEvent({
    events: governanceEvents,
    signer: serverSigner,
    event: createChainedEvent({
      id: "evt_gov_server_registered",
      streamId: "governance",
      type: "SERVER_SIGNER_KEY_REGISTERED",
      at: now,
      actor: { type: "system", id: "settld-produce" },
      payload: {
        tenantId,
        keyId: serverSigner.keyId,
        publicKeyPem: serverSigner.publicKeyPem,
        registeredAt: now,
        reason: "producer bootstrap"
      }
    })
  });
  return governanceEvents;
}

function buildMinimalJobEvents({ jobId, now, serverSigner }) {
  let jobEvents = [];
  jobEvents = appendChainedEvent({
    events: jobEvents,
    signer: serverSigner,
    event: createChainedEvent({
      id: "evt_job_created",
      streamId: jobId,
      type: "JOB_CREATED",
      at: now,
      actor: { type: "system", id: "settld-produce" },
      payload: { jobId }
    })
  });
  return jobEvents;
}

function buildMinimalMonthEvents({ monthStreamId, tenantId, period, basis, now, serverSigner }) {
  let monthEvents = [];
  monthEvents = appendChainedEvent({
    events: monthEvents,
    signer: serverSigner,
    event: createChainedEvent({
      id: "evt_month_close_requested",
      streamId: monthStreamId,
      type: "MONTH_CLOSE_REQUESTED",
      at: now,
      actor: { type: "system", id: "settld-produce" },
      payload: { tenantId, month: period, basis, requestedAt: now }
    })
  });
  return monthEvents;
}

function toolIdentityForReports({ toolVersion, toolCommit, packageVersion }) {
  const version = typeof toolVersion === "string" && toolVersion.trim() ? toolVersion.trim() : packageVersion ?? null;
  const commit = normalizeCommitSha(toolCommit) ?? readToolCommitBestEffort() ?? null;
  return { version, commit };
}

function parseSignerArgsJsonArray(signerArgsJson) {
  if (signerArgsJson === null || signerArgsJson === undefined) return [];
  if (typeof signerArgsJson !== "string" || !signerArgsJson.trim()) return [];
  const parsed = JSON.parse(signerArgsJson);
  if (!Array.isArray(parsed)) throw new TypeError("--signer-args-json must be a JSON array");
  return parsed.map((v) => String(v));
}

function computeProofBundleHeads({ jobSnapshot, tenantGovernanceSnapshot, governanceSnapshot } = {}) {
  return {
    job: {
      lastEventId: jobSnapshot?.lastEventId ?? jobSnapshot?.lastEvent?.id ?? null,
      lastChainHash: jobSnapshot?.lastChainHash ?? jobSnapshot?.lastEvent?.chainHash ?? null
    },
    governance: {
      tenant: tenantGovernanceSnapshot ? { lastEventId: tenantGovernanceSnapshot.lastEventId ?? null, lastChainHash: tenantGovernanceSnapshot.lastChainHash ?? null } : null,
      global: governanceSnapshot ? { lastEventId: governanceSnapshot.lastEventId ?? null, lastChainHash: governanceSnapshot.lastChainHash ?? null } : null
    }
  };
}

async function signChainedEvents({ events, signerKeyId, client }) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  assertNonEmptyString(signerKeyId, "signerKeyId");
  if (!client || typeof client.sign !== "function") throw new TypeError("client.sign is required");

  const out = [];
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const payloadHash = typeof e.payloadHash === "string" ? e.payloadHash : null;
    if (!payloadHash) throw new Error("event missing payloadHash");
    // eslint-disable-next-line no-await-in-loop
    const { signatureBase64 } = await client.sign({
      keyId: signerKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(payloadHash, "hex"),
      purpose: SIGNING_PURPOSE.EVENT_PAYLOAD,
      context: { streamId: e.streamId ?? null, eventId: e.id ?? null, type: e.type ?? null }
    });
    out.push({ ...e, signature: signatureBase64, signerKeyId: signerKeyId });
  }
  return out;
}

async function buildSignedRevocationListV1({ generatedAt, signerKeyId, client }) {
  assertNonEmptyString(generatedAt, "generatedAt");
  assertNonEmptyString(signerKeyId, "signerKeyId");
  const listCore = buildRevocationListV1Core({
    listId: "revocations_default_v1",
    generatedAt,
    rotations: [],
    revocations: [],
    signerKeyId,
    signedAt: generatedAt
  });
  const listHash = sha256Hex(canonicalJsonStringify(listCore));
  const { signatureBase64 } = await client.sign({
    keyId: signerKeyId,
    algorithm: "ed25519",
    messageBytes: Buffer.from(listHash, "hex"),
    purpose: SIGNING_PURPOSE.REVOCATION_LIST,
    context: { listId: listCore.listId, schemaVersion: listCore.schemaVersion }
  });
  const signed = { ...listCore, listHash, signature: signatureBase64 };
  validateRevocationListV1(signed);
  return signed;
}

async function buildSignedGovernancePolicyV2({ generatedAt, signerKeyId, client, subjectType, serverKeyId, revocationListSha256 }) {
  assertNonEmptyString(generatedAt, "generatedAt");
  assertNonEmptyString(signerKeyId, "signerKeyId");
  assertNonEmptyString(serverKeyId, "serverKeyId");
  assertNonEmptyString(subjectType, "subjectType");
  assertNonEmptyString(revocationListSha256, "revocationListSha256");

  const unsigned = buildGovernancePolicyV2Unsigned({
    policyId: "governance_policy_default_v2",
    generatedAt,
    revocationList: { path: "governance/revocations.json", sha256: revocationListSha256 },
    verificationReportSigners: [
      {
        subjectType,
        allowedScopes: ["global", "tenant"],
        allowedKeyIds: [serverKeyId],
        requireGoverned: true,
        requiredPurpose: "server"
      }
    ],
    bundleHeadAttestationSigners: [
      {
        subjectType,
        allowedScopes: ["global", "tenant"],
        allowedKeyIds: [serverKeyId],
        requireGoverned: true,
        requiredPurpose: "server"
      }
    ]
  });

  const policyCore = { ...unsigned, signerKeyId, signedAt: generatedAt, policyHash: null, signature: null };
  const { policyHash: _h, signature: _sig, ...hashMaterial } = policyCore;
  const policyHash = sha256Hex(canonicalJsonStringify(hashMaterial));
  const { signatureBase64 } = await client.sign({
    keyId: signerKeyId,
    algorithm: "ed25519",
    messageBytes: Buffer.from(policyHash, "hex"),
    purpose: SIGNING_PURPOSE.GOVERNANCE_POLICY,
    context: { policyId: unsigned.policyId, schemaVersion: unsigned.schemaVersion }
  });
  const signed = { ...policyCore, policyHash, signature: signatureBase64 };
  validateGovernancePolicyV2(signed);
  return signed;
}

function createLocalSigning({ keysPath, govKeyId, serverKeyId }) {
  assertNonEmptyString(keysPath, "keysPath");
  const { json } = loadKeypairsJsonFromFile({ keysPath, enforcePerms: true });
  const provider = createLocalSignerProvider({ keypairsJson: json });
  const govId = govKeyId ?? keyIdFromKeypairsJson(json, "govRoot");
  const serverId = serverKeyId ?? keyIdFromKeypairsJson(json, "serverA");
  const govSigner = createSigner({ keyId: govId, provider });
  const serverSigner = createSigner({ keyId: serverId, provider });
  const govPublicKeyPem = provider.getPublicKeyPem({ keyId: govId });
  const serverPublicKeyPem = provider.getPublicKeyPem({ keyId: serverId });
  return { govSigner, serverSigner, govPublicKeyPem, serverPublicKeyPem };
}

async function createRemoteSigning({
  signerUrl,
  signerCommand,
  signerArgsJson,
  signerAuth,
  signerTokenEnv,
  signerTokenFile,
  signerHeaders,
  govKeyId,
  serverKeyId
}) {
  const haveUrl = typeof signerUrl === "string" && signerUrl.trim();
  const haveCmd = typeof signerCommand === "string" && signerCommand.trim();
  if (haveUrl === haveCmd) throw new TypeError("remote signing requires exactly one of --signer-url or --signer-command");
  assertNonEmptyString(govKeyId, "govKeyId");
  assertNonEmptyString(serverKeyId, "serverKeyId");
  const client = createRemoteSignerClient({
    url: haveUrl ? signerUrl : null,
    command: haveCmd ? signerCommand : null,
    args: haveCmd ? parseSignerArgsJsonArray(signerArgsJson) : [],
    auth: haveUrl ? signerAuth : null,
    tokenEnv: haveUrl ? signerTokenEnv : null,
    tokenFile: haveUrl ? signerTokenFile : null,
    headers: haveUrl ? signerHeaders : []
  });
  const govPublicKeyPem = await client.getPublicKeyPem({ keyId: govKeyId });
  const serverPublicKeyPem = await client.getPublicKeyPem({ keyId: serverKeyId });
  return { client, govPublicKeyPem, serverPublicKeyPem };
}

async function createPluginSigning({ signerPlugin, signerPluginExport, signerPluginConfig, govKeyId, serverKeyId }) {
  assertNonEmptyString(signerPlugin, "signerPlugin");
  assertNonEmptyString(govKeyId, "govKeyId");
  assertNonEmptyString(serverKeyId, "serverKeyId");
  const provider = await loadSignerPlugin({
    spec: signerPlugin,
    exportName: signerPluginExport ?? "createSignerProvider",
    configPath: signerPluginConfig ?? null
  });
  const govPublicKeyPem = await provider.getPublicKeyPem({ keyId: govKeyId });
  const serverPublicKeyPem = await provider.getPublicKeyPem({ keyId: serverKeyId });
  return { client: provider, govPublicKeyPem, serverPublicKeyPem };
}

export async function produceJobProofBundle({
  outDir,
  force = false,
  keys,
  signerMode = "local",
  signerUrl = null,
  signerCommand = null,
  signerArgsJson = null,
  signerAuth = null,
  signerTokenEnv = null,
  signerTokenFile = null,
  signerHeaders = [],
  signerPlugin = null,
  signerPluginExport = null,
  signerPluginConfig = null,
  govKeyId = null,
  serverKeyId = null,
  tenantId = "tenant_default",
  jobId = "job_default",
  now,
  toolVersion = null,
  toolCommit = null,
  packageVersion = null
} = {}) {
  assertNonEmptyString(outDir, "outDir");
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(jobId, "jobId");
  assertNonEmptyString(now, "now");

  let govSigner = null;
  let serverSigner = null;
  let publicKeyByKeyId = new Map();
  let governanceEvents;
  let jobEvents;
  let revocationList = null;
  let governancePolicy = null;
  let remoteClient = null;

  if (signerMode === "local") {
    const local = createLocalSigning({ keysPath: typeof keys === "string" ? keys : null, govKeyId, serverKeyId });
    govSigner = local.govSigner;
    serverSigner = local.serverSigner;
    publicKeyByKeyId = new Map([
      [local.govSigner.keyId, local.govPublicKeyPem],
      [local.serverSigner.keyId, local.serverPublicKeyPem]
    ]);
    governanceEvents = buildMinimalGovernanceEvents({ tenantId, serverSigner, now });
    jobEvents = buildMinimalJobEvents({ jobId, now, serverSigner });
  } else if (signerMode === "remote") {
    const remote = await createRemoteSigning({
      signerUrl,
      signerCommand,
      signerArgsJson,
      signerAuth,
      signerTokenEnv,
      signerTokenFile,
      signerHeaders,
      govKeyId,
      serverKeyId
    });
    remoteClient = remote.client;
    publicKeyByKeyId = new Map([
      [govKeyId, remote.govPublicKeyPem],
      [serverKeyId, remote.serverPublicKeyPem]
    ]);
    // Stage 1: build deterministic event chain material, then sign event payloads via remote signer.
    const chainSigner = { keyId: serverKeyId };
    governanceEvents = await signChainedEvents({
      events: buildMinimalGovernanceEvents({ tenantId, serverSigner: chainSigner, now }),
      signerKeyId: serverKeyId,
      client: remoteClient
    });
    jobEvents = await signChainedEvents({
      events: buildMinimalJobEvents({ jobId, now, serverSigner: chainSigner }),
      signerKeyId: serverKeyId,
      client: remoteClient
    });

    // Stage 1: presign manifest-included governance files.
    revocationList = await buildSignedRevocationListV1({ generatedAt: now, signerKeyId: govKeyId, client: remoteClient });
    governancePolicy = await buildSignedGovernancePolicyV2({
      generatedAt: now,
      signerKeyId: govKeyId,
      client: remoteClient,
      subjectType: "JobProofBundle.v1",
      serverKeyId,
      revocationListSha256: revocationList.listHash
    });
  } else if (signerMode === "plugin") {
    const plugin = await createPluginSigning({ signerPlugin, signerPluginExport, signerPluginConfig, govKeyId, serverKeyId });
    remoteClient = plugin.client;
    publicKeyByKeyId = new Map([
      [govKeyId, plugin.govPublicKeyPem],
      [serverKeyId, plugin.serverPublicKeyPem]
    ]);
    const chainSigner = { keyId: serverKeyId };
    governanceEvents = await signChainedEvents({
      events: buildMinimalGovernanceEvents({ tenantId, serverSigner: chainSigner, now }),
      signerKeyId: serverKeyId,
      client: remoteClient
    });
    jobEvents = await signChainedEvents({
      events: buildMinimalJobEvents({ jobId, now, serverSigner: chainSigner }),
      signerKeyId: serverKeyId,
      client: remoteClient
    });
    revocationList = await buildSignedRevocationListV1({ generatedAt: now, signerKeyId: govKeyId, client: remoteClient });
    governancePolicy = await buildSignedGovernancePolicyV2({
      generatedAt: now,
      signerKeyId: govKeyId,
      client: remoteClient,
      subjectType: "JobProofBundle.v1",
      serverKeyId,
      revocationListSha256: revocationList.listHash
    });
  } else {
    const err = new Error("unsupported signer mode");
    err.code = "UNSUPPORTED_SIGNER_MODE";
    throw err;
  }

  const governanceSnapshot = { streamId: "governance", lastChainHash: governanceEvents.at(-1)?.chainHash ?? null, lastEventId: governanceEvents.at(-1)?.id ?? null };

  const jobSnapshot = { id: jobId, lastChainHash: jobEvents.at(-1)?.chainHash ?? null, lastEventId: jobEvents.at(-1)?.id ?? null };

  const tool = toolIdentityForReports({ toolVersion, toolCommit, packageVersion });

  const { files, bundle } = buildJobProofBundleV1({
    tenantId,
    jobId,
    jobEvents,
    jobSnapshot,
    governanceEvents,
    governanceSnapshot,
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot: { streamId: "governance", lastChainHash: null, lastEventId: null },
    governancePolicy,
    governancePolicySigner: signerMode === "local" ? govSigner : null,
    revocationList,
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys: [],
    manifestSigner: signerMode === "local" ? serverSigner : null,
    verificationReportSigner: signerMode === "local" ? serverSigner : null,
    timestampAuthoritySigner: null,
    toolVersion: tool.version,
    toolCommit: tool.commit,
    requireHeadAttestation: signerMode === "local",
    generatedAt: now
  });

  if (signerMode !== "local") {
    const heads = computeProofBundleHeads({ jobSnapshot, tenantGovernanceSnapshot: null, governanceSnapshot });
    const unsignedAtt = buildBundleHeadAttestationV1Unsigned({
      kind: "JobProofBundle.v1",
      tenantId,
      scope: { jobId },
      generatedAt: now,
      manifestHash: bundle?.manifestHash ?? null,
      heads,
      signerKeyId: serverKeyId,
      timestampAuthoritySigner: null
    });
    const { signatureBase64 } = await remoteClient.sign({
      keyId: serverKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(unsignedAtt.attestationHash, "hex"),
      purpose: SIGNING_PURPOSE.BUNDLE_HEAD_ATTESTATION,
      context: { kind: "JobProofBundle.v1", tenantId, scope: { jobId }, manifestHash: bundle?.manifestHash ?? null }
    });
    const att = { ...unsignedAtt, signature: signatureBase64 };
    files.set("attestation/bundle_head_attestation.json", new TextEncoder().encode(`${canonicalJsonStringify(att)}\n`));

    const vrUnsigned = buildVerificationReportV1ForProofBundle({
      kind: "JobProofBundle.v1",
      tenantId,
      scope: { jobId },
      generatedAt: now,
      manifestHash: bundle?.manifestHash ?? null,
      bundleHeadAttestation: att,
      signer: { keyId: serverKeyId, scope: "global" },
      timestampAuthoritySigner: null,
      bundleFiles: files,
      warnings: null,
      toolVersion: tool.version,
      toolCommit: tool.commit
    });
    const { signatureBase64: vrSig } = await remoteClient.sign({
      keyId: serverKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(vrUnsigned.reportHash, "hex"),
      purpose: SIGNING_PURPOSE.VERIFICATION_REPORT,
      context: { kind: "JobProofBundle.v1", tenantId, scope: { jobId } }
    });
    const vr = { ...vrUnsigned, signature: vrSig };
    files.set("verify/verification_report.json", new TextEncoder().encode(`${canonicalJsonStringify(vr)}\n`));
  }

  const absOut = await ensureEmptyDir({ dir: outDir, force });
  await writeFilesToDirSorted({ files, outDir: absOut });

  const headAtt = JSON.parse(new TextDecoder().decode(files.get("attestation/bundle_head_attestation.json") ?? new Uint8Array()));
  return {
    bundleDir: absOut,
    kind: "jobproof",
    tenantId,
    jobId,
    bundle,
    manifestHash: bundle?.manifestHash ?? null,
    attestationHash: headAtt?.attestationHash ?? null
  };
}

export async function produceMonthProofBundle({
  outDir,
  force = false,
  keys,
  signerMode = "local",
  signerUrl = null,
  signerCommand = null,
  signerArgsJson = null,
  signerAuth = null,
  signerTokenEnv = null,
  signerTokenFile = null,
  signerHeaders = [],
  signerPlugin = null,
  signerPluginExport = null,
  signerPluginConfig = null,
  govKeyId = null,
  serverKeyId = null,
  tenantId = "tenant_default",
  period = "1970-01",
  basis = "settledAt",
  now,
  toolVersion = null,
  toolCommit = null,
  packageVersion = null
} = {}) {
  assertNonEmptyString(outDir, "outDir");
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(period, "period");
  assertNonEmptyString(basis, "basis");
  assertNonEmptyString(now, "now");

  let govSigner = null;
  let serverSigner = null;
  let publicKeyByKeyId = new Map();
  let governanceEvents;
  let monthEvents;
  let revocationList = null;
  let governancePolicy = null;
  let remoteClient = null;

  if (signerMode === "local") {
    const local = createLocalSigning({ keysPath: typeof keys === "string" ? keys : null, govKeyId, serverKeyId });
    govSigner = local.govSigner;
    serverSigner = local.serverSigner;
    publicKeyByKeyId = new Map([
      [local.govSigner.keyId, local.govPublicKeyPem],
      [local.serverSigner.keyId, local.serverPublicKeyPem]
    ]);
    governanceEvents = buildMinimalGovernanceEvents({ tenantId, serverSigner, now });
  } else if (signerMode === "remote") {
    const remote = await createRemoteSigning({
      signerUrl,
      signerCommand,
      signerArgsJson,
      signerAuth,
      signerTokenEnv,
      signerTokenFile,
      signerHeaders,
      govKeyId,
      serverKeyId
    });
    remoteClient = remote.client;
    publicKeyByKeyId = new Map([
      [govKeyId, remote.govPublicKeyPem],
      [serverKeyId, remote.serverPublicKeyPem]
    ]);
    const chainSigner = { keyId: serverKeyId };
    governanceEvents = await signChainedEvents({
      events: buildMinimalGovernanceEvents({ tenantId, serverSigner: chainSigner, now }),
      signerKeyId: serverKeyId,
      client: remoteClient
    });
    revocationList = await buildSignedRevocationListV1({ generatedAt: now, signerKeyId: govKeyId, client: remoteClient });
    governancePolicy = await buildSignedGovernancePolicyV2({
      generatedAt: now,
      signerKeyId: govKeyId,
      client: remoteClient,
      subjectType: "MonthProofBundle.v1",
      serverKeyId,
      revocationListSha256: revocationList.listHash
    });
  } else if (signerMode === "plugin") {
    const plugin = await createPluginSigning({ signerPlugin, signerPluginExport, signerPluginConfig, govKeyId, serverKeyId });
    remoteClient = plugin.client;
    publicKeyByKeyId = new Map([
      [govKeyId, plugin.govPublicKeyPem],
      [serverKeyId, plugin.serverPublicKeyPem]
    ]);
    const chainSigner = { keyId: serverKeyId };
    governanceEvents = await signChainedEvents({
      events: buildMinimalGovernanceEvents({ tenantId, serverSigner: chainSigner, now }),
      signerKeyId: serverKeyId,
      client: remoteClient
    });
    revocationList = await buildSignedRevocationListV1({ generatedAt: now, signerKeyId: govKeyId, client: remoteClient });
    governancePolicy = await buildSignedGovernancePolicyV2({
      generatedAt: now,
      signerKeyId: govKeyId,
      client: remoteClient,
      subjectType: "MonthProofBundle.v1",
      serverKeyId,
      revocationListSha256: revocationList.listHash
    });
  } else {
    const err = new Error("unsupported signer mode");
    err.code = "UNSUPPORTED_SIGNER_MODE";
    throw err;
  }

  const governanceSnapshot = { streamId: "governance", lastChainHash: governanceEvents.at(-1)?.chainHash ?? null, lastEventId: governanceEvents.at(-1)?.id ?? null };

  const monthStreamId = `month_${tenantId}_${period}_${basis}`;
  if (signerMode === "local") {
    monthEvents = buildMinimalMonthEvents({ monthStreamId, tenantId, period, basis, now, serverSigner });
  } else {
    monthEvents = await signChainedEvents({
      events: buildMinimalMonthEvents({ monthStreamId, tenantId, period, basis, now, serverSigner: { keyId: serverKeyId } }),
      signerKeyId: serverKeyId,
      client: remoteClient
    });
  }

  const tool = toolIdentityForReports({ toolVersion, toolCommit, packageVersion });

  const { files, bundle } = buildMonthProofBundleV1({
    tenantId,
    period,
    basis,
    monthEvents,
    governanceEvents,
    governanceSnapshot,
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot: { streamId: "governance", lastChainHash: null, lastEventId: null },
    governancePolicy,
    governancePolicySigner: signerMode === "local" ? govSigner : null,
    revocationList,
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys: [],
    manifestSigner: signerMode === "local" ? serverSigner : null,
    verificationReportSigner: signerMode === "local" ? serverSigner : null,
    timestampAuthoritySigner: null,
    toolVersion: tool.version,
    toolCommit: tool.commit,
    requireHeadAttestation: signerMode === "local",
    generatedAt: now
  });

  if (signerMode !== "local") {
    const heads = {
      month: {
        lastEventId: monthEvents.at(-1)?.id ?? null,
        lastChainHash: monthEvents.at(-1)?.chainHash ?? null
      },
      governance: {
        tenant: null,
        global: governanceSnapshot ? { lastEventId: governanceSnapshot.lastEventId ?? null, lastChainHash: governanceSnapshot.lastChainHash ?? null } : null
      }
    };
    const unsignedAtt = buildBundleHeadAttestationV1Unsigned({
      kind: "MonthProofBundle.v1",
      tenantId,
      scope: { period, basis },
      generatedAt: now,
      manifestHash: bundle?.manifestHash ?? null,
      heads,
      signerKeyId: serverKeyId,
      timestampAuthoritySigner: null
    });
    const { signatureBase64 } = await remoteClient.sign({
      keyId: serverKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(unsignedAtt.attestationHash, "hex"),
      purpose: SIGNING_PURPOSE.BUNDLE_HEAD_ATTESTATION,
      context: { kind: "MonthProofBundle.v1", tenantId, scope: { period, basis }, manifestHash: bundle?.manifestHash ?? null }
    });
    const att = { ...unsignedAtt, signature: signatureBase64 };
    files.set("attestation/bundle_head_attestation.json", new TextEncoder().encode(`${canonicalJsonStringify(att)}\n`));

    const vrUnsigned = buildVerificationReportV1ForProofBundle({
      kind: "MonthProofBundle.v1",
      tenantId,
      scope: { period, basis },
      generatedAt: now,
      manifestHash: bundle?.manifestHash ?? null,
      bundleHeadAttestation: att,
      signer: { keyId: serverKeyId, scope: "global" },
      timestampAuthoritySigner: null,
      bundleFiles: files,
      warnings: null,
      toolVersion: tool.version,
      toolCommit: tool.commit
    });
    const { signatureBase64: vrSig } = await remoteClient.sign({
      keyId: serverKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(vrUnsigned.reportHash, "hex"),
      purpose: SIGNING_PURPOSE.VERIFICATION_REPORT,
      context: { kind: "MonthProofBundle.v1", tenantId, scope: { period, basis } }
    });
    const vr = { ...vrUnsigned, signature: vrSig };
    files.set("verify/verification_report.json", new TextEncoder().encode(`${canonicalJsonStringify(vr)}\n`));
  }

  const absOut = await ensureEmptyDir({ dir: outDir, force });
  await writeFilesToDirSorted({ files, outDir: absOut });

  const headAtt = JSON.parse(new TextDecoder().decode(files.get("attestation/bundle_head_attestation.json") ?? new Uint8Array()));
  return {
    bundleDir: absOut,
    kind: "monthproof",
    tenantId,
    period,
    basis,
    bundle,
    manifestHash: bundle?.manifestHash ?? null,
    attestationHash: headAtt?.attestationHash ?? null
  };
}

async function readFilesRecursive({ dir }) {
  const files = new Map();
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = path.relative(dir, full).split(path.sep).join("/");
      files.set(rel, new Uint8Array(await fs.readFile(full)));
    }
  }
  return files;
}

function buildMinimalGlBatchArtifact({ tenantId, period, basis }) {
  const core = {
    schemaVersion: "GLBatch.v1",
    artifactType: "GLBatch.v1",
    artifactId: "gl_batch_producer_bootstrap",
    tenantId,
    period,
    basis,
    batch: { lines: [] }
  };
  const artifactHash = computeArtifactHash(core);
  return { ...core, artifactHash };
}

function buildMinimalJournalCsvArtifact({ tenantId, period, basis }) {
  const csv = "a,b\n1,2\n";
  const core = {
    schemaVersion: "JournalCsv.v1",
    artifactType: "JournalCsv.v1",
    artifactId: "journal_csv_producer_bootstrap",
    tenantId,
    period,
    basis,
    csv,
    csvSha256: sha256Hex(csv),
    accountMapHash: "h_map_producer_bootstrap"
  };
  const artifactHash = computeArtifactHash(core);
  return { ...core, artifactHash };
}

export async function produceFinancePackBundle({
  outDir,
  force = false,
  keys,
  signerMode = "local",
  signerUrl = null,
  signerCommand = null,
  signerArgsJson = null,
  signerAuth = null,
  signerTokenEnv = null,
  signerTokenFile = null,
  signerHeaders = [],
  signerPlugin = null,
  signerPluginExport = null,
  signerPluginConfig = null,
  govKeyId = null,
  serverKeyId = null,
  tenantId = "tenant_default",
  period = "1970-01",
  protocol = "1.0",
  now,
  monthProofDir,
  toolVersion = null,
  toolCommit = null,
  packageVersion = null
} = {}) {
  assertNonEmptyString(outDir, "outDir");
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(period, "period");
  assertNonEmptyString(protocol, "protocol");
  assertNonEmptyString(now, "now");
  assertNonEmptyString(monthProofDir, "monthProofDir");

  let govSigner = null;
  let serverSigner = null;
  let remoteClient = null;
  let revocationList = null;
  let governancePolicy = null;

  if (signerMode === "local") {
    const local = createLocalSigning({ keysPath: typeof keys === "string" ? keys : null, govKeyId, serverKeyId });
    govSigner = local.govSigner;
    serverSigner = local.serverSigner;
  } else if (signerMode === "remote") {
    const remote = await createRemoteSigning({
      signerUrl,
      signerCommand,
      signerArgsJson,
      signerAuth,
      signerTokenEnv,
      signerTokenFile,
      signerHeaders,
      govKeyId,
      serverKeyId
    });
    remoteClient = remote.client;
    revocationList = await buildSignedRevocationListV1({ generatedAt: now, signerKeyId: govKeyId, client: remoteClient });
    governancePolicy = await buildSignedGovernancePolicyV2({
      generatedAt: now,
      signerKeyId: govKeyId,
      client: remoteClient,
      subjectType: "FinancePackBundle.v1",
      serverKeyId,
      revocationListSha256: revocationList.listHash
    });
  } else if (signerMode === "plugin") {
    const plugin = await createPluginSigning({ signerPlugin, signerPluginExport, signerPluginConfig, govKeyId, serverKeyId });
    remoteClient = plugin.client;
    revocationList = await buildSignedRevocationListV1({ generatedAt: now, signerKeyId: govKeyId, client: remoteClient });
    governancePolicy = await buildSignedGovernancePolicyV2({
      generatedAt: now,
      signerKeyId: govKeyId,
      client: remoteClient,
      subjectType: "FinancePackBundle.v1",
      serverKeyId,
      revocationListSha256: revocationList.listHash
    });
  } else {
    const err = new Error("unsupported signer mode");
    err.code = "UNSUPPORTED_SIGNER_MODE";
    throw err;
  }

  const monthAbs = path.resolve(process.cwd(), monthProofDir);
  const monthManifest = await readJsonFile(path.join(monthAbs, "manifest.json"));
  const monthProofBundle = { manifestHash: String(monthManifest?.manifestHash ?? "") };
  assertNonEmptyString(monthProofBundle.manifestHash, "monthProofBundle.manifestHash");
  const monthProofFiles = await readFilesRecursive({ dir: monthAbs });

  const glBatchArtifact = buildMinimalGlBatchArtifact({ tenantId, period, basis: "settledAt" });
  const journalCsvArtifact = buildMinimalJournalCsvArtifact({ tenantId, period, basis: "settledAt" });
  const reconcileReport = { ok: true, period, basis: "settledAt", entryCount: 0, totalsKeys: 0 };
  const reconcileReportBytes = new TextEncoder().encode(`${canonicalJsonStringify(reconcileReport)}\n`);

  const tool = toolIdentityForReports({ toolVersion, toolCommit, packageVersion });

  const { files, bundle } = buildFinancePackBundleV1({
    tenantId,
    period,
    protocol,
    createdAt: now,
    governancePolicy,
    governancePolicySigner: signerMode === "local" ? govSigner : null,
    revocationList,
    monthProofBundle,
    monthProofFiles,
    requireMonthProofAttestation: true,
    requireHeadAttestation: signerMode === "local",
    manifestSigner: signerMode === "local" ? serverSigner : null,
    verificationReportSigner: signerMode === "local" ? serverSigner : { keyId: serverKeyId, scope: "global" },
    timestampAuthoritySigner: null,
    verificationReportWarnings: null,
    toolVersion: tool.version,
    toolCommit: tool.commit,
    glBatchArtifact,
    journalCsvArtifact,
    reconcileReport,
    reconcileReportBytes
  });

  if (signerMode !== "local") {
    const manifestHash = bundle?.manifestHash ?? null;
    const monthAtt = JSON.parse(new TextDecoder().decode(monthProofFiles.get("attestation/bundle_head_attestation.json") ?? new Uint8Array()));
    const existingVr = JSON.parse(new TextDecoder().decode(files.get("verify/verification_report.json") ?? new Uint8Array()));
    const inputs = existingVr?.inputs ?? null;
    if (!inputs || typeof inputs !== "object") throw new Error("FinancePack verification report inputs missing");

    const unsignedHead = buildFinancePackHeadAttestationUnsigned({
      tenantId,
      period,
      createdAt: now,
      manifestHash,
      heads: {
        monthProof: {
          manifestHash: monthProofBundle.manifestHash,
          attestationHash: monthAtt?.attestationHash ?? null
        }
      },
      signerKeyId: serverKeyId,
      timestampAuthoritySigner: null
    });
    const { signatureBase64: headSig } = await remoteClient.sign({
      keyId: serverKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(unsignedHead.attestationHash, "hex"),
      purpose: SIGNING_PURPOSE.BUNDLE_HEAD_ATTESTATION,
      context: { kind: "FinancePackBundle.v1", tenantId, scope: { period }, manifestHash }
    });
    const headAtt = { ...unsignedHead, signature: headSig };
    files.set("attestation/bundle_head_attestation.json", new TextEncoder().encode(`${canonicalJsonStringify(headAtt)}\n`));

    const vrUnsigned = buildFinancePackVerificationReportV1({
      tenantId,
      period,
      createdAt: now,
      protocol,
      manifestHash,
      bundleHeadAttestation: headAtt,
      inputs,
      monthProofAttestation: {
        schemaVersion: monthAtt?.schemaVersion ?? null,
        signerKeyId: monthAtt?.signerKeyId ?? null,
        signedAt: monthAtt?.signedAt ?? null,
        attestationHash: monthAtt?.attestationHash ?? null,
        manifestHash: monthAtt?.manifestHash ?? null,
        heads: monthAtt?.heads ?? null
      },
      signer: { keyId: serverKeyId, scope: "global" },
      timestampAuthoritySigner: null,
      monthProofFiles,
      warnings: null,
      toolVersion: tool.version,
      toolCommit: tool.commit
    });
    const { signatureBase64: vrSig } = await remoteClient.sign({
      keyId: serverKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(vrUnsigned.reportHash, "hex"),
      purpose: SIGNING_PURPOSE.VERIFICATION_REPORT,
      context: { tenantId, period, protocol, manifestHash }
    });
    const vr = { ...vrUnsigned, signature: vrSig };
    files.set("verify/verification_report.json", new TextEncoder().encode(`${canonicalJsonStringify(vr)}\n`));
  }

  const absOut = await ensureEmptyDir({ dir: outDir, force });
  await writeFilesToDirSorted({ files, outDir: absOut });

  const headAtt = JSON.parse(new TextDecoder().decode(files.get("attestation/bundle_head_attestation.json") ?? new Uint8Array()));
  return {
    bundleDir: absOut,
    kind: "financepack",
    tenantId,
    period,
    protocol,
    bundle,
    manifestHash: bundle?.manifestHash ?? null,
    attestationHash: headAtt?.attestationHash ?? null
  };
}

export async function produceInvoiceBundle({
  outDir,
  force = false,
  keys,
  signerMode = "local",
  signerUrl = null,
  signerCommand = null,
  signerArgsJson = null,
  signerAuth = null,
  signerTokenEnv = null,
  signerTokenFile = null,
  signerHeaders = [],
  signerPlugin = null,
  signerPluginExport = null,
  signerPluginConfig = null,
  govKeyId = null,
  serverKeyId = null,
  tenantId = "tenant_default",
  invoiceId = "invoice_default",
  protocol = "1.0",
  now,
  jobProofDir,
  toolVersion = null,
  toolCommit = null,
  packageVersion = null
} = {}) {
  assertNonEmptyString(outDir, "outDir");
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(invoiceId, "invoiceId");
  assertNonEmptyString(protocol, "protocol");
  assertNonEmptyString(now, "now");
  assertNonEmptyString(jobProofDir, "jobProofDir");

  let govSigner = null;
  let serverSigner = null;
  let remoteClient = null;
  let revocationList = null;
  let governancePolicy = null;

  if (signerMode === "local") {
    const local = createLocalSigning({ keysPath: typeof keys === "string" ? keys : null, govKeyId, serverKeyId });
    govSigner = local.govSigner;
    serverSigner = local.serverSigner;
  } else if (signerMode === "remote") {
    const remote = await createRemoteSigning({
      signerUrl,
      signerCommand,
      signerArgsJson,
      signerAuth,
      signerTokenEnv,
      signerTokenFile,
      signerHeaders,
      govKeyId,
      serverKeyId
    });
    remoteClient = remote.client;
    revocationList = await buildSignedRevocationListV1({ generatedAt: now, signerKeyId: govKeyId, client: remoteClient });
    governancePolicy = await buildSignedGovernancePolicyV2({
      generatedAt: now,
      signerKeyId: govKeyId,
      client: remoteClient,
      subjectType: "InvoiceBundle.v1",
      serverKeyId,
      revocationListSha256: revocationList.listHash
    });
  } else if (signerMode === "plugin") {
    const plugin = await createPluginSigning({ signerPlugin, signerPluginExport, signerPluginConfig, govKeyId, serverKeyId });
    remoteClient = plugin.client;
    revocationList = await buildSignedRevocationListV1({ generatedAt: now, signerKeyId: govKeyId, client: remoteClient });
    governancePolicy = await buildSignedGovernancePolicyV2({
      generatedAt: now,
      signerKeyId: govKeyId,
      client: remoteClient,
      subjectType: "InvoiceBundle.v1",
      serverKeyId,
      revocationListSha256: revocationList.listHash
    });
  } else {
    const err = new Error("unsupported signer mode");
    err.code = "UNSUPPORTED_SIGNER_MODE";
    throw err;
  }

  const jobAbs = path.resolve(process.cwd(), jobProofDir);
  const jobManifest = await readJsonFile(path.join(jobAbs, "manifest.json"));
  const jobProofBundle = { manifestHash: String(jobManifest?.manifestHash ?? "") };
  assertNonEmptyString(jobProofBundle.manifestHash, "jobProofBundle.manifestHash");
  const jobProofFiles = await readFilesRecursive({ dir: jobAbs });

  const tool = toolIdentityForReports({ toolVersion, toolCommit, packageVersion });

  const pricingMatrix = {
    currency: "USD",
    prices: [
      { code: "WORK_MINUTES", unitPriceCents: "150" }
    ]
  };

  const evidenceSha = sha256Hex(jobProofFiles.get("job/snapshot.json") ?? new Uint8Array());
  const meteringReport = {
    generatedAt: now,
    items: [{ code: "WORK_MINUTES", quantity: "10" }],
    evidenceRefs: [{ path: "job/snapshot.json", sha256: evidenceSha }]
  };

  const { files, bundle } = buildInvoiceBundleV1({
    tenantId,
    invoiceId,
    protocol,
    createdAt: now,
    governancePolicy,
    governancePolicySigner: signerMode === "local" ? govSigner : null,
    revocationList,
    jobProofBundle,
    jobProofFiles,
    requireJobProofAttestation: true,
    requireHeadAttestation: signerMode === "local",
    manifestSigner: signerMode === "local" ? serverSigner : null,
    verificationReportSigner: signerMode === "local" ? serverSigner : { keyId: serverKeyId, scope: "global" },
    timestampAuthoritySigner: null,
    verificationReportWarnings: null,
    toolVersion: tool.version,
    toolCommit: tool.commit,
    pricingMatrix,
    meteringReport,
    invoiceClaim: null
  });

  if (signerMode !== "local") {
    const manifestHash = bundle?.manifestHash ?? null;
    const jobAtt = JSON.parse(new TextDecoder().decode(jobProofFiles.get("attestation/bundle_head_attestation.json") ?? new Uint8Array()));
    const existingVr = JSON.parse(new TextDecoder().decode(files.get("verify/verification_report.json") ?? new Uint8Array()));
    const inputs = existingVr?.inputs ?? null;
    if (!inputs || typeof inputs !== "object") throw new Error("InvoiceBundle verification report inputs missing");

    const unsignedHead = buildInvoiceHeadAttestationUnsigned({
      tenantId,
      invoiceId,
      createdAt: now,
      manifestHash,
      heads: {
        jobProof: {
          manifestHash: jobProofBundle.manifestHash,
          attestationHash: jobAtt?.attestationHash ?? null
        }
      },
      signerKeyId: serverKeyId,
      timestampAuthoritySigner: null
    });
    const { signatureBase64: headSig } = await remoteClient.sign({
      keyId: serverKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(unsignedHead.attestationHash, "hex"),
      purpose: SIGNING_PURPOSE.BUNDLE_HEAD_ATTESTATION,
      context: { kind: "InvoiceBundle.v1", tenantId, scope: { invoiceId }, manifestHash }
    });
    const headAtt = { ...unsignedHead, signature: headSig };
    files.set("attestation/bundle_head_attestation.json", new TextEncoder().encode(`${canonicalJsonStringify(headAtt)}\n`));

    const vrUnsigned = buildInvoiceVerificationReportV1({
      tenantId,
      invoiceId,
      createdAt: now,
      protocol,
      manifestHash,
      bundleHeadAttestation: headAtt,
      inputs,
      signer: { keyId: serverKeyId, scope: "global" },
      timestampAuthoritySigner: null,
      warnings: null,
      toolVersion: tool.version,
      toolCommit: tool.commit
    });
    const { signatureBase64: vrSig } = await remoteClient.sign({
      keyId: serverKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(vrUnsigned.reportHash, "hex"),
      purpose: SIGNING_PURPOSE.VERIFICATION_REPORT,
      context: { tenantId, invoiceId, protocol, manifestHash }
    });
    const vr = { ...vrUnsigned, signature: vrSig };
    files.set("verify/verification_report.json", new TextEncoder().encode(`${canonicalJsonStringify(vr)}\n`));
  }

  const absOut = await ensureEmptyDir({ dir: outDir, force });
  await writeFilesToDirSorted({ files, outDir: absOut });

  const headAtt = JSON.parse(new TextDecoder().decode(files.get("attestation/bundle_head_attestation.json") ?? new Uint8Array()));
  return {
    bundleDir: absOut,
    kind: "invoicebundle",
    tenantId,
    invoiceId,
    protocol,
    bundle,
    manifestHash: bundle?.manifestHash ?? null,
    attestationHash: headAtt?.attestationHash ?? null
  };
}

export async function produceClosePackBundle({
  outDir,
  force = false,
  keys,
  signerMode = "local",
  signerUrl = null,
  signerCommand = null,
  signerArgsJson = null,
  signerAuth = null,
  signerTokenEnv = null,
  signerTokenFile = null,
  signerHeaders = [],
  signerPlugin = null,
  signerPluginExport = null,
  signerPluginConfig = null,
  govKeyId = null,
  serverKeyId = null,
  tenantId = "tenant_default",
  invoiceId = "invoice_default",
  protocol = "1.0",
  now,
  invoiceBundleDir,
  toolVersion = null,
  toolCommit = null,
  packageVersion = null
} = {}) {
  assertNonEmptyString(outDir, "outDir");
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(invoiceId, "invoiceId");
  assertNonEmptyString(protocol, "protocol");
  assertNonEmptyString(now, "now");
  assertNonEmptyString(invoiceBundleDir, "invoiceBundleDir");

  let govSigner = null;
  let serverSigner = null;
  let remoteClient = null;
  let revocationList = null;
  let governancePolicy = null;

  if (signerMode === "local") {
    const local = createLocalSigning({ keysPath: typeof keys === "string" ? keys : null, govKeyId, serverKeyId });
    govSigner = local.govSigner;
    serverSigner = local.serverSigner;
  } else if (signerMode === "remote") {
    const remote = await createRemoteSigning({
      signerUrl,
      signerCommand,
      signerArgsJson,
      signerAuth,
      signerTokenEnv,
      signerTokenFile,
      signerHeaders,
      govKeyId,
      serverKeyId
    });
    remoteClient = remote.client;
    revocationList = await buildSignedRevocationListV1({ generatedAt: now, signerKeyId: govKeyId, client: remoteClient });
    governancePolicy = await buildSignedGovernancePolicyV2({
      generatedAt: now,
      signerKeyId: govKeyId,
      client: remoteClient,
      subjectType: "ClosePack.v1",
      serverKeyId,
      revocationListSha256: revocationList.listHash
    });
  } else if (signerMode === "plugin") {
    const plugin = await createPluginSigning({ signerPlugin, signerPluginExport, signerPluginConfig, govKeyId, serverKeyId });
    remoteClient = plugin.client;
    revocationList = await buildSignedRevocationListV1({ generatedAt: now, signerKeyId: govKeyId, client: remoteClient });
    governancePolicy = await buildSignedGovernancePolicyV2({
      generatedAt: now,
      signerKeyId: govKeyId,
      client: remoteClient,
      subjectType: "ClosePack.v1",
      serverKeyId,
      revocationListSha256: revocationList.listHash
    });
  } else {
    const err = new Error("unsupported signer mode");
    err.code = "UNSUPPORTED_SIGNER_MODE";
    throw err;
  }

  const invAbs = path.resolve(process.cwd(), invoiceBundleDir);
  const invManifest = await readJsonFile(path.join(invAbs, "manifest.json"));
  const invoiceBundle = { manifestHash: String(invManifest?.manifestHash ?? "") };
  assertNonEmptyString(invoiceBundle.manifestHash, "invoiceBundle.manifestHash");
  const invoiceBundleFiles = await readFilesRecursive({ dir: invAbs });

  const tool = toolIdentityForReports({ toolVersion, toolCommit, packageVersion });

  const { files, bundle } = buildClosePackBundleV1({
    tenantId,
    invoiceId,
    protocol,
    createdAt: now,
    governancePolicy,
    governancePolicySigner: signerMode === "local" ? govSigner : null,
    revocationList,
    invoiceBundle,
    invoiceBundleFiles,
    requireInvoiceAttestation: true,
    requireHeadAttestation: signerMode === "local",
    manifestSigner: signerMode === "local" ? serverSigner : null,
    verificationReportSigner: signerMode === "local" ? serverSigner : { keyId: serverKeyId, scope: "global" },
    timestampAuthoritySigner: null,
    verificationReportWarnings: null,
    toolVersion: tool.version,
    toolCommit: tool.commit
  });

  if (signerMode !== "local") {
    const manifestHash = bundle?.manifestHash ?? null;
    const invoiceAtt = JSON.parse(new TextDecoder().decode(invoiceBundleFiles.get("attestation/bundle_head_attestation.json") ?? new Uint8Array()));
    const invoiceHeadAttestationHash = invoiceAtt?.attestationHash ?? null;
    const existingVr = JSON.parse(new TextDecoder().decode(files.get("verify/verification_report.json") ?? new Uint8Array()));
    const inputs = existingVr?.inputs ?? null;
    if (!inputs || typeof inputs !== "object") throw new Error("ClosePack verification report inputs missing");

    const unsignedHead = buildClosePackHeadAttestationUnsigned({
      tenantId,
      invoiceId,
      createdAt: now,
      manifestHash,
      heads: {
        invoiceBundle: {
          embeddedPath: "payload/invoice_bundle",
          manifestHash: invoiceBundle.manifestHash,
          attestationHash: invoiceHeadAttestationHash ?? null
        }
      },
      signerKeyId: serverKeyId,
      timestampAuthoritySigner: null
    });
    const { signatureBase64: headSig } = await remoteClient.sign({
      keyId: serverKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(unsignedHead.attestationHash, "hex"),
      purpose: SIGNING_PURPOSE.BUNDLE_HEAD_ATTESTATION,
      context: { kind: "ClosePack.v1", tenantId, scope: { invoiceId }, manifestHash }
    });
    const headAtt = { ...unsignedHead, signature: headSig };
    files.set("attestation/bundle_head_attestation.json", new TextEncoder().encode(`${canonicalJsonStringify(headAtt)}\n`));

    const vrUnsigned = buildClosePackVerificationReportV1({
      tenantId,
      invoiceId,
      createdAt: now,
      protocol,
      manifestHash,
      bundleHeadAttestation: headAtt,
      inputs,
      signer: { keyId: serverKeyId, scope: "global" },
      timestampAuthoritySigner: null,
      warnings: null,
      toolVersion: tool.version,
      toolCommit: tool.commit
    });
    const { signatureBase64: vrSig } = await remoteClient.sign({
      keyId: serverKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(vrUnsigned.reportHash, "hex"),
      purpose: SIGNING_PURPOSE.VERIFICATION_REPORT,
      context: { tenantId, invoiceId, protocol, manifestHash }
    });
    const vr = { ...vrUnsigned, signature: vrSig };
    files.set("verify/verification_report.json", new TextEncoder().encode(`${canonicalJsonStringify(vr)}\n`));
  }

  const absOut = await ensureEmptyDir({ dir: outDir, force });
  await writeFilesToDirSorted({ files, outDir: absOut });

  let headAtt = null;
  try {
    headAtt = JSON.parse(new TextDecoder().decode(files.get("attestation/bundle_head_attestation.json") ?? new Uint8Array()));
  } catch {
    headAtt = null;
  }
  return {
    bundleDir: absOut,
    kind: "closepack",
    tenantId,
    invoiceId,
    protocol,
    bundle,
    manifestHash: bundle?.manifestHash ?? null,
    attestationHash: headAtt?.attestationHash ?? null
  };
}

export async function produceClosePackFromJson({
  outDir,
  force = false,
  keys,
  signerMode = "local",
  signerUrl = null,
  signerCommand = null,
  signerArgsJson = null,
  signerAuth = null,
  signerTokenEnv = null,
  signerTokenFile = null,
  signerHeaders = [],
  signerPlugin = null,
  signerPluginExport = null,
  signerPluginConfig = null,
  govKeyId = null,
  serverKeyId = null,
  tenantId = "tenant_default",
  invoiceId = "invoice_default",
  protocol = "1.0",
  now,
  jobProofDir,
  pricingMatrixPath,
  pricingSignaturesPath,
  meteringReportPath,
  invoiceClaimPath = null,
  slaDefinitionPath = null,
  acceptanceCriteriaPath = null,
  toolVersion = null,
  toolCommit = null,
  packageVersion = null
} = {}) {
  assertNonEmptyString(outDir, "outDir");
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(invoiceId, "invoiceId");
  assertNonEmptyString(protocol, "protocol");
  assertNonEmptyString(now, "now");
  assertNonEmptyString(jobProofDir, "jobProofDir");
  assertNonEmptyString(pricingMatrixPath, "pricingMatrixPath");
  assertNonEmptyString(pricingSignaturesPath, "pricingSignaturesPath");
  assertNonEmptyString(meteringReportPath, "meteringReportPath");
  if (invoiceClaimPath !== null && typeof invoiceClaimPath !== "string") throw new TypeError("invoiceClaimPath must be null or a string");
  if (slaDefinitionPath !== null && typeof slaDefinitionPath !== "string") throw new TypeError("slaDefinitionPath must be null or a string");
  if (acceptanceCriteriaPath !== null && typeof acceptanceCriteriaPath !== "string") throw new TypeError("acceptanceCriteriaPath must be null or a string");

  let govSigner = null;
  let serverSigner = null;
  let remoteClient = null;
  let revocationList = null;
  let invoiceGovernancePolicy = null;
  let closePackGovernancePolicy = null;

  if (signerMode === "local") {
    const local = createLocalSigning({ keysPath: typeof keys === "string" ? keys : null, govKeyId, serverKeyId });
    govSigner = local.govSigner;
    serverSigner = local.serverSigner;
  } else if (signerMode === "remote") {
    const remote = await createRemoteSigning({
      signerUrl,
      signerCommand,
      signerArgsJson,
      signerAuth,
      signerTokenEnv,
      signerTokenFile,
      signerHeaders,
      govKeyId,
      serverKeyId
    });
    remoteClient = remote.client;
    revocationList = await buildSignedRevocationListV1({ generatedAt: now, signerKeyId: govKeyId, client: remoteClient });
    invoiceGovernancePolicy = await buildSignedGovernancePolicyV2({
      generatedAt: now,
      signerKeyId: govKeyId,
      client: remoteClient,
      subjectType: "InvoiceBundle.v1",
      serverKeyId,
      revocationListSha256: revocationList.listHash
    });
    closePackGovernancePolicy = await buildSignedGovernancePolicyV2({
      generatedAt: now,
      signerKeyId: govKeyId,
      client: remoteClient,
      subjectType: "ClosePack.v1",
      serverKeyId,
      revocationListSha256: revocationList.listHash
    });
  } else if (signerMode === "plugin") {
    const plugin = await createPluginSigning({ signerPlugin, signerPluginExport, signerPluginConfig, govKeyId, serverKeyId });
    remoteClient = plugin.client;
    revocationList = await buildSignedRevocationListV1({ generatedAt: now, signerKeyId: govKeyId, client: remoteClient });
    invoiceGovernancePolicy = await buildSignedGovernancePolicyV2({
      generatedAt: now,
      signerKeyId: govKeyId,
      client: remoteClient,
      subjectType: "InvoiceBundle.v1",
      serverKeyId,
      revocationListSha256: revocationList.listHash
    });
    closePackGovernancePolicy = await buildSignedGovernancePolicyV2({
      generatedAt: now,
      signerKeyId: govKeyId,
      client: remoteClient,
      subjectType: "ClosePack.v1",
      serverKeyId,
      revocationListSha256: revocationList.listHash
    });
  } else {
    const err = new Error("unsupported signer mode");
    err.code = "UNSUPPORTED_SIGNER_MODE";
    throw err;
  }

  const jobAbs = path.resolve(process.cwd(), jobProofDir);
  const jobManifest = await readJsonFile(path.join(jobAbs, "manifest.json"));
  const jobProofBundle = { manifestHash: String(jobManifest?.manifestHash ?? "") };
  assertNonEmptyString(jobProofBundle.manifestHash, "jobProofBundle.manifestHash");
  const jobProofFiles = await readFilesRecursive({ dir: jobAbs });

  const pricingMatrix = await readJsonFile(path.resolve(process.cwd(), pricingMatrixPath));
  const pricingMatrixSignaturesOverride = await readJsonFile(path.resolve(process.cwd(), pricingSignaturesPath));
  const meteringReport = await readJsonFile(path.resolve(process.cwd(), meteringReportPath));
  const invoiceClaim = invoiceClaimPath ? await readJsonFile(path.resolve(process.cwd(), invoiceClaimPath)) : null;
  const slaDefinition = slaDefinitionPath ? await readJsonFile(path.resolve(process.cwd(), slaDefinitionPath)) : null;
  const acceptanceCriteria = acceptanceCriteriaPath ? await readJsonFile(path.resolve(process.cwd(), acceptanceCriteriaPath)) : null;

  const tool = toolIdentityForReports({ toolVersion, toolCommit, packageVersion });

  const invoiceProduced = buildInvoiceBundleV1({
    tenantId,
    invoiceId,
    protocol,
    createdAt: now,
    governancePolicy: invoiceGovernancePolicy,
    governancePolicySigner: signerMode === "local" ? govSigner : null,
    revocationList,
    pricingMatrixSigners: [],
    pricingMatrixSignaturesOverride,
    jobProofBundle,
    jobProofFiles,
    requireJobProofAttestation: true,
    requireHeadAttestation: signerMode === "local",
    manifestSigner: signerMode === "local" ? serverSigner : null,
    verificationReportSigner: signerMode === "local" ? serverSigner : { keyId: serverKeyId, scope: "global" },
    timestampAuthoritySigner: null,
    verificationReportWarnings: null,
    toolVersion: tool.version,
    toolCommit: tool.commit,
    pricingMatrix,
    meteringReport,
    invoiceClaim
  });
  const invoiceBundleFiles = invoiceProduced.files;
  const invoiceManifestHash = invoiceProduced.bundle?.manifestHash ?? null;

  if (signerMode !== "local") {
    const manifestHash = invoiceManifestHash;
    const jobAtt = JSON.parse(new TextDecoder().decode(jobProofFiles.get("attestation/bundle_head_attestation.json") ?? new Uint8Array()));
    const existingVr = JSON.parse(new TextDecoder().decode(invoiceBundleFiles.get("verify/verification_report.json") ?? new Uint8Array()));
    const inputs = existingVr?.inputs ?? null;
    if (!inputs || typeof inputs !== "object") throw new Error("InvoiceBundle verification report inputs missing");

    const unsignedHead = buildInvoiceHeadAttestationUnsigned({
      tenantId,
      invoiceId,
      createdAt: now,
      manifestHash,
      heads: {
        jobProof: {
          manifestHash: jobProofBundle.manifestHash,
          attestationHash: jobAtt?.attestationHash ?? null
        }
      },
      signerKeyId: serverKeyId,
      timestampAuthoritySigner: null
    });
    const { signatureBase64: headSig } = await remoteClient.sign({
      keyId: serverKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(unsignedHead.attestationHash, "hex"),
      purpose: SIGNING_PURPOSE.BUNDLE_HEAD_ATTESTATION,
      context: { kind: "InvoiceBundle.v1", tenantId, scope: { invoiceId }, manifestHash }
    });
    const headAtt = { ...unsignedHead, signature: headSig };
    invoiceBundleFiles.set("attestation/bundle_head_attestation.json", new TextEncoder().encode(`${canonicalJsonStringify(headAtt)}\n`));

    const vrUnsigned = buildInvoiceVerificationReportV1({
      tenantId,
      invoiceId,
      createdAt: now,
      protocol,
      manifestHash,
      bundleHeadAttestation: headAtt,
      inputs,
      signer: { keyId: serverKeyId, scope: "global" },
      timestampAuthoritySigner: null,
      warnings: null,
      toolVersion: tool.version,
      toolCommit: tool.commit
    });
    const { signatureBase64: vrSig } = await remoteClient.sign({
      keyId: serverKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(vrUnsigned.reportHash, "hex"),
      purpose: SIGNING_PURPOSE.VERIFICATION_REPORT,
      context: { tenantId, invoiceId, protocol, manifestHash }
    });
    const vr = { ...vrUnsigned, signature: vrSig };
    invoiceBundleFiles.set("verify/verification_report.json", new TextEncoder().encode(`${canonicalJsonStringify(vr)}\n`));
  }

  const invoiceBundle = { manifestHash: String(invoiceManifestHash ?? "") };
  assertNonEmptyString(invoiceBundle.manifestHash, "invoiceBundle.manifestHash");

  const closeProduced = buildClosePackBundleV1({
    tenantId,
    invoiceId,
    protocol,
    createdAt: now,
    governancePolicy: closePackGovernancePolicy,
    governancePolicySigner: signerMode === "local" ? govSigner : null,
    revocationList,
    invoiceBundle,
    invoiceBundleFiles,
    requireInvoiceAttestation: true,
    requireHeadAttestation: signerMode === "local",
    manifestSigner: signerMode === "local" ? serverSigner : null,
    verificationReportSigner: signerMode === "local" ? serverSigner : { keyId: serverKeyId, scope: "global" },
    timestampAuthoritySigner: null,
    verificationReportWarnings: null,
    toolVersion: tool.version,
    toolCommit: tool.commit,
    slaDefinition,
    acceptanceCriteria
  });
  const closePackFiles = closeProduced.files;

  if (signerMode !== "local") {
    const manifestHash = closeProduced.bundle?.manifestHash ?? null;
    const invoiceAtt = JSON.parse(new TextDecoder().decode(invoiceBundleFiles.get("attestation/bundle_head_attestation.json") ?? new Uint8Array()));
    const invoiceHeadAttestationHash = invoiceAtt?.attestationHash ?? null;
    const existingVr = JSON.parse(new TextDecoder().decode(closePackFiles.get("verify/verification_report.json") ?? new Uint8Array()));
    const inputs = existingVr?.inputs ?? null;
    if (!inputs || typeof inputs !== "object") throw new Error("ClosePack verification report inputs missing");

    const unsignedHead = buildClosePackHeadAttestationUnsigned({
      tenantId,
      invoiceId,
      createdAt: now,
      manifestHash,
      heads: {
        invoiceBundle: {
          embeddedPath: "payload/invoice_bundle",
          manifestHash: invoiceBundle.manifestHash,
          attestationHash: invoiceHeadAttestationHash ?? null
        }
      },
      signerKeyId: serverKeyId,
      timestampAuthoritySigner: null
    });
    const { signatureBase64: headSig } = await remoteClient.sign({
      keyId: serverKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(unsignedHead.attestationHash, "hex"),
      purpose: SIGNING_PURPOSE.BUNDLE_HEAD_ATTESTATION,
      context: { kind: "ClosePack.v1", tenantId, scope: { invoiceId }, manifestHash }
    });
    const headAtt = { ...unsignedHead, signature: headSig };
    closePackFiles.set("attestation/bundle_head_attestation.json", new TextEncoder().encode(`${canonicalJsonStringify(headAtt)}\n`));

    const vrUnsigned = buildClosePackVerificationReportV1({
      tenantId,
      invoiceId,
      createdAt: now,
      protocol,
      manifestHash,
      bundleHeadAttestation: headAtt,
      inputs,
      signer: { keyId: serverKeyId, scope: "global" },
      timestampAuthoritySigner: null,
      warnings: null,
      toolVersion: tool.version,
      toolCommit: tool.commit
    });
    const { signatureBase64: vrSig } = await remoteClient.sign({
      keyId: serverKeyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(vrUnsigned.reportHash, "hex"),
      purpose: SIGNING_PURPOSE.VERIFICATION_REPORT,
      context: { tenantId, invoiceId, protocol, manifestHash }
    });
    const vr = { ...vrUnsigned, signature: vrSig };
    closePackFiles.set("verify/verification_report.json", new TextEncoder().encode(`${canonicalJsonStringify(vr)}\n`));
  }

  const absOut = await ensureEmptyDir({ dir: outDir, force });
  await writeFilesToDirSorted({ files: closePackFiles, outDir: absOut });

  let headAtt = null;
  try {
    headAtt = JSON.parse(new TextDecoder().decode(closePackFiles.get("attestation/bundle_head_attestation.json") ?? new Uint8Array()));
  } catch {
    headAtt = null;
  }
  return {
    bundleDir: absOut,
    kind: "closepack",
    tenantId,
    invoiceId,
    protocol,
    bundle: closeProduced.bundle,
    manifestHash: closeProduced.bundle?.manifestHash ?? null,
    attestationHash: headAtt?.attestationHash ?? null
  };
}

export async function verifyAfterProduce({ bundleKind, bundleDir, trustJson, strict, hashConcurrency }) {
  if (!trustJson || typeof trustJson !== "object") throw new TypeError("trustJson must be an object");
  const env = {
    ...process.env,
    SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trustJson.governanceRoots ?? {}),
    SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON: JSON.stringify(trustJson.timeAuthorities ?? {})
  };
  const args = [
    "exec",
    "--silent",
    "--",
    "settld-verify",
    "--format",
    "json",
    strict ? "--strict" : "--nonstrict",
    ...(hashConcurrency ? ["--hash-concurrency", String(hashConcurrency)] : []),
    bundleKind === "jobproof"
      ? "--job-proof"
      : bundleKind === "monthproof"
        ? "--month-proof"
        : bundleKind === "financepack"
          ? "--finance-pack"
          : bundleKind === "closepack"
            ? "--close-pack"
            : "--invoice-bundle",
    bundleDir
  ];
  const proc = spawn("npm", args, { env, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  proc.stdout.on("data", (d) => stdout.push(d));
  proc.stderr.on("data", (d) => stderr.push(d));
  const code = await new Promise((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (c) => resolve(c ?? 1));
  });
  return { code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
}
