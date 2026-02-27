import { canonicalJsonStringify, normalizeForCanonicalJson } from "../core/canonical-json.js";
import { sha256Hex } from "../core/crypto.js";
import {
  buildSessionMemoryContractHooksV1,
  verifySessionMemoryContractImportV1
} from "../services/memory/contract-hooks.js";
import {
  SESSION_REPLAY_VERIFICATION_VERDICT_SCHEMA_VERSION,
  verifySessionReplayBundleV1
} from "../services/memory/replay-verifier.js";

export const SESSION_REPLAY_EXPORT_METADATA_SCHEMA_VERSION = "SessionReplayExportMetadata.v1";

export function buildSessionMemoryExportResponseV1(args = {}) {
  const { memoryExport, memoryExportRef } = buildSessionMemoryContractHooksV1(args);
  return {
    ok: true,
    memoryExport,
    memoryExportRef
  };
}

export function verifySessionMemoryImportRequestV1(args = {}) {
  return verifySessionMemoryContractImportV1(args);
}

export function buildSessionReplayExportMetadataV1({
  replayPack,
  transcript = null,
  memoryExport,
  memoryExportRef,
  importVerification
} = {}) {
  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: SESSION_REPLAY_EXPORT_METADATA_SCHEMA_VERSION,
      tenantId: replayPack?.tenantId ?? memoryExport?.tenantId ?? null,
      sessionId: replayPack?.sessionId ?? memoryExport?.sessionId ?? null,
      replayPackHash: replayPack?.packHash ?? null,
      transcriptHash: transcript?.transcriptHash ?? null,
      memoryExportHash: memoryExport ? sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(memoryExport, { path: "$.memoryExport" }))) : null,
      memoryExportRefHash: memoryExportRef?.artifactHash ?? null,
      dependencyChecks: {
        replayPackPresent: Boolean(replayPack),
        transcriptPresent: transcript ? true : false,
        memoryExportPresent: Boolean(memoryExport),
        memoryExportRefPresent: Boolean(memoryExportRef),
        importVerified: importVerification?.ok === true,
        importReasonCode: importVerification?.ok === true ? null : importVerification?.code ?? null
      }
    },
    { path: "$.sessionReplayExportMetadata" }
  );
  return normalizeForCanonicalJson(
    {
      ...normalized,
      exportHash: sha256Hex(canonicalJsonStringify(normalized))
    },
    { path: "$.sessionReplayExportMetadata" }
  );
}

export function verifySessionReplayRequestV1(args = {}) {
  const verdict = verifySessionReplayBundleV1(args);
  return {
    ok: verdict.ok === true,
    schemaVersion: SESSION_REPLAY_VERIFICATION_VERDICT_SCHEMA_VERSION,
    verdict
  };
}
