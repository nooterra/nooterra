import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../core/canonical-json.js";
import { sha256Hex } from "../../core/crypto.js";
import { verifySessionMemoryContractImportV1 } from "./contract-hooks.js";

export const SESSION_REPLAY_VERIFICATION_VERDICT_SCHEMA_VERSION = "SessionReplayVerificationVerdict.v1";

export const SESSION_REPLAY_VERIFICATION_REASON_CODES = Object.freeze({
  INPUT_INVALID: "SESSION_REPLAY_VERIFICATION_INPUT_INVALID",
  MEMORY_CONTRACT_INVALID: "SESSION_REPLAY_VERIFICATION_MEMORY_CONTRACT_INVALID",
  POLICY_DECISION_HASH_MISSING: "SESSION_REPLAY_VERIFICATION_POLICY_DECISION_HASH_MISSING",
  POLICY_DECISION_HASH_MISMATCH: "SESSION_REPLAY_VERIFICATION_POLICY_DECISION_HASH_MISMATCH",
  SETTLEMENT_REQUIRED: "SESSION_REPLAY_VERIFICATION_SETTLEMENT_REQUIRED",
  SETTLEMENT_OUTCOME_MISMATCH: "SESSION_REPLAY_VERIFICATION_SETTLEMENT_OUTCOME_MISMATCH"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

function normalizeOptionalNonNegativeInteger(value, name) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return parsed;
}

function normalizeOptionalReleaseRatePct(value, name) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 100) throw new TypeError(`${name} must be an integer in range 0..100`);
  return parsed;
}

function normalizeOptionalSha256Hex(value, name) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError(`${name} must be sha256 hex`);
  return normalized;
}

function normalizeExpectedSettlement(value) {
  if (value === null || value === undefined) return null;
  assertPlainObject(value, "expectedSettlement");
  return normalizeForCanonicalJson(
    {
      status: normalizeOptionalString(value.status)?.toLowerCase() ?? null,
      disputeStatus: normalizeOptionalString(value.disputeStatus)?.toLowerCase() ?? null,
      releaseRatePct: normalizeOptionalReleaseRatePct(value.releaseRatePct, "expectedSettlement.releaseRatePct"),
      releasedAmountCents: normalizeOptionalNonNegativeInteger(
        value.releasedAmountCents,
        "expectedSettlement.releasedAmountCents"
      ),
      refundedAmountCents: normalizeOptionalNonNegativeInteger(
        value.refundedAmountCents,
        "expectedSettlement.refundedAmountCents"
      )
    },
    { path: "$.expectedSettlement" }
  );
}

function normalizeActualSettlement(value) {
  if (value === null || value === undefined) return null;
  assertPlainObject(value, "settlement");
  return normalizeForCanonicalJson(
    {
      status: normalizeOptionalString(value.status)?.toLowerCase() ?? null,
      disputeStatus: normalizeOptionalString(value.disputeStatus)?.toLowerCase() ?? null,
      releaseRatePct: normalizeOptionalReleaseRatePct(value.releaseRatePct, "settlement.releaseRatePct"),
      releasedAmountCents: normalizeOptionalNonNegativeInteger(value.releasedAmountCents, "settlement.releasedAmountCents"),
      refundedAmountCents: normalizeOptionalNonNegativeInteger(value.refundedAmountCents, "settlement.refundedAmountCents")
    },
    { path: "$.settlement" }
  );
}

function resolvePolicyDecisionHash(settlement) {
  if (!settlement || typeof settlement !== "object" || Array.isArray(settlement)) return null;
  const direct = normalizeOptionalSha256Hex(settlement.decisionPolicyHash, "settlement.decisionPolicyHash");
  if (direct) return direct;
  const fromTrace = normalizeOptionalSha256Hex(
    settlement?.decisionTrace?.policyDecisionHash,
    "settlement.decisionTrace.policyDecisionHash"
  );
  if (fromTrace) return fromTrace;
  if (settlement?.decisionTrace?.policyDecision && typeof settlement.decisionTrace.policyDecision === "object") {
    const normalized = normalizeForCanonicalJson(settlement.decisionTrace.policyDecision, { path: "$.settlement.decisionTrace.policyDecision" });
    return sha256Hex(canonicalJsonStringify(normalized));
  }
  return null;
}

