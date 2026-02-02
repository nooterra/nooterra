import { canonicalJsonStringify } from "./canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "./crypto.js";

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

export const TIMESTAMP_PROOF_SCHEMA_V1 = "TimestampProof.v1";

export const TIMESTAMP_PROOF_KIND = Object.freeze({
  ED25519_TIME_AUTHORITY: "ed25519_time_authority"
});

function isHex64(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function buildTimestampProofV1({ messageHash, timestamp, signer } = {}) {
  if (!isHex64(messageHash)) throw new TypeError("messageHash must be a 64-char lowercase hex sha256");
  assertNonEmptyString(timestamp, "timestamp");
  if (!signer || typeof signer !== "object") throw new TypeError("signer is required");
  assertNonEmptyString(signer.keyId, "signer.keyId");
  assertNonEmptyString(signer.privateKeyPem, "signer.privateKeyPem");

  const core = {
    schemaVersion: TIMESTAMP_PROOF_SCHEMA_V1,
    kind: TIMESTAMP_PROOF_KIND.ED25519_TIME_AUTHORITY,
    timestamp,
    messageHash,
    signerKeyId: signer.keyId
  };
  const proofHash = sha256Hex(canonicalJsonStringify(core));
  const signature = signHashHexEd25519(proofHash, signer.privateKeyPem);
  return { ...core, signature };
}

