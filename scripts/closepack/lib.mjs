import fs from "node:fs/promises";
import path from "node:path";

import { computeArtifactHash } from "../../src/core/artifacts.js";
import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { verifyHashHexEd25519, sha256Hex } from "../../src/core/crypto.js";
import { buildDeterministicZipStore, sha256HexBytes } from "../../src/core/deterministic-zip.js";
import {
  DISPUTE_OPEN_ENVELOPE_SCHEMA_VERSION,
  validateDisputeOpenEnvelopeV1
} from "../../src/core/dispute-open-envelope.js";
import { validateFundingHoldV1 } from "../../src/core/funding-hold.js";
import { validateReputationEventV1 } from "../../src/core/reputation-event.js";
import {
  SETTLEMENT_ADJUSTMENT_KIND,
  validateSettlementAdjustmentV1
} from "../../src/core/settlement-adjustment.js";
import { verifyX402ExecutionProofV1 } from "../../src/core/zk-verifier.js";
import { unzipToTempSafe } from "../../packages/artifact-verify/src/safe-unzip.js";

const CLOSEPACK_SCHEMA_VERSION = "KernelToolCallClosePack.v0";
const VERIFY_REPORT_SCHEMA_VERSION = "KernelToolCallClosePackVerifyReport.v0";
const FIXED_ZIP_MTIME = new Date("2000-01-01T00:00:00.000Z");

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function normalizeSha256(value, name) {
  const out = assertNonEmptyString(value, name).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(out)) throw new TypeError(`${name} must be a 64-hex sha256`);
  return out;
}

function normalizeBaseUrl(value) {
  const out = assertNonEmptyString(value, "baseUrl");
  return out.replace(/\/$/, "");
}

