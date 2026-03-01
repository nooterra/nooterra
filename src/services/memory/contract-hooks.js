import {
  buildSessionMemoryExportV1,
  verifySessionMemoryImportV1,
  SESSION_MEMORY_IMPORT_REASON_CODES
} from "../../core/session-replay-pack.js";
import {
  buildArtifactRefFromPayloadV1,
  verifyArtifactRefPayloadBindingV1,
  ARTIFACT_REF_PAYLOAD_BINDING_REASON_CODES
} from "../../core/artifact-ref.js";
import { normalizeForCanonicalJson } from "../../core/canonical-json.js";
import { evaluateSignerLifecycleForContinuity } from "../identity/signer-lifecycle.js";

export const SESSION_MEMORY_CONTRACT_REASON_CODES = Object.freeze({
  ...SESSION_MEMORY_IMPORT_REASON_CODES,
  MEMORY_EXPORT_REF_INVALID: "SESSION_MEMORY_EXPORT_REF_INVALID",
  MEMORY_EXPORT_REF_TAMPERED: "SESSION_MEMORY_EXPORT_REF_TAMPERED",
  REPLAY_PACK_SIGNER_LIFECYCLE_INVALID: "SESSION_MEMORY_REPLAY_PACK_SIGNER_LIFECYCLE_INVALID",
  TRANSCRIPT_SIGNER_LIFECYCLE_INVALID: "SESSION_MEMORY_TRANSCRIPT_SIGNER_LIFECYCLE_INVALID"
});

function normalizeEvaluateSignerLifecycle(evaluateSignerLifecycle) {
  if (evaluateSignerLifecycle === undefined || evaluateSignerLifecycle === null) {
    return null;
  }
  if (typeof evaluateSignerLifecycle !== "function") {
    throw new TypeError("evaluateSignerLifecycle must be a function");
  }
  return evaluateSignerLifecycle;
}

function verifyOptionalSignatureLifecycle({
  label,
  reasonCode,
  signedArtifact,
  evaluateSignerLifecycle,
  signerRegistry,
  signerLifecycleNow = null
} = {}) {
  const signature =
    signedArtifact && typeof signedArtifact === "object" && !Array.isArray(signedArtifact)
      ? signedArtifact.signature
      : null;
  if (!signature || typeof signature !== "object" || Array.isArray(signature)) {
    return { ok: true, code: null, error: null };
  }

  const signerKeyId = typeof signature.keyId === "string" && signature.keyId.trim() !== "" ? signature.keyId.trim() : null;
  const signedAt = typeof signature.signedAt === "string" && signature.signedAt.trim() !== "" ? signature.signedAt.trim() : null;
  if (!signerKeyId || !signedAt) {
    return {
      ok: false,
      code: reasonCode,
      error: `${label} signature lifecycle metadata is incomplete`
    };
  }

  const signerKey = signerRegistry instanceof Map ? signerRegistry.get(signerKeyId) ?? null : null;
  const lifecycle =
    evaluateSignerLifecycle === null
      ? evaluateSignerLifecycleForContinuity({
          signerKey,
          at: signedAt,
          now: signerLifecycleNow,
          requireRegistered: signerRegistry instanceof Map
        })
      : evaluateSignerLifecycle({ signerKeyId, signedAt, signerKey, label, now: signerLifecycleNow });

  if (!lifecycle || lifecycle.ok !== true) {
    return {
      ok: false,
      code: reasonCode,
      error: lifecycle?.error ?? `${label} signature signer lifecycle invalid`,
      details: {
        signerKeyId,
        signedAt,
        reasonCode: lifecycle?.code ?? null,
        signerStatus: lifecycle?.signerStatus ?? null,
        rotatedAt: lifecycle?.rotatedAt ?? null,
        revokedAt: lifecycle?.revokedAt ?? null
      }
    };
  }

  return {
    ok: true,
    code: null,
    error: null,
    lifecycle: normalizeForCanonicalJson(
      {
        signerKeyId,
        signedAt,
        signerStatus: lifecycle?.signerStatus ?? null,
        validFrom: lifecycle?.validFrom ?? null,
        validTo: lifecycle?.validTo ?? null,
        rotatedAt: lifecycle?.rotatedAt ?? null,
        revokedAt: lifecycle?.revokedAt ?? null,
        validAt: lifecycle?.validAt ?? null,
        validNow: lifecycle?.validNow ?? null
      },
      { path: `$.${label.replaceAll(" ", "_")}.lifecycle` }
    )
  };
}