function buildCheck({ id, ok, code = null, error = null, details = null }) {
  return normalizeForCanonicalJson(
    {
      id,
      ok: ok === true,
      code: code ?? null,
      error: error ?? null,
      details: details ?? null
    },
    { path: `$.checks.${id}` }
  );
}

function finalizeVerdict({
  ok,
  code = null,
  error = null,
  checks = [],
  replayPackHash = null,
  memoryExportHash = null,
  transcriptHash = null,
  policyDecisionHash = null
} = {}) {
  const normalizedChecks = Array.isArray(checks) ? checks : [];
  const failureCount = normalizedChecks.filter((check) => check.ok !== true).length;
  const base = normalizeForCanonicalJson(
    {
      schemaVersion: SESSION_REPLAY_VERIFICATION_VERDICT_SCHEMA_VERSION,
      ok: ok === true,
      code: code ?? null,
      error: error ?? null,
      replayPackHash: replayPackHash ?? null,
      memoryExportHash: memoryExportHash ?? null,
      transcriptHash: transcriptHash ?? null,
      policyDecisionHash: policyDecisionHash ?? null,
      checks: normalizedChecks,
      summary: {
        checkCount: normalizedChecks.length,
        failureCount
      }
    },
    { path: "$" }
  );
  return normalizeForCanonicalJson(
    {
      ...base,
      verdictHash: sha256Hex(canonicalJsonStringify(base))
    },
    { path: "$" }
  );
}