function encodeJson(obj) {
  return Buffer.from(`${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

function safeFileSegment(value) {
  return encodeURIComponent(String(value));
}

function addIssue(list, { code, message, severity = "error", details = null }) {
  list.push({ code: String(code), severity: String(severity), message: String(message), details: details ?? null });
}

function isNotFoundError(err) {
  return Number(err?.status) === 404;
}

function deterministicCaseArtifactId(arbitrationCase) {
  if (!arbitrationCase || typeof arbitrationCase !== "object" || Array.isArray(arbitrationCase)) return null;
  const caseId = typeof arbitrationCase.caseId === "string" && arbitrationCase.caseId.trim() !== "" ? arbitrationCase.caseId.trim() : null;
  if (!caseId) return null;
  const revisionRaw = Number(arbitrationCase.revision ?? 1);
  const revision = Number.isSafeInteger(revisionRaw) && revisionRaw > 1 ? revisionRaw : 1;
  return revision > 1 ? `arbitration_case_${caseId}_r${revision}` : `arbitration_case_${caseId}`;
}

function computeArbitrationVerdictHash(verdictArtifact) {
  const core = normalizeForCanonicalJson(
    {
      schemaVersion: "ArbitrationVerdict.v1",
      verdictId: verdictArtifact.verdictId,
      caseId: verdictArtifact.caseId,
      tenantId: verdictArtifact.tenantId,
      runId: verdictArtifact.runId,
      settlementId: verdictArtifact.settlementId,
      disputeId: verdictArtifact.disputeId,
      arbiterAgentId: verdictArtifact.arbiterAgentId,
      outcome: verdictArtifact.outcome,
      releaseRatePct: verdictArtifact.releaseRatePct,
      rationale: verdictArtifact.rationale,
      evidenceRefs: Array.isArray(verdictArtifact.evidenceRefs) ? verdictArtifact.evidenceRefs : [],
      issuedAt: verdictArtifact.issuedAt,
      appealRef: verdictArtifact.appealRef ?? null
    },
    { path: "$" }
  );
  return sha256Hex(canonicalJsonStringify(core));
}

async function requestJson({ baseUrl, tenantId, protocol, apiKey, opsToken, method, pathname, body, allowNotFound = false }) {
  const url = new URL(pathname, baseUrl);
  const headers = {
    "content-type": "application/json",
    "x-proxy-tenant-id": String(tenantId),
    "x-settld-protocol": String(protocol),
    "x-request-id": `closepack_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`
  };
  if (apiKey) headers.authorization = `Bearer ${String(apiKey)}`;
  if (opsToken) headers["x-proxy-ops-token"] = String(opsToken);

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    if (allowNotFound && res.status === 404) return null;
    const err = new Error(
      typeof parsed === "object" && parsed !== null
        ? String(parsed.message ?? parsed.error ?? `HTTP ${res.status}`)
        : String(parsed ?? `HTTP ${res.status}`)
    );
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

async function fetchArtifact({ requestContext, artifactId, issues, required = true }) {
  if (!artifactId) return null;
  try {
    const out = await requestJson({
      ...requestContext,
      method: "GET",
      pathname: `/artifacts/${encodeURIComponent(String(artifactId))}`
    });
    return out?.artifact ?? null;
  } catch (err) {
    if (isNotFoundError(err)) {
      addIssue(issues, {
        code: "CLOSEPACK_ARTIFACT_NOT_FOUND",
        message: `artifact not found: ${artifactId}`,
        severity: required ? "error" : "warning",
        details: { artifactId }
      });
      return null;
    }
    throw err;
  }
}

async function fetchAgentIdentity({ requestContext, agentId, issues, required = false }) {
  if (!agentId) return null;
  try {
    const out = await requestJson({
      ...requestContext,
      method: "GET",
      pathname: `/agents/${encodeURIComponent(String(agentId))}`
    });
    return out?.agentIdentity ?? null;
  } catch (err) {
    if (isNotFoundError(err)) {
      addIssue(issues, {
        code: "CLOSEPACK_AGENT_IDENTITY_NOT_FOUND",
        message: `agent identity not found: ${agentId}`,
        severity: required ? "error" : "warning",
        details: { agentId }
      });
      return null;
    }
    throw err;
  }
}

function makeRequestContext({ baseUrl, tenantId, protocol, apiKey, opsToken }) {
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    tenantId: assertNonEmptyString(tenantId, "tenantId"),
    protocol: assertNonEmptyString(protocol, "protocol"),
    apiKey: apiKey ? String(apiKey) : null,
    opsToken: opsToken ? String(opsToken) : null
  };
}

function selectPrimaryCase(cases) {
  const rows = Array.isArray(cases) ? [...cases] : [];
  rows.sort((left, right) => {
    const leftClosed = String(left?.status ?? "").toLowerCase() === "closed" ? 1 : 0;
    const rightClosed = String(right?.status ?? "").toLowerCase() === "closed" ? 1 : 0;
    if (leftClosed !== rightClosed) return rightClosed - leftClosed;
    const leftRevision = Number(left?.revision ?? 0);
    const rightRevision = Number(right?.revision ?? 0);
    if (Number.isFinite(leftRevision) && Number.isFinite(rightRevision) && leftRevision !== rightRevision) return rightRevision - leftRevision;
    const leftAt = Date.parse(String(left?.updatedAt ?? left?.openedAt ?? ""));
    const rightAt = Date.parse(String(right?.updatedAt ?? right?.openedAt ?? ""));
    if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && leftAt !== rightAt) return rightAt - leftAt;
    return String(left?.caseId ?? "").localeCompare(String(right?.caseId ?? ""));
  });
  return rows[0] ?? null;
}

function buildPublicKeyMap(identities) {
  const map = new Map();
  for (const identity of Array.isArray(identities) ? identities : []) {
    const keys = identity?.keys;
    const keyId = typeof keys?.keyId === "string" ? keys.keyId.trim() : "";
    const publicKeyPem = typeof keys?.publicKeyPem === "string" ? keys.publicKeyPem.trim() : "";
    if (keyId && publicKeyPem) map.set(keyId, publicKeyPem);
  }
  return map;
}

function appendFile(files, filepath, jsonObject) {
  files.set(filepath, encodeJson(normalizeForCanonicalJson(jsonObject, { path: "$" })));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractX402ReceiptZkEvidence(receipt) {
  if (!isPlainObject(receipt)) return null;
  if (isPlainObject(receipt.zkProof)) return receipt.zkProof;
  if (isPlainObject(receipt.bindings?.zkProof)) return receipt.bindings.zkProof;
  return null;
}

function canonicalJsonEquals(left, right) {
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  return (
    canonicalJsonStringify(normalizeForCanonicalJson(left, { path: "$" })) ===
    canonicalJsonStringify(normalizeForCanonicalJson(right, { path: "$" }))
  );
}

function extractArtifactHash(artifact) {
  return typeof artifact?.artifactHash === "string" && artifact.artifactHash.trim() !== "" ? artifact.artifactHash.trim().toLowerCase() : null;
}

function computeStoredArtifactHash(artifact) {
  const { artifactHash: _artifactHash, ...withoutHash } = artifact ?? {};
  return computeArtifactHash(withoutHash);
}

function deterministicAdjustmentId(agreementHash) {
  return `sadj_agmt_${agreementHash}_holdback`;
}

function normalizeReputationEventsForAgreement({ events, agreementHash }) {
  const out = [];
  for (const row of Array.isArray(events) ? events : []) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const src = row.sourceRef && typeof row.sourceRef === "object" && !Array.isArray(row.sourceRef) ? row.sourceRef : null;
    if (!src) continue;
    if (String(src.agreementHash ?? "").toLowerCase() !== String(agreementHash).toLowerCase()) continue;
    out.push(row);
  }
  out.sort((left, right) => {
    const leftMs = Date.parse(String(left?.occurredAt ?? ""));
    const rightMs = Date.parse(String(right?.occurredAt ?? ""));
    if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) return leftMs - rightMs;
    return String(left?.eventId ?? "").localeCompare(String(right?.eventId ?? ""));
  });
  return out;
}

export async function exportToolCallClosepack({
  baseUrl = "http://127.0.0.1:3000",
  tenantId = "tenant_default",
  protocol = "1.0",
  apiKey = null,
  opsToken = null,
  agreementHash,
  outPath
} = {}) {
  const normalizedAgreementHash = normalizeSha256(agreementHash, "agreementHash");
  const outputPath = path.resolve(assertNonEmptyString(outPath, "outPath"));
  const requestContext = makeRequestContext({ baseUrl, tenantId, protocol, apiKey, opsToken });
  const issues = [];

  const holdsResponse = await requestJson({
    ...requestContext,
    method: "GET",
    pathname: `/ops/tool-calls/holds?agreementHash=${encodeURIComponent(normalizedAgreementHash)}`
  });
  const holds = Array.isArray(holdsResponse?.holds) ? holdsResponse.holds : [];
  if (holds.length !== 1) {
    throw new Error(`expected exactly 1 hold for agreementHash; found ${holds.length}`);
  }
  const hold = holds[0];

  const casesResponse = await requestJson({
    ...requestContext,
    method: "GET",
    pathname: `/tool-calls/arbitration/cases?agreementHash=${encodeURIComponent(normalizedAgreementHash)}`
  });
  const arbitrationCases = Array.isArray(casesResponse?.cases) ? casesResponse.cases : [];
  const arbitrationCase = selectPrimaryCase(arbitrationCases);

  const replayEvaluate = await requestJson({
    ...requestContext,
    method: "GET",
    pathname: `/ops/tool-calls/replay-evaluate?agreementHash=${encodeURIComponent(normalizedAgreementHash)}`
  });
  let x402Receipt = null;
  try {
    const receiptList = await requestJson({
      ...requestContext,
      method: "GET",
      pathname: `/x402/receipts?agreementId=${encodeURIComponent(normalizedAgreementHash)}&limit=1`
    });
    const receipts = Array.isArray(receiptList?.receipts) ? receiptList.receipts : [];
    x402Receipt = receipts[0] ?? null;
  } catch (err) {
    addIssue(issues, {
      code: "CLOSEPACK_X402_RECEIPT_FETCH_FAILED",
      severity: "warning",
      message: "failed to fetch x402 receipt for agreementHash",
      details: { message: err?.message ?? String(err ?? "") }
    });
    x402Receipt = null;
  }
  const x402ZkEvidence = extractX402ReceiptZkEvidence(x402Receipt);
  const x402ZkProtocol =
    typeof x402ZkEvidence?.protocol === "string" && x402ZkEvidence.protocol.trim() !== ""
      ? x402ZkEvidence.protocol.trim().toLowerCase()
      : null;
  const x402ZkPublicSignals = Array.isArray(x402ZkEvidence?.publicSignals) ? x402ZkEvidence.publicSignals : [];
  const x402ZkProofData =
    x402ZkEvidence?.proofData && typeof x402ZkEvidence.proofData === "object" && !Array.isArray(x402ZkEvidence.proofData)
      ? x402ZkEvidence.proofData
      : null;
  const x402ZkVerificationKey =
    x402ZkEvidence?.verificationKey &&
    typeof x402ZkEvidence.verificationKey === "object" &&
    !Array.isArray(x402ZkEvidence.verificationKey)
      ? x402ZkEvidence.verificationKey
      : null;

  const adjustmentId = deterministicAdjustmentId(normalizedAgreementHash);
  const adjustmentResponse = await requestJson({
    ...requestContext,
    method: "GET",
    pathname: `/ops/settlement-adjustments/${encodeURIComponent(adjustmentId)}`,
    allowNotFound: true
  });
  const settlementAdjustment = adjustmentResponse?.adjustment ?? null;
  let reputationEvents = [];
  try {
    const reputationFacts = await requestJson({
      ...requestContext,
      method: "GET",
      pathname: `/ops/reputation/facts?agentId=${encodeURIComponent(String(hold?.payeeAgentId ?? ""))}&toolId=tool_call&window=allTime&includeEvents=1`
    });
    reputationEvents = normalizeReputationEventsForAgreement({
      events: reputationFacts?.events,
      agreementHash: normalizedAgreementHash
    });
  } catch (err) {
    addIssue(issues, {
      code: "CLOSEPACK_REPUTATION_FETCH_FAILED",
      severity: "warning",
      message: "failed to fetch reputation facts for closepack",
      details: { message: err?.message ?? String(err ?? "") }
    });
    reputationEvents = [];
  }

  const envelopeArtifactId =
    arbitrationCase?.metadata && typeof arbitrationCase.metadata === "object"
      ? String(arbitrationCase.metadata?.disputeOpenEnvelopeRef?.artifactId ?? "").trim() || null
      : null;

  const caseArtifactId = deterministicCaseArtifactId(arbitrationCase);
  const verdictId =
    typeof arbitrationCase?.verdictId === "string" && arbitrationCase.verdictId.trim() !== ""
      ? arbitrationCase.verdictId.trim()
      : null;
  const verdictArtifactId =
    typeof replayEvaluate?.stored?.arbitrationVerdictArtifactId === "string" && replayEvaluate.stored.arbitrationVerdictArtifactId.trim() !== ""
      ? replayEvaluate.stored.arbitrationVerdictArtifactId.trim()
      : verdictId
        ? `arbitration_verdict_${verdictId}`
        : null;

  const requestedArtifactIds = [envelopeArtifactId, caseArtifactId, verdictArtifactId]
    .concat(
      reputationEvents
        .map((event) => String(event?.sourceRef?.artifactId ?? "").trim())
        .filter((id) => id !== "")
    )
    .filter((id) => typeof id === "string" && id.trim() !== "");
  const uniqueArtifactIds = [...new Set(requestedArtifactIds)];
  const artifactPairs = await Promise.all(
    uniqueArtifactIds.map(async (artifactId) => ({ artifactId, artifact: await fetchArtifact({ requestContext, artifactId, issues, required: false }) }))
  );
  const artifacts = artifactPairs.filter((row) => row.artifact).map((row) => row.artifact);

  const artifactRefs = artifactPairs.map((row) => {
    const artifact = row.artifact;
    const artifactHash = artifact ? extractArtifactHash(artifact) : null;
    const schemaVersion = artifact ? String(artifact?.schemaVersion ?? "") : null;
    return {
      artifactId: row.artifactId,
      schemaVersion,
      artifactHash,
      path: `artifacts/${safeFileSegment(row.artifactId)}.json`,
      present: Boolean(artifact)
    };
  });

  const agentIdSet = new Set([
    hold?.payerAgentId,
    hold?.payeeAgentId,
    arbitrationCase?.claimantAgentId,
    arbitrationCase?.respondentAgentId,
    arbitrationCase?.arbiterAgentId
  ]);

  const envelopeArtifact = artifacts.find((item) => String(item?.schemaVersion ?? "") === DISPUTE_OPEN_ENVELOPE_SCHEMA_VERSION) ?? null;
  const verdictArtifact = artifacts.find((item) => String(item?.schemaVersion ?? "") === "ArbitrationVerdict.v1") ?? null;
  if (envelopeArtifact?.openedByAgentId) agentIdSet.add(String(envelopeArtifact.openedByAgentId));
  if (verdictArtifact?.arbiterAgentId) agentIdSet.add(String(verdictArtifact.arbiterAgentId));

  const agentIds = [...agentIdSet]
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .map((value) => String(value).trim())
    .sort((left, right) => left.localeCompare(right));

  const identities = (
    await Promise.all(agentIds.map(async (agentId) => ({ agentId, agentIdentity: await fetchAgentIdentity({ requestContext, agentId, issues }) })))
  )
    .filter((row) => row.agentIdentity)
    .map((row) => row.agentIdentity);

  const graph = [];
  graph.push({ from: `agreement:${normalizedAgreementHash}`, to: `hold:${String(hold?.holdHash ?? "")}`, reason: "agreementHash" });
  if (arbitrationCase?.caseId) graph.push({ from: `hold:${String(hold?.holdHash ?? "")}`, to: `case:${String(arbitrationCase.caseId)}`, reason: "holdHash" });
  if (envelopeArtifact?.artifactId) {
    graph.push({ from: `case:${String(arbitrationCase?.caseId ?? "")}`, to: `artifact:${String(envelopeArtifact.artifactId)}`, reason: "disputeOpenEnvelopeRef" });
  }
  if (verdictArtifact?.artifactId) {
    graph.push({ from: `case:${String(arbitrationCase?.caseId ?? "")}`, to: `artifact:${String(verdictArtifact.artifactId)}`, reason: "verdictId" });
  }
  if (settlementAdjustment?.adjustmentId) {
    graph.push({ from: `hold:${String(hold?.holdHash ?? "")}`, to: `adjustment:${String(settlementAdjustment.adjustmentId)}`, reason: "holdback_adjustment" });
  }
  for (const event of reputationEvents) {
    const eventId = String(event?.eventId ?? "").trim();
    if (!eventId) continue;
    const sourceRef = event?.sourceRef && typeof event.sourceRef === "object" && !Array.isArray(event.sourceRef) ? event.sourceRef : null;
    graph.push({ from: `agreement:${normalizedAgreementHash}`, to: `reputation:${eventId}`, reason: "reputation_event" });
    if (sourceRef?.artifactId) {
      graph.push({
        from: `reputation:${eventId}`,
        to: `artifact:${String(sourceRef.artifactId)}`,
        reason: "sourceRef.artifactId"
      });
    }
    if (sourceRef?.sourceId && String(sourceRef?.kind ?? "").toLowerCase() === "settlement_adjustment") {
      graph.push({
        from: `reputation:${eventId}`,
        to: `adjustment:${String(sourceRef.sourceId)}`,
        reason: "sourceRef.sourceId"
      });
    }
    if (sourceRef?.holdHash) {
      graph.push({
        from: `reputation:${eventId}`,
        to: `hold:${String(sourceRef.holdHash)}`,
        reason: "sourceRef.holdHash"
      });
    }
  }

  const createdAt = new Date().toISOString();

  const closepack = normalizeForCanonicalJson(
    {
      schemaVersion: CLOSEPACK_SCHEMA_VERSION,
      closepackVersion: "v0",
      createdAt,
      root: {
        kind: "tool_call",
        agreementHash: normalizedAgreementHash,
        runId: `tc_${normalizedAgreementHash}`
      },
      subject: {
        agreementHash: normalizedAgreementHash,
        receiptHash: String(hold?.receiptHash ?? ""),
        holdHash: String(hold?.holdHash ?? ""),
        x402ReceiptId:
          typeof x402Receipt?.receiptId === "string" && x402Receipt.receiptId.trim() !== "" ? x402Receipt.receiptId.trim() : null,
        caseId: arbitrationCase?.caseId ?? null,
        adjustmentId
      },
      files: {
        hold: "state/funding_hold.json",
        x402Receipt: x402Receipt ? "state/x402_receipt.json" : null,
        x402ZkProof:
          x402ZkProofData && typeof x402ZkProofData === "object" && x402ZkProtocol ? "evidence/zk/proof.json" : null,
        x402ZkPublicSignals:
          Array.isArray(x402ZkPublicSignals) && x402ZkPublicSignals.length > 0 && x402ZkProtocol ? "evidence/zk/public.json" : null,
        x402ZkVerificationKey:
          x402ZkVerificationKey && typeof x402ZkVerificationKey === "object" && x402ZkProtocol ? "evidence/zk/verification_key.json" : null,
        arbitrationCase: arbitrationCase ? "state/arbitration_case.json" : null,
        settlementAdjustment: settlementAdjustment ? "state/settlement_adjustment.json" : null,
        reputationEvents: reputationEvents.length > 0 ? "state/reputation_events.json" : null,
        replay: "reports/replay.json"
      },
      artifactRefs,
      reputation: {
        agentId: String(hold?.payeeAgentId ?? ""),
        toolId: "tool_call",
        eventCount: reputationEvents.length,
        eventIds: reputationEvents.map((event) => String(event?.eventId ?? "")).filter(Boolean)
      },
      identityRefs: identities
        .map((identity) => ({
          agentId: String(identity?.agentId ?? ""),
          keyId: String(identity?.keys?.keyId ?? ""),
          path: `identities/${safeFileSegment(String(identity?.agentId ?? "agent"))}.json`
        }))
        .filter((row) => row.agentId !== "" && row.keyId !== ""),
      graph,
      exportIssues: issues
    },
    { path: "$" }
  );

  const files = new Map();
  appendFile(files, "closepack.json", closepack);
  appendFile(files, "state/funding_hold.json", hold);
  if (x402Receipt && typeof x402Receipt === "object" && !Array.isArray(x402Receipt)) {
    appendFile(files, "state/x402_receipt.json", x402Receipt);
  }
  if (x402ZkProofData && typeof x402ZkProofData === "object" && !Array.isArray(x402ZkProofData) && x402ZkProtocol) {
    appendFile(files, "evidence/zk/proof.json", {
      schemaVersion: "X402ExecutionProofData.v1",
      protocol: x402ZkProtocol,
      proofData: x402ZkProofData
    });
  }
  if (Array.isArray(x402ZkPublicSignals) && x402ZkPublicSignals.length > 0 && x402ZkProtocol) {
    appendFile(files, "evidence/zk/public.json", {
      schemaVersion: "X402ExecutionProofPublicSignals.v1",
      protocol: x402ZkProtocol,
      publicSignals: x402ZkPublicSignals
    });
  }
  if (x402ZkVerificationKey && typeof x402ZkVerificationKey === "object" && !Array.isArray(x402ZkVerificationKey) && x402ZkProtocol) {
    appendFile(files, "evidence/zk/verification_key.json", {
      schemaVersion: "X402ExecutionProofVerificationKey.v1",
      protocol: x402ZkProtocol,
      verificationKey: x402ZkVerificationKey
    });
  }
  if (arbitrationCase) appendFile(files, "state/arbitration_case.json", arbitrationCase);
  if (settlementAdjustment) appendFile(files, "state/settlement_adjustment.json", settlementAdjustment);
  if (reputationEvents.length > 0) {
    appendFile(files, "state/reputation_events.json", {
      schemaVersion: "KernelToolCallReputationEvents.v0",
      agreementHash: normalizedAgreementHash,
      agentId: String(hold?.payeeAgentId ?? ""),
      toolId: "tool_call",
      events: reputationEvents
    });
  }
  appendFile(files, "reports/replay.json", replayEvaluate);

  for (const row of artifactPairs) {
    if (!row.artifact) continue;
    appendFile(files, `artifacts/${safeFileSegment(row.artifactId)}.json`, row.artifact);
  }

  for (const identity of identities) {
    appendFile(files, `identities/${safeFileSegment(String(identity.agentId))}.json`, identity);
  }

  const zipBytes = buildDeterministicZipStore({ files, mtime: FIXED_ZIP_MTIME });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, Buffer.from(zipBytes));

  return {
    schemaVersion: "KernelToolCallClosePackExportResult.v0",
    ok: true,
    outPath: outputPath,
    zipSha256: sha256HexBytes(zipBytes),
    closepack,
    stats: {
      artifactsPresent: artifacts.length,
      artifactsExpected: artifactRefs.length,
      identities: identities.length,
      issues: issues.length
    }
  };
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function verifyToolCallClosepackZip({ zipPath } = {}) {
  const resolvedZip = path.resolve(assertNonEmptyString(zipPath, "zipPath"));
  const unzip = await unzipToTempSafe({ zipPath: resolvedZip });
  if (!unzip.ok) {
    return {
      schemaVersion: VERIFY_REPORT_SCHEMA_VERSION,
      verifiedAt: new Date().toISOString(),
      ok: false,
      replayMatch: false,
      issues: [
        {
          code: "CLOSEPACK_ZIP_INVALID",
          severity: "error",
          message: String(unzip.error ?? "zip parse failed"),
          details: unzip.detail ?? null
        }
      ]
    };
  }

  const tmpDir = unzip.dir;
  const issues = [];
  try {
    const closepackPath = path.join(tmpDir, "closepack.json");
    let closepack = null;
    try {
      closepack = await readJsonFile(closepackPath);
    } catch (err) {
      addIssue(issues, {
        code: "CLOSEPACK_MISSING_CLOSEPACK_JSON",
        message: "closepack.json is missing or invalid",
        details: { message: err?.message ?? String(err ?? "") }
      });
      return {
        schemaVersion: VERIFY_REPORT_SCHEMA_VERSION,
        verifiedAt: new Date().toISOString(),
        ok: false,
        replayMatch: false,
        issues
      };
    }

    if (String(closepack?.schemaVersion ?? "") !== CLOSEPACK_SCHEMA_VERSION) {
      addIssue(issues, {
        code: "CLOSEPACK_SCHEMA_UNSUPPORTED",
        message: `unsupported closepack schemaVersion: ${String(closepack?.schemaVersion ?? "")}`,
        details: { expected: CLOSEPACK_SCHEMA_VERSION }
      });
    }

    const agreementHash = (() => {
      try {
        return normalizeSha256(closepack?.root?.agreementHash, "closepack.root.agreementHash");
      } catch (err) {
        addIssue(issues, {
          code: "CLOSEPACK_ROOT_INVALID",
          message: "closepack.root.agreementHash is invalid",
          details: { message: err?.message ?? String(err ?? "") }
        });
        return null;
      }
    })();

    const holdPath = path.join(tmpDir, "state", "funding_hold.json");
    let hold = null;
    try {
      hold = await readJsonFile(holdPath);
      validateFundingHoldV1(hold);
    } catch (err) {
      addIssue(issues, {
        code: "CLOSEPACK_HOLD_INVALID",
        message: "funding hold missing or invalid",
        details: { message: err?.message ?? String(err ?? "") }
      });
    }

    const casePath = path.join(tmpDir, "state", "arbitration_case.json");
    let arbitrationCase = null;
    try {
      arbitrationCase = await readJsonFile(casePath);
    } catch {
      arbitrationCase = null;
    }

    const adjustmentPath = path.join(tmpDir, "state", "settlement_adjustment.json");
    let settlementAdjustment = null;
    try {
      settlementAdjustment = await readJsonFile(adjustmentPath);
      validateSettlementAdjustmentV1(settlementAdjustment);
    } catch {
      settlementAdjustment = null;
    }

    const replayPath = path.join(tmpDir, "reports", "replay.json");
    let replay = null;
    try {
      replay = await readJsonFile(replayPath);
    } catch {
      replay = null;
    }
    const reputationEventsPath = path.join(tmpDir, "state", "reputation_events.json");
    let reputationEvents = [];
    let reputationEnvelope = null;
    try {
      reputationEnvelope = await readJsonFile(reputationEventsPath);
      if (Array.isArray(reputationEnvelope?.events)) reputationEvents = reputationEnvelope.events;
    } catch (err) {
      if (String(closepack?.files?.reputationEvents ?? "").trim() !== "") {
        addIssue(issues, {
          code: "CLOSEPACK_REPUTATION_EVENTS_MISSING",
          message: "state/reputation_events.json is missing or invalid",
          details: { message: err?.message ?? String(err ?? "") }
        });
      }
      reputationEvents = [];
      reputationEnvelope = null;
    }
    const x402ReceiptPath = path.join(tmpDir, "state", "x402_receipt.json");
    let x402Receipt = null;
    try {
      x402Receipt = await readJsonFile(x402ReceiptPath);
    } catch (err) {
      if (String(closepack?.files?.x402Receipt ?? "").trim() !== "") {
        addIssue(issues, {
          code: "CLOSEPACK_X402_RECEIPT_MISSING",
          message: "state/x402_receipt.json is missing or invalid",
          details: { message: err?.message ?? String(err ?? "") }
        });
      }
      x402Receipt = null;
    }
    const x402ZkProofPath = path.join(tmpDir, "evidence", "zk", "proof.json");
    const x402ZkPublicSignalsPath = path.join(tmpDir, "evidence", "zk", "public.json");
    const x402ZkVerificationKeyPath = path.join(tmpDir, "evidence", "zk", "verification_key.json");
    let x402ZkProofFile = null;
    let x402ZkPublicSignalsFile = null;
    let x402ZkVerificationKeyFile = null;
    try {
      x402ZkProofFile = await readJsonFile(x402ZkProofPath);
    } catch {
      x402ZkProofFile = null;
    }
    try {
      x402ZkPublicSignalsFile = await readJsonFile(x402ZkPublicSignalsPath);
    } catch {
      x402ZkPublicSignalsFile = null;
    }
    try {
      x402ZkVerificationKeyFile = await readJsonFile(x402ZkVerificationKeyPath);
    } catch {
      x402ZkVerificationKeyFile = null;
    }

    if (hold && agreementHash && String(hold.agreementHash ?? "").toLowerCase() !== agreementHash) {
      addIssue(issues, {
        code: "CLOSEPACK_BINDING_HOLD_AGREEMENT_MISMATCH",
        message: "hold.agreementHash does not match closepack root agreementHash",
        details: { holdAgreementHash: hold.agreementHash, agreementHash }
      });
    }

    if (settlementAdjustment && hold) {
      const expectedAdjustmentId = deterministicAdjustmentId(String(hold.agreementHash ?? "").toLowerCase());
      if (String(settlementAdjustment.adjustmentId ?? "") !== expectedAdjustmentId) {
        addIssue(issues, {
          code: "CLOSEPACK_ADJUSTMENT_ID_NOT_DETERMINISTIC",
          message: "settlement adjustment id does not match deterministic pattern",
          details: { expectedAdjustmentId, actualAdjustmentId: settlementAdjustment.adjustmentId ?? null }
        });
      }
      if (String(settlementAdjustment.holdHash ?? "").toLowerCase() !== String(hold.holdHash ?? "").toLowerCase()) {
        addIssue(issues, {
          code: "CLOSEPACK_BINDING_ADJUSTMENT_HOLD_MISMATCH",
          message: "settlement adjustment holdHash does not match funding hold",
          details: { holdHash: hold.holdHash ?? null, adjustmentHoldHash: settlementAdjustment.holdHash ?? null }
        });
      }
      if (Number(settlementAdjustment.amountCents ?? -1) !== Number(hold.heldAmountCents ?? -2)) {
        addIssue(issues, {
          code: "CLOSEPACK_BINDING_ADJUSTMENT_AMOUNT_MISMATCH",
          message: "settlement adjustment amountCents does not match hold heldAmountCents",
          details: { adjustmentAmountCents: settlementAdjustment.amountCents ?? null, heldAmountCents: hold.heldAmountCents ?? null }
        });
      }
    }

    const identityRefs = Array.isArray(closepack?.identityRefs) ? closepack.identityRefs : [];
    const identities = [];
    for (const ref of identityRefs) {
      const p = typeof ref?.path === "string" && ref.path.trim() !== "" ? ref.path.trim() : null;
      if (!p) continue;
      const fp = path.join(tmpDir, ...p.split("/"));
      try {
        identities.push(await readJsonFile(fp));
      } catch (err) {
        addIssue(issues, {
          code: "CLOSEPACK_IDENTITY_REF_MISSING",
          message: `identity file missing: ${p}`,
          details: { message: err?.message ?? String(err ?? "") }
        });
      }
    }
    const publicKeyByKeyId = buildPublicKeyMap(identities);

    const artifactRefs = Array.isArray(closepack?.artifactRefs) ? closepack.artifactRefs : [];
    const artifacts = [];
    for (const ref of artifactRefs) {
      const artifactId = typeof ref?.artifactId === "string" ? ref.artifactId.trim() : "";
      const p = typeof ref?.path === "string" && ref.path.trim() !== "" ? ref.path.trim() : null;
      if (!artifactId || !p) continue;
      const fp = path.join(tmpDir, ...p.split("/"));
      try {
        const artifact = await readJsonFile(fp);
        artifacts.push(artifact);

        const fileArtifactId = typeof artifact?.artifactId === "string" && artifact.artifactId.trim() !== "" ? artifact.artifactId.trim() : null;
        if (fileArtifactId && fileArtifactId !== artifactId) {
          addIssue(issues, {
            code: "CLOSEPACK_ARTIFACT_ID_MISMATCH",
            message: "artifactRef artifactId does not match artifact body",
            details: { artifactIdRef: artifactId, artifactIdBody: fileArtifactId }
          });
        }

        const refHash = typeof ref?.artifactHash === "string" && ref.artifactHash.trim() !== "" ? ref.artifactHash.trim().toLowerCase() : null;
        const bodyHash = extractArtifactHash(artifact);
        if (bodyHash) {
          const computed = computeStoredArtifactHash(artifact);
          if (computed !== bodyHash) {
            addIssue(issues, {
              code: "CLOSEPACK_ARTIFACT_HASH_MISMATCH",
              message: "artifact hash mismatch",
              details: { artifactId, expected: bodyHash, computed }
            });
          }
          if (refHash && refHash !== bodyHash) {
            addIssue(issues, {
              code: "CLOSEPACK_ARTIFACT_REF_HASH_MISMATCH",
              message: "artifactRef hash does not match artifact body hash",
              details: { artifactId, refHash, bodyHash }
            });
          }
        } else {
          addIssue(issues, {
            code: "CLOSEPACK_ARTIFACT_HASH_MISSING",
            message: "artifact body is missing artifactHash",
            details: { artifactId }
          });
        }
      } catch (err) {
        if (ref?.present === false) {
          addIssue(issues, {
            code: "CLOSEPACK_ARTIFACT_OPTIONAL_MISSING",
            severity: "warning",
            message: `optional artifact missing: ${artifactId}`,
            details: { message: err?.message ?? String(err ?? "") }
          });
        } else {
          addIssue(issues, {
            code: "CLOSEPACK_ARTIFACT_REF_MISSING",
            message: `artifact file missing: ${artifactId}`,
            details: { message: err?.message ?? String(err ?? "") }
          });
        }
      }
    }

    const envelopeArtifact = artifacts.find((artifact) => String(artifact?.schemaVersion ?? "") === DISPUTE_OPEN_ENVELOPE_SCHEMA_VERSION) ?? null;
    if (envelopeArtifact) {
      try {
        validateDisputeOpenEnvelopeV1(envelopeArtifact);
      } catch (err) {
        addIssue(issues, {
          code: "CLOSEPACK_ENVELOPE_INVALID",
          message: "dispute-open envelope artifact is invalid",
          details: { message: err?.message ?? String(err ?? "") }
        });
      }

      const signerKeyId = typeof envelopeArtifact.signerKeyId === "string" ? envelopeArtifact.signerKeyId.trim() : "";
      const publicKeyPem = signerKeyId ? publicKeyByKeyId.get(signerKeyId) : null;
      if (!publicKeyPem) {
        addIssue(issues, {
          code: "CLOSEPACK_ENVELOPE_SIGNER_KEY_MISSING",
          message: "missing signer public key for dispute-open envelope",
          details: { signerKeyId: signerKeyId || null }
        });
      } else {
        const valid = verifyHashHexEd25519({
          hashHex: String(envelopeArtifact.envelopeHash ?? ""),
          signatureBase64: String(envelopeArtifact.signature ?? ""),
          publicKeyPem
        });
        if (!valid) {
          addIssue(issues, {
            code: "CLOSEPACK_ENVELOPE_SIGNATURE_INVALID",
            message: "dispute-open envelope signature verification failed"
          });
        }
      }

      if (hold) {
        if (String(envelopeArtifact.agreementHash ?? "").toLowerCase() !== String(hold.agreementHash ?? "").toLowerCase()) {
          addIssue(issues, {
            code: "CLOSEPACK_BINDING_ENVELOPE_AGREEMENT_MISMATCH",
            message: "envelope agreementHash does not match hold agreementHash"
          });
        }
        if (String(envelopeArtifact.receiptHash ?? "").toLowerCase() !== String(hold.receiptHash ?? "").toLowerCase()) {
          addIssue(issues, {
            code: "CLOSEPACK_BINDING_ENVELOPE_RECEIPT_MISMATCH",
            message: "envelope receiptHash does not match hold receiptHash"
          });
        }
        if (String(envelopeArtifact.holdHash ?? "").toLowerCase() !== String(hold.holdHash ?? "").toLowerCase()) {
          addIssue(issues, {
            code: "CLOSEPACK_BINDING_ENVELOPE_HOLD_MISMATCH",
            message: "envelope holdHash does not match hold holdHash"
          });
        }
      }
    }

    const verdictArtifact = artifacts.find((artifact) => String(artifact?.schemaVersion ?? "") === "ArbitrationVerdict.v1") ?? null;
    if (verdictArtifact) {
      const sig = verdictArtifact?.signature && typeof verdictArtifact.signature === "object" ? verdictArtifact.signature : null;
      if (!sig) {
        addIssue(issues, {
          code: "CLOSEPACK_VERDICT_SIGNATURE_MISSING",
          message: "arbitration verdict artifact signature is missing"
        });
      } else {
        const computedVerdictHash = computeArbitrationVerdictHash(verdictArtifact);
        if (String(sig.verdictHash ?? "").toLowerCase() !== computedVerdictHash.toLowerCase()) {
          addIssue(issues, {
            code: "CLOSEPACK_VERDICT_HASH_MISMATCH",
            message: "arbitration verdict signature verdictHash does not match computed hash",
            details: { expected: computedVerdictHash, actual: sig.verdictHash ?? null }
          });
        }
        const signerKeyId = typeof sig.signerKeyId === "string" ? sig.signerKeyId.trim() : "";
        const publicKeyPem = signerKeyId ? publicKeyByKeyId.get(signerKeyId) : null;
        if (!publicKeyPem) {
          addIssue(issues, {
            code: "CLOSEPACK_VERDICT_SIGNER_KEY_MISSING",
            message: "missing signer public key for arbitration verdict",
            details: { signerKeyId: signerKeyId || null }
          });
        } else {
          const valid = verifyHashHexEd25519({
            hashHex: String(sig.verdictHash ?? ""),
            signatureBase64: String(sig.signature ?? ""),
            publicKeyPem
          });
          if (!valid) {
            addIssue(issues, {
              code: "CLOSEPACK_VERDICT_SIGNATURE_INVALID",
              message: "arbitration verdict signature verification failed"
            });
          }
        }
      }

      if (arbitrationCase) {
        if (String(verdictArtifact.caseId ?? "") !== String(arbitrationCase.caseId ?? "")) {
          addIssue(issues, {
            code: "CLOSEPACK_BINDING_VERDICT_CASE_MISMATCH",
            message: "verdict caseId does not match arbitration case caseId"
          });
        }
        if (arbitrationCase?.verdictHash && String(arbitrationCase.verdictHash ?? "").toLowerCase() !== String(sig?.verdictHash ?? "").toLowerCase()) {
          addIssue(issues, {
            code: "CLOSEPACK_BINDING_VERDICT_HASH_MISMATCH",
            message: "arbitration case verdictHash does not match verdict artifact signature hash"
          });
        }
      }
    }

    if (arbitrationCase && hold) {
      const meta = arbitrationCase?.metadata && typeof arbitrationCase.metadata === "object" ? arbitrationCase.metadata : null;
      if (!meta || String(meta.caseType ?? "").toLowerCase() !== "tool_call") {
        addIssue(issues, {
          code: "CLOSEPACK_CASE_METADATA_INVALID",
          message: "arbitration case metadata.caseType must be tool_call"
        });
      } else {
        if (String(meta.agreementHash ?? "").toLowerCase() !== String(hold.agreementHash ?? "").toLowerCase()) {
          addIssue(issues, {
            code: "CLOSEPACK_BINDING_CASE_AGREEMENT_MISMATCH",
            message: "arbitration case agreementHash does not match hold"
          });
        }
        if (String(meta.receiptHash ?? "").toLowerCase() !== String(hold.receiptHash ?? "").toLowerCase()) {
          addIssue(issues, {
            code: "CLOSEPACK_BINDING_CASE_RECEIPT_MISMATCH",
            message: "arbitration case receiptHash does not match hold"
          });
        }
        if (String(meta.holdHash ?? "").toLowerCase() !== String(hold.holdHash ?? "").toLowerCase()) {
          addIssue(issues, {
            code: "CLOSEPACK_BINDING_CASE_HOLD_MISMATCH",
            message: "arbitration case holdHash does not match hold"
          });
        }
      }
    }

    if (verdictArtifact && settlementAdjustment) {
      const releaseRatePct = Number(verdictArtifact.releaseRatePct);
      const expectedKind =
        releaseRatePct === 100
          ? SETTLEMENT_ADJUSTMENT_KIND.HOLDBACK_RELEASE
          : releaseRatePct === 0
            ? SETTLEMENT_ADJUSTMENT_KIND.HOLDBACK_REFUND
            : null;
      if (expectedKind && String(settlementAdjustment.kind ?? "").toLowerCase() !== String(expectedKind)) {
        addIssue(issues, {
          code: "CLOSEPACK_BINDING_ADJUSTMENT_KIND_MISMATCH",
          message: "settlement adjustment kind does not match verdict releaseRatePct",
          details: { expectedKind, actualKind: settlementAdjustment.kind ?? null }
        });
      }
    }

    const artifactById = new Map();
    const knownHashes = new Map();
    function rememberHashTarget(hash, target) {
      const normalized = typeof hash === "string" && /^[0-9a-f]{64}$/i.test(hash.trim()) ? hash.trim().toLowerCase() : null;
      if (!normalized) return;
      if (!knownHashes.has(normalized)) knownHashes.set(normalized, new Set());
      knownHashes.get(normalized).add(String(target));
    }
    for (const artifact of artifacts) {
      const artifactId = typeof artifact?.artifactId === "string" ? artifact.artifactId.trim() : "";
      const artifactHash = extractArtifactHash(artifact);
      if (artifactId) artifactById.set(artifactId, artifact);
      if (artifactHash) rememberHashTarget(artifactHash, `artifact:${artifactId}`);
    }
    if (hold?.holdHash) rememberHashTarget(String(hold.holdHash), `hold:${String(hold.holdHash)}`);
    if (settlementAdjustment?.adjustmentHash) {
      rememberHashTarget(String(settlementAdjustment.adjustmentHash), `adjustment:${String(settlementAdjustment.adjustmentId ?? "")}`);
    }

    const graphRows = Array.isArray(closepack?.graph) ? closepack.graph : [];
    const graphTargetsByFrom = new Map();
    for (const edge of graphRows) {
      const from = typeof edge?.from === "string" ? edge.from.trim() : "";
      const to = typeof edge?.to === "string" ? edge.to.trim() : "";
      if (!from || !to) continue;
      if (!graphTargetsByFrom.has(from)) graphTargetsByFrom.set(from, new Set());
      graphTargetsByFrom.get(from).add(to);
    }

    let reputationSourceRefsChecked = 0;
    let reputationSourceRefsUnresolved = 0;
    let reputationGraphEdgesMissing = 0;
    for (const event of reputationEvents) {
      const eventId = String(event?.eventId ?? "").trim();
      if (!eventId) {
        addIssue(issues, {
          code: "CLOSEPACK_REPUTATION_EVENT_ID_MISSING",
          message: "reputation event is missing eventId"
        });
        continue;
      }
      try {
        validateReputationEventV1(event);
      } catch (err) {
        addIssue(issues, {
          code: "CLOSEPACK_REPUTATION_EVENT_INVALID",
          message: "reputation event artifact is invalid",
          details: { eventId, message: err?.message ?? String(err ?? "") }
        });
        continue;
      }
      const sourceRef = event?.sourceRef && typeof event.sourceRef === "object" && !Array.isArray(event.sourceRef) ? event.sourceRef : null;
      if (!sourceRef) continue;
      reputationSourceRefsChecked += 1;

      if (sourceRef.hash) {
        const hashKey = String(sourceRef.hash).toLowerCase();
        if (!knownHashes.has(hashKey)) {
          reputationSourceRefsUnresolved += 1;
          addIssue(issues, {
            code: "CLOSEPACK_REPUTATION_SOURCE_HASH_UNRESOLVED",
            message: "reputation sourceRef.hash does not resolve to a closepack artifact/hold/adjustment hash",
            details: { eventId, sourceHash: sourceRef.hash }
          });
        }
      }

      const expectedTargets = [];
      if (sourceRef.artifactId) {
        expectedTargets.push(`artifact:${String(sourceRef.artifactId)}`);
        const artifact = artifactById.get(String(sourceRef.artifactId));
        if (!artifact) {
          addIssue(issues, {
            code: "CLOSEPACK_REPUTATION_SOURCE_ARTIFACT_MISSING",
            message: "reputation sourceRef.artifactId is not present in closepack artifacts",
            details: { eventId, artifactId: sourceRef.artifactId }
          });
        } else if (sourceRef.hash) {
          const artifactHash = extractArtifactHash(artifact);
          if (artifactHash && artifactHash !== String(sourceRef.hash).toLowerCase()) {
            addIssue(issues, {
              code: "CLOSEPACK_REPUTATION_SOURCE_ARTIFACT_HASH_MISMATCH",
              message: "reputation sourceRef.hash does not match referenced artifact hash",
              details: { eventId, artifactId: sourceRef.artifactId, sourceHash: sourceRef.hash, artifactHash }
            });
          }
        }
      }
      if (String(sourceRef.kind ?? "").toLowerCase() === "settlement_adjustment" && sourceRef.sourceId) {
        expectedTargets.push(`adjustment:${String(sourceRef.sourceId)}`);
      }
      if (sourceRef.holdHash) {
        expectedTargets.push(`hold:${String(sourceRef.holdHash)}`);
      }
      if (expectedTargets.length > 0) {
        const from = `reputation:${eventId}`;
        const graphTargets = graphTargetsByFrom.get(from) ?? new Set();
        const hasExpectedEdge = expectedTargets.some((target) => graphTargets.has(target));
        if (!hasExpectedEdge) {
          reputationGraphEdgesMissing += 1;
          addIssue(issues, {
            code: "CLOSEPACK_REPUTATION_GRAPH_EDGE_MISSING",
            message: "closepack graph is missing expected reputation source edge",
            details: { eventId, expectedTargets, graphTargets: [...graphTargets] }
          });
        }
      }
    }

    let replayMatch = false;
    if (replay && typeof replay === "object") {
      replayMatch = replay?.comparisons?.chainConsistent === true;
      if (!replayMatch) {
        addIssue(issues, {
          code: "CLOSEPACK_REPLAY_MISMATCH",
          message: "replay report comparisons.chainConsistent is not true",
          details: { comparisons: replay?.comparisons ?? null, issues: replay?.issues ?? null }
        });
      }
      if (settlementAdjustment && replay?.replay?.expected?.adjustmentKind) {
        const expectedKind = String(replay.replay.expected.adjustmentKind ?? "").toLowerCase();
        if (expectedKind && String(settlementAdjustment.kind ?? "").toLowerCase() !== expectedKind) {
          addIssue(issues, {
            code: "CLOSEPACK_REPLAY_ADJUSTMENT_KIND_MISMATCH",
            message: "replay expected adjustment kind does not match settlement adjustment",
            details: { expectedKind, actualKind: settlementAdjustment.kind ?? null }
          });
        }
      }
    } else {
      addIssue(issues, {
        code: "CLOSEPACK_REPLAY_REPORT_MISSING",
        message: "reports/replay.json is missing",
        severity: "warning"
      });
    }

    let x402ZkVerification = null;
    if (x402Receipt && isPlainObject(x402Receipt)) {
      const receiptZkEvidence = extractX402ReceiptZkEvidence(x402Receipt);
      if (receiptZkEvidence && isPlainObject(receiptZkEvidence)) {
        const required = receiptZkEvidence.required === true;
        const protocolFromReceipt =
          typeof receiptZkEvidence.protocol === "string" && receiptZkEvidence.protocol.trim() !== ""
            ? receiptZkEvidence.protocol.trim().toLowerCase()
            : null;
        const proofDataFromReceipt =
          receiptZkEvidence.proofData && typeof receiptZkEvidence.proofData === "object" && !Array.isArray(receiptZkEvidence.proofData)
            ? receiptZkEvidence.proofData
            : null;
        const publicSignalsFromReceipt = Array.isArray(receiptZkEvidence.publicSignals) ? receiptZkEvidence.publicSignals : null;
        const verificationKeyFromReceipt =
          receiptZkEvidence.verificationKey &&
          typeof receiptZkEvidence.verificationKey === "object" &&
          !Array.isArray(receiptZkEvidence.verificationKey)
            ? receiptZkEvidence.verificationKey
            : null;
        const verificationKeyRefFromReceipt =
          typeof receiptZkEvidence.verificationKeyRef === "string" && receiptZkEvidence.verificationKeyRef.trim() !== ""
            ? receiptZkEvidence.verificationKeyRef.trim()
            : null;

        const protocolFromFiles =
          typeof x402ZkProofFile?.protocol === "string" && x402ZkProofFile.protocol.trim() !== ""
            ? x402ZkProofFile.protocol.trim().toLowerCase()
            : typeof x402ZkPublicSignalsFile?.protocol === "string" && x402ZkPublicSignalsFile.protocol.trim() !== ""
              ? x402ZkPublicSignalsFile.protocol.trim().toLowerCase()
              : typeof x402ZkVerificationKeyFile?.protocol === "string" && x402ZkVerificationKeyFile.protocol.trim() !== ""
                ? x402ZkVerificationKeyFile.protocol.trim().toLowerCase()
                : null;
        const protocol = protocolFromReceipt ?? protocolFromFiles;

        const proofDataFromFiles =
          x402ZkProofFile?.proofData && typeof x402ZkProofFile.proofData === "object" && !Array.isArray(x402ZkProofFile.proofData)
            ? x402ZkProofFile.proofData
            : null;
        const publicSignalsFromFiles = Array.isArray(x402ZkPublicSignalsFile?.publicSignals) ? x402ZkPublicSignalsFile.publicSignals : null;
        const verificationKeyFromFiles =
          x402ZkVerificationKeyFile?.verificationKey &&
          typeof x402ZkVerificationKeyFile.verificationKey === "object" &&
          !Array.isArray(x402ZkVerificationKeyFile.verificationKey)
            ? x402ZkVerificationKeyFile.verificationKey
            : null;

        if (proofDataFromReceipt && proofDataFromFiles && !canonicalJsonEquals(proofDataFromReceipt, proofDataFromFiles)) {
          addIssue(issues, {
            code: "CLOSEPACK_X402_ZK_PROOF_MISMATCH",
            message: "x402 zk proof in receipt and evidence/zk/proof.json do not match"
          });
        }
        if (
          Array.isArray(publicSignalsFromReceipt) &&
          Array.isArray(publicSignalsFromFiles) &&
          canonicalJsonStringify(normalizeForCanonicalJson(publicSignalsFromReceipt, { path: "$" })) !==
            canonicalJsonStringify(normalizeForCanonicalJson(publicSignalsFromFiles, { path: "$" }))
        ) {
          addIssue(issues, {
            code: "CLOSEPACK_X402_ZK_PUBLIC_SIGNALS_MISMATCH",
            message: "x402 zk publicSignals in receipt and evidence/zk/public.json do not match"
          });
        }
        if (verificationKeyFromReceipt && verificationKeyFromFiles && !canonicalJsonEquals(verificationKeyFromReceipt, verificationKeyFromFiles)) {
          addIssue(issues, {
            code: "CLOSEPACK_X402_ZK_VERIFICATION_KEY_MISMATCH",
            message: "x402 zk verification key in receipt and evidence/zk/verification_key.json do not match"
          });
        }

        const proofData = proofDataFromFiles ?? proofDataFromReceipt;
        const publicSignals = publicSignalsFromFiles ?? publicSignalsFromReceipt;
        const verificationKey = verificationKeyFromFiles ?? verificationKeyFromReceipt;
        const statementHashSha256 =
          typeof receiptZkEvidence.statementHashSha256 === "string" && receiptZkEvidence.statementHashSha256.trim() !== ""
            ? receiptZkEvidence.statementHashSha256.trim().toLowerCase()
            : typeof x402Receipt?.bindings?.quote?.quoteSha256 === "string" && x402Receipt.bindings.quote.quoteSha256.trim() !== ""
              ? x402Receipt.bindings.quote.quoteSha256.trim().toLowerCase()
              : null;
        const inputDigestSha256 =
          typeof receiptZkEvidence.inputDigestSha256 === "string" && receiptZkEvidence.inputDigestSha256.trim() !== ""
            ? receiptZkEvidence.inputDigestSha256.trim().toLowerCase()
            : typeof x402Receipt?.bindings?.request?.sha256 === "string" && x402Receipt.bindings.request.sha256.trim() !== ""
              ? x402Receipt.bindings.request.sha256.trim().toLowerCase()
              : null;
        const outputDigestSha256 =
          typeof receiptZkEvidence.outputDigestSha256 === "string" && receiptZkEvidence.outputDigestSha256.trim() !== ""
            ? receiptZkEvidence.outputDigestSha256.trim().toLowerCase()
            : typeof x402Receipt?.bindings?.response?.sha256 === "string" && x402Receipt.bindings.response.sha256.trim() !== ""
              ? x402Receipt.bindings.response.sha256.trim().toLowerCase()
              : null;
        const hasProofMaterial =
          typeof protocol === "string" &&
          protocol.trim() !== "" &&
          Array.isArray(publicSignals) &&
          proofData &&
          typeof proofData === "object" &&
          !Array.isArray(proofData);

        if (!hasProofMaterial) {
          if (required) {
            addIssue(issues, {
              code: "CLOSEPACK_X402_ZK_PROOF_MISSING",
              message: "required x402 zk proof material is missing from closepack",
              details: {
                hasProtocol: Boolean(protocol),
                hasPublicSignals: Array.isArray(publicSignals),
                hasProofData: Boolean(proofData)
              }
            });
          }
        } else {
          x402ZkVerification = await verifyX402ExecutionProofV1({
            proof: {
              protocol,
              publicSignals,
              proofData,
              ...(verificationKey ? { verificationKey } : {}),
              ...(verificationKeyRefFromReceipt ? { verificationKeyRef: verificationKeyRefFromReceipt } : {}),
              ...(statementHashSha256 ? { statementHashSha256 } : {}),
              ...(inputDigestSha256 ? { inputDigestSha256 } : {}),
              ...(outputDigestSha256 ? { outputDigestSha256 } : {})
            },
            verificationKey,
            expectedVerificationKeyRef: verificationKeyRefFromReceipt,
            requiredProtocol: protocol,
            expectedBindings: {
              statementHashSha256,
              inputDigestSha256,
              outputDigestSha256
            },
            requireBindings: required
          });
          if (x402ZkVerification?.verified !== true) {
            if (required) {
              addIssue(issues, {
                code: "CLOSEPACK_X402_ZK_PROOF_INVALID",
                message: "required x402 zk proof failed offline verification",
                details: {
                  status: x402ZkVerification?.status ?? null,
                  code: x402ZkVerification?.code ?? null,
                  message: x402ZkVerification?.message ?? null
                }
              });
            } else {
              addIssue(issues, {
                code: "CLOSEPACK_X402_ZK_PROOF_OPTIONAL_UNVERIFIED",
                severity: "warning",
                message: "optional x402 zk proof did not verify offline",
                details: {
                  status: x402ZkVerification?.status ?? null,
                  code: x402ZkVerification?.code ?? null
                }
              });
            }
          }
        }
      }
    }

    const errorCount = issues.filter((issue) => issue.severity !== "warning").length;
    return {
      schemaVersion: VERIFY_REPORT_SCHEMA_VERSION,
      verifiedAt: new Date().toISOString(),
      ok: errorCount === 0,
      replayMatch,
      sourceRefResolution: {
        ok: reputationSourceRefsUnresolved === 0 && reputationGraphEdgesMissing === 0,
        checkedEvents: reputationEvents.length,
        checkedSourceRefs: reputationSourceRefsChecked,
        unresolvedHashes: reputationSourceRefsUnresolved,
        missingGraphEdges: reputationGraphEdgesMissing
      },
      summary: {
        agreementHash: agreementHash ?? null,
        holdHash: hold?.holdHash ?? null,
        caseId: arbitrationCase?.caseId ?? null,
        adjustmentId: settlementAdjustment?.adjustmentId ?? null,
        x402ReceiptId:
          typeof x402Receipt?.receiptId === "string" && x402Receipt.receiptId.trim() !== "" ? x402Receipt.receiptId.trim() : null,
        x402ZkVerified: x402ZkVerification?.verified === true,
        artifacts: artifacts.length,
        identities: identities.length,
        reputationEvents: reputationEvents.length
      },
      issues
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