export function buildSessionMemoryContractHooksV1({
  replayPack,
  transcript = null,
  exportId = null,
  exportedAt = null,
  previousHeadChainHash = null,
  previousPackHash = null,
  memoryExportArtifactId = null,
  tenantId = null,
  workspace = null,
  migration = null
} = {}) {
  const memoryExport = buildSessionMemoryExportV1({
    replayPack,
    transcript,
    exportId,
    exportedAt,
    previousHeadChainHash,
    previousPackHash,
    workspace,
    migration
  });

  const normalizedTenantId =
    typeof tenantId === "string" && tenantId.trim() !== "" ? tenantId.trim() : memoryExport.tenantId;
  const artifactId =
    typeof memoryExportArtifactId === "string" && memoryExportArtifactId.trim() !== ""
      ? memoryExportArtifactId.trim()
      : `session_memory_export_${memoryExport.replayPackHash}`;

  const memoryExportRef = buildArtifactRefFromPayloadV1({
    artifactId,
    artifactType: memoryExport.schemaVersion,
    tenantId: normalizedTenantId,
    payload: memoryExport
  });

  return {
    memoryExport,
    memoryExportRef
  };
}

export function verifySessionMemoryContractImportV1({
  memoryExport,
  replayPack,
  transcript = null,
  expectedMemoryExportRef = null,
  signerRegistry = null,
  evaluateSignerLifecycle = null,
  expectedTenantId = null,
  expectedSessionId = null,
  expectedWorkspace = null,
  expectedMigration = null,
  expectedPreviousHeadChainHash = null,
  expectedPreviousPackHash = null,
  replayPackPublicKeyPem = null,
  transcriptPublicKeyPem = null,
  requireReplayPackSignature = false,
  requireTranscriptSignature = false,
  signerLifecycleNow = null
} = {}) {
  if (expectedMemoryExportRef !== null && expectedMemoryExportRef !== undefined) {
    const binding = verifyArtifactRefPayloadBindingV1({
      artifactRef: expectedMemoryExportRef,
      payload: memoryExport
    });
    if (!binding.ok) {
      return {
        ok: false,
        code:
          binding.code === ARTIFACT_REF_PAYLOAD_BINDING_REASON_CODES.HASH_MISMATCH
            ? SESSION_MEMORY_CONTRACT_REASON_CODES.MEMORY_EXPORT_REF_TAMPERED
            : SESSION_MEMORY_CONTRACT_REASON_CODES.MEMORY_EXPORT_REF_INVALID,
        error: binding.error ?? "memory export artifact ref binding failed",
        details: binding
      };
    }
  }

  const verified = verifySessionMemoryImportV1({
    memoryExport,
    replayPack,
    transcript,
    expectedTenantId,
    expectedSessionId,
    expectedWorkspace,
    expectedMigration,
    expectedPreviousHeadChainHash,
    expectedPreviousPackHash,
    replayPackPublicKeyPem,
    transcriptPublicKeyPem,
    requireReplayPackSignature,
    requireTranscriptSignature
  });
  if (!verified.ok) return verified;

  const evaluateLifecycle = normalizeEvaluateSignerLifecycle(evaluateSignerLifecycle);

  const replayLifecycle = verifyOptionalSignatureLifecycle({
    label: "replay pack",
    reasonCode: SESSION_MEMORY_CONTRACT_REASON_CODES.REPLAY_PACK_SIGNER_LIFECYCLE_INVALID,
    signedArtifact: verified.replayPack,
    evaluateSignerLifecycle: evaluateLifecycle,
    signerRegistry,
    signerLifecycleNow
  });
  if (!replayLifecycle.ok) return replayLifecycle;

  const transcriptLifecycle = verifyOptionalSignatureLifecycle({
    label: "transcript",
    reasonCode: SESSION_MEMORY_CONTRACT_REASON_CODES.TRANSCRIPT_SIGNER_LIFECYCLE_INVALID,
    signedArtifact: verified.transcript,
    evaluateSignerLifecycle: evaluateLifecycle,
    signerRegistry,
    signerLifecycleNow
  });
  if (!transcriptLifecycle.ok) return transcriptLifecycle;

  return {
    ...verified,
    memoryExportRefVerified: expectedMemoryExportRef ? true : null,
    signatureLifecycle: normalizeForCanonicalJson(
      {
        replayPack: replayLifecycle.lifecycle ?? null,
        transcript: transcriptLifecycle.lifecycle ?? null
      },
      { path: "$.signatureLifecycle" }
    )
  };
}