export function verifySessionReplayBundleV1({
  memoryExport,
  replayPack,
  transcript = null,
  memoryExportRef = null,
  signerRegistry = null,
  evaluateSignerLifecycle = null,
  signerLifecycleNow = null,
  expectedTenantId = null,
  expectedSessionId = null,
  expectedPreviousHeadChainHash = null,
  expectedPreviousPackHash = null,
  replayPackPublicKeyPem = null,
  transcriptPublicKeyPem = null,
  requireReplayPackSignature = false,
  requireTranscriptSignature = false,
  expectedPolicyDecisionHash = null,
  settlement = null,
  expectedSettlement = null
} = {}) {
  const checks = [];
  try {
    const normalizedExpectedPolicyDecisionHash = normalizeOptionalSha256Hex(
      expectedPolicyDecisionHash,
      "expectedPolicyDecisionHash"
    );
    const normalizedExpectedSettlement = normalizeExpectedSettlement(expectedSettlement);
    const normalizedActualSettlement = normalizeActualSettlement(settlement);
    const memoryExportHash = memoryExport ? sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(memoryExport, { path: "$.memoryExport" }))) : null;
    const transcriptHash =
      transcript && typeof transcript === "object" && !Array.isArray(transcript)
        ? normalizeOptionalSha256Hex(transcript?.transcriptHash ?? null, "transcript.transcriptHash")
        : null;
    const memoryImport = verifySessionMemoryContractImportV1({
      memoryExport,
      replayPack,
      transcript,
      expectedMemoryExportRef: memoryExportRef,
      signerRegistry,
      evaluateSignerLifecycle,
      signerLifecycleNow,
      expectedTenantId,
      expectedSessionId,
      expectedPreviousHeadChainHash,
      expectedPreviousPackHash,
      replayPackPublicKeyPem,
      transcriptPublicKeyPem,
      requireReplayPackSignature: requireReplayPackSignature === true,
      requireTranscriptSignature: requireTranscriptSignature === true
    });
    checks.push(
      buildCheck({
        id: "memory_contract_import",
        ok: memoryImport.ok === true,
        code:
          memoryImport.ok === true
            ? null
            : `${SESSION_REPLAY_VERIFICATION_REASON_CODES.MEMORY_CONTRACT_INVALID}:${String(memoryImport.code ?? "UNKNOWN")}`,
        error: memoryImport.ok === true ? null : memoryImport.error ?? "session memory contract verification failed",
        details:
          memoryImport.ok === true
            ? {
                memoryExportRefVerified: memoryImport.memoryExportRefVerified ?? null,
                signatureLifecycle: memoryImport.signatureLifecycle ?? null
              }
            : {
                reasonCode: memoryImport.code ?? null
              }
      })
    );
    if (!memoryImport.ok) {
      return finalizeVerdict({
        ok: false,
        code: SESSION_REPLAY_VERIFICATION_REASON_CODES.MEMORY_CONTRACT_INVALID,
        error: memoryImport.error ?? "session memory contract verification failed",
        checks,
        replayPackHash: normalizeOptionalSha256Hex(replayPack?.packHash ?? null, "replayPack.packHash"),
        memoryExportHash,
        transcriptHash,
        policyDecisionHash: null
      });
    }

    const replayPackHash = memoryImport?.replayPack?.packHash ?? null;
    let policyDecisionHash = null;
    if (normalizedExpectedPolicyDecisionHash) {
      policyDecisionHash = resolvePolicyDecisionHash(settlement);
      const policyHashOk = Boolean(policyDecisionHash) && policyDecisionHash === normalizedExpectedPolicyDecisionHash;
      checks.push(
        buildCheck({
          id: "policy_decision_hash",
          ok: policyHashOk,
          code: policyHashOk
            ? null
            : policyDecisionHash
              ? SESSION_REPLAY_VERIFICATION_REASON_CODES.POLICY_DECISION_HASH_MISMATCH
              : SESSION_REPLAY_VERIFICATION_REASON_CODES.POLICY_DECISION_HASH_MISSING,
          error: policyHashOk
            ? null
            : policyDecisionHash
              ? "policy decision hash mismatch"
              : "policy decision hash missing from settlement material",
          details: {
            expectedPolicyDecisionHash: normalizedExpectedPolicyDecisionHash,
            actualPolicyDecisionHash: policyDecisionHash ?? null
          }
        })
      );
      if (!policyHashOk) {
        return finalizeVerdict({
          ok: false,
          code: policyDecisionHash
            ? SESSION_REPLAY_VERIFICATION_REASON_CODES.POLICY_DECISION_HASH_MISMATCH
            : SESSION_REPLAY_VERIFICATION_REASON_CODES.POLICY_DECISION_HASH_MISSING,
          error: policyDecisionHash ? "policy decision hash mismatch" : "policy decision hash missing from settlement material",
          checks,
          replayPackHash,
          memoryExportHash,
          transcriptHash,
          policyDecisionHash: policyDecisionHash ?? null
        });
      }
    }

    if (normalizedExpectedSettlement) {
      const hasSettlement = Boolean(normalizedActualSettlement);
      const settlementOk =
        hasSettlement &&
        canonicalJsonStringify(normalizedExpectedSettlement) === canonicalJsonStringify(normalizedActualSettlement);
      checks.push(
        buildCheck({
          id: "settlement_outcome",
          ok: settlementOk,
          code: settlementOk
            ? null
            : hasSettlement
              ? SESSION_REPLAY_VERIFICATION_REASON_CODES.SETTLEMENT_OUTCOME_MISMATCH
              : SESSION_REPLAY_VERIFICATION_REASON_CODES.SETTLEMENT_REQUIRED,
          error: settlementOk ? null : hasSettlement ? "settlement outcome mismatch" : "settlement payload is required",
          details: {
            expectedSettlement: normalizedExpectedSettlement,
            actualSettlement: normalizedActualSettlement ?? null
          }
        })
      );
      if (!settlementOk) {
        return finalizeVerdict({
          ok: false,
          code: hasSettlement
            ? SESSION_REPLAY_VERIFICATION_REASON_CODES.SETTLEMENT_OUTCOME_MISMATCH
            : SESSION_REPLAY_VERIFICATION_REASON_CODES.SETTLEMENT_REQUIRED,
          error: hasSettlement ? "settlement outcome mismatch" : "settlement payload is required",
          checks,
          replayPackHash,
          memoryExportHash,
          transcriptHash,
          policyDecisionHash: policyDecisionHash ?? null
        });
      }
    }

    return finalizeVerdict({
      ok: true,
      code: null,
      error: null,
      checks,
      replayPackHash,
      memoryExportHash,
      transcriptHash,
      policyDecisionHash: policyDecisionHash ?? null
    });
  } catch (err) {
    checks.push(
      buildCheck({
        id: "input",
        ok: false,
        code: SESSION_REPLAY_VERIFICATION_REASON_CODES.INPUT_INVALID,
        error: err?.message ?? "invalid replay verification input"
      })
    );
    return finalizeVerdict({
      ok: false,
      code: SESSION_REPLAY_VERIFICATION_REASON_CODES.INPUT_INVALID,
      error: err?.message ?? "invalid replay verification input",
      checks
    });
  }
}
