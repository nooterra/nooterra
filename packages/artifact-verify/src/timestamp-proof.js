import { canonicalJsonStringify } from "./canonical-json.js";
import { sha256HexUtf8, verifyHashHexEd25519 } from "./crypto.js";

export const TIMESTAMP_PROOF_SCHEMA_V1 = "TimestampProof.v1";
export const TIMESTAMP_PROOF_KIND = Object.freeze({
  ED25519_TIME_AUTHORITY: "ed25519_time_authority"
});

function stripTimestampProof(value) {
  const { timestampProof: _tp, ...rest } = value ?? {};
  return rest;
}

function stripTimestampProofSig(proof) {
  const { signature: _sig, ...rest } = proof ?? {};
  return rest;
}

export function verifyTimestampProofV1({ documentCoreWithProof, trustedPublicKeyByKeyId } = {}) {
  const proof = documentCoreWithProof?.timestampProof ?? null;
  if (!proof) return { ok: false, error: "missing timestampProof" };
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return { ok: false, error: "timestampProof must be an object" };
  if (String(proof.schemaVersion ?? "") !== TIMESTAMP_PROOF_SCHEMA_V1) return { ok: false, error: "unsupported timestampProof schemaVersion", schemaVersion: proof.schemaVersion ?? null };
  if (String(proof.kind ?? "") !== TIMESTAMP_PROOF_KIND.ED25519_TIME_AUTHORITY) return { ok: false, error: "unsupported timestampProof kind", kind: proof.kind ?? null };
  const timestamp = typeof proof.timestamp === "string" && proof.timestamp.trim() ? proof.timestamp : null;
  const messageHash = typeof proof.messageHash === "string" && proof.messageHash.trim() ? proof.messageHash : null;
  const signerKeyId = typeof proof.signerKeyId === "string" && proof.signerKeyId.trim() ? proof.signerKeyId : null;
  const signature = typeof proof.signature === "string" && proof.signature.trim() ? proof.signature : null;
  if (!timestamp || !messageHash || !signerKeyId || !signature) return { ok: false, error: "timestampProof missing required fields" };
  if (!/^[0-9a-f]{64}$/.test(messageHash)) return { ok: false, error: "timestampProof messageHash invalid", messageHash };
  if (!(trustedPublicKeyByKeyId instanceof Map)) return { ok: false, error: "trustedPublicKeyByKeyId must be a Map" };
  const publicKeyPem = trustedPublicKeyByKeyId.get(signerKeyId) ?? null;
  if (!publicKeyPem) return { ok: false, error: "timestampProof signerKeyId not trusted", signerKeyId };

  // messageHash binds to the document's core payload without timestampProof.
  const coreWithoutProof = stripTimestampProof(documentCoreWithProof);
  const expectedMessageHash = sha256HexUtf8(canonicalJsonStringify(coreWithoutProof));
  if (expectedMessageHash !== messageHash) {
    return { ok: false, error: "timestampProof messageHash mismatch", expected: expectedMessageHash, actual: messageHash };
  }

  const proofCore = stripTimestampProofSig(proof);
  const proofHash = sha256HexUtf8(canonicalJsonStringify(proofCore));
  const okSig = verifyHashHexEd25519({ hashHex: proofHash, signatureBase64: signature, publicKeyPem });
  if (!okSig) return { ok: false, error: "timestampProof signature invalid", signerKeyId };

  return { ok: true, timestamp, signerKeyId, messageHash };
}

